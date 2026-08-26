-- ==========================================================
-- DOCCONVERT AI - SUPABASE POSTGRESQL DATABASE & RLS SCHEMA
-- PHASE 1.5 REFACTOR: Supabase Auth, Profiles, Private Storage,
-- Row Level Security (RLS) & Multi-Role User Isolation
-- ==========================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. PLANS TABLE (Public Read)
CREATE TABLE IF NOT EXISTS public.plans (
    id VARCHAR(50) PRIMARY KEY, -- FREE, 7_DAYS_FULL, 30_DAYS_FULL
    name VARCHAR(100) NOT NULL,
    price_vnd INT NOT NULL DEFAULT 0,
    duration_days INT NOT NULL,
    document_quota INT NOT NULL,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Default Plans
INSERT INTO public.plans (id, name, price_vnd, duration_days, document_quota, features, is_active)
VALUES
    ('FREE', 'Gói Miễn Phí (Free)', 0, 3650, 3, '["3 tài liệu miễn phí", "Nhận dạng văn bản OCR & Bảng", "Giao diện đối soát số liệu", "Xuất file Excel (.xlsx) & Word (.docx)", "Lưu trữ riêng tư bảo mật"]'::jsonb, true),
    ('7_DAYS_FULL', 'Gói 7 Ngày Đầy Đủ', 29000, 7, 50, '["Hạn mức 50 tài liệu / 7 ngày", "Ưu tiên xử lý Azure AI tốc độ cao", "Đối soát số dư & sao kê ngân hàng", "Xuất Excel/Word định dạng chuẩn kế toán", "Hỗ trợ kỹ thuật 24/7"]'::jsonb, true),
    ('30_DAYS_FULL', 'Gói 30 Ngày Toàn Diện', 79000, 30, 250, '["Hạn mức 250 tài liệu / 30 ngày", "Đầy đủ mọi tính năng AI cao cấp", "Hỗ trợ tài liệu ngân hàng & hóa đơn đa trang", "Xuất bảng tính giữ nguyên định dạng", "Bảo mật dữ liệu chuẩn ngân hàng"]'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_vnd = EXCLUDED.price_vnd,
    duration_days = EXCLUDED.duration_days,
    document_quota = EXCLUDED.document_quota,
    features = EXCLUDED.features,
    is_active = EXCLUDED.is_active;

-- 3. PROFILES TABLE (Linked 1:1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    current_plan_id VARCHAR(50) NOT NULL DEFAULT 'FREE' REFERENCES public.plans(id),
    used_documents INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES public.plans(id),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, EXPIRED, CANCELLED, PENDING
    start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    payment_status VARCHAR(50) DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. USAGE TABLE
CREATE TABLE IF NOT EXISTS public.usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    month_period VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    used_count INT NOT NULL DEFAULT 0,
    quota_limit INT NOT NULL DEFAULT 3,
    last_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unq_user_month UNIQUE (user_id, month_period)
);

-- 6. DOCUMENTS TABLE
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(20) NOT NULL, -- PDF, JPG, JPEG, PNG
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    page_count INT DEFAULT 1,
    storage_bucket VARCHAR(100) NOT NULL DEFAULT 'documents',
    storage_path TEXT NOT NULL,
    document_type VARCHAR(50) DEFAULT 'BANK_STATEMENT',
    status VARCHAR(50) NOT NULL DEFAULT 'QUEUED', -- UPLOADED, QUEUED, PROCESSING, REVIEW_REQUIRED, READY, FAILED, DELETED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 7. PROCESSING JOBS TABLE
CREATE TABLE IF NOT EXISTS public.processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
    current_step VARCHAR(100) NOT NULL DEFAULT 'Queued in pipeline',
    progress INT NOT NULL DEFAULT 0,
    attempt_count INT NOT NULL DEFAULT 1,
    error_code VARCHAR(100),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. OCR RESULTS TABLE (Phase 2 Azure AI layout output)
CREATE TABLE IF NOT EXISTS public.ocr_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    page_number INT NOT NULL,
    raw_text TEXT,
    confidence_score NUMERIC(5, 4),
    azure_model_id VARCHAR(100) DEFAULT 'prebuilt-layout',
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. EXTRACTED TABLES
CREATE TABLE IF NOT EXISTS public.extracted_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    page_number INT NOT NULL,
    table_index INT NOT NULL,
    row_count INT NOT NULL,
    column_count INT NOT NULL,
    confidence_score NUMERIC(5, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. EXTRACTED ROWS
CREATE TABLE IF NOT EXISTS public.extracted_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES public.extracted_tables(id) ON DELETE CASCADE,
    row_index INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. EXTRACTED CELLS
CREATE TABLE IF NOT EXISTS public.extracted_cells (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    row_id UUID NOT NULL REFERENCES public.extracted_rows(id) ON DELETE CASCADE,
    column_index INT NOT NULL,
    raw_value TEXT,
    normalized_value TEXT,
    cell_type VARCHAR(50) DEFAULT 'TEXT', -- DATE, MONEY, TEXT, NUMBER
    confidence_score NUMERIC(5, 4),
    is_reviewed BOOLEAN DEFAULT FALSE,
    bounding_box JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. REVIEW ACTIONS
CREATE TABLE IF NOT EXISTS public.review_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    cell_id UUID REFERENCES public.extracted_cells(id) ON DELETE CASCADE,
    old_value TEXT,
    new_value TEXT,
    action_type VARCHAR(50) NOT NULL, -- EDIT_CELL, APPROVE_DOCUMENT, REJECT_DOCUMENT
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. EXPORT FILES
CREATE TABLE IF NOT EXISTS public.export_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    export_format VARCHAR(20) NOT NULL, -- XLSX, DOCX
    storage_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    download_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    ip_address VARCHAR(100),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- INDEXES
-- ==========================================================
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON public.processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_doc_id ON public.processing_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON public.usage(user_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_doc_id ON public.ocr_results(document_id);
CREATE INDEX IF NOT EXISTS idx_tables_doc_id ON public.extracted_tables(document_id);
CREATE INDEX IF NOT EXISTS idx_rows_table_id ON public.extracted_rows(table_id);
CREATE INDEX IF NOT EXISTS idx_cells_row_id ON public.extracted_cells(row_id);
CREATE INDEX IF NOT EXISTS idx_review_doc_id ON public.review_actions(document_id);
CREATE INDEX IF NOT EXISTS idx_export_doc_id ON public.export_files(document_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);

-- ==========================================================
-- SUPABASE AUTH TRIGGER FOR USER PROVISIONING
-- ==========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. Create Profile
    INSERT INTO public.profiles (id, email, full_name, current_plan_id, used_documents)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Người dùng DocConvert'),
        'FREE',
        0
    )
    ON CONFLICT (id) DO NOTHING;

    -- 2. Create Free Subscription
    INSERT INTO public.subscriptions (id, user_id, plan_id, status, start_at, expires_at, payment_status)
    VALUES (
        gen_random_uuid(),
        NEW.id,
        'FREE',
        'ACTIVE',
        NOW(),
        NOW() + INTERVAL '10 years',
        'COMPLETED'
    )
    ON CONFLICT DO NOTHING;

    -- 3. Create Initial Usage Record for Current Month
    INSERT INTO public.usage (id, user_id, month_period, used_count, quota_limit)
    VALUES (
        gen_random_uuid(),
        NEW.id,
        to_char(NOW(), 'YYYY-MM'),
        0,
        3
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================================
-- ROW LEVEL SECURITY (RLS) POLICIES AUDIT
-- ==========================================================

-- Enable RLS on all user data tables
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extracted_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extracted_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extracted_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_files ENABLE ROW LEVEL SECURITY;

-- 1. PLANS POLICIES (Public Read)
DROP POLICY IF EXISTS plans_select_all ON public.plans;
CREATE POLICY plans_select_all ON public.plans FOR SELECT USING (is_active = true);

-- 2. PROFILES POLICIES
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_delete_own ON public.profiles FOR DELETE USING (id = auth.uid());

-- 3. SUBSCRIPTIONS POLICIES
DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_insert_own ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_update_own ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_delete_own ON public.subscriptions;
CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY subscriptions_insert_own ON public.subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY subscriptions_update_own ON public.subscriptions FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY subscriptions_delete_own ON public.subscriptions FOR DELETE USING (user_id = auth.uid());

-- 4. USAGE POLICIES
DROP POLICY IF EXISTS usage_select_own ON public.usage;
DROP POLICY IF EXISTS usage_insert_own ON public.usage;
DROP POLICY IF EXISTS usage_update_own ON public.usage;
DROP POLICY IF EXISTS usage_delete_own ON public.usage;
CREATE POLICY usage_select_own ON public.usage FOR SELECT USING (user_id = auth.uid());
CREATE POLICY usage_insert_own ON public.usage FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY usage_update_own ON public.usage FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY usage_delete_own ON public.usage FOR DELETE USING (user_id = auth.uid());

-- 5. DOCUMENTS POLICIES (Isolated by user_id)
DROP POLICY IF EXISTS documents_select_own ON public.documents;
DROP POLICY IF EXISTS documents_insert_own ON public.documents;
DROP POLICY IF EXISTS documents_update_own ON public.documents;
DROP POLICY IF EXISTS documents_delete_own ON public.documents;
CREATE POLICY documents_select_own ON public.documents FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY documents_insert_own ON public.documents FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY documents_update_own ON public.documents FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY documents_delete_own ON public.documents FOR DELETE USING (user_id = auth.uid());

-- 6. PROCESSING JOBS POLICIES
DROP POLICY IF EXISTS processing_jobs_select_own ON public.processing_jobs;
DROP POLICY IF EXISTS processing_jobs_insert_own ON public.processing_jobs;
DROP POLICY IF EXISTS processing_jobs_update_own ON public.processing_jobs;
DROP POLICY IF EXISTS processing_jobs_delete_own ON public.processing_jobs;
CREATE POLICY processing_jobs_select_own ON public.processing_jobs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY processing_jobs_insert_own ON public.processing_jobs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY processing_jobs_update_own ON public.processing_jobs FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY processing_jobs_delete_own ON public.processing_jobs FOR DELETE USING (user_id = auth.uid());

-- 7. AUDIT LOGS POLICIES (Users can read/insert their own; CANNOT modify or delete)
DROP POLICY IF EXISTS audit_logs_select_own ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert_own ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_update_own ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete_own ON public.audit_logs;
CREATE POLICY audit_logs_select_own ON public.audit_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY audit_logs_insert_own ON public.audit_logs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY audit_logs_update_own ON public.audit_logs FOR UPDATE USING (false);
CREATE POLICY audit_logs_delete_own ON public.audit_logs FOR DELETE USING (false);

-- 8. OCR RESULTS POLICIES (Document Ownership Check)
DROP POLICY IF EXISTS ocr_results_select_own ON public.ocr_results;
DROP POLICY IF EXISTS ocr_results_insert_own ON public.ocr_results;
DROP POLICY IF EXISTS ocr_results_update_own ON public.ocr_results;
DROP POLICY IF EXISTS ocr_results_delete_own ON public.ocr_results;
CREATE POLICY ocr_results_select_own ON public.ocr_results FOR SELECT USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY ocr_results_insert_own ON public.ocr_results FOR INSERT WITH CHECK (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY ocr_results_update_own ON public.ocr_results FOR UPDATE USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY ocr_results_delete_own ON public.ocr_results FOR DELETE USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);

-- 9. EXTRACTED TABLES POLICIES
DROP POLICY IF EXISTS extracted_tables_select_own ON public.extracted_tables;
DROP POLICY IF EXISTS extracted_tables_insert_own ON public.extracted_tables;
DROP POLICY IF EXISTS extracted_tables_update_own ON public.extracted_tables;
DROP POLICY IF EXISTS extracted_tables_delete_own ON public.extracted_tables;
CREATE POLICY extracted_tables_select_own ON public.extracted_tables FOR SELECT USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY extracted_tables_insert_own ON public.extracted_tables FOR INSERT WITH CHECK (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY extracted_tables_update_own ON public.extracted_tables FOR UPDATE USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);
CREATE POLICY extracted_tables_delete_own ON public.extracted_tables FOR DELETE USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
);

-- 10. EXTRACTED ROWS POLICIES
DROP POLICY IF EXISTS extracted_rows_select_own ON public.extracted_rows;
DROP POLICY IF EXISTS extracted_rows_insert_own ON public.extracted_rows;
DROP POLICY IF EXISTS extracted_rows_update_own ON public.extracted_rows;
DROP POLICY IF EXISTS extracted_rows_delete_own ON public.extracted_rows;
CREATE POLICY extracted_rows_select_own ON public.extracted_rows FOR SELECT USING (
    table_id IN (
        SELECT id FROM public.extracted_tables WHERE document_id IN (
            SELECT id FROM public.documents WHERE user_id = auth.uid()
        )
    )
);
CREATE POLICY extracted_rows_insert_own ON public.extracted_rows FOR INSERT WITH CHECK (
    table_id IN (
        SELECT id FROM public.extracted_tables WHERE document_id IN (
            SELECT id FROM public.documents WHERE user_id = auth.uid()
        )
    )
);
CREATE POLICY extracted_rows_update_own ON public.extracted_rows FOR UPDATE USING (
    table_id IN (
        SELECT id FROM public.extracted_tables WHERE document_id IN (
            SELECT id FROM public.documents WHERE user_id = auth.uid()
        )
    )
);
CREATE POLICY extracted_rows_delete_own ON public.extracted_rows FOR DELETE USING (
    table_id IN (
        SELECT id FROM public.extracted_tables WHERE document_id IN (
            SELECT id FROM public.documents WHERE user_id = auth.uid()
        )
    )
);

-- 11. EXTRACTED CELLS POLICIES
DROP POLICY IF EXISTS extracted_cells_select_own ON public.extracted_cells;
DROP POLICY IF EXISTS extracted_cells_insert_own ON public.extracted_cells;
DROP POLICY IF EXISTS extracted_cells_update_own ON public.extracted_cells;
DROP POLICY IF EXISTS extracted_cells_delete_own ON public.extracted_cells;
CREATE POLICY extracted_cells_select_own ON public.extracted_cells FOR SELECT USING (
    row_id IN (
        SELECT id FROM public.extracted_rows WHERE table_id IN (
            SELECT id FROM public.extracted_tables WHERE document_id IN (
                SELECT id FROM public.documents WHERE user_id = auth.uid()
            )
        )
    )
);
CREATE POLICY extracted_cells_insert_own ON public.extracted_cells FOR INSERT WITH CHECK (
    row_id IN (
        SELECT id FROM public.extracted_rows WHERE table_id IN (
            SELECT id FROM public.extracted_tables WHERE document_id IN (
                SELECT id FROM public.documents WHERE user_id = auth.uid()
            )
        )
    )
);
CREATE POLICY extracted_cells_update_own ON public.extracted_cells FOR UPDATE USING (
    row_id IN (
        SELECT id FROM public.extracted_rows WHERE table_id IN (
            SELECT id FROM public.extracted_tables WHERE document_id IN (
                SELECT id FROM public.documents WHERE user_id = auth.uid()
            )
        )
    )
);
CREATE POLICY extracted_cells_delete_own ON public.extracted_cells FOR DELETE USING (
    row_id IN (
        SELECT id FROM public.extracted_rows WHERE table_id IN (
            SELECT id FROM public.extracted_tables WHERE document_id IN (
                SELECT id FROM public.documents WHERE user_id = auth.uid()
            )
        )
    )
);

-- 12. REVIEW ACTIONS POLICIES
DROP POLICY IF EXISTS review_actions_select_own ON public.review_actions;
DROP POLICY IF EXISTS review_actions_insert_own ON public.review_actions;
DROP POLICY IF EXISTS review_actions_update_own ON public.review_actions;
DROP POLICY IF EXISTS review_actions_delete_own ON public.review_actions;
CREATE POLICY review_actions_select_own ON public.review_actions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY review_actions_insert_own ON public.review_actions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY review_actions_update_own ON public.review_actions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY review_actions_delete_own ON public.review_actions FOR DELETE USING (user_id = auth.uid());

-- 13. EXPORT FILES POLICIES
DROP POLICY IF EXISTS export_files_select_own ON public.export_files;
DROP POLICY IF EXISTS export_files_insert_own ON public.export_files;
DROP POLICY IF EXISTS export_files_update_own ON public.export_files;
DROP POLICY IF EXISTS export_files_delete_own ON public.export_files;
CREATE POLICY export_files_select_own ON public.export_files FOR SELECT USING (user_id = auth.uid());
CREATE POLICY export_files_insert_own ON public.export_files FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY export_files_update_own ON public.export_files FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY export_files_delete_own ON public.export_files FOR DELETE USING (user_id = auth.uid());

-- ==========================================================
-- SUPABASE STORAGE CONFIGURATION & POLICIES
-- Bucket: 'documents' (Strictly Private, public = false)
-- Path format: {user_id}/{document_id}/original/{filename}
-- ==========================================================

-- 1. Create Private Bucket (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents',
    'documents',
    false,
    20971520, -- 20 MB Limit
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/pjpeg']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/pjpeg'];

-- 2. Storage Objects RLS Policies
-- SELECT: Users can only read objects in their own folder (folder name matches user UUID)
DROP POLICY IF EXISTS "Storage SELECT own documents" ON storage.objects;
CREATE POLICY "Storage SELECT own documents"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- INSERT: Users can only upload to their own folder
DROP POLICY IF EXISTS "Storage INSERT own documents" ON storage.objects;
CREATE POLICY "Storage INSERT own documents"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE: Users can only update their own folder objects
DROP POLICY IF EXISTS "Storage UPDATE own documents" ON storage.objects;
CREATE POLICY "Storage UPDATE own documents"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETE: Users can only delete objects in their own folder
DROP POLICY IF EXISTS "Storage DELETE own documents" ON storage.objects;
CREATE POLICY "Storage DELETE own documents"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
