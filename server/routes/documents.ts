import express, { Response } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { db } from '../db/db.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { storageService } from '../services/storageService.js';
import { ocrService } from '../services/ocrService.js';
import { quotaService } from '../services/quotaService.js';
import { auditService } from '../services/auditService.js';
import { excelExportEngine, ExportMode } from '../services/excelExportEngine.js';
import { ocrRateLimiter, exportRateLimiter } from '../middleware/rateLimiter.js';
import { DataNormalizer } from '../services/ocr/normalizer.js';
import { createSupabaseUserClient, getSupabaseAdminClient } from '../services/supabaseClient.js';

const router = express.Router();

// Multer in-memory storage configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/pjpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];

    if (allowedTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận tệp định dạng PDF, JPG, JPEG hoặc PNG.'));
    }
  },
});

// All document routes require Supabase Bearer Authentication
router.use(authMiddleware);

// 1. GET ALL USER DOCUMENTS (RLS: User can only see their own documents)
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const documents = await db.getUserDocuments(userId, req.userToken);
    res.json({
      success: true,
      documents,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Không thể tải danh sách tài liệu' });
  }
});

// 2. GET SINGLE DOCUMENT
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;

    const document = await db.getUserDocumentById(userId, docId, req.userToken);
    if (!document) {
      res.status(404).json({
        success: false,
        error: 'Không tìm thấy tài liệu hoặc bạn không có quyền truy cập.',
      });
      return;
    }

    const job = await db.getJobByDocumentId(userId, docId);

    res.json({
      success: true,
      document,
      job,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Lỗi khi tải thông tin tài liệu' });
  }
});

// 3. GET FILE CONTENT / STREAM FROM PRIVATE SUPABASE STORAGE (Requires Bearer Header)
router.get('/:id/file', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;

    // Strict ownership verification (RLS)
    const document = await db.getUserDocumentById(userId, docId, req.userToken);
    if (!document) {
      res.status(403).json({
        success: false,
        error: 'Truy cập bị từ chối. Bạn không sở hữu tài liệu này.',
      });
      return;
    }

    const fileData = await storageService.getFile(userId, docId, req.userToken);
    if (!fileData) {
      res.status(404).json({ success: false, error: 'Tệp tin không tồn tại trong bộ lưu trữ an toàn.' });
      return;
    }

    res.setHeader('Content-Type', fileData.mimeType || document.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.original_filename)}"`);
    res.send(fileData.buffer);
  } catch (err) {
    console.error('File stream error:', err);
    res.status(500).json({ success: false, error: 'Có lỗi khi đọc tệp từ lưu trữ riêng tư.' });
  }
});

// 4. CREATE SHORT-LIVED SIGNED URL (For single document only, valid for 60 seconds)
router.post('/:id/signed-url', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;

    const document = await db.getUserDocumentById(userId, docId, req.userToken);
    if (!document) {
      res.status(403).json({
        success: false,
        error: 'Truy cập bị từ chối.',
      });
      return;
    }

    const signedUrlData = await storageService.createSignedUrl(
      userId,
      docId,
      document.file_name,
      60,
      req.userToken
    );

    if (!signedUrlData) {
      res.status(500).json({ success: false, error: 'Không thể tạo liên kết truy cập an toàn.' });
      return;
    }

    res.json({
      success: true,
      signedUrl: signedUrlData.signedUrl,
      expiresAt: signedUrlData.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Lỗi khi tạo liên kết an toàn.' });
  }
});

