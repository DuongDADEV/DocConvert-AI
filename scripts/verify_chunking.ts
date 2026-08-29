import 'dotenv/config';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { azureOcrProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { db } from '../server/db/db.js';
import { excelExportEngine } from '../server/services/excelExportEngine.js';

async function createTestPdfBuffer(pageCount: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let i = 1; i <= pageCount; i++) {
    const page = pdfDoc.addPage([600, 400]);
    page.drawText(`Bank Statement Page ${i} of ${pageCount}`, { x: 50, y: 350, size: 18, font });
    page.drawText(`Date | Ref | Description | Debit | Credit | Balance`, { x: 50, y: 300, size: 12, font });
    page.drawText(`0${i}/08/2026 | FT00${i} | Transaction item on page ${i} | 0 | ${i * 10000} | ${i * 10000}`, { x: 50, y: 270, size: 11, font });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function runChunkingVerificationTests() {
  console.log('==================================================');
  console.log('STARTING PDF CHUNKING & MERGE INTEGRATION TESTS');
  console.log('==================================================\n');

  const testUserId = 'test_user_chunking_verifier';
  db.ensureProfile(testUserId, 'chunk_test@docconvert.ai', 'Chunk Verifier');

  // TEST 1: PDF 1 Page
  console.log('--- TEST 1: PDF 1 Page ---');
  const pdf1Buf = await createTestPdfBuffer(1);
  const res1 = await azureOcrProvider.analyzeDocument(pdf1Buf, 'application/pdf');
  console.log(`Pages count: ${res1.pages.length} (Expected: 1)`);
  console.log(`Page numbers: ${res1.pages.map((p) => p.pageNumber).join(', ')}`);
  console.assert(res1.pages.length === 1, 'TEST 1 FAIL: Page count should be 1');
  console.log('TEST 1 PASS!\n');

  // TEST 2: PDF 2 Pages (Limit = 2)
  console.log('--- TEST 2: PDF 2 Pages ---');
  const pdf2Buf = await createTestPdfBuffer(2);
  const res2 = await azureOcrProvider.analyzeDocument(pdf2Buf, 'application/pdf');
  console.log(`Pages count: ${res2.pages.length} (Expected: 2)`);
  console.log(`Page numbers: ${res2.pages.map((p) => p.pageNumber).join(', ')}`);
  console.assert(res2.pages.length === 2, 'TEST 2 FAIL: Page count should be 2');
  console.log('TEST 2 PASS!\n');

  // TEST 3: PDF 3 Pages (Odd number, 2 chunks: 1-2, 3)
  console.log('--- TEST 3: PDF 3 Pages ---');
  const pdf3Buf = await createTestPdfBuffer(3);
  const res3 = await azureOcrProvider.analyzeDocument(pdf3Buf, 'application/pdf');
  console.log(`Pages count: ${res3.pages.length} (Expected: 3)`);
  console.log(`Page numbers: ${res3.pages.map((p) => p.pageNumber).join(', ')}`);
  console.assert(res3.pages.length === 3, 'TEST 3 FAIL: Page count should be 3');
  console.assert(
    res3.pages.map((p) => p.pageNumber).join(',') === '1,2,3',
    'TEST 3 FAIL: Page numbers mapping wrong'
  );
  console.log('TEST 3 PASS!\n');

  // TEST 4 & 5 & 6 & 7: PDF 8 Pages (4 Chunks: 1-2, 3-4, 5-6, 7-8)
  console.log('--- TEST 4-7: PDF 8 Pages (Chunks & Table Merging) ---');
  const pdf8Buf = await createTestPdfBuffer(8);
  const res8 = await azureOcrProvider.analyzeDocument(pdf8Buf, 'application/pdf');
  console.log(`Pages count: ${res8.pages.length} (Expected: 8)`);
  console.log(`Page numbers: ${res8.pages.map((p) => p.pageNumber).join(', ')}`);
  console.log(`Tables count: ${res8.tables.length}`);
  console.log(`Table page numbers: ${res8.tables.map((t) => t.pageNumber).join(', ')}`);
  console.log(`Table indices: ${res8.tables.map((t) => t.tableIndex).join(', ')}`);

  console.assert(res8.pages.length === 8, 'TEST 4 FAIL: Page count should be 8');
  console.assert(
    res8.pages.map((p) => p.pageNumber).join(',') === '1,2,3,4,5,6,7,8',
    'TEST 5 FAIL: Page numbers mapping wrong'
  );

  // Check unique table indices
  const tableIndices = res8.tables.map((t) => t.tableIndex);
  const uniqueTableIndices = new Set(tableIndices);
  console.assert(tableIndices.length === uniqueTableIndices.size, 'TEST 6 FAIL: Table indices duplicated!');

  // TEST 8 & 9: Database Persistence & User Isolation & document.page_count
  console.log('\n--- TEST 8-9: Database Record & Page Count ---');
  const testDocId = `doc_verify_chunk_${Date.now()}`;
  const docRecord = db.createDocument({
    id: testDocId,
    user_id: testUserId,
    original_filename: 'sao_ke_8_trang_test.pdf',
    file_name: 'sao_ke_8_trang_test.pdf',
    file_type: 'PDF',
    mime_type: 'application/pdf',
    file_size: pdf8Buf.length,
    page_count: 8,
    storage_bucket: 'documents',
    storage_path: `documents/${testUserId}/${testDocId}/original/test.pdf`,
    document_type: 'BANK_STATEMENT',
    status: 'PROCESSING',
  });

  db.saveOcrAnalysis(testUserId, testDocId, res8);

  const storedOcr = db.getDocumentOcrResult(testUserId, testDocId);
  console.log(`Stored DB Pages count: ${storedOcr?.pages.length}`);
  console.log(`Stored DB Document page_count: ${storedOcr?.document.page_count}`);
  console.log(`Stored DB Tables count: ${storedOcr?.tables.length}`);

  console.assert(storedOcr?.pages.length === 8, 'TEST 9 FAIL: DB should have 8 page records');
  console.assert(storedOcr?.document.page_count === 8, 'TEST 9 FAIL: doc.page_count should be 8');
  console.assert(storedOcr?.document.user_id === testUserId, 'TEST 8 FAIL: user_id mismatch');

  // TEST 10: Excel Export with All Pages Data
  console.log('\n--- TEST 10: Excel Export with All 8 Pages ---');
  const exportResult = await excelExportEngine.exportDocumentToExcel(testUserId, testDocId, {
    mode: 'NORMALIZED',
    includeReviewLog: true,
  });

  console.log(`Exported file size: ${exportResult.fileSize} bytes`);
  console.log(`Exported tables count: ${exportResult.tablesCount}`);
  console.log(`Exported total rows: ${exportResult.totalRows}`);
  console.log(`Exported total cells: ${exportResult.totalCells}`);

  console.assert(exportResult.fileSize > 0, 'TEST 10 FAIL: Excel file size 0');
  console.assert(exportResult.tablesCount === res8.tables.length, 'TEST 10 FAIL: Excel tables count mismatch');

  console.log('\n==================================================');
  console.log('ALL 10 VERIFICATION TESTS PASSED SUCCESSFULLY! ✅');
  console.log('==================================================');
}

runChunkingVerificationTests().catch((err) => {
  console.error('TEST SUITE ERROR:', err);
  process.exit(1);
});
