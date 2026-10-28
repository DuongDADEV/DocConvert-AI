-- ==============================================================================
-- MIGRATION: 20261006010000_fix_partial_credit_reservation_status.sql
-- DESCRIPTION: Phase 3B.5 — Fix partial settlement reservation status bug
--   Corrects regression in 20261003010000_credit_settlement_and_free_bootstrap_patch.sql
--   where partial capture/release emitted 'ACTIVE', violating check constraint
--   chk_credit_reservations_status and TypeScript CreditReservationStatus vocabulary.
--   Enforces canonical status vocabulary:
--     - Outstanding held units with partial capture -> 'PARTIALLY_CAPTURED'
--     - Outstanding held units with zero capture -> 'RESERVED'
--     - Fully captured without release -> 'CAPTURED'
--     - Fully released without capture -> 'RELEASED'
--     - Settled with both capture and release -> 'SETTLED'
-- ==============================================================================

-- 1. REPLACED ATOMIC RPC: capture_credit_reservation (Phase 3B.5 Patch)
CREATE OR REPLACE FUNCTION public.capture_credit_reservation(
    p_user_id UUID,
    p_reservation_id UUID,
    p_capture_units BIGINT,
    p_idempotency_key TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_reservation RECORD;
    v_account_status VARCHAR;
    v_existing_event RECORD;
    v_outstanding BIGINT;
    v_remaining_to_capture BIGINT;
    v_alloc RECORD;
    v_alloc_outstanding BIGINT;
    v_capture_amount BIGINT;
    v_grant RECORD;
    v_new_remaining BIGINT;
    v_new_reserved BIGINT;
    v_grant_status VARCHAR;
    v_running_gross_balance BIGINT;
    v_new_captured BIGINT;
    v_new_outstanding BIGINT;
    v_new_status VARCHAR;
    v_settled_at TIMESTAMPTZ := NULL;
    v_sum_captured BIGINT;
    v_sum_released BIGINT;
    v_sum_reserved BIGINT;
BEGIN
    -- 1. Input Validation
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_user_id is required';
    END IF;
    IF p_reservation_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_reservation_id is required';
    END IF;
    IF p_capture_units IS NULL OR p_capture_units <= 0 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_capture_units must be positive';
    END IF;
    IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_idempotency_key is required';
    END IF;

    -- 2. Concurrency Safety: Transaction-scoped advisory lock on idempotency key
    PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key));

    -- 3. Idempotency Check via credit_reservation_events
    SELECT * INTO v_existing_event
    FROM public.credit_reservation_events
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_event.reservation_id <> p_reservation_id
           OR v_existing_event.event_type <> 'CAPTURE'
           OR v_existing_event.units <> p_capture_units
           OR v_existing_event.user_id <> p_user_id
        THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT: Capture idempotency key "%" was already processed with a different business payload', p_idempotency_key;
        END IF;

        SELECT * INTO v_reservation FROM public.credit_reservations WHERE id = p_reservation_id;
        v_outstanding := v_reservation.reserved_units - v_reservation.captured_units - v_reservation.released_units;

        RETURN jsonb_build_object(
            'reservation_id', p_reservation_id,
            'account_id', v_reservation.account_id,
            'user_id', p_user_id,
            'captured_units', p_capture_units,
            'total_captured_units', v_reservation.captured_units,
            'outstanding_units', v_outstanding,
            'status', v_reservation.status,
            'already_processed', true
        );
    END IF;

    -- 4. Lock Reservation Header
    SELECT * INTO v_reservation
    FROM public.credit_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RESERVATION_NOT_FOUND: Reservation % not found', p_reservation_id;
    END IF;

    IF v_reservation.user_id <> p_user_id THEN
        RAISE EXCEPTION 'RESERVATION_NOT_FOUND: Reservation % does not belong to user %', p_reservation_id, p_user_id;
    END IF;

    -- 5. Lock and Check User Account Status
    -- Phase 3A.3 Settlement Semantics: FROZEN accounts ALLOW CAPTURE; CLOSED accounts reject CAPTURE
    SELECT status INTO v_account_status
    FROM public.credit_accounts
    WHERE id = v_reservation.account_id
    FOR UPDATE;

    IF v_account_status = 'CLOSED' THEN
        RAISE EXCEPTION 'CREDIT_ACCOUNT_CLOSED: Cannot capture on closed account';
    END IF;

    -- 6. Validate Capture against Outstanding Reserved Units and Terminal State
    v_outstanding := v_reservation.reserved_units - v_reservation.captured_units - v_reservation.released_units;
    IF v_reservation.status IN ('CAPTURED', 'RELEASED', 'SETTLED', 'EXPIRED') OR v_outstanding <= 0 THEN
        RAISE EXCEPTION 'RESERVATION_ALREADY_SETTLED: Reservation % is already in terminal status %',
            p_reservation_id, v_reservation.status;
    END IF;

    IF p_capture_units > v_outstanding THEN
        RAISE EXCEPTION 'CAPTURE_EXCEEDS_RESERVED: Cannot capture % units; only % outstanding on reservation %',
            p_capture_units, v_outstanding, p_reservation_id;
    END IF;

    -- 7. Initialize Running Gross Balance for Multi-Grant Ledger Accounting
    SELECT COALESCE(SUM(remaining_units), 0)
    INTO v_running_gross_balance
    FROM public.credit_grants
    WHERE account_id = v_reservation.account_id
      AND remaining_units > 0;

    -- 8. Deduct from Allocations in Deterministic Order
    v_remaining_to_capture := p_capture_units;

    FOR v_alloc IN
        SELECT *
        FROM public.credit_reservation_allocations
        WHERE reservation_id = p_reservation_id
          AND (allocated_units - captured_units - released_units) > 0
        ORDER BY allocation_order ASC
        FOR UPDATE
    LOOP
        EXIT WHEN v_remaining_to_capture <= 0;

        v_alloc_outstanding := v_alloc.allocated_units - v_alloc.captured_units - v_alloc.released_units;
        v_capture_amount := LEAST(v_remaining_to_capture, v_alloc_outstanding);

        SELECT * INTO v_grant
        FROM public.credit_grants
        WHERE id = v_alloc.grant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CORRUPT_RESERVATION_ALLOCATION: Grant % referenced in allocation % not found',
                v_alloc.grant_id, v_alloc.id;
        END IF;

        IF v_grant.reserved_units < v_capture_amount THEN
            RAISE EXCEPTION 'CORRUPT_RESERVATION_ALLOCATION: Grant % reserved_units (%) < capture_amount (%)',
                v_grant.id, v_grant.reserved_units, v_capture_amount;
        END IF;
        IF v_grant.remaining_units < v_capture_amount THEN
            RAISE EXCEPTION 'CORRUPT_RESERVATION_ALLOCATION: Grant % remaining_units (%) < capture_amount (%)',
                v_grant.id, v_grant.remaining_units, v_capture_amount;
        END IF;

        v_new_remaining := v_grant.remaining_units - v_capture_amount;
        v_new_reserved  := v_grant.reserved_units  - v_capture_amount;
        v_grant_status  := CASE WHEN v_new_remaining = 0 THEN 'DEPLETED' ELSE v_grant.status END;

        UPDATE public.credit_grants
        SET remaining_units = v_new_remaining,
            reserved_units  = v_new_reserved,
            status          = v_grant_status,
            updated_at      = NOW()
        WHERE id = v_grant.id;

        UPDATE public.credit_reservation_allocations
        SET captured_units = captured_units + v_capture_amount,
            updated_at     = NOW()
        WHERE id = v_alloc.id;

        v_running_gross_balance := v_running_gross_balance - v_capture_amount;

        INSERT INTO public.credit_ledger (
            account_id,
            user_id,
            grant_id,
            entry_type,
            delta_units,
            balance_after_units,
            reference_type,
            reference_id,
            idempotency_key,
            description,
            metadata
        ) VALUES (
            v_reservation.account_id,
            p_user_id,
            v_grant.id,
            'CAPTURE',
            -v_capture_amount,
            v_running_gross_balance,
            COALESCE(v_reservation.reference_type, 'RESERVATION'),
            COALESCE(v_reservation.reference_id, p_reservation_id::text),
            p_idempotency_key || ':grant:' || v_grant.id,
            'Reservation capture deduction from grant ' || v_grant.id,
            jsonb_build_object(
                'reservation_id', p_reservation_id,
                'allocation_id', v_alloc.id,
                'captured_from_grant', v_capture_amount,
                'source_type', v_grant.source_type
            ) || p_metadata
        );

        v_remaining_to_capture := v_remaining_to_capture - v_capture_amount;
    END LOOP;

    IF v_remaining_to_capture > 0 THEN
        RAISE EXCEPTION 'CORRUPT_RESERVATION_ALLOCATION: Could not fully satisfy capture of % units across allocations (% remaining unallocated)',
            p_capture_units, v_remaining_to_capture;
    END IF;

    -- 9. Log Operation in credit_reservation_events
    INSERT INTO public.credit_reservation_events (
        reservation_id,
        user_id,
        account_id,
        event_type,
        units,
        idempotency_key,
        metadata
    ) VALUES (
        p_reservation_id,
        p_user_id,
        v_reservation.account_id,
        'CAPTURE',
        p_capture_units,
        p_idempotency_key,
        jsonb_build_object('captured_units', p_capture_units) || p_metadata
    );

    -- 10. Update Reservation Status (Phase 3B.5: PARTIALLY_CAPTURED replaces invalid ACTIVE)
    v_new_captured := v_reservation.captured_units + p_capture_units;
    v_new_outstanding := v_reservation.reserved_units - v_new_captured - v_reservation.released_units;

    IF v_new_outstanding = 0 THEN
        IF v_reservation.released_units = 0 THEN
            v_new_status := 'CAPTURED';
        ELSE
            v_new_status := 'SETTLED';
        END IF;
        v_settled_at := NOW();
    ELSE
        v_new_status := 'PARTIALLY_CAPTURED';
    END IF;

    UPDATE public.credit_reservations
    SET captured_units = v_new_captured,
        status         = v_new_status,
        settled_at     = COALESCE(settled_at, v_settled_at),
        updated_at     = NOW()
    WHERE id = p_reservation_id;

    -- 11. Post-condition Cross-table Reconciliation Check
    SELECT
        COALESCE(SUM(captured_units), 0),
        COALESCE(SUM(released_units), 0),
        COALESCE(SUM(allocated_units), 0)
    INTO v_sum_captured, v_sum_released, v_sum_reserved
    FROM public.credit_reservation_allocations
    WHERE reservation_id = p_reservation_id;

    IF v_sum_captured <> v_new_captured THEN
        RAISE EXCEPTION 'CROSS_TABLE_CORRUPTION: Allocations sum captured (%) != reservation captured (%)',
            v_sum_captured, v_new_captured;
    END IF;
    IF v_sum_reserved <> v_reservation.reserved_units THEN
        RAISE EXCEPTION 'CROSS_TABLE_CORRUPTION: Allocations sum allocated (%) != reservation reserved (%)',
            v_sum_reserved, v_reservation.reserved_units;
    END IF;

    RETURN jsonb_build_object(
        'reservation_id', p_reservation_id,
        'account_id', v_reservation.account_id,
        'user_id', p_user_id,
        'captured_units', p_capture_units,
        'total_captured_units', v_new_captured,
        'outstanding_units', v_new_outstanding,
        'status', v_new_status,
        'already_processed', false
    );
