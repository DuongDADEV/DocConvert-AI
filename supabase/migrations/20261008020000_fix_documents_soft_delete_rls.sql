-- ==========================================================
-- Migration: 20261008020000_fix_documents_soft_delete_rls.sql
-- Module: Documents RLS Hardening for Soft-Delete Support
-- Objective: Fix PostgreSQL/PostgREST RLS 42501 error during soft-delete
-- Details:
--   1. documents_select_own: Allow SELECT on owner's documents (user_id = auth.uid()).
--      Application read paths (db.getUserDocuments, db.getUserDocumentById) explicitly
--      enforce deleted_at IS NULL. Decoupling deleted_at IS NULL from the RLS SELECT policy
--      enables PostgREST UPDATE ... RETURNING * during soft-delete without 42501 error.
--   2. documents_update_own: Allow UPDATE only on owner's active documents (deleted_at IS NULL).
--      WITH CHECK ensures user_id remains immutable (user_id = auth.uid()), permitting
--      deleted_at to transition from NULL to timestamp while blocking revival of deleted rows.
-- ==========================================================

DROP POLICY IF EXISTS documents_select_own ON public.documents;

CREATE POLICY documents_select_own
ON public.documents
FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS documents_update_own ON public.documents;

CREATE POLICY documents_update_own
ON public.documents
FOR UPDATE
USING (user_id = auth.uid() AND deleted_at IS NULL)
WITH CHECK (user_id = auth.uid());
