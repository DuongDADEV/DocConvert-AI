import { db, ProcessingJobRecord } from '../db/db.js';
import { storageService } from './storageService.js';
import { azureOcrProvider } from './ocr/AzureDocumentIntelligenceProvider.js';
import { DocumentAIProvider, OCRAnalysisResult } from './ocr/types.js';
import { processingDecisionEngine, PDE_VERSION } from './pde/ProcessingDecisionEngine.js';
import { ProcessingExecutor } from './pde/ProcessingExecutor.js';
import type { DocumentProcessingPlan } from './pde/types.js';
import { ValidationEngine } from './validation/ValidationEngine.js';
import { SecondaryOcrCoordinator } from './secondaryOcr/SecondaryOcrCoordinator.js';
import { creditService } from './credit/creditService.js';

export class OcrBackgroundWorker {
  private provider: DocumentAIProvider;
  private isResumingQueue = false;
  private inFlightJobs = new Set<string>();
  private activeRetryTimers = new Map<string, NodeJS.Timeout>();

  constructor(provider?: DocumentAIProvider) {
    this.provider = provider || azureOcrProvider;
    // Startup recovery is NOT invoked in constructor to avoid duplicate triggers.
    // It is authoritatively invoked via await ocrWorker.resumeUnfinishedJobs() during server startup in server.ts.
  }

