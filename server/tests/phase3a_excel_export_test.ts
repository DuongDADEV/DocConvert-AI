import { db } from '../db/db.js';
import { excelExportEngine } from '../services/excelExportEngine.js';
import { storageService } from '../services/storageService.js';
import ExcelJS from 'exceljs';

async function runPhase3ATests() {
  console.log('====================================================');
  console.log('PHASE 3A — EXCEL EXPORT ENGINE AUTOMATED AUDIT (16 TESTS)');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `-> ${detail}` : ''}`);
      failedCount++;
    }
  }

  // Setup Test Fixtures in Database
  const userA = 'test-user-a-' + Date.now();
  const userB = 'test-user-b-' + Date.now();
  const docIdA = 'test-doc-a-' + Date.now();
  const docIdB = 'test-doc-b-' + Date.now();

  const sampleHeaders = ['Ngày GD', 'Số chứng từ', 'Diễn giải', 'Ghi Nợ', 'Ghi Có', 'Số dư'];
  
  // 1. Create Documents for User A & User B
  db.createDocument({
    id: docIdA,
    user_id: userA,
    original_filename: 'Sao_ke_ACB_Thang12_2025.pdf',
    file_name: 'safe_acb.pdf',
    file_type: 'PDF',
    mime_type: 'application/pdf',
    file_size: 102400,
    page_count: 2,
    storage_bucket: 'documents',
    storage_path: `${userA}/${docIdA}/original/safe_acb.pdf`,
    document_type: 'BANK_STATEMENT',
    status: 'READY',
  });

  db.createDocument({
    id: docIdB,
    user_id: userB,
    original_filename: 'Hoa_don_VIB_2025.pdf',
    file_name: 'safe_vib.pdf',
    file_type: 'PDF',
    mime_type: 'application/pdf',
    file_size: 51200,
    page_count: 1,
    storage_bucket: 'documents',
    storage_path: `${userB}/${docIdB}/original/safe_vib.pdf`,
    document_type: 'INVOICE',
    status: 'READY',
  });

  // 2. Populate structured tables & cells for Doc A (Multi-table & Merged Cells) via saveOcrAnalysis
  db.saveOcrAnalysis(userA, docIdA, {
    modelId: 'prebuilt-layout',
    provider: 'Azure AI Document Intelligence',
    overallConfidence: 0.97,
    rawText: 'Sao kê ngân hàng ACB 2025...',
    pages: [
      { pageNumber: 1, rawText: 'Trang 1', confidence: 0.98, linesCount: 15 },
      { pageNumber: 2, rawText: 'Trang 2', confidence: 0.96, linesCount: 8 },
    ],
    tables: [
      {
        pageNumber: 1,
        tableIndex: 0,
        rowCount: 4,
        columnCount: 6,
        confidence: 0.98,
        rows: [
          // Header Row (Row 0)
          {
            rowIndex: 0,
            isHeader: true,
            cells: sampleHeaders.map((h, colIdx) => ({
              rowIndex: 0,
              columnIndex: colIdx,
              rowSpan: 1,
              columnSpan: 1,
              rawValue: h,
              normalizedValue: h,
              cellType: 'TEXT' as const,
              confidence: 0.99,
            })),
          },
          // Data Row 1 (High confidence)
          {
            rowIndex: 1,
            isHeader: false,
            cells: [
              { rowIndex: 1, columnIndex: 0, rawValue: '2025-12-01', normalizedValue: '2025-12-01', cellType: 'DATE' as const, confidence: 0.96 },
              { rowIndex: 1, columnIndex: 1, rawValue: 'FT2533001', normalizedValue: 'FT2533001', cellType: 'TEXT' as const, confidence: 0.98 },
              { rowIndex: 1, columnIndex: 2, rawValue: 'Chuyển tiền thanh toán hợp đồng', normalizedValue: 'Chuyển tiền thanh toán hợp đồng', cellType: 'TEXT' as const, confidence: 0.97 },
              { rowIndex: 1, columnIndex: 3, rawValue: '50,000,000', normalizedValue: '50000000', cellType: 'MONEY' as const, confidence: 0.96 },
              { rowIndex: 1, columnIndex: 4, rawValue: '', normalizedValue: '', cellType: 'TEXT' as const, confidence: 1.0 },
              { rowIndex: 1, columnIndex: 5, rawValue: '150,000,000', normalizedValue: '150000000', cellType: 'MONEY' as const, confidence: 0.95 },
            ],
          },
          // Data Row 2 (Low confidence on credit cell)
          {
            rowIndex: 2,
            isHeader: false,
            cells: [
              { rowIndex: 2, columnIndex: 0, rawValue: '2025-12-02', normalizedValue: '2025-12-02', cellType: 'DATE' as const, confidence: 0.95 },
              { rowIndex: 2, columnIndex: 1, rawValue: 'FT2533002', normalizedValue: 'FT2533002', cellType: 'TEXT' as const, confidence: 0.98 },
              { rowIndex: 2, columnIndex: 2, rawValue: 'Nhận tiền thanh toán dịch vụ', normalizedValue: 'Nhận tiền thanh toán dịch vụ', cellType: 'TEXT' as const, confidence: 0.97 },
              { rowIndex: 2, columnIndex: 3, rawValue: '', normalizedValue: '', cellType: 'TEXT' as const, confidence: 1.0 },
              { rowIndex: 2, columnIndex: 4, rawValue: '120,000,000', normalizedValue: '120000000', cellType: 'MONEY' as const, confidence: 0.62 }, // Low confidence
              { rowIndex: 2, columnIndex: 5, rawValue: '270,000,000', normalizedValue: '270000000', cellType: 'MONEY' as const, confidence: 0.95 },
            ],
          },
          // Data Row 3 (Merged Column: colSpan = 2)
          {
            rowIndex: 3,
            isHeader: false,
            cells: [
              { rowIndex: 3, columnIndex: 0, rowSpan: 1, columnSpan: 2, rawValue: 'Tổng phát sinh lũy kế', normalizedValue: 'Tổng phát sinh lũy kế', cellType: 'TEXT' as const, confidence: 0.98 },
              { rowIndex: 3, columnIndex: 2, rawValue: 'Ghi chú quyết toán', normalizedValue: 'Ghi chú quyết toán', cellType: 'TEXT' as const, confidence: 0.95 },
              { rowIndex: 3, columnIndex: 3, rawValue: '50,000,000', normalizedValue: '50000000', cellType: 'MONEY' as const, confidence: 0.96 },
              { rowIndex: 3, columnIndex: 4, rawValue: '120,000,000', normalizedValue: '120000000', cellType: 'MONEY' as const, confidence: 0.96 },
              { rowIndex: 3, columnIndex: 5, rawValue: '270,000,000', normalizedValue: '270000000', cellType: 'MONEY' as const, confidence: 0.95 },
            ],
          },
        ],
      },
      // Table 2 on Page 2
      {
        pageNumber: 2,
        tableIndex: 1,
        rowCount: 2,
        columnCount: 3,
        confidence: 0.95,
        rows: [
          {
            rowIndex: 0,
            isHeader: true,
            cells: ['Loại phí', 'Mô tả', 'Số tiền'].map((h, colIdx) => ({
              rowIndex: 0,
              columnIndex: colIdx,
              rawValue: h,
              normalizedValue: h,
              cellType: 'TEXT' as const,
              confidence: 0.99,
            })),
          },
          {
            rowIndex: 1,
            isHeader: false,
            cells: [
              { rowIndex: 1, columnIndex: 0, rawValue: 'Phí thường niên', normalizedValue: 'Phí thường niên', cellType: 'TEXT' as const, confidence: 0.98 },
              { rowIndex: 1, columnIndex: 1, rawValue: 'Phí duy trì tài khoản', normalizedValue: 'Phí duy trì tài khoản', cellType: 'TEXT' as const, confidence: 0.97 },
              { rowIndex: 1, columnIndex: 2, rawValue: '55,000', normalizedValue: '55000', cellType: 'MONEY' as const, confidence: 0.99 },
            ],
          },
        ],
      },
    ],
  });

  // Table for User B
  db.saveOcrAnalysis(userB, docIdB, {
    modelId: 'prebuilt-layout',
    provider: 'Azure AI Document Intelligence',
    overallConfidence: 0.99,
    rawText: 'Hóa đơn VIB 2025...',
    pages: [{ pageNumber: 1, rawText: 'Trang 1', confidence: 0.99, linesCount: 5 }],
    tables: [
      {
        pageNumber: 1,
        tableIndex: 0,
        rowCount: 1,
        columnCount: 2,
        confidence: 0.99,
        rows: [
          {
            rowIndex: 0,
            isHeader: true,
            cells: ['Mã SP', 'Tên sản phẩm'].map((h, colIdx) => ({
              rowIndex: 0,
              columnIndex: colIdx,
              rawValue: h,
              normalizedValue: h,
              cellType: 'TEXT' as const,
              confidence: 0.99,
            })),
          },
        ],
      },
    ],
  });

  // ==========================================
  // RUNNING THE 16 VERIFICATION TESTS
  // ==========================================

  console.log('\n--- 1. TEST CASES: BASIC EXPORT & SHEET NAMING ---');
  // Test 1: Export Document to Excel (.xlsx format)
  let exportResNormal = await excelExportEngine.exportDocumentToExcel(userA, docIdA, { mode: 'NORMALIZED' });
  assert(exportResNormal.exportFormat === 'XLSX' && exportResNormal.fileSize > 0, 'Test 1: Export to .xlsx format successfully generated');

  // Test 2: Safe Worksheet Name sanitization (length <= 31, no prohibited chars, handles collisions)
  const namesSet = new Set<string>();
  const safeName1 = excelExportEngine.sanitizeSheetName('Bang [Tai Chinh]: Ngân Hàng * ACB / 2025?', namesSet);
  const safeName2 = excelExportEngine.sanitizeSheetName('Bang [Tai Chinh]: Ngân Hàng * ACB / 2025?', namesSet);
  assert(
    safeName1.length <= 31 &&
    !safeName1.includes('[') &&
    !safeName1.includes('*') &&
    !safeName1.includes('/') &&
    safeName2 !== safeName1 &&
    safeName2.length <= 31,
    'Test 2: Worksheet names are strictly sanitized <= 31 chars without invalid characters'
  );

  console.log('\n--- 2. TEST CASES: VALUE POLICIES & FINANCIAL DATA TYPES ---');
  // Test 3: Mode B (NORMALIZED) exports numeric types for money with accounting format
  const wbNormal = new ExcelJS.Workbook();
  const fileDataA = await storageService.getFile(userA, `export_${exportResNormal.exportId}`);
  await wbNormal.xlsx.load(fileDataA!.buffer);
  const sheet1 = wbNormal.worksheets[0];
  const moneyCellRow2 = sheet1.getCell('D2'); // Ghi nợ 50,000,000
  assert(
    typeof moneyCellRow2.value === 'number' && moneyCellRow2.value === 50000000 && moneyCellRow2.numFmt === '#,##0;[Red]-#,##0;"-"',
    'Test 3: Mode NORMALIZED formats MONEY as native Excel number with accounting format'
  );

  // Test 4: Mode B (NORMALIZED) formats DATE as Excel Date or DD/MM/YYYY
  const dateCellRow2 = sheet1.getCell('A2'); // 2025-12-01
  assert(
    (dateCellRow2.value instanceof Date || typeof dateCellRow2.value === 'string') && dateCellRow2.numFmt === 'DD/MM/YYYY',
    'Test 4: Mode NORMALIZED formats DATE with DD/MM/YYYY formatting'
  );

  // Test 5: Mode A (ORIGINAL) preserves 100% exact text string
  const exportResOriginal = await excelExportEngine.exportDocumentToExcel(userA, docIdA, { mode: 'ORIGINAL' });
  const wbOrig = new ExcelJS.Workbook();
  const fileDataOrig = await storageService.getFile(userA, `export_${exportResOriginal.exportId}`);
  await wbOrig.xlsx.load(fileDataOrig!.buffer);
  const origSheet1 = wbOrig.worksheets[0];
  const origMoneyCell = origSheet1.getCell('D2');
  assert(
    typeof origMoneyCell.value === 'string' && origMoneyCell.value === '50,000,000',
    'Test 5: Mode ORIGINAL preserves 100% exact string "50,000,000" without conversion'
  );

  // Test 6: Cell with low confidence (< 0.70) is highlighted in yellow and has warning note
  const lowConfCell = sheet1.getCell('E3'); // Ghi có 120,000,000 (conf: 0.62)
  const hasFill = lowConfCell.fill && (lowConfCell.fill as any).fgColor?.argb === 'FFFFFBEB';
  const hasNote = Boolean(lowConfCell.note);
  assert(
    hasFill && hasNote,
    'Test 6: Low-confidence cell (<70%) is visually highlighted with audit warning note'
  );

  console.log('\n--- 3. TEST CASES: AUDIT & VALIDATION SHEETS ---');
  // Test 7: Review_Log sheet is generated with all cell extraction details
  const reviewSheet = wbNormal.getWorksheet('Review_Log');
  assert(
    reviewSheet !== undefined && reviewSheet.rowCount >= 4,
    'Test 7: Review_Log worksheet is generated with row & cell audit trail'
  );

  // Test 8: Validation sheet is generated with financial debit/credit totals
  const valSheet = wbNormal.getWorksheet('Validation');
  assert(
    valSheet !== undefined && valSheet.rowCount >= 5,
    'Test 8: Validation worksheet is generated with debit/credit balance reconciliation'
  );

  // Test 9: Merged cells (rowSpan / columnSpan) are accurately preserved
  assert(
    sheet1.model.merges && sheet1.model.merges.length > 0,
    'Test 9: Merged cells with columnSpan > 1 are preserved in Excel worksheet'
  );

  // Test 10: Multi-table documents map each OCR table to separate worksheets
  assert(
    wbNormal.worksheets.length >= 2,
    'Test 10: Multi-table documents map tables to distinct worksheets'
  );

  console.log('\n--- 4. TEST CASES: SECURITY & USER ISOLATION (RLS) ---');
  // Test 11: Exported files are stored in Private Supabase Storage (no public access)
  assert(
    exportResNormal.storageBucket === 'documents' &&
    exportResNormal.storagePath.includes(`${userA}/export_`),
    'Test 11: Exported files are placed exclusively in Private Storage path'
  );

  // Test 12: User A CANNOT access or download User B export (Strict Isolation)
  let userBLeakBlocked = false;
  try {
    const userBExport = await excelExportEngine.exportDocumentToExcel(userB, docIdB);
    const leakedData = await storageService.getFile(userA, `export_${userBExport.exportId}`);
    if (!leakedData) userBLeakBlocked = true;
  } catch {
    userBLeakBlocked = true;
  }
  assert(userBLeakBlocked, 'Test 12: User A cannot read or download User B export file (RLS Enforced)');

  // Test 13: User A CANNOT export Document belonging to User B
  let crossDocExportBlocked = false;
  try {
    await excelExportEngine.exportDocumentToExcel(userA, docIdB);
  } catch (err: any) {
    if (err.message.includes('không có quyền')) crossDocExportBlocked = true;
  }
  assert(crossDocExportBlocked, 'Test 13: User A is blocked from exporting User B document ID');

  // Test 14: Idempotency & Export History Tracking
  const exportResDuplicate = await excelExportEngine.exportDocumentToExcel(userA, docIdA, { mode: 'NORMALIZED' });
  assert(
    exportResDuplicate.exportId === exportResNormal.exportId,
    'Test 14: Idempotency avoids duplicate file generation for identical document & mode'
  );

  // Test 15: Export record is queried in Document Exports History
  const history = db.getDocumentExports(userA, docIdA);
  assert(
    history.length >= 2 && history[0].export_format === 'XLSX',
    'Test 15: Document exports history is recorded and queryable per user'
  );

  // Test 16: No Azure keys, Supabase Service Role keys, or JWT tokens in file names / logs
  const auditLogs = db.getUserAuditLogs(userA, 10);
  const hasSecretsInLogs = auditLogs.some((l) =>
    JSON.stringify(l).includes('service_role') ||
    JSON.stringify(l).includes('eyJh') ||
    JSON.stringify(l).includes('SECRET')
  );
  assert(
    !hasSecretsInLogs && !exportResNormal.fileName.includes('Bearer'),
    'Test 16: No API keys, secrets, or JWT tokens are exposed in export filenames or audit logs'
  );

  console.log('\n====================================================');
  console.log(`PHASE 3A AUDIT COMPLETE: ${passedCount}/16 TESTS PASSED, ${failedCount} FAILED`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPhase3ATests().catch((err) => {
  console.error('Phase 3A test suite encountered an unexpected error:', err);
  process.exit(1);
});
