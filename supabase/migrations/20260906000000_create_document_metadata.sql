-- ==========================================================
-- DOCCONVERT AI - PHASE 2A DYNAMIC METADATA SCHEMA MIGRATION
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.document_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    label VARCHAR(255) NOT NULL,
    raw_label TEXT NOT NULL,
    value TEXT NOT NULL,
    raw_value TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    normalized_value_for_match TEXT NOT NULL,
    confidence_score NUMERIC(5, 4) NOT NULL DEFAULT 0.95,
    source_page INT NOT NULL DEFAULT 1,
    key_bounding_box JSONB,
    value_bounding_box JSONB,
    occurrence_count INT NOT NULL DEFAULT 1,
    status VARCHAR(50) NOT NULL DEFAULT 'AUTO', -- 'AUTO', 'CONFLICT', 'REVIEWED'
    alternatives JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_metadata_status CHECK (status IN ('AUTO', 'CONFLICT', 'REVIEWED'))
);

CREATE INDEX IF NOT EXISTS idx_document_metadata_doc_id ON public.document_metadata(document_id);
CREATE INDEX IF NOT EXISTS idx_document_metadata_doc_norm ON public.document_metadata(document_id, normalized_label);

-- ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.document_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_metadata_select_own ON public.document_metadata;
DROP POLICY IF EXISTS document_metadata_insert_own ON public.document_metadata;
DROP POLICY IF EXISTS document_metadata_update_own ON public.document_metadata;
DROP POLICY IF EXISTS document_metadata_delete_own ON public.document_metadata;

CREATE POLICY document_metadata_select_own ON public.document_metadata FOR SELECT USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY document_metadata_insert_own ON public.document_metadata FOR INSERT WITH CHECK (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY document_metadata_update_own ON public.document_metadata FOR UPDATE USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY document_metadata_delete_own ON public.document_metadata FOR DELETE USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
