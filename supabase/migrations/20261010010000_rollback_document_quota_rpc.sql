-- =========================================================================
-- Migration: 20261010010000_rollback_document_quota_rpc.sql
-- Description: Safe, idempotent rollback of used_documents when a job fails terminally
-- Environment: Prepared for rollout (DO NOT apply directly to Production without authorization)
-- Backward Compatibility: Fully backward-compatible; does not alter existing tables
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rollback_document_quota(
    p_user_id UUID,
    p_job_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job RECORD;
    v_profile RECORD;
    v_current_used INT;
    v_new_used INT;
BEGIN
    -- 1. Lock and fetch job
    SELECT id, user_id, document_id, status, quote_snapshot
    INTO v_job
    FROM public.processing_jobs
    WHERE id = p_job_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'JOB_NOT_FOUND',
            'message', 'Không tìm thấy tác vụ xử lý.'
        );
    END IF;

    -- 2. Guard: Cannot rollback if job already succeeded
    IF v_job.status IN ('READY', 'REVIEW_REQUIRED') THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'JOB_ALREADY_SUCCEEDED',
            'message', 'Tác vụ đã hoàn tất thành công, không thể hoàn lại hạn mức.'
        );
    END IF;

    -- 3. Idempotency guard: Check if already rolled back
    IF (v_job.quote_snapshot->>'quota_refunded')::boolean IS TRUE THEN
        SELECT used_documents INTO v_current_used
        FROM public.profiles
        WHERE id = p_user_id;

        RETURN jsonb_build_object(
            'success', true,
            'already_rolled_back', true,
            'used_documents', v_current_used,
            'message', 'Hạn mức đã được hoàn lại trước đó (idempotent).'
        );
    END IF;

    -- 4. Mark job as quota refunded
    UPDATE public.processing_jobs
    SET quote_snapshot = jsonb_set(
            COALESCE(quote_snapshot, '{}'::jsonb),
            '{quota_refunded}',
            'true'::jsonb
        ) || jsonb_build_object('quota_refunded_at', NOW()::text)::jsonb,
        updated_at = NOW()
    WHERE id = p_job_id AND user_id = p_user_id;

    -- 5. Lock and decrement user profile used_documents (ensure >= 0)
    SELECT used_documents INTO v_current_used
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF FOUND THEN
        v_new_used := GREATEST(0, COALESCE(v_current_used, 0) - 1);
        UPDATE public.profiles
        SET used_documents = v_new_used,
            updated_at = NOW()
        WHERE id = p_user_id;
    ELSE
        v_new_used := 0;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'already_rolled_back', false,
        'used_documents', v_new_used,
        'message', 'Hoàn lại 1 hạn mức tài liệu thành công.'
    );
END;
$$;

-- Revoke execute from public/anon/authenticated; grant only to service_role
REVOKE EXECUTE ON FUNCTION public.rollback_document_quota(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_document_quota(UUID, UUID) TO service_role;
