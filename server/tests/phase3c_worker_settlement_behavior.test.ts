import 'dotenv/config';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { db, ProcessingJobRecord } from '../db/db.js';
import { creditService } from '../services/credit/creditService.js';
import { storageService } from '../services/storageService.js';
import { OcrBackgroundWorker } from '../services/ocrWorker.js';
import { DocumentAIProvider, OCRAnalysisResult } from '../services/ocr/types.js';

// ==============================================================================
// PHASE 3C — BEHAVIORAL FINANCIAL SETTLEMENT TEST MATRIX
// ==============================================================================

interface TestCase {
  id: string;
  name: string;
  run: () => Promise<void>;
}

// Minimal valid OCR mock result for ValidationEngine deterministic validation
function createValidOcrResult(): OCRAnalysisResult {
  return {
    provider: 'AZURE_DOCUMENT_INTELLIGENCE',
    modelId: 'prebuilt-layout',
    overallConfidence: 0.99,
    rawText: '100.00',
    pages: [{ pageNumber: 1, width: 8.5, height: 11, unit: 'inch', lines: [] } as any],
    tables: [
      {
        pageNumber: 1,
        tableIndex: 0,
        rowCount: 1,
        columnCount: 1,
        confidence: 0.99,
        rows: [
          {
            rowIndex: 0,
            cells: [
              {
                rowIndex: 0,
                columnIndex: 0,
                rawValue: '100.00',
                normalizedValue: '100.00',
                confidence: 0.99,
                confidenceSource: 'AZURE_MODEL',
                cellType: 'MONEY',
              },
            ],
          },
        ],
      },
    ],
    metadata: { pageCount: 1 },
  };
}

// Minimal OCR mock result that produces REVIEW_REQUIRED
function createReviewRequiredOcrResult(): OCRAnalysisResult {
  return {
    provider: 'AZURE_DOCUMENT_INTELLIGENCE',
    modelId: 'prebuilt-layout',
    overallConfidence: 0.25,
    rawText: 'invalid_num',
    pages: [{ pageNumber: 1, width: 8.5, height: 11, unit: 'inch', lines: [] } as any],
    tables: [
      {
        pageNumber: 1,
        tableIndex: 0,
        rowCount: 1,
        columnCount: 1,
        confidence: 0.25,
        rows: [
          {
            rowIndex: 0,
            cells: [
              {
                rowIndex: 0,
                columnIndex: 0,
                rawValue: 'invalid_num',
                normalizedValue: '',
                confidence: 0.25,
                confidenceSource: 'AZURE_MODEL',
                cellType: 'MONEY',
              },
            ],
          },
        ],
      },
    ],
    metadata: { pageCount: 1 },
  };
}

class BehavioralTestHarness {
  public jobs: Map<string, ProcessingJobRecord> = new Map();
  public documents: Map<string, any> = new Map();
  public reservations: Map<string, any> = new Map();

  // Spies & Call Trackers
  public analyzeDocumentCalls: any[] = [];
  public getFileCalls: any[] = [];
  public captureCalls: any[] = [];
  public releaseCalls: any[] = [];
  public updateJobCalls: any[] = [];
  public updateDocStatusCalls: any[] = [];

  // Injected behaviors
  public analyzeDocumentImpl?: (buffer: Buffer, mime: string, opts?: any) => Promise<OCRAnalysisResult>;
  public captureReservationImpl?: (params: any) => Promise<any>;
  public releaseReservationImpl?: (params: any) => Promise<any>;

  // Originals backup
  private origGetProcessingJob = db.getProcessingJob;
  private origUpdateProcessingJob = db.updateProcessingJob;
  private origGetUserDocumentById = db.getUserDocumentById;
  private origGetDocument = db.getDocument;
  private origUpdateDocumentStatus = db.updateDocumentStatus;
  private origGetValidatedReservationForJob = db.getValidatedReservationForJob;
  private origGetDocumentPages = db.getDocumentPages;
  private origSaveOcrAnalysis = db.saveOcrAnalysis;
  private origUpdateSecondaryOcrTelemetry = db.updateSecondaryOcrTelemetry;

  private origGetFile = storageService.getFile;
  private origCaptureReservation = creditService.captureReservation;
  private origReleaseReservation = creditService.releaseReservation;

  public worker: OcrBackgroundWorker;

  constructor() {
    const mockProvider: DocumentAIProvider = {
      providerName: 'MOCK_AZURE_PROVIDER',
      analyzeDocument: async (buffer: Buffer, mimeType: string, options?: any) => {
        this.analyzeDocumentCalls.push({ buffer, mimeType, options });
        if (this.analyzeDocumentImpl) {
          return this.analyzeDocumentImpl(buffer, mimeType, options);
        }
        return createValidOcrResult();
      },
    };

    this.worker = new OcrBackgroundWorker(mockProvider);
  }

