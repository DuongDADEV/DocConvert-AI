import { db, ProcessingJobRecord } from '../db/db.js';
import { storageService } from './storageService.js';
import { azureOcrProvider } from './ocr/AzureDocumentIntelligenceProvider.js';
import { DocumentAIProvider } from './ocr/types.js';

export class OcrBackgroundWorker {
  private provider: DocumentAIProvider;
  private isResumingQueue = false;
  private inFlightJobs = new Set<string>();
  private activeRetryTimers = new Map<string, NodeJS.Timeout>();

  constructor(provider?: DocumentAIProvider) {
    this.provider = provider || azureOcrProvider;
    this.resumeUnfinishedJobs();
  }

  /**
   * Resume QUEUED and PROCESSING jobs from Supabase PostgreSQL on startup
   */
  async resumeUnfinishedJobs(): Promise<void> {
    if (this.isResumingQueue) return;
    this.isResumingQueue = true;
    try {
      const pendingJobs = await db.getQueuedJobs();
      if (pendingJobs.length > 0) {
        console.log(`[OcrWorker] Found ${pendingJobs.length} unfinished jobs in PostgreSQL. Resuming...`);
        for (const job of pendingJobs) {
          if (this.inFlightJobs.has(job.id)) {
            continue;
          }
          this.processJob(job.user_id, job.id, job.document_id).catch((err) => {
            console.error(`[OcrWorker] Error resuming job ${job.id}:`, err);
          });
        }
      }
    } catch (err) {
      console.warn('[OcrWorker] Could not resume pending jobs on startup:', err);
    } finally {
      this.isResumingQueue = false;
    }
  }

  /**
   * Main Worker Execution with Strict User Isolation, Concurrency Guard & Exponential Retry.
   */
  async processJob(userId: string, jobId: string, documentId: string): Promise<ProcessingJobRecord | null> {
    // 1. In-Memory Execution Guard: Prevent duplicate concurrent processing
    if (this.inFlightJobs.has(jobId)) {
      console.warn(`[OcrWorker] Job ${jobId} is already in-flight. Skipping duplicate execution.`);
      return null;
    }

    // Clear active retry timer if triggered
    if (this.activeRetryTimers.has(jobId)) {
      clearTimeout(this.activeRetryTimers.get(jobId)!);
      this.activeRetryTimers.delete(jobId);
    }

    this.inFlightJobs.add(jobId);

    try {
      // 2. Verify Job existence & ownership
      const job = await db.getProcessingJob(userId, jobId);
      if (!job) {
        console.error(`[OcrWorker] Job ${jobId} not found for user ${userId}`);
        return null;
      }

      // 3. Verify Document existence & ownership (Critical Isolation Check)
      const document = await db.getUserDocumentById(userId, documentId);
      if (!document) {
        await db.updateProcessingJob(userId, jobId, {
          status: 'FAILED',
          error_code: 'UNAUTHORIZED_OR_NOT_FOUND',
          error_message: 'Không tìm thấy tài liệu hoặc người dùng không có quyền truy cập.',
          completed_at: new Date().toISOString(),
        });
        return null;
      }

      // Verify job.user_id === document.user_id
      if (job.user_id !== document.user_id || job.user_id !== userId) {
        await db.updateProcessingJob(userId, jobId, {
          status: 'FAILED',
          error_code: 'OWNERSHIP_MISMATCH',
          error_message: 'Vi phạm quyền sở hữu tài liệu và tác vụ.',
          completed_at: new Date().toISOString(),
        });
        return null;
      }

      // 4. Update status to PROCESSING
      await db.updateProcessingJob(userId, jobId, {
        status: 'PROCESSING',
        current_step: 'Đang tải tệp tin từ bộ lưu trữ riêng tư...',
        progress: 20,
        started_at: job.started_at || new Date().toISOString(),
      });
      await db.updateDocumentStatus(userId, documentId, 'PROCESSING');

      try {
        // 5. Download file from Private Supabase Storage (using worker server privileges)
        const fileData = await storageService.getFile(userId, documentId);
        if (!fileData || !fileData.buffer) {
          throw new Error('Không thể tải tệp tin từ bộ lưu trữ riêng tư.');
        }

        // 6. Update step: Sending to Azure Document Intelligence
        await db.updateProcessingJob(userId, jobId, {
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
        await db.updateProcessingJob(userId, jobId, {
          current_step: 'Đang phân tích cấu trúc bảng, dòng, cột và điểm tin cậy...',
          progress: 80,
        });

        // 9. Save structured OCR results into Database with strict user isolation and compensating rollback
        await db.saveOcrAnalysis(userId, documentId, analysisResult);

        // 10. Check confidence metrics to determine if review is required
        const ocrData = await db.getDocumentOcrResult(userId, documentId);
        const requiresReview = (ocrData?.stats?.lowConfidenceCount ?? 0) > 0 || (ocrData?.tables?.length ?? 0) > 0;
        const finalStatus = requiresReview ? 'REVIEW_REQUIRED' : 'READY';
        const stepDescription = requiresReview
          ? 'Trích xuất hoàn tất. Cần đối soát dữ liệu bảng và các ô nghi vấn.'
          : 'Trích xuất thành công. Độ tin cậy cao, sẵn sàng xuất dữ liệu.';

        // 11. Finalize Job & Document Status
        const updatedJob = await db.updateProcessingJob(userId, jobId, {
          status: finalStatus,
          current_step: stepDescription,
          progress: 100,
          completed_at: new Date().toISOString(),
        });

        await db.updateDocumentStatus(userId, documentId, finalStatus);

        return updatedJob;
      } catch (err: any) {
        console.error(`[OcrWorker] Error processing job ${jobId}:`, err.message || err);

        const maxRetries = 3;
        const currentAttempt = (job.attempt_count || 1) + 1;

        if (currentAttempt <= maxRetries) {
          // Calculate exponential backoff delay: attempt 2 -> 2s, attempt 3 -> 4s
          const delayMs = Math.min(1000 * Math.pow(2, currentAttempt - 1), 30000);
          const delaySec = Math.round(delayMs / 1000);

          await db.updateProcessingJob(userId, jobId, {
            status: 'QUEUED',
            attempt_count: currentAttempt,
            current_step: `Xảy ra lỗi tạm thời, đang tự động thử lại lần ${currentAttempt}/${maxRetries} sau ${delaySec}s...`,
            progress: 10,
          });
          await db.updateDocumentStatus(userId, documentId, 'QUEUED');

          // Schedule automatic retry timer with .unref() so process can exit cleanly
          const retryTimer = setTimeout(() => {
            this.activeRetryTimers.delete(jobId);
            this.processJob(userId, jobId, documentId).catch((retryErr) => {
              console.error(`[OcrWorker] Error during scheduled retry for job ${jobId}:`, retryErr);
            });
          }, delayMs);

          retryTimer.unref();
          this.activeRetryTimers.set(jobId, retryTimer);
        } else {
          // Max retries exceeded -> FAILED
          const safeErrorMessage = 'Không thể hoàn thành nhận dạng tài liệu sau 3 lần thử. Vui lòng thử lại.';
          await db.updateProcessingJob(userId, jobId, {
            status: 'FAILED',
            error_code: 'OCR_PROCESSING_FAILED',
            error_message: safeErrorMessage,
            completed_at: new Date().toISOString(),
          });
          await db.updateDocumentStatus(userId, documentId, 'FAILED');
        }

        return await db.getProcessingJob(userId, jobId);
      }
    } finally {
      // Always release in-flight execution guard
      this.inFlightJobs.delete(jobId);
    }
  }
}

export const ocrWorker = new OcrBackgroundWorker();