// 5. UPLOAD DOCUMENT TO SUPABASE STORAGE
router.post('/upload', ocrRateLimiter, upload.single('file'), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const file = req.file;

    if (!file) {
      res.status(400).json({
        success: false,
        error: 'Vui lòng chọn một tệp PDF hoặc ảnh hợp lệ để tải lên.',
      });
      return;
    }

    // Step 1: Server-Side Quota Enforcement
    const quota = await quotaService.checkUserQuota(userId);
    if (!quota.allowed) {
      res.status(403).json({
        success: false,
        error: quota.message || 'Bạn đã sử dụng hết số tài liệu của gói hiện tại. Vui lòng nâng cấp gói.',
      });
      return;
    }

    const documentId = crypto.randomUUID();
    const ext = path.extname(file.originalname).toLowerCase();
    const fileType = ext === '.pdf' ? 'PDF' : ext === '.png' ? 'PNG' : 'JPG';

    let isFileSaved = false;
    let isDocumentCreated = false;
    let isJobCreated = false;

    try {
      // Step 2: Save to Private Supabase Storage (Bucket: 'documents')
      const saved = await storageService.saveFile(
        userId,
        documentId,
        file.originalname,
        file.buffer,
        file.mimetype,
        req.userToken
      );
      isFileSaved = true;

      // Step 3: Calculate actual PDF Page Count before database record creation
      let pageCount = 1;
      if (fileType === 'PDF') {
        try {
          const pdfDoc = await PDFDocument.load(file.buffer);
          pageCount = pdfDoc.getPageCount();
        } catch (pdfErr) {
          pageCount = 1;
        }
      }

      // Create Document Record in Database
      const newDoc = await db.createDocument({
        id: documentId,
        user_id: userId,
        original_filename: file.originalname,
        file_name: saved.fileName,
        file_type: fileType,
        mime_type: file.mimetype,
        file_size: saved.fileSize,
        page_count: pageCount,
        storage_bucket: saved.storageBucket,
        storage_path: saved.storagePath,
        document_type: 'BANK_STATEMENT',
        status: 'QUEUED',
      }, req.userToken);
      isDocumentCreated = true;

      // Step 4: Create Processing Job in QUEUED state
      const job = await ocrService.queueDocumentForProcessing(userId, documentId);
      isJobCreated = true;

      // Step 5: Atomically Deduct Quota
      const updatedQuota = await quotaService.consumeQuota(userId);

      // Step 6: Log Audit Trail
      await auditService.log({
        userId,
        action: 'UPLOAD_DOCUMENT',
        resourceType: 'documents',
        resourceId: documentId,
        ipAddress: req.ip,
        metadata: {
          filename: file.originalname,
          fileSize: saved.fileSize,
          fileType,
          storageBucket: saved.storageBucket,
          storagePath: saved.storagePath,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Tải tài liệu lên thành công. Tác vụ xử lý đã được đưa vào hàng đợi.',
        document: newDoc,
        job,
        quota: updatedQuota,
      });
    } catch (pipelineErr: any) {
      console.error(`[Upload Pipeline Error] docId: ${documentId}, isFileSaved: ${isFileSaved}, isDocumentCreated: ${isDocumentCreated}, isJobCreated: ${isJobCreated}. Initiating compensating cleanup...`, pipelineErr);

      // Compensating cleanup in reverse order to ensure zero orphan records / files
      if (isFileSaved) {
        if (isJobCreated) {
          try {
            const client = req.userToken ? createSupabaseUserClient(req.userToken) : getSupabaseAdminClient();
            await client.from('processing_jobs').delete().eq('document_id', documentId).eq('user_id', userId);
          } catch (jobCleanupErr) {
            console.error('[Compensating Cleanup] Error deleting orphan job:', jobCleanupErr);
          }
        }

        if (isDocumentCreated) {
          try {
            await db.hardDeleteDocument(userId, documentId, req.userToken);
          } catch (docCleanupErr) {
            console.error('[Compensating Cleanup] Error deleting orphan document:', docCleanupErr);
          }
        }

        try {
          await storageService.deleteDocumentFiles(userId, documentId, req.userToken);
        } catch (storageCleanupErr) {
          console.error('[Compensating Cleanup] Error deleting orphan storage file:', storageCleanupErr);
        }
      }

      throw pipelineErr;
    }
  } catch (err: any) {
    console.error('Document upload error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Có lỗi xảy ra khi tải tài liệu. Vui lòng thử lại.',
    });
  }
});

// 6. DELETE DOCUMENT (Soft delete DB + remove objects from Private Supabase Storage)
router.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;

    const document = await db.getUserDocumentById(userId, docId, req.userToken);
    if (!document) {
      res.status(404).json({
        success: false,
        error: 'Tài liệu không tồn tại hoặc bạn không có quyền xóa tài liệu này.',
      });
      return;
    }

    // 1. Soft delete database record
    const deleted = await db.softDeleteDocument(userId, docId, req.userToken);
    if (!deleted) {
      res.status(500).json({ success: false, error: 'Không thể xóa bản ghi tài liệu.' });
      return;
    }

    // 2. Remove files from Supabase Storage
    await storageService.deleteDocumentFiles(userId, docId, req.userToken);

    // 3. Log audit
    await auditService.log({
      userId,
      action: 'DELETE_DOCUMENT',
      resourceType: 'documents',
      resourceId: docId,
      ipAddress: req.ip,
      metadata: { originalFilename: document.original_filename },
    });

    res.json({
      success: true,
      message: 'Đã xóa tài liệu và tệp lưu trữ an toàn thành công.',
    });
  } catch (err) {
    console.error('Document delete error:', err);
    res.status(500).json({ success: false, error: 'Có lỗi xảy ra khi xóa tài liệu.' });
  }
});

