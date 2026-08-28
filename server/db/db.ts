import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export interface PlanRecord {
  id: string;
  name: string;
  price_vnd: number;
  duration_days: number;
  document_quota: number;
  features: string[];
  is_active: boolean;
  created_at: string;
}

export interface ProfileRecord {
  id: string; // References auth.users(id)
  email: string;
  full_name: string;
  avatar_url?: string | null;
  current_plan_id: string;
  used_documents: number;
  created_at: string;
  updated_at: string;
}

export interface AuthUserRecord {
  id: string; // UUID in auth.users
  email: string;
  password_hash: string;
  full_name: string;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
  start_at: string;
  expires_at: string;
  payment_status: string;
  created_at: string;
}

export interface UsageRecord {
  id: string;
  user_id: string;
  month_period: string; // YYYY-MM
  used_count: number;
  quota_limit: number;
  last_reset_at: string;
  updated_at: string;
}

export interface DocumentRecord {
  id: string;
  user_id: string; // auth.uid()
  original_filename: string;
  file_name: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  page_count: number;
  storage_bucket: string; // 'documents'
  storage_path: string; // documents/{user_id}/{document_id}/original/{file_name}
  document_type: string;
  status: 'UPLOADED' | 'QUEUED' | 'PROCESSING' | 'REVIEW_REQUIRED' | 'READY' | 'FAILED' | 'DELETED';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProcessingJobRecord {
  id: string;
  document_id: string;
  user_id: string;
  status: 'QUEUED' | 'VALIDATING' | 'UPLOADING' | 'PROCESSING' | 'PARSING' | 'VALIDATING_RESULT' | 'REVIEW_REQUIRED' | 'READY' | 'FAILED';
  current_step: string;
  progress: number;
  attempt_count: number;
  error_code?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRecord {
  id: string;
  user_id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface OcrResultRecord {
  id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  raw_text: string;
  confidence_score: number;
  azure_model_id: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface ExtractedTableRecord {
  id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  table_index: number;
  row_count: number;
  column_count: number;
  confidence_score: number;
  bounding_regions?: any[];
  created_at: string;
}

export interface ExtractedRowRecord {
  id: string;
  table_id: string;
  document_id: string;
  user_id: string;
  row_index: number;
  is_header: boolean;
  created_at: string;
}

export interface ExtractedCellRecord {
  id: string;
  row_id: string;
  table_id: string;
  document_id: string;
  user_id: string;
  row_index: number;
  column_index: number;
  row_span: number;
  column_span: number;
  raw_value: string;
  normalized_value: string;
  cell_type: 'TEXT' | 'MONEY' | 'DATE' | 'NUMBER';
  confidence_score: number;
  is_reviewed: boolean;
  bounding_box?: any;
  created_at: string;
  updated_at: string;
}

export interface ReviewActionRecord {
  id: string;
  user_id: string;
  document_id: string;
  cell_id?: string;
  action_type: 'EDIT_CELL' | 'ADD_ROW' | 'DELETE_ROW' | 'COMPLETE_REVIEW';
  before_value?: string;
  after_value?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface ExportRecord {
  id: string;
  user_id: string;
  document_id: string;
  export_format: 'XLSX' | 'DOCX';
  export_mode: 'ORIGINAL' | 'NORMALIZED';
  file_name: string;
  file_size: number;
  storage_bucket: string;
  storage_path: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  error_message?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface ActiveSession {
  access_token: string;
  user_id: string;
  email: string;
  expires_at: number;
}

export interface DatabaseState {
  plans: PlanRecord[];
  auth_users: AuthUserRecord[];
  profiles: ProfileRecord[];
  subscriptions: SubscriptionRecord[];
  usage: UsageRecord[];
  documents: DocumentRecord[];
  processing_jobs: ProcessingJobRecord[];
  audit_logs: AuditLogRecord[];
  sessions: ActiveSession[];
  ocr_results: OcrResultRecord[];
  extracted_tables: ExtractedTableRecord[];
  extracted_rows: ExtractedRowRecord[];
  extracted_cells: ExtractedCellRecord[];
  review_actions: ReviewActionRecord[];
  exports: ExportRecord[];
}

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

const DEFAULT_PLANS: PlanRecord[] = [
  {
    id: 'FREE',
    name: 'Gói Miễn Phí (Free)',
    price_vnd: 0,
    duration_days: 3650,
    document_quota: 3,
    features: [
      '3 tài liệu miễn phí',
      'Nhận dạng văn bản OCR & Bảng',
      'Giao diện đối soát số liệu',
      'Xuất file Excel (.xlsx) & Word (.docx)',
      'Lưu trữ riêng tư bảo mật'
    ],
    is_active: true,
    created_at: new Date().toISOString(),
  },
  {
    id: '7_DAYS_FULL',
    name: 'Gói 7 Ngày Đầy Đủ',
    price_vnd: 29000,
    duration_days: 7,
    document_quota: 50,
    features: [
      'Hạn mức 50 tài liệu / 7 ngày',
      'Ưu tiên xử lý Azure AI tốc độ cao',
      'Đối soát số dư & sao kê ngân hàng',
      'Xuất Excel/Word định dạng chuẩn kế toán',
      'Hỗ trợ kỹ thuật 24/7'
    ],
    is_active: true,
    created_at: new Date().toISOString(),
  },
  {
    id: '30_DAYS_FULL',
    name: 'Gói 30 Ngày Toàn Diện',
    price_vnd: 79000,
    duration_days: 30,
    document_quota: 250,
    features: [
      'Hạn mức 250 tài liệu / 30 ngày',
      'Đầy đủ mọi tính năng AI cao cấp',
      'Hỗ trợ tài liệu ngân hàng & hóa đơn đa trang',
      'Xuất bảng tính giữ nguyên định dạng',
      'Bảo mật dữ liệu chuẩn ngân hàng'
    ],
    is_active: true,
    created_at: new Date().toISOString(),
  },
];

class DatabaseService {
  private state: DatabaseState = {
    plans: [...DEFAULT_PLANS],
    auth_users: [],
    profiles: [],
    subscriptions: [],
    usage: [],
    documents: [],
    processing_jobs: [],
    audit_logs: [],
    sessions: [],
    ocr_results: [],
    extracted_tables: [],
    extracted_rows: [],
    extracted_cells: [],
    review_actions: [],
    exports: [],
  };

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.state = {
          plans: parsed.plans?.length ? parsed.plans : DEFAULT_PLANS,
          auth_users: parsed.auth_users || [],
          profiles: parsed.profiles || parsed.users || [],
          subscriptions: parsed.subscriptions || [],
          usage: parsed.usage || [],
          documents: parsed.documents || [],
          processing_jobs: parsed.processing_jobs || [],
          audit_logs: parsed.audit_logs || [],
          sessions: parsed.sessions || [],
          ocr_results: parsed.ocr_results || [],
          extracted_tables: parsed.extracted_tables || [],
          extracted_rows: parsed.extracted_rows || [],
          extracted_cells: parsed.extracted_cells || [],
          review_actions: parsed.review_actions || [],
          exports: parsed.exports || [],
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('Failed to initialize database file:', err);
    }
  }

  private save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist database state:', err);
    }
  }

  // --- PLANS ---
  getPlans(): PlanRecord[] {
    return this.state.plans.filter((p) => p.is_active);
  }

  getPlanById(id: string): PlanRecord | undefined {
    return this.state.plans.find((p) => p.id === id);
  }

  // --- SUPABASE AUTH & PROFILES ---
  async createAuthUserAndProfile(params: {
    email: string;
    password: string;
    fullName: string;
  }): Promise<{ user: AuthUserRecord; profile: ProfileRecord; session: ActiveSession }> {
    const existing = this.findAuthUserByEmail(params.email);
    if (existing) {
      throw new Error('Email này đã được sử dụng. Vui lòng chọn email khác.');
    }

    const userId = crypto.randomUUID();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(params.password, salt);
    const now = new Date().toISOString();

    // 1. auth.users Record
    const authUser: AuthUserRecord = {
      id: userId,
      email: params.email.toLowerCase().trim(),
      password_hash: passwordHash,
      full_name: params.fullName.trim(),
      created_at: now,
      updated_at: now,
    };
    this.state.auth_users.push(authUser);

    // 2. profiles Record (Trigger: handle_new_user)
    const profile: ProfileRecord = {
      id: userId,
      email: authUser.email,
      full_name: authUser.full_name,
      avatar_url: null,
      current_plan_id: 'FREE',
      used_documents: 0,
      created_at: now,
      updated_at: now,
    };
    this.state.profiles.push(profile);

    // 3. subscriptions Record (Default Free)
    const sub: SubscriptionRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      plan_id: 'FREE',
      status: 'ACTIVE',
      start_at: now,
      expires_at: new Date(Date.now() + 3650 * 86400000).toISOString(),
      payment_status: 'COMPLETED',
      created_at: now,
    };
    this.state.subscriptions.push(sub);

    // 4. usage Record
    const currentMonth = new Date().toISOString().substring(0, 7);
    const usage: UsageRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      month_period: currentMonth,
      used_count: 0,
      quota_limit: 3,
      last_reset_at: now,
      updated_at: now,
    };
    this.state.usage.push(usage);

    // 5. Generate Supabase Access Token Session
    const session = this.createLocalSupabaseSession(authUser);

    this.save();
    return { user: authUser, profile, session };
  }

  async authenticateUser(email: string, password: string): Promise<{ profile: ProfileRecord; session: ActiveSession } | null> {
    const authUser = this.findAuthUserByEmail(email);
    if (!authUser) return null;

    const match = await bcrypt.compare(password, authUser.password_hash);
    if (!match) return null;

    let profile = this.findProfileById(authUser.id);
    if (!profile) {
      // Auto heal profile if missing
      profile = {
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.full_name,
        current_plan_id: 'FREE',
        used_documents: 0,
        created_at: authUser.created_at,
        updated_at: new Date().toISOString(),
      };
      this.state.profiles.push(profile);
    }

    const session = this.createLocalSupabaseSession(authUser);
    this.save();
    return { profile, session };
  }

  findAuthUserByEmail(email: string): AuthUserRecord | undefined {
    return this.state.auth_users.find((u) => u.email.toLowerCase() === email.toLowerCase().trim());
  }

  findAuthUserById(id: string): AuthUserRecord | undefined {
    return this.state.auth_users.find((u) => u.id === id);
  }

  findProfileById(id: string): ProfileRecord | undefined {
    return this.state.profiles.find((p) => p.id === id);
  }

  findProfileByEmail(email: string): ProfileRecord | undefined {
    return this.state.profiles.find((p) => p.email.toLowerCase() === email.toLowerCase().trim());
  }

  ensureProfile(userId: string, email: string, fullName: string): ProfileRecord {
    let profile = this.findProfileById(userId);
    if (!profile) {
      const now = new Date().toISOString();
      profile = {
        id: userId,
        email: email.toLowerCase().trim(),
        full_name: fullName.trim() || 'User',
        avatar_url: null,
        current_plan_id: 'FREE',
        used_documents: 0,
        created_at: now,
        updated_at: now,
      };
      this.state.profiles.push(profile);

      // Default Free Subscription
      const sub: SubscriptionRecord = {
        id: crypto.randomUUID(),
        user_id: userId,
        plan_id: 'FREE',
        status: 'ACTIVE',
        start_at: now,
        expires_at: new Date(Date.now() + 3650 * 86400000).toISOString(),
        payment_status: 'COMPLETED',
        created_at: now,
      };
      this.state.subscriptions.push(sub);

      // Default Monthly Usage
      const currentMonth = new Date().toISOString().substring(0, 7);
      const usage: UsageRecord = {
        id: crypto.randomUUID(),
        user_id: userId,
        month_period: currentMonth,
        used_count: 0,
        quota_limit: 3,
        last_reset_at: now,
        updated_at: now,
      };
      this.state.usage.push(usage);

      this.save();
    }
    return profile;
  }

  updateProfile(id: string, updates: Partial<ProfileRecord>): ProfileRecord | null {
    const idx = this.state.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return null;

    this.state.profiles[idx] = {
      ...this.state.profiles[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.state.profiles[idx];
  }

  // --- LOCAL SUPABASE SESSION TOKEN GENERATION & VALIDATION ---
  createLocalSupabaseSession(user: AuthUserRecord): ActiveSession {
    const tokenBytes = crypto.randomBytes(32).toString('hex');
    const token = `sbp_${user.id}_${tokenBytes}`;
    const expiresAt = Date.now() + 7 * 86400000; // 7 days

    const session: ActiveSession = {
      access_token: token,
      user_id: user.id,
      email: user.email,
      expires_at: expiresAt,
    };

    // Remove expired sessions
    this.state.sessions = this.state.sessions.filter((s) => s.expires_at > Date.now());
    this.state.sessions.push(session);
    this.save();

    return session;
  }

  verifyLocalSupabaseToken(token: string): { id: string; email: string; fullName: string; currentPlanId: string; usedDocuments: number } | null {
    if (!token) return null;

    const session = this.state.sessions.find((s) => s.access_token === token && s.expires_at > Date.now());
    if (!session) return null;

    const profile = this.findProfileById(session.user_id);
    if (!profile) return null;

    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      currentPlanId: profile.current_plan_id,
      usedDocuments: profile.used_documents,
    };
  }

  revokeSession(token: string): boolean {
    const beforeLen = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((s) => s.access_token !== token);
    this.save();
    return this.state.sessions.length < beforeLen;
  }

  // --- QUOTA & USAGE ---
  getUserUsage(userId: string): { used: number; total: number; remaining: number; planId: string } {
    const profile = this.findProfileById(userId);
    const planId = profile?.current_plan_id || 'FREE';
    const plan = this.getPlanById(planId) || DEFAULT_PLANS[0];
    const total = plan.document_quota;
    const used = profile?.used_documents || 0;
    const remaining = Math.max(0, total - used);

    return { used, total, remaining, planId };
  }

  incrementUserDocUsage(userId: string): number {
    const profile = this.findProfileById(userId);
    if (!profile) throw new Error('User profile not found');

    profile.used_documents += 1;
    profile.updated_at = new Date().toISOString();

    // Also update monthly usage record
    const currentMonth = new Date().toISOString().substring(0, 7);
    let monthUsage = this.state.usage.find((u) => u.user_id === userId && u.month_period === currentMonth);
    if (monthUsage) {
      monthUsage.used_count += 1;
      monthUsage.updated_at = new Date().toISOString();
    }

    this.save();
    return profile.used_documents;
  }

  // --- DOCUMENTS (RLS: strictly enforced via auth.uid() == user_id) ---
  getUserDocuments(userId: string): DocumentRecord[] {
    return this.state.documents
      .filter((d) => d.user_id === userId && d.deleted_at === null)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  getUserDocumentById(userId: string, documentId: string): DocumentRecord | null {
    const doc = this.state.documents.find((d) => d.id === documentId && d.deleted_at === null);
    // RLS Enforcement
    if (!doc || doc.user_id !== userId) {
      return null;
    }
    return doc;
  }

  createDocument(doc: Omit<DocumentRecord, 'created_at' | 'updated_at' | 'deleted_at'>): DocumentRecord {
    const now = new Date().toISOString();
    const newDoc: DocumentRecord = {
      ...doc,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    this.state.documents.push(newDoc);
    this.save();
    return newDoc;
  }

  updateDocumentStatus(userId: string, documentId: string, status: DocumentRecord['status']): DocumentRecord | null {
    const doc = this.getUserDocumentById(userId, documentId);
    if (!doc) return null;
    doc.status = status;
    doc.updated_at = new Date().toISOString();
    this.save();
    return doc;
  }

  softDeleteDocument(userId: string, documentId: string): boolean {
    const doc = this.getUserDocumentById(userId, documentId);
    if (!doc) return false;
    doc.deleted_at = new Date().toISOString();
    doc.status = 'DELETED';
    doc.updated_at = new Date().toISOString();
    this.save();
    return true;
  }

  // --- PROCESSING JOBS (RLS: isolated by user_id) ---
  createProcessingJob(job: Omit<ProcessingJobRecord, 'created_at' | 'updated_at'>): ProcessingJobRecord {
    const now = new Date().toISOString();
    const newJob: ProcessingJobRecord = {
      ...job,
      created_at: now,
      updated_at: now,
    };
    this.state.processing_jobs.push(newJob);
    this.save();
    return newJob;
  }

  getProcessingJob(userId: string, jobId: string): ProcessingJobRecord | null {
    const job = this.state.processing_jobs.find((j) => j.id === jobId && j.user_id === userId);
    return job || null;
  }

  getJobByDocumentId(userId: string, docId: string): ProcessingJobRecord | null {
    const job = this.state.processing_jobs.find((j) => j.document_id === docId && j.user_id === userId);
    return job || null;
  }

  updateProcessingJob(userId: string, jobId: string, updates: Partial<ProcessingJobRecord>): ProcessingJobRecord | null {
    const job = this.getProcessingJob(userId, jobId);
    if (!job) return null;
    Object.assign(job, updates, { updated_at: new Date().toISOString() });
    this.save();
    return job;
  }

  // --- AUDIT LOGS ---
  createAuditLog(log: Omit<AuditLogRecord, 'id' | 'created_at'>): AuditLogRecord {
    const newLog: AuditLogRecord = {
      id: crypto.randomUUID(),
      ...log,
      created_at: new Date().toISOString(),
    };
    this.state.audit_logs.push(newLog);
    if (this.state.audit_logs.length > 500) {
      this.state.audit_logs.shift();
    }
    this.save();
    return newLog;
  }

  getUserAuditLogs(userId: string, limit = 20): AuditLogRecord[] {
    return this.state.audit_logs
      .filter((l) => l.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  // --- OCR RESULTS & TABLE EXTRACTION (RLS & User Isolation) ---
  saveOcrAnalysis(
    userId: string,
    documentId: string,
    analysis: {
      provider: string;
      modelId: string;
      overallConfidence: number;
      rawText: string;
      pages: Array<{ pageNumber: number; rawText?: string; confidence?: number; linesCount?: number }>;
      tables: Array<{
        pageNumber: number;
        tableIndex: number;
        rowCount: number;
        columnCount: number;
        confidence: number;
        boundingRegions?: any[];
        rows: Array<{
          rowIndex: number;
          isHeader?: boolean;
          cells: Array<{
            rowIndex: number;
            columnIndex: number;
            rowSpan?: number;
            columnSpan?: number;
            rawValue: string;
            normalizedValue?: string;
            cellType: 'TEXT' | 'MONEY' | 'DATE' | 'NUMBER';
            confidence: number;
            boundingPolygon?: number[];
          }>;
        }>;
      }>;
      metadata?: Record<string, any>;
    }
  ): void {
    // 1. Verify document ownership
    const doc = this.getUserDocumentById(userId, documentId);
    if (!doc) {
      throw new Error('Document not found or unauthorized');
    }

    const now = new Date().toISOString();

    // 2. Clear old OCR data for this document if any (idempotency)
    this.state.ocr_results = this.state.ocr_results.filter((r) => r.document_id !== documentId);
    this.state.extracted_tables = this.state.extracted_tables.filter((t) => t.document_id !== documentId);
    this.state.extracted_rows = this.state.extracted_rows.filter((r) => r.document_id !== documentId);
    this.state.extracted_cells = this.state.extracted_cells.filter((c) => c.document_id !== documentId);

    // 3. Save page OCR results
    for (const page of analysis.pages) {
      this.state.ocr_results.push({
        id: crypto.randomUUID(),
        document_id: documentId,
        user_id: userId,
        page_number: page.pageNumber,
        raw_text: page.rawText || analysis.rawText,
        confidence_score: page.confidence ?? analysis.overallConfidence,
        azure_model_id: analysis.modelId,
        metadata: {
          provider: analysis.provider,
          linesCount: page.linesCount,
          ...analysis.metadata,
        },
        created_at: now,
      });
    }

    // 4. Save tables, rows, cells
    for (const t of analysis.tables) {
      const tableId = crypto.randomUUID();
      this.state.extracted_tables.push({
        id: tableId,
        document_id: documentId,
        user_id: userId,
        page_number: t.pageNumber,
        table_index: t.tableIndex,
        row_count: t.rowCount,
        column_count: t.columnCount,
        confidence_score: t.confidence,
        bounding_regions: t.boundingRegions,
        created_at: now,
      });

      for (const r of t.rows) {
        const rowId = crypto.randomUUID();
        this.state.extracted_rows.push({
          id: rowId,
          table_id: tableId,
          document_id: documentId,
          user_id: userId,
          row_index: r.rowIndex,
          is_header: !!r.isHeader,
          created_at: now,
        });

        for (const c of r.cells) {
          this.state.extracted_cells.push({
            id: crypto.randomUUID(),
            row_id: rowId,
            table_id: tableId,
            document_id: documentId,
            user_id: userId,
            row_index: c.rowIndex,
            column_index: c.columnIndex,
            row_span: c.rowSpan || 1,
            column_span: c.columnSpan || 1,
            raw_value: c.rawValue,
            normalized_value: c.normalizedValue || c.rawValue,
            cell_type: c.cellType || 'TEXT',
            confidence_score: c.confidence,
            is_reviewed: false,
            bounding_box: c.boundingPolygon ? { polygon: c.boundingPolygon } : undefined,
            created_at: now,
            updated_at: now,
          });
        }
      }
    }

    this.save();
  }

  getDocumentOcrResult(userId: string, documentId: string) {
    const doc = this.getUserDocumentById(userId, documentId);
    if (!doc) return null;

    const ocrResults = this.state.ocr_results.filter((r) => r.document_id === documentId && r.user_id === userId);
    const tables = this.state.extracted_tables
      .filter((t) => t.document_id === documentId && t.user_id === userId)
      .sort((a, b) => a.table_index - b.table_index);

    const formattedTables = tables.map((t) => {
      const rows = this.state.extracted_rows
        .filter((r) => r.table_id === t.id && r.user_id === userId)
        .sort((a, b) => a.row_index - b.row_index);

      const formattedRows = rows.map((r) => {
        const cells = this.state.extracted_cells
          .filter((c) => c.row_id === r.id && c.user_id === userId)
          .sort((a, b) => a.column_index - b.column_index);

        return {
          id: r.id,
          rowIndex: r.row_index,
          isHeader: r.is_header,
          cells: cells.map((c) => ({
            id: c.id,
            rowIndex: c.row_index,
            columnIndex: c.column_index,
            rowSpan: c.row_span,
            columnSpan: c.column_span,
            rawValue: c.raw_value,
            normalizedValue: c.normalized_value,
            cellType: c.cell_type,
            confidence: c.confidence_score,
            isReviewed: c.is_reviewed,
            boundingPolygon: c.bounding_box?.polygon,
            updatedAt: c.updated_at,
          })),
        };
      });

      const headerRow = formattedRows.find((r) => r.isHeader) || formattedRows[0];
      const headers = headerRow ? headerRow.cells.map((c) => c.rawValue) : [];

      return {
        id: t.id,
        pageNumber: t.page_number,
        tableIndex: t.table_index,
        rowCount: t.row_count,
        columnCount: t.column_count,
        confidence: t.confidence_score,
        boundingRegions: t.bounding_regions,
        headers,
        rows: formattedRows,
      };
    });

    // Calculate confidence metrics
    const allCells = this.state.extracted_cells.filter((c) => c.document_id === documentId && c.user_id === userId);
    const lowConfidenceCount = allCells.filter((c) => c.confidence_score < 0.7).length;
    const mediumConfidenceCount = allCells.filter((c) => c.confidence_score >= 0.7 && c.confidence_score < 0.9).length;
    const highConfidenceCount = allCells.filter((c) => c.confidence_score >= 0.9).length;

    return {
      document: doc,
      pages: ocrResults,
      tables: formattedTables,
      metadata: ocrResults[0]?.metadata || {
        provider: 'Azure AI Document Intelligence',
        model: 'prebuilt-layout',
      },
      stats: {
        totalCells: allCells.length,
        lowConfidenceCount,
        mediumConfidenceCount,
        highConfidenceCount,
        requiresReview: lowConfidenceCount > 0,
      },
    };
  }

  updateExtractedCell(
    userId: string,
    documentId: string,
    cellId: string,
    updates: { rawValue?: string; normalizedValue?: string; cellType?: 'TEXT' | 'MONEY' | 'DATE' | 'NUMBER'; isReviewed?: boolean }
  ) {
    const doc = this.getUserDocumentById(userId, documentId);
    if (!doc) throw new Error('Document not found or unauthorized');

    const cell = this.state.extracted_cells.find(
      (c) => c.id === cellId && c.document_id === documentId && c.user_id === userId
    );
    if (!cell) throw new Error('Cell not found or unauthorized');

    const beforeVal = cell.raw_value;

    if (updates.rawValue !== undefined) {
      cell.raw_value = updates.rawValue;
      // If normalizedValue not explicitly provided, calculate it
      cell.normalized_value = updates.normalizedValue !== undefined ? updates.normalizedValue : updates.rawValue;
    }
    if (updates.cellType !== undefined) {
      cell.cell_type = updates.cellType;
    }
    if (updates.isReviewed !== undefined) {
      cell.is_reviewed = updates.isReviewed;
    } else {
      cell.is_reviewed = true;
    }

    cell.updated_at = new Date().toISOString();

    // Log review action
    this.state.review_actions.push({
      id: crypto.randomUUID(),
      user_id: userId,
      document_id: documentId,
      cell_id: cellId,
      action_type: 'EDIT_CELL',
      before_value: beforeVal,
      after_value: cell.raw_value,
      metadata: { rowIndex: cell.row_index, columnIndex: cell.column_index },
      created_at: new Date().toISOString(),
    });

    this.save();
    return cell;
  }

  addExtractedRow(
    userId: string,
    documentId: string,
    tableId: string,
    cells: Array<{ rawValue: string; normalizedValue?: string; cellType?: 'TEXT' | 'MONEY' | 'DATE' | 'NUMBER'; columnIndex: number }>
  ) {
    const doc = this.getUserDocumentById(userId, documentId);
    if (!doc) throw new Error('Document not found or unauthorized');

    const table = this.state.extracted_tables.find(
      (t) => t.id === tableId && t.document_id === documentId && t.user_id === userId
    );
    if (!table) throw new Error('Table not found or unauthorized');

    const existingRows = this.state.extracted_rows.filter((r) => r.table_id === tableId);
    const newRowIndex = existingRows.length;
    const rowId = crypto.randomUUID();
    const now = new Date().toISOString();

    const newRow: ExtractedRowRecord = {
      id: rowId,
      table_id: tableId,
      document_id: documentId,
      user_id: userId,
      row_index: newRowIndex,
      is_header: false,
      created_at: now,
    };
    this.state.extracted_rows.push(newRow);

    const createdCells: ExtractedCellRecord[] = [];
    for (let cIdx = 0; cIdx < (table.column_count || cells.length || 1); cIdx++) {
      const inputCell = cells.find((c) => c.columnIndex === cIdx);
      const rawVal = inputCell?.rawValue || '';
      const normVal = inputCell?.normalizedValue || rawVal;
      const cType = inputCell?.cellType || 'TEXT';

      const cellRec: ExtractedCellRecord = {
        id: crypto.randomUUID(),
        row_id: rowId,
        table_id: tableId,
        document_id: documentId,
        user_id: userId,
        row_index: newRowIndex,
        column_index: cIdx,
        row_span: 1,
        column_span: 1,
        raw_value: rawVal,
        normalized_value: normVal,
        cell_type: cType,
        confidence_score: 1.0, // Human entered
        is_reviewed: true,
        created_at: now,
        updated_at: now,
      };
      this.state.extracted_cells.push(cellRec);
      createdCells.push(cellRec);
    }

    table.row_count += 1;

    // Log review action
    this.state.review_actions.push({
      id: crypto.randomUUID(),
      user_id: userId,
      document_id: documentId,
      action_type: 'ADD_ROW',
      after_value: JSON.stringify(cells),
      metadata: { tableId, rowIndex: newRowIndex },
      created_at: now,
    });

    this.save();
    return { row: newRow, cells: createdCells };
  }

  deleteExtractedRow(userId: string, documentId: string, tableId: string, rowIndex: number) {
    const doc = this.getUserDocumentById(userId, documentId);
    if (!doc) throw new Error('Document not found or unauthorized');

    const table = this.state.extracted_tables.find(
      (t) => t.id === tableId && t.document_id === documentId && t.user_id === userId
    );
    if (!table) throw new Error('Table not found or unauthorized');

    const targetRow = this.state.extracted_rows.find(
      (r) => r.table_id === tableId && r.row_index === rowIndex && r.user_id === userId
    );
    if (!targetRow) throw new Error('Row not found');

    // Remove row and its cells
    this.state.extracted_rows = this.state.extracted_rows.filter((r) => r.id !== targetRow.id);
    this.state.extracted_cells = this.state.extracted_cells.filter((c) => c.row_id !== targetRow.id);

    // Re-index subsequent rows
    this.state.extracted_rows
      .filter((r) => r.table_id === tableId && r.row_index > rowIndex)
      .forEach((r) => {
        r.row_index -= 1;
      });
    this.state.extracted_cells
      .filter((c) => c.table_id === tableId && c.row_index > rowIndex)
      .forEach((c) => {
        c.row_index -= 1;
      });

    table.row_count = Math.max(0, table.row_count - 1);

    this.state.review_actions.push({
      id: crypto.randomUUID(),
      user_id: userId,
      document_id: documentId,
      action_type: 'DELETE_ROW',
      before_value: JSON.stringify({ rowIndex }),
      created_at: new Date().toISOString(),
    });

    this.save();
    return true;
  }

  markDocumentReviewed(userId: string, documentId: string) {
    const doc = this.getUserDocumentById(userId, documentId);
    if (!doc) throw new Error('Document not found or unauthorized');

    doc.status = 'READY';
    doc.updated_at = new Date().toISOString();

    const job = this.getJobByDocumentId(userId, documentId);
    if (job) {
      job.status = 'READY';
      job.current_step = 'Đối soát hoàn tất. Sẵn sàng xuất dữ liệu.';
      job.progress = 100;
      job.completed_at = new Date().toISOString();
      job.updated_at = new Date().toISOString();
    }

    // Mark all cells as reviewed
    this.state.extracted_cells
      .filter((c) => c.document_id === documentId && c.user_id === userId)
      .forEach((c) => {
        c.is_reviewed = true;
      });

    this.state.review_actions.push({
      id: crypto.randomUUID(),
      user_id: userId,
      document_id: documentId,
      action_type: 'COMPLETE_REVIEW',
      created_at: new Date().toISOString(),
    });

    this.save();
    return doc;
  }

  getDocumentReviewActions(userId: string, documentId: string): ReviewActionRecord[] {
    return this.state.review_actions
      .filter((a) => a.user_id === userId && a.document_id === documentId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  // --- EXPORTS (PHASE 3A) ---
  createExportRecord(exportData: Omit<ExportRecord, 'created_at'>): ExportRecord {
    const record: ExportRecord = {
      ...exportData,
      created_at: new Date().toISOString(),
    };
    this.state.exports.push(record);
    this.save();
    return record;
  }

  getUserExportById(userId: string, exportId: string): ExportRecord | undefined {
    return this.state.exports.find((e) => e.id === exportId && e.user_id === userId);
  }

  getDocumentExports(userId: string, documentId: string): ExportRecord[] {
    return this.state.exports
      .filter((e) => e.user_id === userId && e.document_id === documentId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  findExistingExport(
    userId: string,
    documentId: string,
    format: 'XLSX' | 'DOCX',
    mode: 'ORIGINAL' | 'NORMALIZED'
  ): ExportRecord | undefined {
    return this.state.exports.find(
      (e) =>
        e.user_id === userId &&
        e.document_id === documentId &&
        e.export_format === format &&
        e.export_mode === mode &&
        e.status === 'COMPLETED'
    );
  }
}

export const db = new DatabaseService();
