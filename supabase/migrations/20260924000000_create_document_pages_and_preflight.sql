-- ==========================================================
-- MIGRATION: CREATE document_pages AND PREFLIGHT FIELDS
-- Supports Preflight phase before expensive Azure AI OCR
-- Matches actual Supabase Production Schema exactly
-- ==========================================================

-- 1. ADD PREFLIGHT FIELDS TO documents TABLE
ALTER TABLE public.documents 
  ADD COLUMN IF NOT EXISTS preflight_summary JSONB NULL,
  ADD COLUMN IF NOT EXISTS output_type VARCHAR(20) NOT NULL DEFAULT 'EXCEL';

-- Ensure CHECK constraint for output_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_documents_output_type'
  ) THEN
    ALTER TABLE public.documents 
      ADD CONSTRAINT chk_documents_output_type CHECK (output_type IN ('EXCEL', 'WORD'));
  END IF;
END $$;

-- 2. CREATE document_pages TABLE
CREATE TABLE IF NOT EXISTS public.document_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number >= 1),
    classification VARCHAR(50) NOT NULL CHECK (classification IN ('NATIVE_TEXT', 'SCANNED', 'MIXED', 'UNCERTAIN')),
    classification_confidence NUMERIC(5, 4) NOT NULL DEFAULT 1.0000 CHECK (classification_confidence BETWEEN 0 AND 1),
    text_char_count INTEGER NOT NULL DEFAULT 0 CHECK (text_char_count >= 0),
    text_block_count INTEGER NOT NULL DEFAULT 0 CHECK (text_block_count >= 0),
    text_coverage NUMERIC(5, 4) NOT NULL DEFAULT 0.0000 CHECK (text_coverage BETWEEN 0 AND 1),
    image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
    image_coverage NUMERIC(5, 4) NOT NULL DEFAULT 0.0000 CHECK (image_coverage BETWEEN 0 AND 1),
    has_full_page_image BOOLEAN NOT NULL DEFAULT FALSE,
    classification_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unq_document_page UNIQUE (document_id, page_number)
);

-- Index for fast lookup by document_id
CREATE INDEX IF NOT EXISTS idx_document_pages_document_id ON public.document_pages(document_id);

-- 3. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;

-- 4. RLS POLICIES
DROP POLICY IF EXISTS document_pages_select_own ON public.document_pages;
DROP POLICY IF EXISTS document_pages_insert_own ON public.document_pages;
DROP POLICY IF EXISTS document_pages_update_own ON public.document_pages;
DROP POLICY IF EXISTS document_pages_delete_own ON public.document_pages;

-- SELECT policy
CREATE POLICY document_pages_select_own ON public.document_pages 
FOR SELECT USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);

-- INSERT policy
CREATE POLICY document_pages_insert_own ON public.document_pages 
FOR INSERT WITH CHECK (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);

-- UPDATE policy (Must contain BOTH USING and WITH CHECK)
CREATE POLICY document_pages_update_own ON public.document_pages 
FOR UPDATE 
USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
)
WITH CHECK (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);

-- DELETE policy
CREATE POLICY document_pages_delete_own ON public.document_pages 
FOR DELETE USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);

-- 5. PERMISSIONS (Strict: Do NOT grant ALL to anon)
REVOKE ALL ON TABLE public.document_pages FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.document_pages TO authenticated;
GRANT ALL ON TABLE public.document_pages TO service_role;
GRANT ALL ON TABLE public.document_pages TO postgres;