// 7. GET OCR STRUCTURED RESULT & TABLES FOR REVIEW
router.get('/:id/ocr-result', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;

    // Strict User Isolation Check
    const document = await db.getUserDocumentById(userId, docId, req.userToken);
    if (!document) {
      res.status(404).json({
        success: false,
        error: 'Tài liệu không tồn tại hoặc bạn không có quyền truy cập.',
      });
      return;
    }

    const ocrData = await db.getDocumentOcrResult(userId, docId, req.userToken);
    const job = await db.getJobByDocumentId(userId, docId);

    if (!ocrData || ocrData.tables.length === 0) {
      // If OCR not run yet, provide status
      res.json({
        success: true,
        document,
        job,
        pages: ocrData?.pages || [],
        tables: [],
        documentMetadata: ocrData?.documentMetadata || [],
        stats: {
          totalCells: 0,
          lowConfidenceCount: 0,
          mediumConfidenceCount: 0,
          highConfidenceCount: 0,
          requiresReview: false,
        },
      });
      return;
    }

    res.json({
      success: true,
      document: ocrData.document,
      job,
      pages: ocrData.pages,
      tables: ocrData.tables,
      documentMetadata: ocrData.documentMetadata || [],
      stats: ocrData.stats,
    });
  } catch (err: any) {
    console.error('Get OCR result error:', err);
    res.status(500).json({ success: false, error: 'Không thể tải dữ liệu OCR của tài liệu.' });
  }
});

// 8. TRIGGER / RETRY OCR PROCESSING
router.post('/:id/ocr', ocrRateLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;

    const document = await db.getUserDocumentById(userId, docId, req.userToken);
    if (!document) {
      res.status(404).json({
        success: false,
        error: 'Tài liệu không tồn tại hoặc bạn không có quyền truy cập.',
      });
      return;
    }

    const job = await ocrService.retryDocumentProcessing(userId, docId);

    await auditService.log({
      userId,
      action: 'RETRY_OCR',
      resourceType: 'documents',
      resourceId: docId,
      ipAddress: req.ip,
      metadata: { jobId: job.id },
    });

    res.json({
      success: true,
      message: 'Đã gửi yêu cầu xử lý OCR vào hàng đợi Azure AI.',
      job,
    });
  } catch (err: any) {
    console.error('Trigger OCR error:', err);
    res.status(500).json({ success: false, error: err.message || 'Không thể bắt đầu xử lý OCR.' });
  }
});

// 9. UPDATE EXTRACTED CELL (Review & Edit Data)
router.put('/:id/cells/:cellId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;
    const cellId = req.params.cellId;
    const { rawValue, cellType } = req.body;

    // Backend is the Single Source of Truth for normalization
    const normalized = DataNormalizer.normalizeCell(rawValue, cellType);

    const updatedCell = await db.updateExtractedCell(userId, docId, cellId, {
      rawValue: normalized.rawValue,
      normalizedValue: normalized.normalizedValue,
      cellType: normalized.cellType,
      isReviewed: true,
    }, req.userToken);

    res.json({
      success: true,
      message: 'Đã cập nhật ô dữ liệu thành công.',
      cell: updatedCell,
    });
  } catch (err: any) {
    console.error('Update cell error:', err);
    res.status(400).json({ success: false, error: err.message || 'Không thể cập nhật ô dữ liệu.' });
  }
});

// 10. ADD ROW TO TABLE
router.post('/:id/tables/:tableId/rows', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;
    const tableId = req.params.tableId;
    const { cells } = req.body; // Array of { rawValue, normalizedValue, cellType, columnIndex }

    const result = await db.addExtractedRow(userId, docId, tableId, Array.isArray(cells) ? cells : [], req.userToken);

    res.status(201).json({
      success: true,
      message: 'Đã thêm dòng mới vào bảng thành công.',
      row: result.row,
      cells: result.cells,
    });
  } catch (err: any) {
    console.error('Add row error:', err);
    res.status(400).json({ success: false, error: err.message || 'Không thể thêm dòng mới.' });
  }
});

