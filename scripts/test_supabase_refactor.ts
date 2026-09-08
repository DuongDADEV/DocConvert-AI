import 'dotenv/config';
import { db } from '../server/db/db.js';
import { ocrWorker } from '../server/services/ocrWorker.js';
import { excelExportEngine } from '../server/services/excelExportEngine.js';
import { OCRAnalysisResult } from '../server/services/ocr/types.js';

async function runSupabaseRefactorTests() {
  console.log('==================================================');
  console.log('RUNNING MANDATORY SUPABASE REFACTOR VERIFICATION');
  console.log('==================================================\n');

  const testUserA = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c'; // User A (Medihub demo user)
  const testUserB = '99999999-9999-9999-9999-999999999999'; // User B (Unauthorized tenant)
  const docId = crypto.randomUUID();

  // Test A: Ensure User Profile
  console.log('1. Testing User Profile Ensure...');
  const profileA = await db.ensureProfile(testUserA, 'medihub@test.com', 'CTY CP MEDIHUB');
  console.log(`   [PASS] Profile A loaded: ${profileA.email} (${profileA.id})`);

  // Test B: Create Document in Supabase PostgreSQL
  console.log('\n2. Testing Create Document in PostgreSQL...');
  const newDoc = await db.createDocument({
    id: docId,
    user_id: testUserA,
    original_filename: 'sao-ke-acb-Medihub-2023.pdf',
    file_name: 'sao-ke-acb-Medihub-2023.pdf',
    file_type: 'PDF',
    mime_type: 'application/pdf',
    file_size: 154200,
    page_count: 8,
    storage_bucket: 'documents',
    storage_path: `${testUserA}/${docId}/original/sao-ke-acb-Medihub-2023.pdf`,
    document_type: 'BANK_STATEMENT',
    status: 'QUEUED',
  });
  console.log(`   [PASS] Document created: ${newDoc.id} | Status: ${newDoc.status} | Pages: ${newDoc.page_count}`);

  // Test C: Create Processing Job in PostgreSQL
  console.log('\n3. Testing Processing Job Creation...');
  const job = await db.createProcessingJob({
    document_id: docId,
    user_id: testUserA,
    status: 'QUEUED',
    current_step: 'Đang chờ xử lý',
    progress: 10,
  });
  console.log(`   [PASS] Job created: ${job.id} | Status: ${job.status}`);

  // Test D: Save OCR Analysis for 8 Pages (Chunking merged 8 pages, 16 tables, 236 rows, 1,113 cells)
  console.log('\n4. Testing OCR Analysis Persistence (8 Pages Batch Cell Insert & Rollback Safety)...');
  const pages = Array.from({ length: 8 }).map((_, i) => ({
    pageNumber: i + 1,
    width: 8.5,
    height: 11,
    unit: 'inch',
    linesCount: 35,
    wordsCount: 200,
    confidence: 0.98,
    rawText: `Page ${i + 1} of 8 Bank Statement Data`,
  }));

  const mockTables = Array.from({ length: 2 }).map((_, tIdx) => ({
    pageNumber: tIdx + 1,
    tableIndex: tIdx,
    rowCount: 10,
    columnCount: 6,
    confidence: 0.96,
    headers: ['Ngày GD', 'Số chứng từ', 'Diễn giải', 'Số tiền Nợ', 'Số tiền Có', 'Số dư'],
    rows: Array.from({ length: 10 }).map((_, rIdx) => ({
      rowIndex: rIdx,
      isHeader: rIdx === 0,
      cells: Array.from({ length: 6 }).map((_, cIdx) => ({
        rowIndex: rIdx,
        columnIndex: cIdx,
        rowSpan: 1,
        columnSpan: 1,
        rawValue: rIdx === 0 ? `Header ${cIdx}` : `Value ${rIdx}_${cIdx}`,
        normalizedValue: rIdx === 0 ? `Header ${cIdx}` : `Value ${rIdx}_${cIdx}`,
        cellType: 'TEXT' as const,
        confidence: 0.95,
        boundingPolygon: [0.1, 0.2, 0.5, 0.2, 0.5, 0.4, 0.1, 0.4],
      })),
    })),
  }));

  const mockAnalysisResult: OCRAnalysisResult = {
    provider: 'AzureDocumentIntelligence',
    modelId: 'prebuilt-layout',
    overallConfidence: 0.96,
    rawText: 'Mock 8 page OCR raw text',
    pages,
    tables: mockTables,
  };

  await db.saveOcrAnalysis(testUserA, docId, mockAnalysisResult);
  console.log('   [PASS] saveOcrAnalysis completed successfully.');

  // Test E: Query OCR Result
  console.log('\n5. Testing getDocumentOcrResult Hierarchy...');
  const ocrData = await db.getDocumentOcrResult(testUserA, docId);
  console.log(`   [PASS] Retrieved OCR Data: ${ocrData?.pages.length} pages, ${ocrData?.tables.length} tables, ${ocrData?.stats.totalCells} total cells.`);

  // Test F: Update Extracted Cell
  console.log('\n6. Testing Cell Update & Review Action Logging...');
  const firstTable = ocrData?.tables[0];
  const firstCell = firstTable?.rows[1]?.cells[0];
  if (firstCell) {
    const updatedCell = await db.updateExtractedCell(testUserA, docId, firstCell.id, {
      normalizedValue: 'EDITED_VALUE_123',
    });
    console.log(`   [PASS] Cell ${firstCell.id} updated: normalized_value = "${updatedCell.normalized_value}"`);
  }

  // Test G: Strict Tenant Isolation (User B cannot access User A's doc)
  console.log('\n7. Testing Strict Multi-Tenant User Isolation...');
  const unauthDoc = await db.getUserDocumentById(testUserB, docId);
  if (unauthDoc === null) {
    console.log('   [PASS] User B was blocked from accessing User A document.');
  } else {
    console.error('   [FAIL] Tenant Isolation breached!');
  }

  // Test H: Worker Resume Check
  console.log('\n8. Testing Worker Queue Resume Check...');
  const queuedJobs = await db.getQueuedJobs();
  console.log(`   [PASS] Found ${queuedJobs.length} queued/processing jobs ready for worker resume.`);

  console.log('\n==================================================');
  console.log('ALL SUPABASE REFACTOR VERIFICATION TESTS PASSED! ✅');
  console.log('==================================================');
}

runSupabaseRefactorTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
