-- ==============================================================================
-- MIGRATION: 20260930050000_cleanup_phase13_test_artifacts.sql
-- DESCRIPTION:
-- Phase 1.3.1 — Safely remove ONLY the known Phase 1.3 billing test artifacts.
--
-- SAFETY PRINCIPLES:
--   1. Targets exact audited UUIDs only.
--   2. Fails closed if database state differs from the audited state.
--   3. Never touches pricing-v1 or production commercial products.
--   4. Verifies no customer subscription references test products.
--   5. Disables only the specific immutability triggers required for cleanup.
--   6. PostgreSQL transaction rollback restores all changes if any step fails.
-- ==============================================================================

DO $$
DECLARE
    v_version_count INT;
    v_product_count INT;
    v_price_count INT;
    v_grant_count INT;
    v_entitlement_count INT;
    v_subscription_count INT;
    v_production_product_count INT;
BEGIN

    ---------------------------------------------------------------------------
    -- 1. HARD GUARD — pricing-v1 must exist and remain locked
    ---------------------------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM public.pricing_versions
        WHERE code = 'pricing-v1'
          AND active = true
          AND is_locked = true
    ) THEN
        RAISE EXCEPTION
            'SAFETY_ERROR: pricing-v1 is missing, inactive, or unlocked. Cleanup aborted.';
    END IF;


    ---------------------------------------------------------------------------
    -- 2. AUDIT EXACT KNOWN TEST PRICING VERSIONS
    ---------------------------------------------------------------------------

    SELECT COUNT(*)
    INTO v_version_count
    FROM public.pricing_versions
    WHERE id IN (
        'd4eeaa9f-1879-4499-97e9-170e362c6f0f'::uuid,
        'c4b658a6-facf-4be0-ade5-71ad319678a9'::uuid,
        '56443755-cd6d-4703-aef1-c738fdf62372'::uuid,
        '4b487a36-2be4-41d0-9c25-702ceb55af14'::uuid
    )
    AND code LIKE '__TEST_%';


    ---------------------------------------------------------------------------
    -- 3. AUDIT EXACT KNOWN TEST PRODUCTS
    ---------------------------------------------------------------------------

    SELECT COUNT(*)
    INTO v_product_count
    FROM public.billing_products
    WHERE id IN (
        '7ae2f7a8-dd91-4b47-aa5f-35d0380499c3'::uuid,
        '9619747e-9d60-44e1-8485-6dd159e01366'::uuid,
        '924e1ebe-2553-470c-b29d-6ca7a8152e90'::uuid,
        '2c7ebebd-7ec7-464b-8b43-482c122036b4'::uuid
    )
    AND code LIKE '__TEST_%';


    ---------------------------------------------------------------------------
    -- 4. AUDIT CHILD RECORDS
    ---------------------------------------------------------------------------

    SELECT COUNT(*)
    INTO v_price_count
    FROM public.billing_prices
    WHERE pricing_version_id IN (
        'd4eeaa9f-1879-4499-97e9-170e362c6f0f'::uuid,
        'c4b658a6-facf-4be0-ade5-71ad319678a9'::uuid,
        '56443755-cd6d-4703-aef1-c738fdf62372'::uuid,
        '4b487a36-2be4-41d0-9c25-702ceb55af14'::uuid
    );


    SELECT COUNT(*)
    INTO v_grant_count
    FROM public.product_credit_grants
    WHERE pricing_version_id IN (
        'd4eeaa9f-1879-4499-97e9-170e362c6f0f'::uuid,
        'c4b658a6-facf-4be0-ade5-71ad319678a9'::uuid,
        '56443755-cd6d-4703-aef1-c738fdf62372'::uuid,
        '4b487a36-2be4-41d0-9c25-702ceb55af14'::uuid
    );


    SELECT COUNT(*)
    INTO v_entitlement_count
    FROM public.plan_entitlements
    WHERE pricing_version_id IN (
        'd4eeaa9f-1879-4499-97e9-170e362c6f0f'::uuid,
        'c4b658a6-facf-4be0-ade5-71ad319678a9'::uuid,
        '56443755-cd6d-4703-aef1-c738fdf62372'::uuid,
        '4b487a36-2be4-41d0-9c25-702ceb55af14'::uuid
    )
    OR product_id IN (
        '7ae2f7a8-dd91-4b47-aa5f-35d0380499c3'::uuid,
        '9619747e-9d60-44e1-8485-6dd159e01366'::uuid,
        '924e1ebe-2553-470c-b29d-6ca7a8152e90'::uuid,
        '2c7ebebd-7ec7-464b-8b43-482c122036b4'::uuid
    );


    ---------------------------------------------------------------------------
    -- 5. ABSOLUTELY NO CUSTOMER SUBSCRIPTION MAY REFERENCE TEST PRODUCTS
    ---------------------------------------------------------------------------

    SELECT COUNT(*)
    INTO v_subscription_count
    FROM public.user_subscriptions
    WHERE product_id IN (
        '7ae2f7a8-dd91-4b47-aa5f-35d0380499c3'::uuid,
        '9619747e-9d60-44e1-8485-6dd159e01366'::uuid,
        '924e1ebe-2553-470c-b29d-6ca7a8152e90'::uuid,
        '2c7ebebd-7ec7-464b-8b43-482c122036b4'::uuid
    );


    ---------------------------------------------------------------------------
    -- 6. IDEMPOTENCY
    -- If cleanup has already been completed, safely exit.
    ---------------------------------------------------------------------------

    IF v_version_count = 0
       AND v_product_count = 0
       AND v_price_count = 0
       AND v_grant_count = 0
       AND v_entitlement_count = 0
       AND v_subscription_count = 0
    THEN
        RAISE NOTICE 'Phase 1.3 test artifacts are already clean. No action required.';
        RETURN;
    END IF;


    ---------------------------------------------------------------------------
    -- 7. FAIL CLOSED IF DATABASE NO LONGER MATCHES THE AUDITED STATE
    ---------------------------------------------------------------------------

    IF v_version_count <> 4 THEN
        RAISE EXCEPTION
            'SAFETY_ERROR: Expected exactly 4 audited test pricing versions, found %.',
            v_version_count;
    END IF;

    IF v_product_count <> 4 THEN
        RAISE EXCEPTION
            'SAFETY_ERROR: Expected exactly 4 audited test billing products, found %.',
            v_product_count;
    END IF;

    IF v_price_count <> 4 THEN
        RAISE EXCEPTION
            'SAFETY_ERROR: Expected exactly 4 audited test billing prices, found %.',
            v_price_count;
    END IF;

    IF v_grant_count <> 4 THEN
        RAISE EXCEPTION
            'SAFETY_ERROR: Expected exactly 4 audited test credit grants, found %.',
            v_grant_count;
    END IF;

    IF v_entitlement_count <> 0 THEN
        RAISE EXCEPTION
            'SAFETY_ERROR: Unexpected plan_entitlements reference test records (% rows). Cleanup aborted.',
            v_entitlement_count;
    END IF;

    IF v_subscription_count <> 0 THEN
        RAISE EXCEPTION
            'SAFETY_ERROR: % user_subscriptions reference test products. Cleanup aborted.',
            v_subscription_count;
    END IF;


    ---------------------------------------------------------------------------
    -- 8. TEMPORARILY DISABLE ONLY REQUIRED IMMUTABILITY TRIGGERS
    ---------------------------------------------------------------------------

    ALTER TABLE public.billing_prices
        DISABLE TRIGGER trg_guard_billing_prices_immutability;

    ALTER TABLE public.product_credit_grants
        DISABLE TRIGGER trg_guard_product_credit_grants_immutability;

    ALTER TABLE public.pricing_versions
        DISABLE TRIGGER trg_guard_pricing_versions_lock;


    ---------------------------------------------------------------------------
    -- 9. DELETE EXACT AUDITED CHILD RECORDS
    ---------------------------------------------------------------------------

    DELETE FROM public.product_credit_grants
    WHERE pricing_version_id IN (
        'd4eeaa9f-1879-4499-97e9-170e362c6f0f'::uuid,
        'c4b658a6-facf-4be0-ade5-71ad319678a9'::uuid,
        '56443755-cd6d-4703-aef1-c738fdf62372'::uuid,
        '4b487a36-2be4-41d0-9c25-702ceb55af14'::uuid
    );


    DELETE FROM public.billing_prices
    WHERE pricing_version_id IN (
        'd4eeaa9f-1879-4499-97e9-170e362c6f0f'::uuid,
        'c4b658a6-facf-4be0-ade5-71ad319678a9'::uuid,
        '56443755-cd6d-4703-aef1-c738fdf62372'::uuid,
        '4b487a36-2be4-41d0-9c25-702ceb55af14'::uuid
    );


    ---------------------------------------------------------------------------
    -- 10. DELETE EXACT AUDITED TEST PRODUCTS
    ---------------------------------------------------------------------------

    DELETE FROM public.billing_products
    WHERE id IN (
        '7ae2f7a8-dd91-4b47-aa5f-35d0380499c3'::uuid,
        '9619747e-9d60-44e1-8485-6dd159e01366'::uuid,
        '924e1ebe-2553-470c-b29d-6ca7a8152e90'::uuid,
        '2c7ebebd-7ec7-464b-8b43-482c122036b4'::uuid
    );


    ---------------------------------------------------------------------------
    -- 11. DELETE EXACT AUDITED TEST PRICING VERSIONS
    ---------------------------------------------------------------------------

    DELETE FROM public.pricing_versions
    WHERE id IN (
        'd4eeaa9f-1879-4499-97e9-170e362c6f0f'::uuid,
        'c4b658a6-facf-4be0-ade5-71ad319678a9'::uuid,
        '56443755-cd6d-4703-aef1-c738fdf62372'::uuid,
        '4b487a36-2be4-41d0-9c25-702ceb55af14'::uuid
    );


    ---------------------------------------------------------------------------
    -- 12. RE-ENABLE IMMUTABILITY TRIGGERS
    ---------------------------------------------------------------------------

    ALTER TABLE public.billing_prices
        ENABLE TRIGGER trg_guard_billing_prices_immutability;

    ALTER TABLE public.product_credit_grants
        ENABLE TRIGGER trg_guard_product_credit_grants_immutability;

    ALTER TABLE public.pricing_versions
        ENABLE TRIGGER trg_guard_pricing_versions_lock;


    ---------------------------------------------------------------------------
    -- 13. POST-CLEANUP VERIFICATION
    ---------------------------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM public.pricing_versions
        WHERE id IN (
            'd4eeaa9f-1879-4499-97e9-170e362c6f0f'::uuid,
            'c4b658a6-facf-4be0-ade5-71ad319678a9'::uuid,
            '56443755-cd6d-4703-aef1-c738fdf62372'::uuid,
            '4b487a36-2be4-41d0-9c25-702ceb55af14'::uuid
        )
    ) THEN
        RAISE EXCEPTION
            'POSTCHECK_FAILED: Test pricing versions still exist.';
    END IF;


    IF EXISTS (
        SELECT 1
        FROM public.billing_products
        WHERE id IN (
            '7ae2f7a8-dd91-4b47-aa5f-35d0380499c3'::uuid,
            '9619747e-9d60-44e1-8485-6dd159e01366'::uuid,
            '924e1ebe-2553-470c-b29d-6ca7a8152e90'::uuid,
            '2c7ebebd-7ec7-464b-8b43-482c122036b4'::uuid
        )
    ) THEN
        RAISE EXCEPTION
            'POSTCHECK_FAILED: Test billing products still exist.';
    END IF;


    ---------------------------------------------------------------------------
    -- 14. VERIFY PRODUCTION BILLING WAS NOT AFFECTED
    ---------------------------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM public.pricing_versions
        WHERE code = 'pricing-v1'
          AND active = true
          AND is_locked = true
    ) THEN
        RAISE EXCEPTION
            'POSTCHECK_FAILED: pricing-v1 integrity changed unexpectedly.';
    END IF;


    SELECT COUNT(*)
    INTO v_production_product_count
    FROM public.billing_products
    WHERE pricing_channel = 'WEB'
      AND active = true
      AND code IN (
          'FREE',
          'BASIC',
          'PRO',
          'BUSINESS',
          'PACK_50',
          'PACK_200',
          'PACK_500',
          'PACK_2000'
      );

    IF v_production_product_count <> 8 THEN
        RAISE EXCEPTION
            'POSTCHECK_FAILED: Expected 8 production WEB billing products, found %.',
            v_production_product_count;
    END IF;


    RAISE NOTICE '======================================================';
    RAISE NOTICE 'Phase 1.3 test artifact cleanup completed successfully.';
    RAISE NOTICE '4 test pricing versions removed.';
    RAISE NOTICE '4 test billing products removed.';
    RAISE NOTICE '4 test prices removed.';
    RAISE NOTICE '4 test credit grants removed.';
    RAISE NOTICE 'pricing-v1 remains active and locked.';
    RAISE NOTICE '8 production WEB billing products remain intact.';
    RAISE NOTICE '======================================================';

END $$;