// 11. DELETE ROW FROM TABLE
router.delete('/:id/tables/:tableId/rows/:rowIndex', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;
    const tableId = req.params.tableId;
    const rowIndex = parseInt(req.params.rowIndex, 10);

    await db.deleteExtractedRow(userId, docId, tableId, rowIndex, req.userToken);

    res.json({
      success: true,
      message: 'Đã xóa dòng khỏi bảng thành công.',
    });
  } catch (err: any) {
    console.error('Delete row error:', err);
    res.status(400).json({ success: false, error: err.message || 'Không thể xóa dòng.' });
  }
});

// 12. COMPLETE DOCUMENT REVIEW
router.post('/:id/review/complete', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;

    const doc = await db.markDocumentReviewed(userId, docId, req.userToken);

    await auditService.log({
      userId,
      action: 'COMPLETE_REVIEW',
      resourceType: 'documents',
      resourceId: docId,
      ipAddress: req.ip,
      metadata: { originalFilename: doc.original_filename },
    });

    res.json({
      success: true,
      message: 'Đã hoàn tất đối soát dữ liệu. Tài liệu sẵn sàng để xuất file.',
      document: doc,
    });
  } catch (err: any) {
    console.error('Complete review error:', err);
    res.status(400).json({ success: false, error: err.message || 'Không thể hoàn tất đối soát.' });
  }
});

// 13. EXPORT DOCUMENT TO EXCEL (.XLSX) — (Phase 3A)
router.post('/:id/export/excel', exportRateLimiter, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;
    const { mode, includeReviewLog, includeValidationSheet, highlightLowConfidence } = req.body;

    const exportMode: ExportMode = mode === 'ORIGINAL' ? 'ORIGINAL' : 'NORMALIZED';

    const result = await excelExportEngine.exportDocumentToExcel(userId, docId, {
      mode: exportMode,
      includeReviewLog: includeReviewLog !== false,
      includeValidationSheet: includeValidationSheet !== false,
      highlightLowConfidence: highlightLowConfidence !== false,
    });

    res.json({
      success: true,
      message: `Đã xuất dữ liệu sang định dạng Excel (.xlsx) thành công (${exportMode === 'ORIGINAL' ? 'Dữ liệu gốc' : 'Chuẩn hóa'}).`,
      export: result,
    });
  } catch (err: any) {
    console.error('Excel Export error:', err);
    res.status(400).json({
      success: false,
      error: err.message || 'Không thể tạo tệp Excel từ dữ liệu tài liệu.',
    });
  }
});

// 14. GET DOCUMENT EXPORTS HISTORY
router.get('/:id/exports', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;

    // Verify ownership
    const doc = await db.getUserDocumentById(userId, docId, req.userToken);
    if (!doc) {
      res.status(404).json({ success: false, error: 'Không tìm thấy tài liệu hoặc không có quyền truy cập.' });
      return;
    }

    const exportsList = await db.getDocumentExports(userId, docId);
    res.json({
      success: true,
      exports: exportsList,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Không thể tải lịch sử xuất tệp.' });
  }
});

// 15. DOWNLOAD EXPORTED EXCEL FILE (Secure Stream with User Isolation)
router.get('/:id/exports/:exportId/download', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const docId = req.params.id;
    const exportId = req.params.exportId;

    // Strict ownership & RLS check
    const doc = await db.getUserDocumentById(userId, docId, req.userToken);
    if (!doc) {
      res.status(403).json({ success: false, error: 'Truy cập bị từ chối. Bạn không sở hữu tài liệu này.' });
      return;
    }

    const exportRecord = await db.getUserExportById(userId, exportId);
    if (!exportRecord || exportRecord.document_id !== docId) {
      res.status(404).json({ success: false, error: 'Không tìm thấy bản xuất tệp hoặc bạn không có quyền tải xuống.' });
      return;
    }

    // Retrieve file from private storage
    const fileData = await storageService.getFile(userId, `export_${exportId}`, req.userToken);
    if (!fileData) {
      res.status(404).json({ success: false, error: 'Tệp xuất không tồn tại trong kho lưu trữ an toàn.' });
      return;
    }

    // Log download audit action
    await auditService.log({
      userId,
      action: 'DOWNLOAD_EXPORT',
      resourceType: 'documents',
      resourceId: docId,
      ipAddress: req.ip,
      metadata: {
        exportId,
        fileName: exportRecord.file_name,
        fileSize: exportRecord.file_size,
        exportFormat: exportRecord.export_format,
      },
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(exportRecord.file_name)}"`);
    res.setHeader('Content-Length', fileData.buffer.length);
    res.send(fileData.buffer);
  } catch (err: any) {
    console.error('Download export error:', err);
    res.status(500).json({ success: false, error: 'Lỗi khi tải tệp xuất.' });
  }
});

export default router;