  /**
   * Authoritative Startup Recovery:
   * Resumes any unfinished active jobs (QUEUED, PROCESSING, VALIDATING, UPLOADING, PARSING, VALIDATING_RESULT)
   * from Supabase PostgreSQL upon server startup.
   * Concurrency safe: prevents concurrent duplicate scans via isResumingQueue and inFlightJobs guard.
   */
  async resumeUnfinishedJobs(): Promise<ProcessingJobRecord[]> {
    if (this.isResumingQueue) {
      console.log('[OcrWorker] Recovery is already in progress. Skipping duplicate concurrent recovery trigger.');
      return [];
    }
    this.isResumingQueue = true;
    const resumedJobs: ProcessingJobRecord[] = [];
    try {
      console.log('[PROCESS_JOB_RECOVERY_STARTED] Scanning PostgreSQL for active unfinished jobs...');
      const pendingJobs = await db.getQueuedJobs();
      if (pendingJobs.length > 0) {
        console.log(`[PROCESS_JOB_RECOVERY_STARTED] Found ${pendingJobs.length} active unfinished jobs to resume.`);
        for (const job of pendingJobs) {
          if (this.inFlightJobs.has(job.id)) {
            console.log(`[OcrWorker] Job ${job.id} already in-flight. Skipping duplicate.`);
            continue;
          }
          resumedJobs.push(job);
          this.processJob(job.user_id, job.id, job.document_id).catch((err) => {
            console.error(`[PROCESS_JOB_RECOVERY_FAILED] Error resuming job ${job.id}:`, err);
          });
        }
        console.log(`[PROCESS_JOB_RECOVERY_COMPLETED] Resumed ${resumedJobs.length} active jobs.`);
      } else {
        console.log('[PROCESS_JOB_RECOVERY_COMPLETED] No pending active jobs found in PostgreSQL.');
      }
    } catch (err) {
      console.error('[PROCESS_JOB_RECOVERY_FAILED] Could not resume pending jobs on startup:', err);
    } finally {
      this.isResumingQueue = false;
    }
    return resumedJobs;
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
        try {
          await db.rollbackDocumentQuota(userId, jobId);
        } catch (quotaErr) {
          console.error(`[OcrWorker] Error rolling back quota on missing document for job ${jobId}:`, quotaErr);
        }
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

      // 3b. Phase 3B / 3B.1 Worker Hard Gate: Processing job must have a valid ACTIVE reservation
      // Validates bidirectional consistency, user match, status ('RESERVED'/'PARTIALLY_CAPTURED'), amount, and remaining held units
      const reservationValidation = await db.getValidatedReservationForJob(job);
      const reservation = reservationValidation.reservation;

      // B3: VALIDATING_RESULT is a settlement-only recovery state
      if (job.status === 'VALIDATING_RESULT') {
        const latestDoc = await db.getUserDocumentById(userId, documentId);
        if (!latestDoc || (latestDoc.status !== 'READY' && latestDoc.status !== 'REVIEW_REQUIRED')) {
          console.warn(
            `[OcrWorker] Job ${jobId} is VALIDATING_RESULT but document status is ${latestDoc?.status}. Settlement recovery cannot finalize.`
          );
          await db.updateProcessingJob(userId, jobId, {
            status: 'VALIDATING_RESULT',
            error_code: 'SETTLEMENT_RECOVERY_DOCUMENT_STATE_INVALID',
            error_message: `Trạng thái tài liệu không hợp lệ để phục hồi quyết toán (${latestDoc?.status}). Yêu cầu kiểm tra thủ công.`,
            current_step: 'Đang chờ xác minh trạng thái tài liệu trước khi quyết toán...',
          });
          return await db.getProcessingJob(userId, jobId);
        }

        const recoveredFinalStatus: 'READY' | 'REVIEW_REQUIRED' = latestDoc.status as any;

        // B4: Recovery Case A — Active Reservation (valid hold awaiting capture)
        if (reservationValidation.valid && reservation) {
          const capturedUnits = Number(reservation.captured_units);
          const releasedUnits = Number(reservation.released_units);
          const expectedUnits = Number(job.estimated_billable_units || 0);
          const outstandingReservedUnits = Number(reservation.reserved_units) - capturedUnits - releasedUnits;

          const invariantOk =
            releasedUnits === 0 &&
            outstandingReservedUnits > 0 &&
            capturedUnits + outstandingReservedUnits === expectedUnits;

          if (!invariantOk) {
            console.error(
              `[OcrWorker] [SETTLEMENT_RECOVERY_INVARIANT_FAILED] Job ${jobId}: reserved=${reservation.reserved_units}, captured=${capturedUnits}, released=${releasedUnits}, expected=${expectedUnits}, outstanding=${outstandingReservedUnits}`
            );
            await db.updateProcessingJob(userId, jobId, {
              status: 'VALIDATING_RESULT',
              error_code: 'SETTLEMENT_RECOVERY_INVARIANT_FAILED',
              error_message: 'Khoản giữ credit không đáp ứng điều kiện quyết toán an toàn. Yêu cầu kiểm tra thủ công.',
              current_step: 'Đang chờ kiểm tra tính nhất quán của credit trước khi hoàn tất xử lý...',
            });
            return await db.getProcessingJob(userId, jobId);
          }

          try {
            await creditService.captureReservation({
              userId,
              reservationId: job.reservation_id as string,
              captureUnits: outstandingReservedUnits,
              idempotencyKey: `processing-capture:${jobId}`,
              metadata: {
                job_id: jobId,
                document_id: documentId,
                final_status: recoveredFinalStatus,
                pricing_version: job.pricing_version,
                settlement_source: 'OCR_WORKER_SETTLEMENT_RECOVERY',
              },
            });

            const updatedJob = await db.updateProcessingJob(userId, jobId, {
              status: recoveredFinalStatus,
              current_step: recoveredFinalStatus === 'REVIEW_REQUIRED'
                ? 'Trích xuất hoàn tất. Phát hiện các ô cần kiểm tra đối soát.'
                : 'Trích xuất và kiểm định thành công. Dữ liệu sẵn sàng xuất Excel.',
              progress: 100,
              error_code: null as any,
              error_message: null as any,
              completed_at: new Date().toISOString(),
            });

            await db.updateDocumentStatus(userId, documentId, recoveredFinalStatus);
            return updatedJob;
          } catch (captureErr: any) {
            console.error(`[OcrWorker] Settlement recovery capture failed for job ${jobId}:`, captureErr);
            const settlementAttempt = (job.attempt_count || 1) + 1;
            const maxSettlementRetries = 5;

            if (settlementAttempt > maxSettlementRetries) {
              console.error(
                `[OcrWorker] Settlement recovery capture retries exhausted (${settlementAttempt} > ${maxSettlementRetries}) for job ${jobId}. Halting automatic retry.`
              );
              await db.updateProcessingJob(userId, jobId, {
                status: 'VALIDATING_RESULT',
                attempt_count: settlementAttempt,
                error_code: 'SETTLEMENT_RETRY_EXHAUSTED',
                error_message: `Quyết toán tín dụng thất bại sau ${maxSettlementRetries} lần thử lại tự động. Yêu cầu kiểm tra thủ công.`,
                current_step: 'Đã dừng thử lại tự động. Đang chờ kiểm tra thủ công...',
              });
              return await db.getProcessingJob(userId, jobId);
            }

            const delayMs = Math.min(1000 * Math.pow(2, settlementAttempt - 1), 30000);
            const delaySec = Math.round(delayMs / 1000);

            await db.updateProcessingJob(userId, jobId, {
              status: 'VALIDATING_RESULT',
              attempt_count: settlementAttempt,
              error_code: 'CREDIT_SETTLEMENT_RETRY_REQUIRED',
              error_message: `Quyết toán tín dụng gặp lỗi tạm thời: ${captureErr.message || 'Lỗi không xác định'}. Đang thử lại sau ${delaySec}s...`,
              current_step: `Đang thử lại quyết toán tín dụng lần ${settlementAttempt} sau ${delaySec}s...`,
            });

            const retryTimer = setTimeout(() => {
              this.activeRetryTimers.delete(jobId);
              this.processJob(userId, jobId, documentId).catch((retryErr) => {
                console.error(`[OcrWorker] Error during scheduled settlement recovery retry for job ${jobId}:`, retryErr);
              });
            }, delayMs);
            retryTimer.unref();
            this.activeRetryTimers.set(jobId, retryTimer);
            return await db.getProcessingJob(userId, jobId);
          }
        }
        // B6: Recovery Case B — CAPTURE already committed before terminal job status
        else if (
          reservation &&
          reservationValidation.reason === `INVALID_RESERVATION_STATUS: ${reservation.status}` &&
          (reservation.status === 'CAPTURED' || reservation.status === 'SETTLED')
        ) {
          const capturedUnits = Number(reservation.captured_units);
          const releasedUnits = Number(reservation.released_units);
          const expectedUnits = Number(job.estimated_billable_units || 0);
          const outstandingUnits = Number(reservation.reserved_units) - capturedUnits - releasedUnits;

          if (releasedUnits === 0 && capturedUnits === expectedUnits && outstandingUnits === 0) {
            console.log(
              `[OcrWorker] Job ${jobId} settlement already committed (${reservation.status}). Finalizing job to ${recoveredFinalStatus}.`
            );
            const updatedJob = await db.updateProcessingJob(userId, jobId, {
              status: recoveredFinalStatus,
              current_step: recoveredFinalStatus === 'REVIEW_REQUIRED'
                ? 'Trích xuất hoàn tất. Phát hiện các ô cần kiểm tra đối soát.'
                : 'Trích xuất và kiểm định thành công. Dữ liệu sẵn sàng xuất Excel.',
              progress: 100,
              error_code: null as any,
              error_message: null as any,
              completed_at: new Date().toISOString(),
            });
            await db.updateDocumentStatus(userId, documentId, recoveredFinalStatus);
            return updatedJob;
          } else {
            console.error(
              `[OcrWorker] Job ${jobId} reservation already terminal but amounts mismatch: captured=${capturedUnits}, expected=${expectedUnits}, outstanding=${outstandingUnits}`
            );
            await db.updateProcessingJob(userId, jobId, {
              status: 'VALIDATING_RESULT',
              error_code: 'SETTLEMENT_RECOVERY_INVARIANT_FAILED',
              error_message: 'Khoản giữ tín dụng đã kết thúc nhưng số lượng không khớp với tác vụ. Yêu cầu kiểm tra thủ công.',
              current_step: 'Đang chờ kiểm tra tính nhất quán của credit trước khi hoàn tất xử lý...',
            });
            return await db.getProcessingJob(userId, jobId);
          }
        } else {
          // Untrusted reservation condition in VALIDATING_RESULT
          console.error(
            `[OcrWorker] Job ${jobId} in VALIDATING_RESULT failed reservation validation: ${reservationValidation.reason}. Halting.`
          );
          await db.updateProcessingJob(userId, jobId, {
            status: 'VALIDATING_RESULT',
            error_code: 'CREDIT_SETTLEMENT_RECOVERY_INVALID',
            error_message: `Trạng thái khoản giữ credit không hợp lệ để recovery (${reservationValidation.reason}). Yêu cầu kiểm tra thủ công.`,
            current_step: 'Đang chờ kiểm tra thủ công khoản giữ credit...',
          });
          return await db.getProcessingJob(userId, jobId);
        }
      }

      // 3c. Phase 3B / 3B.1 Worker Hard Gate: Normal OCR execution requires valid ACTIVE reservation
      if (!reservationValidation.valid) {
        console.error(
          `[OcrWorker] [DEFENSIVE_FINANCIAL_GATE_FAIL] Job ${jobId} failed reservation validation: ${reservationValidation.reason}. Worker failing closed.`
        );

        // Window D Recovery Check: If reservation was already RELEASED, finalize job without rerunning OCR or double-release
        if (
          reservation &&
          reservationValidation.reason === 'INVALID_RESERVATION_STATUS: RELEASED' &&
          Number(reservation.released_units) > 0 &&
          Number(reservation.captured_units) === 0
        ) {
          console.log(
            `[OcrWorker] Job ${jobId} reservation already RELEASED (${reservation.status}). Finalizing job and document to FAILED.`
          );
          await db.updateProcessingJob(userId, jobId, {
            status: 'FAILED',
            error_code: 'OCR_PROCESSING_FAILED',
            error_message: 'Không thể hoàn thành nhận dạng tài liệu sau 3 lần thử. Khoản giữ credit đã được hoàn trả.',
            completed_at: new Date().toISOString(),
          });
          await db.updateDocumentStatus(userId, documentId, 'FAILED');
          return await db.getProcessingJob(userId, jobId);
        }

        await db.updateProcessingJob(userId, jobId, {
          status: 'FAILED',
          error_code: 'MISSING_CREDIT_RESERVATION',
          error_message: `Không tìm thấy hoặc không hợp lệ khoản giữ trước tín dụng cho tác vụ này (${reservationValidation.reason}).`,
          completed_at: new Date().toISOString(),
        });
        await db.updateDocumentStatus(userId, documentId, 'FAILED');
        return await db.getProcessingJob(userId, jobId);
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

        const mimeType = fileData.mimeType || document.mime_type || 'application/pdf';
        const pdeEnabled = process.env.PROCESSING_DECISION_ENGINE_ENABLED !== 'false';
        let analysisResult: OCRAnalysisResult;

        if (pdeEnabled) {
          // PHASE 5: Processing Decision Engine & Page-Level Routing
          const dbPages = await db.getDocumentPages(userId, documentId);

          if (dbPages && dbPages.length > 0) {
            let plan: DocumentProcessingPlan;

            // Idempotency / Restart Check: check if all pages already have valid stored PDE decisions
            const hasExistingDecisions = dbPages.every(
              (p) => Boolean(p.processing_strategy) && p.decision_version === PDE_VERSION
            );

            if (hasExistingDecisions) {
              console.log(`[OcrWorker] Reusing existing persisted ${PDE_VERSION} decisions for doc ${documentId}`);
              plan = {
                documentId,
                totalPages: dbPages.length,
                localPages: dbPages.filter((p) => p.processing_strategy === 'LOCAL_NATIVE').length,
                azurePages: dbPages.filter((p) => p.processing_strategy === 'AZURE_FULL_PAGE' || p.processing_strategy === 'AZURE_FALLBACK').length,
                hybridPages: dbPages.filter((p) => p.processing_strategy === 'HYBRID').length,
                recheckPages: dbPages.filter((p) => p.processing_strategy === 'LOCAL_RECHECK').length,
                estimatedAzurePages: dbPages.filter((p) => p.requires_azure).length,
                decisionVersion: PDE_VERSION,
                decisions: dbPages.map((p) => ({
                  pageNumber: p.page_number,
                  classification: p.classification,
                  preferredStrategy: p.processing_strategy!,
                  fallbackStrategy: p.fallback_strategy || undefined,
                  requiresAzure: Boolean(p.requires_azure),
                  requiresLocalExtraction: Boolean(p.processing_strategy === 'LOCAL_NATIVE' || p.processing_strategy === 'HYBRID' || p.processing_strategy === 'LOCAL_RECHECK'),
                  requiresRegionAnalysis: Boolean(p.requires_region_analysis),
                  requiresSecondPass: false,
                  decisionReason: p.decision_reason || 'Tái sử dụng quyết định đã lưu từ trước.',
                  decisionVersion: p.decision_version || PDE_VERSION,
                })),
              };
            } else {
              await db.updateProcessingJob(userId, jobId, {
                current_step: 'Đang thiết lập kế hoạch định tuyến xử lý từng trang (Decision Engine)...',
                progress: 30,
              });

              plan = processingDecisionEngine.buildProcessingPlan(documentId, dbPages);

              // Persist decisions to document_pages
              await db.updateDocumentPageDecisions(
                documentId,
                plan.decisions.map((d) => ({
                  page_number: d.pageNumber,
                  processing_strategy: d.preferredStrategy,
                  fallback_strategy: d.fallbackStrategy,
                  requires_azure: d.requiresAzure,
                  requires_region_analysis: d.requiresRegionAnalysis,
                  decision_reason: d.decisionReason,
                  decision_version: d.decisionVersion,
                }))
              );
            }

            await db.updateProcessingJob(userId, jobId, {
              current_step: `Đang thực thi kế hoạch: ${plan.localPages} trang cục bộ, ${plan.azurePages + plan.hybridPages} trang Azure...`,
              progress: 45,
            });

            try {
              const executor = new ProcessingExecutor(this.provider);
              analysisResult = await executor.executePlan(
                documentId,
                userId,
                fileData.buffer,
                mimeType,
                plan,
                { outputType: document.output_type || 'EXCEL' }
              );
            } catch (pdeExecErr: any) {
              const azureSucceeded = pdeExecErr?.azurePagesSucceeded ?? 0;
              if (azureSucceeded > 0) {
                console.warn(
                  `[PDE_FALLBACK_SUPPRESSED_AFTER_PARTIAL_EXTERNAL_SUCCESS] doc: ${documentId}, azureSucceeded: ${azureSucceeded}. Suppressing whole-document fallback to prevent duplicate Azure calls.`
                );
                // Suppress whole-document fallback: throw error so retry mechanism resumes the SAME plan cleanly without duplicate billing
                throw new Error(
                  `Lỗi xử lý từng trang sau khi đã hoàn tất ${azureSucceeded} trang Azure: ${pdeExecErr.message || 'Lỗi không xác định'}`
                );
              }

              console.warn(
                `[PDE_FALLBACK_BEFORE_EXTERNAL_CALL] doc: ${documentId}, error: ${pdeExecErr.message}. Triggering safe legacy whole-document Azure fallback.`
              );
              analysisResult = await this.provider.analyzeDocument(fileData.buffer, mimeType, {
                modelId: 'prebuilt-layout',
              });
            }
          } else {
            // Document has no preflight pages (e.g. historical legacy document)
            console.log(`[OcrWorker] Document ${documentId} has no document_pages records. Processing via legacy whole-document path.`);
            await db.updateProcessingJob(userId, jobId, {
              current_step: 'Đang gửi tài liệu tới Azure AI Document Intelligence...',
              progress: 45,
            });
            analysisResult = await this.provider.analyzeDocument(fileData.buffer, mimeType, {
              modelId: 'prebuilt-layout',
            });
          }
        } else {
          // Feature flag disabled -> legacy path
          await db.updateProcessingJob(userId, jobId, {
            current_step: 'Đang gửi tài liệu tới Azure AI Document Intelligence...',
            progress: 45,
          });
          analysisResult = await this.provider.analyzeDocument(fileData.buffer, mimeType, {
            modelId: 'prebuilt-layout',
          });
        }

        // 8. Update step: Deterministic Validation Engine (Phase 6)
        await db.updateProcessingJob(userId, jobId, {
          current_step: 'Đang thực hiện kiểm định cấu trúc dữ liệu và chất lượng trích xuất...',
          progress: 85,
        });

        // Run deterministic Validation Engine
        const validationReport = ValidationEngine.validate(documentId, analysisResult);

        // 9. Save structured OCR results and validation atomically into PostgreSQL
        await db.saveOcrAnalysis(userId, documentId, analysisResult, validationReport);

        // 10. Phase 7: Targeted Secondary OCR & Conflict Resolution (if review required)
        if (validationReport.status === 'REVIEW_REQUIRED' && validationReport.reviewRequiredCount > 0) {
          try {
            await db.updateProcessingJob(userId, jobId, {
              current_step: 'Đang thực hiện nhận diện bổ sung vùng dữ liệu và giải quyết xung đột...',
              progress: 92,
            });

            const secondaryCoordinator = new SecondaryOcrCoordinator();
            const resolutionSummary = await secondaryCoordinator.processDocumentCells(
              userId,
              documentId,
              fileData.buffer,
              mimeType
            );

            console.log(
              `[OcrWorker] Phase 7 Targeted Secondary OCR completed for doc ${documentId}: ` +
              `processed ${resolutionSummary.processedCount}, attempts ${resolutionSummary.secondaryOcrAttemptCount}, resolved ${resolutionSummary.resolvedCount}, remaining unresolved ${resolutionSummary.unresolvedCount}, providerUsage: ${JSON.stringify(resolutionSummary.providerSummary)}`
            );

            // Phase 3A.3.1: Persist Secondary OCR technical telemetry back to ocr_results.metadata
            await db.updateSecondaryOcrTelemetry(documentId, resolutionSummary);

            if (analysisResult?.metadata?.technicalUsage) {
              analysisResult.metadata.technicalUsage.secondaryOcrExecuted = resolutionSummary.secondaryOcrExecuted;
              analysisResult.metadata.technicalUsage.secondaryOcrCellCount = resolutionSummary.secondaryOcrCellCount;
              analysisResult.metadata.technicalUsage.secondaryOcrAttemptCount = resolutionSummary.secondaryOcrAttemptCount;
              analysisResult.metadata.technicalUsage.secondaryOcrProviderSummary = resolutionSummary.providerSummary;
              analysisResult.metadata.technicalUsage.successfulResolutionCount = resolutionSummary.resolvedCount;
              analysisResult.metadata.technicalUsage.failedResolutionCount = resolutionSummary.unresolvedCount;
            }
          } catch (secOcrErr: any) {
            console.warn(`[OcrWorker] Phase 7 Secondary OCR encountered an error for doc ${documentId}, continuing to review workspace:`, secOcrErr.message || secOcrErr);
          }
        }

        // 11. Finalize Job & Document Status based on authoritative DB status
        const updatedDoc = await db.getDocument(userId, documentId);
        const finalStatus: 'READY' | 'REVIEW_REQUIRED' = updatedDoc?.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'READY';
        const stepDescription = finalStatus === 'REVIEW_REQUIRED'
          ? `Trích xuất hoàn tất. Phát hiện các ô cần kiểm tra đối soát.`
          : 'Trích xuất và kiểm định thành công. Dữ liệu sẵn sàng xuất Excel.';

        // B8: Persist VALIDATING_RESULT as restart-recoverable financial checkpoint before CAPTURE
        await db.updateProcessingJob(userId, jobId, {
          status: 'VALIDATING_RESULT',
          current_step: 'Đang hoàn tất quyết toán tín dụng và trạng thái xử lý...',
          progress: 98,
        });

        // B8: Reload latest processing job and reservation
        const settlementJob = await db.getProcessingJob(userId, jobId);
        if (!settlementJob) {
          console.error(`[OcrWorker] [SETTLEMENT_FAIL] Job ${jobId} not found when reloading for settlement.`);
          return null;
        }

        const settlementReservationValidation = await db.getValidatedReservationForJob(settlementJob);
        if (!settlementReservationValidation.valid || !settlementReservationValidation.reservation) {
          console.error(
            `[OcrWorker] [SETTLEMENT_FAIL] Job ${jobId} reservation invalid for settlement: ${settlementReservationValidation.reason}`
          );
          await db.updateProcessingJob(userId, jobId, {
            status: 'VALIDATING_RESULT',
            error_code: 'CREDIT_SETTLEMENT_VALIDATION_FAILED',
            error_message: `OCR đã hoàn tất nhưng khoản giữ credit không hợp lệ để quyết toán (${settlementReservationValidation.reason}). Yêu cầu kiểm tra thủ công.`,
          });
          return await db.getProcessingJob(userId, jobId);
        }

        // B9: Settlement Invariant Validation
        const settlementRes = settlementReservationValidation.reservation;
        const reservedUnits = Number(settlementRes.reserved_units);
        const capturedUnits = Number(settlementRes.captured_units);
        const releasedUnits = Number(settlementRes.released_units);
        const expectedUnits = Number(settlementJob.estimated_billable_units || 0);
        const outstandingReservedUnits = reservedUnits - capturedUnits - releasedUnits;

        if (
          releasedUnits !== 0 ||
          outstandingReservedUnits <= 0 ||
          capturedUnits + outstandingReservedUnits !== expectedUnits
        ) {
          console.error(
            `[OcrWorker] [SETTLEMENT_INVARIANT_FAIL] Job ${jobId}: reserved=${reservedUnits}, captured=${capturedUnits}, released=${releasedUnits}, expected=${expectedUnits}, outstanding=${outstandingReservedUnits}`
          );
          await db.updateProcessingJob(userId, jobId, {
            status: 'VALIDATING_RESULT',
            error_code: 'CREDIT_SETTLEMENT_INVARIANT_FAILED',
            error_message: 'Khoản giữ credit không đáp ứng điều kiện quyết toán an toàn sau OCR. Yêu cầu kiểm tra thủ công.',
          });
          return await db.getProcessingJob(userId, jobId);
        }

        // B9: Execute CAPTURE
        await creditService.captureReservation({
          userId,
          reservationId: job.reservation_id as string,
          captureUnits: outstandingReservedUnits,
          idempotencyKey: `processing-capture:${jobId}`,
          metadata: {
            job_id: jobId,
            document_id: documentId,
            final_status: finalStatus,
            pricing_version: settlementJob.pricing_version,
            settlement_source: 'OCR_WORKER_SUCCESS',
          },
        });

        // 11b. Finalize Job & Document Status ONLY after successful CAPTURE
        const updatedJob = await db.updateProcessingJob(userId, jobId, {
          status: finalStatus,
          current_step: stepDescription,
          progress: 100,
          error_code: null as any,
          error_message: null as any,
          completed_at: new Date().toISOString(),
        });

        await db.updateDocumentStatus(userId, documentId, finalStatus);

        return updatedJob;
      } catch (err: any) {
        console.error(`[OcrWorker] Error processing job ${jobId}:`, err.message || err);

        // B10: Settlement failure guard — if job reached VALIDATING_RESULT, do NOT rerun OCR
        const latestJobState = await db.getProcessingJob(userId, jobId);
        if (latestJobState?.status === 'VALIDATING_RESULT') {
          const settlementAttempt = (latestJobState.attempt_count || 1) + 1;
          const maxSettlementRetries = 5;

          if (settlementAttempt > maxSettlementRetries) {
            console.error(
              `[OcrWorker] Settlement capture retries exhausted (${settlementAttempt} > ${maxSettlementRetries}) for job ${jobId}. Halting automatic retry.`
            );
            await db.updateProcessingJob(userId, jobId, {
              status: 'VALIDATING_RESULT',
              attempt_count: settlementAttempt,
              error_code: 'SETTLEMENT_RETRY_EXHAUSTED',
              error_message: `Quyết toán tín dụng thất bại sau ${maxSettlementRetries} lần thử lại tự động. Yêu cầu kiểm tra thủ công.`,
              current_step: 'Đã dừng thử lại tự động. Đang chờ kiểm tra thủ công...',
            });
            return await db.getProcessingJob(userId, jobId);
          }

          const delayMs = Math.min(1000 * Math.pow(2, settlementAttempt - 1), 30000);
          const delaySec = Math.round(delayMs / 1000);

          console.warn(
            `[OcrWorker] [SETTLEMENT_ONLY_RETRY] Job ${jobId} remains VALIDATING_RESULT. Retrying settlement only in ${delaySec}s.`
          );

          await db.updateProcessingJob(userId, jobId, {
            status: 'VALIDATING_RESULT',
            attempt_count: settlementAttempt,
            error_code: 'CREDIT_SETTLEMENT_RETRY_REQUIRED',
            error_message: `Quyết toán tín dụng gặp lỗi: ${err.message || 'Lỗi không xác định'}. Đang thử lại sau ${delaySec}s...`,
            current_step: `Đang thử lại quyết toán tín dụng lần ${settlementAttempt} sau ${delaySec}s...`,
          });

          const retryTimer = setTimeout(() => {
            this.activeRetryTimers.delete(jobId);
            this.processJob(userId, jobId, documentId).catch((retryErr) => {
              console.error(`[OcrWorker] Error during scheduled settlement retry for job ${jobId}:`, retryErr);
            });
          }, delayMs);

          retryTimer.unref();
          this.activeRetryTimers.set(jobId, retryTimer);

          return await db.getProcessingJob(userId, jobId);
        }

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
          // B11: Terminal OCR failure — validate and RELEASE reservation before terminal FAILED
          const safeErrorMessage = 'Không thể hoàn thành nhận dạng tài liệu sau 3 lần thử. Vui lòng thử lại.';

          let releaseFailed = false;
          let releaseErrorMessage = '';
          const latestJobBeforeRelease = await db.getProcessingJob(userId, jobId);
          if (latestJobBeforeRelease?.reservation_id) {
            try {
              const latestReservationValidation = await db.getValidatedReservationForJob(latestJobBeforeRelease);
              if (latestReservationValidation.valid && latestReservationValidation.reservation) {
                const heldRes = latestReservationValidation.reservation;
                const outstandingReservedUnits =
                  Number(heldRes.reserved_units) - Number(heldRes.captured_units) - Number(heldRes.released_units);

                if (outstandingReservedUnits > 0) {
                  console.log(
                    `[OcrWorker] Terminal OCR failure: releasing ${outstandingReservedUnits} units for job ${jobId}, reservation ${job.reservation_id}`
                  );
                  await creditService.releaseReservation({
                    userId,
                    reservationId: job.reservation_id as string,
                    releaseUnits: outstandingReservedUnits,
                    idempotencyKey: `processing-release:${jobId}`,
                    metadata: {
                      job_id: jobId,
                      document_id: documentId,
                      failure_code: 'OCR_PROCESSING_FAILED',
                      settlement_source: 'OCR_WORKER_FAILURE',
                    },
                  });
                }
              } else {
                console.warn(
                  `[OcrWorker] Cannot release reservation for job ${jobId}: validation reason ${latestReservationValidation.reason}`
                );
              }
            } catch (releaseErr: any) {
              releaseFailed = true;
              releaseErrorMessage = releaseErr.message || 'Lỗi không xác định';
              console.error(`[OcrWorker] Error releasing reservation on terminal failure for job ${jobId}:`, releaseErr);
            }
          }

          // Phase 7.7 (P0-B): Safe Idempotent Quota Rollback for Terminal Job Failure
          try {
            const quotaRollbackResult = await db.rollbackDocumentQuota(userId, jobId);
            console.log(`[OcrWorker] Quota rollback for job ${jobId}:`, quotaRollbackResult);
          } catch (quotaErr: any) {
            console.error(`[OcrWorker] Error rolling back quota for job ${jobId}:`, quotaErr?.message || quotaErr);
          }

          if (releaseFailed) {
            await db.updateProcessingJob(userId, jobId, {
              status: 'FAILED',
              error_code: 'CREDIT_RELEASE_FAILED',
              error_message: `Không thể hoàn thành nhận dạng tài liệu và xảy ra lỗi khi giải phóng khoản giữ credit (${releaseErrorMessage}). Yêu cầu kiểm tra tài chính thủ công.`,
              completed_at: new Date().toISOString(),
            });
            await db.updateDocumentStatus(userId, documentId, 'FAILED');
          } else {
            await db.updateProcessingJob(userId, jobId, {
              status: 'FAILED',
              error_code: 'OCR_PROCESSING_FAILED',
              error_message: safeErrorMessage,
              completed_at: new Date().toISOString(),
            });
            await db.updateDocumentStatus(userId, documentId, 'FAILED');
          }
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