  public setupMocks() {
    // Disable PDE so worker follows deterministic single-path
    process.env.PROCESSING_DECISION_ENGINE_ENABLED = 'false';

    // Mock db.getProcessingJob
    db.getProcessingJob = async (userId: string, jobId: string) => {
      const job = this.jobs.get(jobId);
      return job ? { ...job } : null;
    };

    // Mock db.updateProcessingJob
    db.updateProcessingJob = async (userId: string, jobId: string, updates: Partial<ProcessingJobRecord>) => {
      this.updateJobCalls.push({ userId, jobId, updates });
      const existing = this.jobs.get(jobId);
      if (!existing) return null;
      const updated = {
        ...existing,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      this.jobs.set(jobId, updated);
      return { ...updated };
    };

    // Mock db.getUserDocumentById & db.getDocument
    db.getUserDocumentById = async (userId: string, docId: string) => {
      const doc = this.documents.get(docId);
      return doc ? { ...doc } : null;
    };
    db.getDocument = async (userId: string, docId: string) => {
      const doc = this.documents.get(docId);
      return doc ? { ...doc } : null;
    };

    // Mock db.updateDocumentStatus
    db.updateDocumentStatus = (async (userId: string, docId: string, status: any) => {
      this.updateDocStatusCalls.push({ userId, docId, status });
      const doc = this.documents.get(docId);
      if (doc) {
        doc.status = status;
        this.documents.set(docId, doc);
      }
      return doc as any;
    }) as any;

    // Mock db.getValidatedReservationForJob
    // Implements exact logic of db.ts getValidatedReservationForJob against in-memory reservations
    db.getValidatedReservationForJob = async (job: ProcessingJobRecord) => {
      if (!job.reservation_id && !job.pricing_version) {
        return { valid: false, reason: 'HISTORICAL_JOB_NO_RESERVATION' };
      }
      if (!job.reservation_id) {
        return { valid: false, reason: 'MISSING_JOB_RESERVATION_ID' };
      }
      const reservation = this.reservations.get(job.reservation_id);
      if (!reservation) {
        return { valid: false, reason: 'RESERVATION_NOT_FOUND' };
      }
      if (reservation.reference_type !== 'PROCESSING_JOB') {
        return {
          valid: false,
          reason: `REFERENCE_TYPE_MISMATCH: ${reservation.reference_type}`,
          reservation,
        };
      }
      if (reservation.reference_id !== job.id) {
        return {
          valid: false,
          reason: `REFERENCE_ID_MISMATCH: expected ${job.id}, got ${reservation.reference_id}`,
          reservation,
        };
      }
      if (reservation.user_id !== job.user_id) {
        return {
          valid: false,
          reason: `USER_ID_MISMATCH: job user ${job.user_id} != reservation user ${reservation.user_id}`,
          reservation,
        };
      }
      if (
        job.estimated_billable_units !== null &&
        job.estimated_billable_units !== undefined
      ) {
        if (Number(reservation.requested_units) !== Number(job.estimated_billable_units)) {
          return {
            valid: false,
            reason: `AMOUNT_MISMATCH: job estimated ${job.estimated_billable_units} != requested ${reservation.requested_units}`,
            reservation,
          };
        }
      }
      if (
        reservation.status !== 'RESERVED' &&
        reservation.status !== 'PARTIALLY_CAPTURED'
      ) {
        return {
          valid: false,
          reason: `INVALID_RESERVATION_STATUS: ${reservation.status}`,
          reservation,
        };
      }
      const heldUnits =
        Number(reservation.reserved_units) -
        Number(reservation.captured_units) -
        Number(reservation.released_units);
      if (heldUnits <= 0) {
        return {
          valid: false,
          reason: `NO_HELD_UNITS_REMAINING: heldUnits = ${heldUnits}`,
          reservation,
        };
      }
      if (job.status === 'QUEUED' || !job.started_at) {
        if (
          Number(reservation.captured_units) > 0 ||
          Number(reservation.released_units) > 0
        ) {
          return {
            valid: false,
            reason: 'RESERVATION_ALREADY_MUTATED_BEFORE_INITIAL_RUN',
            reservation,
          };
        }
      }
      return { valid: true, reservation };
    };

    db.getDocumentPages = (async () => []) as any;
    db.saveOcrAnalysis = (async (userId: string, docId: string, analysis: any, validationReport: any) => {
      const doc = this.documents.get(docId);
      if (doc) {
        doc.status = validationReport?.status || 'READY';
      }
    }) as any;
    db.updateSecondaryOcrTelemetry = (async () => {}) as any;

    // Mock storageService.getFile
    storageService.getFile = (async (userId: string, docId: string) => {
      this.getFileCalls.push({ userId, docId });
      return {
        buffer: Buffer.from('%PDF-1.4 test dummy content'),
        mimeType: 'application/pdf',
      } as any;
    }) as any;

    // Mock creditService.captureReservation
    creditService.captureReservation = async (params: any) => {
      this.captureCalls.push({ ...params });
      if (this.captureReservationImpl) {
        return this.captureReservationImpl(params);
      }
      const res = this.reservations.get(params.reservationId);
      if (res) {
        res.captured_units = Number(res.captured_units) + Number(params.captureUnits);
        const outstanding = Number(res.reserved_units) - Number(res.captured_units) - Number(res.released_units);
        if (outstanding === 0 && Number(res.released_units) === 0) {
          res.status = 'CAPTURED';
        } else if (outstanding === 0 && Number(res.released_units) > 0) {
          res.status = 'SETTLED';
        } else {
          res.status = 'PARTIALLY_CAPTURED';
        }
      }
      return {
        reservation_id: params.reservationId,
        captured_units: params.captureUnits,
        already_processed: false,
      };
    };

    // Mock creditService.releaseReservation
    creditService.releaseReservation = async (params: any) => {
      this.releaseCalls.push({ ...params });
      if (this.releaseReservationImpl) {
        return this.releaseReservationImpl(params);
      }
      const res = this.reservations.get(params.reservationId);
      if (res) {
        res.released_units = Number(res.released_units) + Number(params.releaseUnits);
        const outstanding = Number(res.reserved_units) - Number(res.captured_units) - Number(res.released_units);
        if (outstanding === 0 && Number(res.captured_units) === 0) {
          res.status = 'RELEASED';
        } else if (outstanding === 0 && Number(res.captured_units) > 0) {
          res.status = 'SETTLED';
        } else {
          res.status = Number(res.captured_units) > 0 ? 'PARTIALLY_CAPTURED' : 'RESERVED';
        }
      }
      return {
        reservation_id: params.reservationId,
        released_units: params.releaseUnits,
        already_processed: false,
      };
    };
  }

  public teardown() {
    // Restore all original functions
    db.getProcessingJob = this.origGetProcessingJob;
    db.updateProcessingJob = this.origUpdateProcessingJob;
    db.getUserDocumentById = this.origGetUserDocumentById;
    db.getDocument = this.origGetDocument;
    db.updateDocumentStatus = this.origUpdateDocumentStatus;
    db.getValidatedReservationForJob = this.origGetValidatedReservationForJob;
    db.getDocumentPages = this.origGetDocumentPages;
    db.saveOcrAnalysis = this.origSaveOcrAnalysis;
    db.updateSecondaryOcrTelemetry = this.origUpdateSecondaryOcrTelemetry;

    storageService.getFile = this.origGetFile;
    creditService.captureReservation = this.origCaptureReservation;
    creditService.releaseReservation = this.origReleaseReservation;

    // Clear any active timers on worker
    const timers = (this.worker as any).activeRetryTimers;
    if (timers) {
      for (const t of timers.values()) {
        clearTimeout(t);
      }
      timers.clear();
    }
  }
}

// Helper to seed standard valid job, document, and reservation
function seedStandardState(harness: BehavioralTestHarness, overrides?: {
  jobStatus?: ProcessingJobRecord['status'];
  docStatus?: string;
  resStatus?: string;
  units?: number;
  capturedUnits?: number;
  releasedUnits?: number;
  startedAt?: string | null;
}) {
  const userId = 'user-test-uuid-001';
  const docId = 'doc-test-uuid-001';
  const jobId = 'job-test-uuid-001';
  const resId = 'res-test-uuid-001';

  const units = overrides?.units ?? 1000;
  const captured = overrides?.capturedUnits ?? 0;
  const released = overrides?.releasedUnits ?? 0;

  const job: ProcessingJobRecord = {
    id: jobId,
    user_id: userId,
    document_id: docId,
    status: overrides?.jobStatus ?? 'QUEUED',
    current_step: 'Queued in pipeline',
    progress: 0,
    attempt_count: 1,
    started_at: overrides?.startedAt !== undefined ? overrides.startedAt : null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pricing_version: '2026-10-tier-standard',
    estimated_billable_units: units,
    reservation_id: resId,
  };

  const document = {
    id: docId,
    user_id: userId,
    file_name: 'statement.pdf',
    original_filename: 'statement.pdf',
    mime_type: 'application/pdf',
    status: overrides?.docStatus ?? 'QUEUED',
    output_type: 'EXCEL',
  };

  const reservation = {
    id: resId,
    user_id: userId,
    reference_type: 'PROCESSING_JOB',
    reference_id: jobId,
    status: overrides?.resStatus ?? 'RESERVED',
    requested_units: units,
    reserved_units: units,
    captured_units: captured,
    released_units: released,
  };

  harness.jobs.set(jobId, job);
  harness.documents.set(docId, document);
  harness.reservations.set(resId, reservation);

  return { userId, docId, jobId, resId, units };
}

// ==============================================================================
// TEST CASES MATRIX (3C-01 to 3C-16)
// ==============================================================================

const testCases: TestCase[] = [
  // ---------------------------------------------------------------------------
  // TEST 3C-01 — NORMAL SUCCESS CAPTURE (READY and REVIEW_REQUIRED)
  // ---------------------------------------------------------------------------
  {
    id: '3C-01A',
    name: 'Normal success CAPTURE with final status READY',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId, units } = seedStandardState(harness, {
          jobStatus: 'QUEUED',
          docStatus: 'QUEUED',
        });

        const result = await harness.worker.processJob(userId, jobId, docId);

        // 1. OCR executes exactly once
        assert.strictEqual(harness.analyzeDocumentCalls.length, 1, 'OCR provider must be called exactly once');

        // 2. Worker persists VALIDATING_RESULT before CAPTURE
        const validatingResultUpdateIndex = harness.updateJobCalls.findIndex(
          (c) => c.updates.status === 'VALIDATING_RESULT'
        );
        assert(validatingResultUpdateIndex >= 0, 'Worker must persist VALIDATING_RESULT checkpoint');

        // 3. CAPTURE called exactly once
        assert.strictEqual(harness.captureCalls.length, 1, 'captureReservation must be called exactly once');
        const captureCall = harness.captureCalls[0];
        assert.strictEqual(captureCall.captureUnits, units, `captureUnits must match estimated units ${units}`);
        assert.strictEqual(captureCall.idempotencyKey, `processing-capture:${jobId}`, 'idempotencyKey must follow canonical pattern');
        assert.strictEqual(captureCall.userId, userId, 'userId must match');
        assert.strictEqual(captureCall.reservationId, resId, 'reservationId must match');

        // 4. RELEASE not called
        assert.strictEqual(harness.releaseCalls.length, 0, 'releaseReservation must NOT be called on success');

        // 5. Final job & document status READY
        assert.strictEqual(result?.status, 'READY', 'Final job status must be READY');
        assert.strictEqual(result?.progress, 100, 'Final progress must be 100');
        assert(result?.completed_at, 'completed_at must be populated');
        const finalDoc = harness.documents.get(docId);
        assert.strictEqual(finalDoc.status, 'READY', 'Final document status must be READY');
      } finally {
        harness.teardown();
      }
    },
  },

  {
    id: '3C-01B',
    name: 'Normal success CAPTURE with final status REVIEW_REQUIRED',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, units } = seedStandardState(harness, {
          jobStatus: 'QUEUED',
          docStatus: 'QUEUED',
        });

        // Provider returns low confidence output -> triggers REVIEW_REQUIRED
        harness.analyzeDocumentImpl = async () => createReviewRequiredOcrResult();

        const result = await harness.worker.processJob(userId, jobId, docId);

        assert.strictEqual(harness.analyzeDocumentCalls.length, 1, 'OCR called exactly once');
        assert.strictEqual(harness.captureCalls.length, 1, 'captureReservation called exactly once');
        assert.strictEqual(harness.captureCalls[0].captureUnits, units);
        assert.strictEqual(harness.releaseCalls.length, 0, 'No RELEASE called');
        assert.strictEqual(result?.status, 'REVIEW_REQUIRED', 'Job status must be REVIEW_REQUIRED');
        assert.strictEqual(result?.progress, 100);
        assert(result?.completed_at);
        const finalDoc = harness.documents.get(docId);
        assert.strictEqual(finalDoc.status, 'REVIEW_REQUIRED', 'Document status must be REVIEW_REQUIRED');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-02 — VALIDATING_RESULT + ACTIVE RESERVATION (Recovery Case A)
  // ---------------------------------------------------------------------------
  {
    id: '3C-02',
    name: 'VALIDATING_RESULT recovery with active reservation executes settlement without rerunning OCR',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId, units } = seedStandardState(harness, {
          jobStatus: 'VALIDATING_RESULT',
          docStatus: 'READY',
          resStatus: 'RESERVED',
          startedAt: new Date().toISOString(),
        });

        const result = await harness.worker.processJob(userId, jobId, docId);

        // Negative guarantees: NO OCR, NO storage download
        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'OCR provider MUST NOT be called in settlement recovery');
        assert.strictEqual(harness.getFileCalls.length, 0, 'Storage download MUST NOT be called in settlement recovery');

        // Financial side effect: CAPTURE exactly once
        assert.strictEqual(harness.captureCalls.length, 1, 'captureReservation must be called exactly once');
        assert.strictEqual(harness.captureCalls[0].captureUnits, units);
        assert.strictEqual(harness.captureCalls[0].idempotencyKey, `processing-capture:${jobId}`);

        // RELEASE not called
        assert.strictEqual(harness.releaseCalls.length, 0, 'releaseReservation must not be called');

        // Finalize
        assert.strictEqual(result?.status, 'READY', 'Job must be finalized to READY');
        assert.strictEqual(result?.progress, 100);
        assert(result?.completed_at);
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-03 — VALIDATING_RESULT + ALREADY CAPTURED (Recovery Case B)
  // ---------------------------------------------------------------------------
  {
    id: '3C-03',
    name: 'VALIDATING_RESULT recovery with ALREADY CAPTURED reservation finalizes without duplicate capture or OCR',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, units } = seedStandardState(harness, {
          jobStatus: 'VALIDATING_RESULT',
          docStatus: 'REVIEW_REQUIRED',
          resStatus: 'CAPTURED',
          capturedUnits: 1000,
          releasedUnits: 0,
          startedAt: new Date().toISOString(),
        });

        const result = await harness.worker.processJob(userId, jobId, docId);

        // Negative guarantees
        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'OCR MUST NOT be called');
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE MUST NOT be called again');
        assert.strictEqual(harness.releaseCalls.length, 0, 'RELEASE MUST NOT be called');

        // Finalize
        assert.strictEqual(result?.status, 'REVIEW_REQUIRED', 'Job must finalize to REVIEW_REQUIRED');
        assert.strictEqual(result?.progress, 100);
        assert(result?.completed_at);
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-04 — VALIDATING_RESULT + ALREADY SETTLED
  // ---------------------------------------------------------------------------
  {
    id: '3C-04',
    name: 'VALIDATING_RESULT recovery with ALREADY SETTLED reservation finalizes without duplicate capture or OCR',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId } = seedStandardState(harness, {
          jobStatus: 'VALIDATING_RESULT',
          docStatus: 'READY',
          resStatus: 'SETTLED',
          capturedUnits: 1000,
          releasedUnits: 0,
          startedAt: new Date().toISOString(),
        });

        const result = await harness.worker.processJob(userId, jobId, docId);

        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'OCR MUST NOT be called');
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE MUST NOT be called');
        assert.strictEqual(harness.releaseCalls.length, 0, 'RELEASE MUST NOT be called');
        assert.strictEqual(result?.status, 'READY', 'Job must finalize to READY');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-05 — CAPTURE TEMPORARY FAILURE
  // ---------------------------------------------------------------------------
  {
    id: '3C-05',
    name: 'Temporary failure during CAPTURE stays in VALIDATING_RESULT without resetting to QUEUED or rerunning OCR',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId } = seedStandardState(harness, {
          jobStatus: 'QUEUED',
          docStatus: 'QUEUED',
        });

        // Mock CAPTURE failure
        harness.captureReservationImpl = async () => {
          throw new Error('Database connection timed out during capture RPC');
        };

        const result = await harness.worker.processJob(userId, jobId, docId);

        // Verify OCR executed on initial pass
        assert.strictEqual(harness.analyzeDocumentCalls.length, 1, 'Initial OCR executed');

        // Negative guarantees: Job and document MUST NOT become QUEUED
        assert.strictEqual(result?.status, 'VALIDATING_RESULT', 'Job MUST remain in VALIDATING_RESULT');
        assert.notStrictEqual(result?.status, 'QUEUED', 'Job MUST NOT be reset to QUEUED');
        const doc = harness.documents.get(docId);
        assert.notStrictEqual(doc.status, 'QUEUED', 'Document MUST NOT be reset to QUEUED');

        // Financial retry error code persisted
        assert.strictEqual(result?.error_code, 'CREDIT_SETTLEMENT_RETRY_REQUIRED', 'Error code must reflect settlement retry');

        // Re-simulate next processJob invocation in settlement-only recovery:
        // Clear OCR spy and invoke processJob again
        harness.analyzeDocumentCalls = [];
        await harness.worker.processJob(userId, jobId, docId);

        // PROVE: OCR call count remains ZERO during settlement retry!
        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'Settlement retry MUST NOT rerun OCR');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-06 — INVALID RESERVATION LINKAGE (Fail-closed)
  // ---------------------------------------------------------------------------
  {
    id: '3C-06A',
    name: 'Invalid reservation linkage: REFERENCE_ID_MISMATCH fails closed',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId } = seedStandardState(harness);
        const res = harness.reservations.get(resId);
        res.reference_id = 'different-job-id-999'; // MISMATCH

        const result = await harness.worker.processJob(userId, jobId, docId);

        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'OCR MUST NOT be called');
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE MUST NOT be called');
        assert.strictEqual(harness.releaseCalls.length, 0, 'RELEASE MUST NOT be called');
        assert.strictEqual(result?.status, 'FAILED', 'Worker must fail closed');
        assert.strictEqual(result?.error_code, 'MISSING_CREDIT_RESERVATION');
      } finally {
        harness.teardown();
      }
    },
  },

  {
    id: '3C-06B',
    name: 'Invalid reservation linkage: USER_ID_MISMATCH fails closed',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId } = seedStandardState(harness);
        const res = harness.reservations.get(resId);
        res.user_id = 'attacker-user-id-666'; // MISMATCH

        const result = await harness.worker.processJob(userId, jobId, docId);

        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'OCR MUST NOT be called');
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE MUST NOT be called');
        assert.strictEqual(harness.releaseCalls.length, 0, 'RELEASE MUST NOT be called');
        assert.strictEqual(result?.status, 'FAILED', 'Worker must fail closed');
      } finally {
        harness.teardown();
      }
    },
  },

  {
    id: '3C-06C',
    name: 'Invalid reservation linkage: AMOUNT_MISMATCH fails closed',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId } = seedStandardState(harness);
        const res = harness.reservations.get(resId);
        res.requested_units = 500; // job estimated is 1000 -> MISMATCH

        const result = await harness.worker.processJob(userId, jobId, docId);

        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'OCR MUST NOT be called');
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE MUST NOT be called');
        assert.strictEqual(harness.releaseCalls.length, 0, 'RELEASE MUST NOT be called');
        assert.strictEqual(result?.status, 'FAILED', 'Worker must fail closed');
      } finally {
        harness.teardown();
      }
    },
  },

  {
    id: '3C-06D',
    name: 'Terminal CAPTURED reservation with linkage mismatch CANNOT bypass validation in recovery',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId } = seedStandardState(harness, {
          jobStatus: 'VALIDATING_RESULT',
          docStatus: 'READY',
          resStatus: 'CAPTURED',
          capturedUnits: 1000,
          releasedUnits: 0,
        });
        const res = harness.reservations.get(resId);
        res.user_id = 'foreign-user-id'; // User mismatch

        const result = await harness.worker.processJob(userId, jobId, docId);

        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'OCR MUST NOT be called');
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE MUST NOT be called');
        assert.strictEqual(result?.status, 'VALIDATING_RESULT', 'Must stay in VALIDATING_RESULT');
        assert.strictEqual(result?.error_code, 'CREDIT_SETTLEMENT_RECOVERY_INVALID', 'Must flag invalid recovery');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-07 — PRIOR RELEASE MUST BLOCK SUCCESS
  // ---------------------------------------------------------------------------
  {
    id: '3C-07',
    name: 'Prior release (released_units > 0) blocks success and halts settlement',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId } = seedStandardState(harness, {
          jobStatus: 'VALIDATING_RESULT',
          docStatus: 'READY',
          resStatus: 'RESERVED',
          units: 1000,
          capturedUnits: 0,
          releasedUnits: 300, // Partial prior release!
          startedAt: new Date().toISOString(),
        });

        const result = await harness.worker.processJob(userId, jobId, docId);

        // Negative guarantees
        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'OCR MUST NOT be called');
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE MUST NOT be called');
        assert.strictEqual(harness.releaseCalls.length, 0, 'RELEASE MUST NOT be called');

        // Financial invariant failure recorded
        assert.strictEqual(result?.status, 'VALIDATING_RESULT', 'Job must remain VALIDATING_RESULT');
        assert.strictEqual(result?.error_code, 'SETTLEMENT_RECOVERY_INVARIANT_FAILED', 'Must record invariant failure');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-08 — TERMINAL OCR FAILURE RELEASE
  // ---------------------------------------------------------------------------
  {
    id: '3C-08',
    name: 'Terminal OCR failure releases reservation before marking job and doc FAILED',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId, units } = seedStandardState(harness, {
          jobStatus: 'QUEUED',
          docStatus: 'QUEUED',
        });
        const job = harness.jobs.get(jobId)!;
        job.attempt_count = 3; // Final attempt, next is attempt 4 > maxRetries (3)

        // Force OCR failure
        harness.analyzeDocumentImpl = async () => {
          throw new Error('Azure Document Intelligence service unavailable');
        };

        const result = await harness.worker.processJob(userId, jobId, docId);

        // 1. RELEASE called exactly once
        assert.strictEqual(harness.releaseCalls.length, 1, 'releaseReservation must be called exactly once');
        const releaseCall = harness.releaseCalls[0];
        assert.strictEqual(releaseCall.releaseUnits, units, `releaseUnits must equal held units ${units}`);
        assert.strictEqual(releaseCall.idempotencyKey, `processing-release:${jobId}`);
        assert.strictEqual(releaseCall.userId, userId);
        assert.strictEqual(releaseCall.reservationId, resId);

        // 2. CAPTURE not called
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE must not be called');

        // 3. Final state is FAILED
        assert.strictEqual(result?.status, 'FAILED', 'Job must be marked FAILED');
        assert.strictEqual(result?.error_code, 'OCR_PROCESSING_FAILED');
        const finalDoc = harness.documents.get(docId);
        assert.strictEqual(finalDoc.status, 'FAILED', 'Document must be marked FAILED');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-09 — INVALID RESERVATION MUST NOT RELEASE
  // ---------------------------------------------------------------------------
  {
    id: '3C-09',
    name: 'Invalid reservation linkage on terminal failure must NOT release reservation',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId } = seedStandardState(harness);
        const job = harness.jobs.get(jobId)!;
        job.attempt_count = 3;
        const res = harness.reservations.get(resId);
        res.reference_id = 'unrelated-job-id'; // Linkage invalid

        harness.analyzeDocumentImpl = async () => {
          throw new Error('Fatal OCR error');
        };

        const result = await harness.worker.processJob(userId, jobId, docId);

        // Negative guarantee: Unrelated/invalid reservation MUST NOT be released
        assert.strictEqual(harness.releaseCalls.length, 0, 'releaseReservation MUST NOT be called for invalid linkage');
        assert.strictEqual(harness.captureCalls.length, 0, 'CAPTURE MUST NOT be called');
        assert.strictEqual(result?.status, 'FAILED', 'Job becomes FAILED');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-10 — RELEASE RPC FAILURE
  // ---------------------------------------------------------------------------
  {
    id: '3C-10',
    name: 'RELEASE RPC failure must not silently mark cleanup complete or falsely succeed',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId } = seedStandardState(harness);
        const job = harness.jobs.get(jobId)!;
        job.attempt_count = 3;

        // Force OCR failure
        harness.analyzeDocumentImpl = async () => {
          throw new Error('Fatal OCR error');
        };

        // Mock RELEASE RPC failure
        harness.releaseReservationImpl = async () => {
          throw new Error('Database connection failed during release_credit_reservation RPC');
        };

        const result = await harness.worker.processJob(userId, jobId, docId);

        // Financial Safety Invariant:
        // A failed RELEASE must NOT silently create a clean terminal job while leaving reservation held forever.
        // It must NOT report that cleanup succeeded without recording the release failure.
        assert(harness.releaseCalls.length >= 1, 'Worker attempted release');
        
        // Check how worker handled the failed release:
        // If the worker updated the job, the error code or message MUST explicitly flag the settlement/release failure,
        // or the job must not be marked clean without recording the financial problem.
        if (result?.status === 'FAILED') {
          assert(
            result?.error_code === 'CREDIT_RELEASE_FAILED' ||
            result?.error_code === 'CREDIT_SETTLEMENT_RELEASE_FAILED' ||
            result?.error_message?.includes('giải phóng') ||
            result?.error_message?.includes('release'),
            `If job is marked FAILED, error_code/message must indicate release failure, but got code: ${result?.error_code}, msg: ${result?.error_message}`
          );
        } else {
          // Worker kept job active / retry
          assert(
            result?.status === 'VALIDATING_RESULT' || result?.status === 'PROCESSING',
            `Worker kept job in non-terminal state ${result?.status} for retry`
          );
        }
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-11 — RELEASE COMMITTED, CRASH BEFORE FAILED STATUS (Window D)
  // ---------------------------------------------------------------------------
  {
    id: '3C-11',
    name: 'Window D recovery: reservation already RELEASED must not rerun OCR or release twice',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        // Crash scenario: OCR failed, RELEASE committed (res status: RELEASED),
        // but worker crashed before updating job/doc to FAILED.
        const { userId, docId, jobId } = seedStandardState(harness, {
          jobStatus: 'PROCESSING',
          docStatus: 'PROCESSING',
          resStatus: 'RELEASED',
          units: 1000,
          capturedUnits: 0,
          releasedUnits: 1000,
          startedAt: new Date().toISOString(),
        });

        const result = await harness.worker.processJob(userId, jobId, docId);

        // Safety Properties:
        // 1. Expensive OCR MUST NOT rerun
        assert.strictEqual(harness.analyzeDocumentCalls.length, 0, 'Expensive OCR MUST NOT rerun when reservation is already RELEASED');

        // 2. Reservation MUST NOT be released twice
        assert.strictEqual(harness.releaseCalls.length, 0, 'Reservation MUST NOT be released twice');

        // 3. Reservation MUST NOT be captured
        assert.strictEqual(harness.captureCalls.length, 0, 'Reservation MUST NOT be captured');

        // 4. Deterministic terminal state reached
        assert.strictEqual(result?.status, 'FAILED', 'Job must reach terminal FAILED state');
        const finalDoc = harness.documents.get(docId);
        assert.strictEqual(finalDoc.status, 'FAILED', 'Document must reach terminal FAILED state');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-12 — IDEMPOTENT CAPTURE REPLAY
  // ---------------------------------------------------------------------------
  {
    id: '3C-12',
    name: 'Idempotent CAPTURE replay with identical key does not double-capture',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId, units } = seedStandardState(harness, {
          jobStatus: 'VALIDATING_RESULT',
          docStatus: 'READY',
          resStatus: 'RESERVED',
        });

        // Run recovery 1
        await harness.worker.processJob(userId, jobId, docId);
        assert.strictEqual(harness.captureCalls.length, 1);
        const firstKey = harness.captureCalls[0].idempotencyKey;

        // Replay: Run recovery 2 with same job
        // Reset job status to VALIDATING_RESULT to simulate duplicate trigger
        const job = harness.jobs.get(jobId)!;
        job.status = 'VALIDATING_RESULT';

        await harness.worker.processJob(userId, jobId, docId);

        // Worker sends the same deterministic idempotency key
        assert.strictEqual(firstKey, `processing-capture:${jobId}`);
        // Reservation captured units remains exactly 1000, not 2000
        const res = harness.reservations.get(resId);
        assert.strictEqual(Number(res.captured_units), units, 'Captured units must NOT double');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-13 — IDEMPOTENT RELEASE REPLAY
  // ---------------------------------------------------------------------------
  {
    id: '3C-13',
    name: 'Idempotent RELEASE replay with identical key does not double-release',
    run: async () => {
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId, resId, units } = seedStandardState(harness);
        const job = harness.jobs.get(jobId)!;
        job.attempt_count = 3;

        harness.analyzeDocumentImpl = async () => {
          throw new Error('Fatal OCR error');
        };

        await harness.worker.processJob(userId, jobId, docId);
        assert.strictEqual(harness.releaseCalls.length, 1);
        const firstKey = harness.releaseCalls[0].idempotencyKey;
        assert.strictEqual(firstKey, `processing-release:${jobId}`);

        const res = harness.reservations.get(resId);
        assert.strictEqual(Number(res.released_units), units, 'Released units matches original held units');
      } finally {
        harness.teardown();
      }
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-14 — PARTIAL CAPTURE STATUS (Migration invariant)
  // ---------------------------------------------------------------------------
  {
    id: '3C-14',
    name: 'Migration invariant: partial CAPTURE produces PARTIALLY_CAPTURED and NEVER ACTIVE',
    run: async () => {
      const migrationFile = path.resolve('supabase/migrations/20261006010000_fix_partial_credit_reservation_status.sql');
      const sql = fs.readFileSync(migrationFile, 'utf-8');

      // 1. Partial capture status in capture_credit_reservation
      assert(
        sql.includes("v_new_status := 'PARTIALLY_CAPTURED';"),
        'capture_credit_reservation must set PARTIALLY_CAPTURED when outstanding > 0'
      );

      // 2. Negative guarantee: NEVER sets 'ACTIVE'
      const activeMatch = sql.match(/v_new_status\s*:=\s*'ACTIVE'/i);
      assert.strictEqual(activeMatch, null, 'Migration MUST NOT set v_new_status to ACTIVE anywhere');

      // 3. Behavioral simulation of SQL logic
      function computeCaptureStatus(outstanding: number, released: number): string {
        if (outstanding === 0) {
          if (released === 0) return 'CAPTURED';
          return 'SETTLED';
        }
        return 'PARTIALLY_CAPTURED';
      }

      assert.strictEqual(computeCaptureStatus(500, 0), 'PARTIALLY_CAPTURED');
      assert.strictEqual(computeCaptureStatus(0, 0), 'CAPTURED');
      assert.strictEqual(computeCaptureStatus(0, 200), 'SETTLED');
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-15 — PARTIAL RELEASE STATUS (Migration invariant)
  // ---------------------------------------------------------------------------
  {
    id: '3C-15',
    name: 'Migration invariant: partial RELEASE produces RESERVED (captured=0) or PARTIALLY_CAPTURED (captured>0)',
    run: async () => {
      const migrationFile = path.resolve('supabase/migrations/20261006010000_fix_partial_credit_reservation_status.sql');
      const sql = fs.readFileSync(migrationFile, 'utf-8');

      // 1. Case A: captured_units = 0 -> RESERVED
      assert(
        sql.includes("v_new_status := 'RESERVED';"),
        'release_credit_reservation must set RESERVED when captured = 0 and outstanding > 0'
      );

      // 2. Case B: captured_units > 0 -> PARTIALLY_CAPTURED
      assert(
        sql.includes("v_new_status := 'PARTIALLY_CAPTURED';"),
        'release_credit_reservation must set PARTIALLY_CAPTURED when captured > 0 and outstanding > 0'
      );

      // 3. Behavioral simulation of release SQL logic
      function computeReleaseStatus(outstanding: number, captured: number): string {
        if (outstanding === 0) {
          if (captured === 0) return 'RELEASED';
          return 'SETTLED';
        }
        if (captured === 0) return 'RESERVED';
        return 'PARTIALLY_CAPTURED';
      }

      // Case A: captured = 0, partial release, outstanding > 0
      assert.strictEqual(computeReleaseStatus(500, 0), 'RESERVED');
      // Case B: captured = 300, partial release, outstanding > 0
      assert.strictEqual(computeReleaseStatus(200, 300), 'PARTIALLY_CAPTURED');
      // Full release with 0 captured
      assert.strictEqual(computeReleaseStatus(0, 0), 'RELEASED');
      // Full release with prior capture
      assert.strictEqual(computeReleaseStatus(0, 500), 'SETTLED');
    },
  },

  // ---------------------------------------------------------------------------
  // TEST 3C-16 — SETTLEMENT RETRY POLICY (Bounded Analysis)
  // ---------------------------------------------------------------------------
  {
    id: '3C-16',
    name: 'Settlement retry policy inspection: bounded vs unbounded analysis',
    run: async () => {
      const ocrWorkerFile = path.resolve('server/services/ocrWorker.ts');
      const ocrWorkerCode = fs.readFileSync(ocrWorkerFile, 'utf-8');

      // Check how settlement retry is triggered
      assert(
        ocrWorkerCode.includes("status: 'VALIDATING_RESULT'") &&
        ocrWorkerCode.includes("error_code: 'CREDIT_SETTLEMENT_RETRY_REQUIRED'"),
        'Worker must persist CREDIT_SETTLEMENT_RETRY_REQUIRED on settlement failure'
      );

      // Inspect if settlement retries increment attempt_count
      assert(
        ocrWorkerCode.includes('const settlementAttempt = (latestJobState.attempt_count || 1) + 1') ||
        ocrWorkerCode.includes('const settlementAttempt = (job.attempt_count || 1) + 1'),
        'Worker tracks settlementAttempt based on attempt_count'
      );

      // Verify that settlement failure NEVER sets status: 'QUEUED'
      // The settlement guard returns early without reaching the QUEUED retry branch
      const settlementGuardBlock = ocrWorkerCode.slice(
        ocrWorkerCode.indexOf('// B10: Settlement failure guard'),
        ocrWorkerCode.indexOf('const maxRetries = 3;')
      );
      assert(
        !settlementGuardBlock.includes("status: 'QUEUED'"),
        'Settlement failure guard MUST NOT update status to QUEUED'
      );

      // Behavioral execution of bounded retry limit:
      // When attempt_count reaches 5, next settlement failure sets SETTLEMENT_RETRY_EXHAUSTED and schedules NO timer
      const harness = new BehavioralTestHarness();
      harness.setupMocks();
      try {
        const { userId, docId, jobId } = seedStandardState(harness, {
          jobStatus: 'VALIDATING_RESULT',
          docStatus: 'READY',
          resStatus: 'RESERVED',
        });
        const job = harness.jobs.get(jobId)!;
        job.attempt_count = 5; // Reached limit

        harness.captureReservationImpl = async () => {
          throw new Error('Continuous RPC failure');
        };

        const result = await harness.worker.processJob(userId, jobId, docId);

        assert.strictEqual(result?.status, 'VALIDATING_RESULT', 'Stays in VALIDATING_RESULT');
        assert.strictEqual(result?.error_code, 'SETTLEMENT_RETRY_EXHAUSTED', 'Halts with SETTLEMENT_RETRY_EXHAUSTED');
        assert.strictEqual((harness.worker as any).activeRetryTimers.size, 0, 'No more retry timers scheduled');
      } finally {
        harness.teardown();
      }
    },
  },
];

// ==============================================================================
// TEST RUNNER
// ==============================================================================

async function runTestSuite() {
  console.log('================================================================');
  console.log('   PHASE 3C — BEHAVIORAL FINANCIAL SETTLEMENT TEST MATRIX');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  const failureDetails: { id: string; name: string; error: any }[] = [];

  for (const tc of testCases) {
    try {
      await tc.run();
      console.log(`  [PASS] ${tc.id}: ${tc.name}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${tc.id}: ${tc.name}`);
      console.error(`         -> ${err.message || err}`);
      failed++;
      failureDetails.push({ id: tc.id, name: tc.name, error: err });
    }
  }

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} / ${testCases.length} PASS, ${failed} FAIL`);
  console.log('================================================================\n');

  if (failureDetails.length > 0) {
    console.error('FAILURES SUMMARY:');
    for (const f of failureDetails) {
      console.error(`\n- ${f.id} (${f.name}):`);
      console.error(f.error?.stack || f.error?.message || f.error);
    }
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