END;
$$;

-- Permissions for capture_credit_reservation:
REVOKE ALL ON FUNCTION public.capture_credit_reservation(UUID, UUID, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_credit_reservation(UUID, UUID, BIGINT, TEXT, JSONB) TO postgres, service_role;


-- 2. REPLACED ATOMIC RPC: release_credit_reservation (Phase 3B.5 Patch)
CREATE OR REPLACE FUNCTION public.release_credit_reservation(
    p_user_id UUID,
    p_reservation_id UUID,
    p_release_units BIGINT,
    p_idempotency_key TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_reservation RECORD;
    v_account_status VARCHAR;
    v_existing_event RECORD;
    v_outstanding BIGINT;
    v_remaining_to_release BIGINT;
    v_alloc RECORD;
    v_alloc_outstanding BIGINT;
    v_release_amount BIGINT;
    v_grant RECORD;
    v_new_reserved BIGINT;
    v_new_released BIGINT;
    v_new_outstanding BIGINT;
    v_new_status VARCHAR;
    v_settled_at TIMESTAMPTZ := NULL;
    v_sum_captured BIGINT;
    v_sum_released BIGINT;
    v_sum_reserved BIGINT;
BEGIN
    -- 1. Input Validation
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_user_id is required';
    END IF;
    IF p_reservation_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_reservation_id is required';
    END IF;
    IF p_release_units IS NULL OR p_release_units <= 0 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_release_units must be positive';
    END IF;
    IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_idempotency_key is required';
    END IF;

    -- 2. Concurrency Safety: Transaction-scoped advisory lock on idempotency key
    PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key));

    -- 3. Idempotency Check via credit_reservation_events
    SELECT * INTO v_existing_event
    FROM public.credit_reservation_events
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_event.reservation_id <> p_reservation_id
           OR v_existing_event.event_type <> 'RELEASE'
           OR v_existing_event.units <> p_release_units
           OR v_existing_event.user_id <> p_user_id
        THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT: Release idempotency key "%" was already processed with a different business payload', p_idempotency_key;
        END IF;

        SELECT * INTO v_reservation FROM public.credit_reservations WHERE id = p_reservation_id;
        v_outstanding := v_reservation.reserved_units - v_reservation.captured_units - v_reservation.released_units;

        RETURN jsonb_build_object(
            'reservation_id', p_reservation_id,
            'account_id', v_reservation.account_id,
            'user_id', p_user_id,
            'released_units', p_release_units,
            'total_released_units', v_reservation.released_units,
            'outstanding_units', v_outstanding,
            'status', v_reservation.status,
            'already_processed', true
        );
    END IF;

    -- 4. Lock Reservation Header
    SELECT * INTO v_reservation
    FROM public.credit_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RESERVATION_NOT_FOUND: Reservation % not found', p_reservation_id;
    END IF;

    IF v_reservation.user_id <> p_user_id THEN
        RAISE EXCEPTION 'RESERVATION_NOT_FOUND: Reservation % does not belong to user %', p_reservation_id, p_user_id;
    END IF;

    -- 5. Lock and Check User Account Status
    -- Phase 3A.3 Settlement Semantics: FROZEN & CLOSED accounts ALLOW RELEASE
    SELECT status INTO v_account_status
    FROM public.credit_accounts
    WHERE id = v_reservation.account_id
    FOR UPDATE;

    -- 6. Validate Release against Outstanding Reserved Units and Terminal State
    v_outstanding := v_reservation.reserved_units - v_reservation.captured_units - v_reservation.released_units;
    IF v_reservation.status IN ('CAPTURED', 'RELEASED', 'SETTLED', 'EXPIRED') OR v_outstanding <= 0 THEN
        RAISE EXCEPTION 'RESERVATION_ALREADY_SETTLED: Reservation % is already in terminal status %',
            p_reservation_id, v_reservation.status;
    END IF;

    IF p_release_units > v_outstanding THEN
        RAISE EXCEPTION 'RELEASE_EXCEEDS_RESERVED: Cannot release % units; only % outstanding on reservation %',
            p_release_units, v_outstanding, p_reservation_id;
    END IF;

    -- 7. Deduct from Allocations in REVERSE Order (LIFO)
    v_remaining_to_release := p_release_units;

    FOR v_alloc IN
        SELECT *
        FROM public.credit_reservation_allocations
        WHERE reservation_id = p_reservation_id
          AND (allocated_units - captured_units - released_units) > 0
        ORDER BY allocation_order DESC
        FOR UPDATE
    LOOP
        EXIT WHEN v_remaining_to_release <= 0;

        v_alloc_outstanding := v_alloc.allocated_units - v_alloc.captured_units - v_alloc.released_units;
        v_release_amount := LEAST(v_remaining_to_release, v_alloc_outstanding);

        SELECT * INTO v_grant
        FROM public.credit_grants
        WHERE id = v_alloc.grant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CORRUPT_RESERVATION_ALLOCATION: Grant % referenced in allocation % not found',
                v_alloc.grant_id, v_alloc.id;
        END IF;

        IF v_grant.reserved_units < v_release_amount THEN
            RAISE EXCEPTION 'CORRUPT_RESERVATION_ALLOCATION: Grant % reserved_units (%) < release_amount (%)',
                v_grant.id, v_grant.reserved_units, v_release_amount;
        END IF;

        v_new_reserved := v_grant.reserved_units - v_release_amount;

        UPDATE public.credit_grants
        SET reserved_units = v_new_reserved,
            updated_at     = NOW()
        WHERE id = v_grant.id;

        UPDATE public.credit_reservation_allocations
        SET released_units = released_units + v_release_amount,
            updated_at     = NOW()
        WHERE id = v_alloc.id;

        v_remaining_to_release := v_remaining_to_release - v_release_amount;
    END LOOP;

    IF v_remaining_to_release > 0 THEN
        RAISE EXCEPTION 'CORRUPT_RESERVATION_ALLOCATION: Could not satisfy release of % units across allocations (% remaining)',
            p_release_units, v_remaining_to_release;
    END IF;

    -- 8. Log Operational Event in credit_reservation_events
    INSERT INTO public.credit_reservation_events (
        reservation_id,
        user_id,
        account_id,
        event_type,
        units,
        idempotency_key,
        metadata
    ) VALUES (
        p_reservation_id,
        p_user_id,
        v_reservation.account_id,
        'RELEASE',
        p_release_units,
        p_idempotency_key,
        jsonb_build_object('released_units', p_release_units) || p_metadata
    );

    -- 9. Update Reservation Status (Phase 3B.5: PARTIALLY_CAPTURED/RESERVED replaces invalid ACTIVE)
    v_new_released := v_reservation.released_units + p_release_units;
    v_new_outstanding := v_reservation.reserved_units - v_reservation.captured_units - v_new_released;

    IF v_new_outstanding = 0 THEN
        IF v_reservation.captured_units = 0 THEN
            v_new_status := 'RELEASED';
        ELSE
            v_new_status := 'SETTLED';
        END IF;
        v_settled_at := NOW();
    ELSE
        IF v_reservation.captured_units > 0 THEN
            v_new_status := 'PARTIALLY_CAPTURED';
        ELSE
            v_new_status := 'RESERVED';
        END IF;
    END IF;

    UPDATE public.credit_reservations
    SET released_units = v_new_released,
        status         = v_new_status,
        settled_at     = COALESCE(settled_at, v_settled_at),
        updated_at     = NOW()
    WHERE id = p_reservation_id;

    -- 10. Post-condition Cross-table Reconciliation Check
    SELECT
        COALESCE(SUM(captured_units), 0),
        COALESCE(SUM(released_units), 0),
        COALESCE(SUM(allocated_units), 0)
    INTO v_sum_captured, v_sum_released, v_sum_reserved
    FROM public.credit_reservation_allocations
    WHERE reservation_id = p_reservation_id;

    IF v_sum_released <> v_new_released THEN
        RAISE EXCEPTION 'CROSS_TABLE_CORRUPTION: Allocations sum released (%) != reservation released (%)',
            v_sum_released, v_new_released;
    END IF;
    IF v_sum_reserved <> v_reservation.reserved_units THEN
        RAISE EXCEPTION 'CROSS_TABLE_CORRUPTION: Allocations sum allocated (%) != reservation reserved (%)',
            v_sum_reserved, v_reservation.reserved_units;
    END IF;

    RETURN jsonb_build_object(
        'reservation_id', p_reservation_id,
        'account_id', v_reservation.account_id,
        'user_id', p_user_id,
        'released_units', p_release_units,
        'total_released_units', v_new_released,
        'outstanding_units', v_new_outstanding,
        'status', v_new_status,
        'already_processed', false
    );
END;
$$;

-- Permissions for release_credit_reservation:
REVOKE ALL ON FUNCTION public.release_credit_reservation(UUID, UUID, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_credit_reservation(UUID, UUID, BIGINT, TEXT, JSONB) TO postgres, service_role;
