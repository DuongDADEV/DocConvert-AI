-- ==========================================================
-- DOCCONVERT AI - PHASE 2A.1 METADATA QUALITY & SEMANTICS
-- ==========================================================

ALTER TABLE public.document_metadata
    ADD COLUMN IF NOT EXISTS semantic_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5, 4),
    ADD COLUMN IF NOT EXISTS visibility_class VARCHAR(50) DEFAULT 'ADDITIONAL';

CREATE INDEX IF NOT EXISTS idx_document_metadata_semantic_type ON public.document_metadata(document_id, semantic_type);
CREATE INDEX IF NOT EXISTS idx_document_metadata_visibility ON public.document_metadata(document_id, visibility_class);
