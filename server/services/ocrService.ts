import { db, ProcessingJobRecord } from '../db/db.js';
import { ocrWorker } from './ocrWorker.js';

export interface IOCRService {
  queueDocumentForProcessing(userId: string, documentId: string): Promise<ProcessingJobRecord>;
  retryDocumentProcessing(userId: string, documentId: string): Promise<ProcessingJobRecord>;
  getJobStatus(userId: string, jobId: string): Promise<ProcessingJobRecord | null>;
}

export class AzureDocumentIntelligenceService implements IOCRService {
  /**
   * Queues a document for OCR and triggers the non-blocking background worker.
   */
  async queueDocumentForProcessing(userId: string, documentId: string): Promise<ProcessingJobRecord> {
    const existingJob = db.getJobByDocumentId(userId, documentId);
    if (existingJob) {
      // If it's already QUEUED or PROCESSING, return it
      if (existingJob.status === 'QUEUED' || existingJob.status === 'PROCESSING') {
        return existingJob;
      }
      // If already finished or failed, return existing
      if (existingJob.status === 'READY' || existingJob.status === 'REVIEW_REQUIRED') {
        return existingJob;
      }
    }

    const jobId = existingJob ? existingJob.id : crypto.randomUUID();
    const job = existingJob
      ? db.updateProcessingJob(userId, jobId, {
          status: 'QUEUED',
          current_step: 'Đang xếp hàng chờ xử lý Azure AI Document Intelligence',
          progress: 10,
          attempt_count: (existingJob.attempt_count || 0) + 1,
          error_code: null,
          error_message: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        })!
      : db.createProcessingJob({
          id: jobId,
          document_id: documentId,
          user_id: userId,
          status: 'QUEUED',
          current_step: 'Đang xếp hàng chờ xử lý Azure AI Document Intelligence',
          progress: 10,
          attempt_count: 1,
          started_at: new Date().toISOString(),
        });

    db.updateDocumentStatus(userId, documentId, 'QUEUED');

    // Trigger asynchronous background worker
    ocrWorker.enqueueJob(userId, job.id, documentId);

    return job;
  }

  async retryDocumentProcessing(userId: string, documentId: string): Promise<ProcessingJobRecord> {
    const doc = db.getUserDocumentById(userId, documentId);
    if (!doc) {
      throw new Error('Tài liệu không tồn tại hoặc không có quyền truy cập.');
    }

    let job = db.getJobByDocumentId(userId, documentId);
    const jobId = job ? job.id : crypto.randomUUID();

    job = job
      ? db.updateProcessingJob(userId, jobId, {
          status: 'QUEUED',
          current_step: 'Đang xếp hàng thử lại xử lý OCR...',
          progress: 10,
          attempt_count: (job.attempt_count || 1) + 1,
          error_code: null,
          error_message: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        })!
      : db.createProcessingJob({
          id: jobId,
          document_id: documentId,
          user_id: userId,
          status: 'QUEUED',
          current_step: 'Đang xếp hàng thử lại xử lý OCR...',
          progress: 10,
          attempt_count: 1,
          started_at: new Date().toISOString(),
        });

    db.updateDocumentStatus(userId, documentId, 'QUEUED');
    ocrWorker.enqueueJob(userId, jobId, documentId);

    return job;
  }

  async getJobStatus(userId: string, jobId: string): Promise<ProcessingJobRecord | null> {
    return db.getProcessingJob(userId, jobId);
  }
}

export const ocrService = new AzureDocumentIntelligenceService();
