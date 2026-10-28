-- =========================================================================
-- Migration: 20261009030000_reconcile_export_files_schema.sql
-- Description: Reconcile export_files table schema with ExportRecord application model
-- Environment: Prepared for rollout (DO NOT apply directly to Production without authorization)
-- Backward Compatibility: Fully backward-compatible; existing rows receive safe defaults
-- Idempotency: All statements use IF NOT EXISTS / IF EXISTS
-- =========================================================================

BEGIN;

-- 1. Add missing columns with safe defaults
ALTER TABLE public.export_files
    ADD COLUMN IF NOT EXISTS export_mode VARCHAR(50) NOT NULL DEFAULT 'NORMALIZED',
    ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT 'export.xlsx',
    ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT 'documents',
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Add domain integrity constraints
ALTER TABLE public.export_files
    DROP CONSTRAINT IF EXISTS chk_export_files_status;
ALTER TABLE public.export_files
    ADD CONSTRAINT chk_export_files_status
    CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'));

ALTER TABLE public.export_files
    DROP CONSTRAINT IF EXISTS chk_export_files_mode;
ALTER TABLE public.export_files
    ADD CONSTRAINT chk_export_files_mode
    CHECK (export_mode IN ('ORIGINAL', 'NORMALIZED'));

-- 3. Composite query index for document exports history & download lookup
CREATE INDEX IF NOT EXISTS idx_export_files_doc_user_created
    ON public.export_files(document_id, user_id, created_at DESC);

COMMIT;
