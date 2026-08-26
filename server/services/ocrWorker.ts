import { db, ProcessingJobRecord } from '../db/db.js';
import { storageService } from './storageService.js';
import { azureOcrProvider } from './ocr/AzureDocumentIntelligenceProvider.js';
import { DocumentAIProvider } from './ocr/types.js';

export class OcrBackgroundWorker {
  private provider: DocumentAIProvider;
  private isProcessingQueue = false;
  private queue: Array<{ userId: string; jobId: string; documentId: string }> = [];

  constructor(provider: DocumentAIProvider = azureOcrProvider) {
    this.provider = provider;
  }

  setProvider(provider: DocumentAIProvider) {
    this.provider = provider;
  }

  /**
   * Enqueue a job for non-blocking background processing.
   */
  enqueueJob(userId: string, jobId: string, documentId: string) {
    this.queue.push({ userId, jobId, documentId });
    this.processNextInQueue();
  }

  private async processNextInQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    const task = this.queue.shift();

    if (task) {
      try {
        await this.processJob(task.userId, task.jobId, task.documentId);
      } catch (err) {
        console.error(`[OcrWorker] Background task failed for job ${task.jobId}:`, err);
      }
    }

    this.isProcessingQueue = false;
    // Process next item if any
    if (this.queue.length > 0) {
      setTimeout(() => this.processNextInQueue(), 100);
    }
  }

  /**
   * Main Worker Execution with Strict User Isolation & Idempotency.
   */
  async processJob(userId: string, jobId: string, documentId: string): Promise<ProcessingJobRecord | null> {
    // 1. Verify Job existence & ownership
    const job = db.getProcessingJob(userId, jobId);
    if (!job) {
      console.error(`[OcrWorker] Job ${jobId} not found for user ${userId}`);
      return null;
    }

    // 2. Verify Document existence & ownership (Critical Isolation Check)
    const document = db.getUserDocumentById(userId, documentId);
    if (!document) {
      db.updateProcessingJob(userId, jobId, {
        status: 'FAILED',
        error_code: 'UNAUTHORIZED_OR_NOT_FOUND',
        error_message: 'Không tìm thấy tài liệu hoặc người dùng không có quyền truy cập.',
        completed_at: new Date().toISOString(),
      });
      return null;
    }

    // Verify job.user_id === document.user_id
    if (job.user_id !== document.user_id || job.user_id !== userId) {
      db.updateProcessingJob(userId, jobId, {
        status: 'FAILED',
        error_code: 'OWNERSHIP_MISMATCH',
        error_message: 'Vi phạm quyền sở hữu tài liệu và tác vụ.',
        completed_at: new Date().toISOString(),
      });
      return null;
    }

    // 3. Idempotency check: don't re-run if already in progress or completed
    if (job.status === 'PROCESSING') {
      return job;
    }

    // 4. Update status to PROCESSING
    db.updateProcessingJob(userId, jobId, {
      status: 'PROCESSING',
      current_step: 'Đang tải tệp tin từ bộ lưu trữ riêng tư...',
      progress: 20,
      started_at: job.started_at || new Date().toISOString(),
    });
    db.updateDocumentStatus(userId, documentId, 'PROCESSING');

    try {
      // 5. Download file from Private Supabase Storage (using worker server privileges)
      const fileData = await storageService.getFile(userId, documentId);
      if (!fileData || !fileData.buffer) {
        throw new Error('Không thể tải tệp tin từ bộ lưu trữ riêng tư.');
      }

      // 6. Update step: Sending to Azure Document Intelligence
      db.updateProcessingJob(userId, jobId, {
        current_step: 'Đang gửi tài liệu tới Azure AI Document Intelligence...',
        progress: 45,
      });

      // 7. Analyze Document with Azure / DocumentAIProvider
      const analysisResult = await this.provider.analyzeDocument(
        fileData.buffer,
        fileData.mimeType || document.mime_type || 'application/pdf',
        { modelId: 'prebuilt-layout' }
      );

      // 8. Update step: Parsing tables, columns, rows & confidence
      db.updateProcessingJob(userId, jobId, {
        current_step: 'Đang phân tích cấu trúc bảng, dòng, cột và điểm tin cậy...',
        progress: 80,
      });

      // 9. Save structured OCR results into Database with strict user isolation
      db.saveOcrAnalysis(userId, documentId, analysisResult);

      // 10. Check confidence metrics to determine if review is required
      const ocrData = db.getDocumentOcrResult(userId, documentId);
      const requiresReview = (ocrData?.stats?.lowConfidenceCount ?? 0) > 0 || (ocrData?.tables?.length ?? 0) > 0;
      const finalStatus = requiresReview ? 'REVIEW_REQUIRED' : 'READY';
      const stepDescription = requiresReview
        ? 'Trích xuất hoàn tất. Cần đối soát dữ liệu bảng và các ô nghi vấn.'
        : 'Trích xuất thành công. Độ tin cậy cao, sẵn sàng xuất dữ liệu.';

      // 11. Finalize Job & Document Status
      const updatedJob = db.updateProcessingJob(userId, jobId, {
        status: finalStatus,
        current_step: stepDescription,
        progress: 100,
        completed_at: new Date().toISOString(),
      });

      db.updateDocumentStatus(userId, documentId, finalStatus);

      return updatedJob;
    } catch (err: any) {
      console.error(`[OcrWorker] Error processing job ${jobId}:`, err.message || err);

      const maxRetries = 3;
      const currentAttempt = (job.attempt_count || 1) + 1;

      if (currentAttempt <= maxRetries) {
        // Can retry -> Set status to QUEUED for next worker cycle
        db.updateProcessingJob(userId, jobId, {
          status: 'QUEUED',
          attempt_count: currentAttempt,
          current_step: `Xảy ra lỗi tạm thời, đang thử lại lần ${currentAttempt}/${maxRetries}...`,
          progress: 10,
        });
      } else {
        // Max retries exceeded -> FAILED
        const safeErrorMessage = 'Không thể hoàn thành nhận dạng tài liệu. Vui lòng thử lại.';
        db.updateProcessingJob(userId, jobId, {
          status: 'FAILED',
          error_code: 'OCR_PROCESSING_FAILED',
          error_message: safeErrorMessage,
          completed_at: new Date().toISOString(),
        });
        db.updateDocumentStatus(userId, documentId, 'FAILED');
      }

      return db.getProcessingJob(userId, jobId);
    }
  }
}

export const ocrWorker = new OcrBackgroundWorker();
