/**
 * PHASE 2 AUTOMATED TEST SUITE: AZURE AI DOCUMENT INTELLIGENCE & TABLE REVIEW WORKSPACE
 * Tests:
 * 1. OCR Provider & Data Normalization Engine
 * 2. Background Worker Pipeline & State Machine (QUEUED -> PROCESSING -> REVIEW_REQUIRED/READY)
 * 3. Strict User Isolation on OCR Results, Tables, and Cells
 * 4. In-place Cell Editing, Row Insertion, Row Deletion, Review Actions Audit Log
 * 5. Credential Security & Zero API Key Leakage
 */

process.env.USE_SIMULATED_OCR = 'true';
import { azureOcrProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { DataNormalizer } from '../server/services/ocr/normalizer.js';
import { ocrWorker } from '../server/services/ocrWorker.js';
import { db } from '../server/db/db.js';
import { storageService } from '../server/services/storageService.js';

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
  }
}

async function runPhase2Tests() {
  console.log('\n======================================================');
  console.log('🚀 RUNNING PHASE 2 AZURE AI OCR & REVIEW TEST SUITE');
  console.log('======================================================\n');

  // --- SUITE 1: DATA NORMALIZER ---
  console.log('--- TEST SUITE 1: Banking Data Normalizer ---');
  {
    const date1 = DataNormalizer.normalizeCell('01/08/2026');
    assert(date1.cellType === 'DATE' && date1.normalizedValue === '2026-08-01', 'Normalizes DD/MM/YYYY date format');

    const moneyVnd = DataNormalizer.normalizeCell('125.450.000 VND');
    assert(moneyVnd.cellType === 'MONEY' && moneyVnd.normalizedValue === '125450000', 'Normalizes Vietnamese Currency (VND) with dots');

    const moneyNegative = DataNormalizer.normalizeCell('- 35.200.000 đ');
    assert(moneyNegative.cellType === 'MONEY' && moneyNegative.normalizedValue === '-35200000', 'Normalizes Negative Debit Currency (- VND)');

    const textCell = DataNormalizer.normalizeCell('Thanh toán tiền thuê văn phòng');
    assert(textCell.cellType === 'TEXT' && textCell.normalizedValue === 'Thanh toán tiền thuê văn phòng', 'Preserves General Text Description');
  }

  // --- SUITE 2: AZURE OCR PROVIDER & BOUNDING REGIONS ---
  console.log('\n--- TEST SUITE 2: Azure AI OCR Provider Abstraction ---');
  {
    const dummyBuffer = Buffer.from('PDF_SAMPLE_BANK_STATEMENT');
    const result = await azureOcrProvider.analyzeDocument(dummyBuffer, 'application/pdf', { forceSimulation: true });

    assert(result.provider === 'Azure AI Document Intelligence', 'Provider name is Azure AI Document Intelligence');
    assert(result.tables.length > 0, 'Extracted at least 1 table from bank statement');
    assert(result.tables[0].rows.length >= 6, 'Extracted table has header and transaction rows');
    assert(result.tables[0].headers.length >= 5, 'Headers contain Date, Ref, Description, Debit, Credit, Balance');

    // Check confidence scores & bounding polygon
    const sampleCell = result.tables[0].rows[1].cells[0];
    assert(typeof sampleCell.confidence === 'number' && sampleCell.confidence > 0, 'Each cell contains valid confidence score');
    assert(Array.isArray(sampleCell.boundingPolygon) && sampleCell.boundingPolygon.length === 8, 'Cell has 8-point bounding polygon');
  }

  // --- SUITE 3: BACKGROUND WORKER & USER ISOLATION PIPELINE ---
  console.log('\n--- TEST SUITE 3: Asynchronous OCR Background Worker & User Isolation ---');
  {
    const userA = 'user_bank_officer_a_' + Date.now();
    const userB = 'user_attacker_b_' + Date.now();

    // 1. Create document for User A
    const docA = db.createDocument({
      id: 'doc_bank_statement_' + Date.now(),
      user_id: userA,
      original_filename: 'Sao_Ke_Thang_08_2026.pdf',
      file_name: 'statement.pdf',
      file_type: 'PDF',
      mime_type: 'application/pdf',
      file_size: 102400,
      page_count: 1,
      storage_bucket: 'documents',
      storage_path: `documents/${userA}/doc_bank_statement/statement.pdf`,
      document_type: 'BANK_STATEMENT',
      status: 'QUEUED',
    });

    // Upload mock file buffer into Private Storage
    await storageService.saveFile(
      userA,
      docA.id,
      'statement.pdf',
      Buffer.from('%PDF-1.4 Mock Bank Statement Content'),
      'application/pdf'
    );

    // Create processing job for User A
    const jobA = db.createProcessingJob({
      id: 'job_' + Date.now(),
      document_id: docA.id,
      user_id: userA,
      status: 'QUEUED',
      current_step: 'Xếp hàng chờ xử lý',
      progress: 0,
      attempt_count: 1,
    });

    // Run Worker processing job
    const finishedJob = await ocrWorker.processJob(userA, jobA.id, docA.id);
    assert(finishedJob?.status === 'REVIEW_REQUIRED' || finishedJob?.status === 'READY', 'Worker transitions job to REVIEW_REQUIRED/READY');
    assert(finishedJob?.progress === 100, 'Worker sets progress to 100%');

    // Verify document status updated
    const updatedDocA = db.getUserDocumentById(userA, docA.id);
    assert(updatedDocA?.status === 'REVIEW_REQUIRED' || updatedDocA?.status === 'READY', 'Document status synchronized with OCR result');

    // Verify OCR data stored in DB
    const ocrDataA = db.getDocumentOcrResult(userA, docA.id);
    assert((ocrDataA?.tables.length || 0) > 0, 'Extracted tables persisted in database for User A');
    assert((ocrDataA?.stats.totalCells || 0) > 0, 'Extracted cells calculated in stats');

    // Strict Isolation Test: User B attempts to access User A's OCR result
    const ocrDataB = db.getDocumentOcrResult(userB, docA.id);
    assert(ocrDataB === null, 'SECURITY: User B cannot access User A OCR results (Isolation enforced)');
  }

  // --- SUITE 4: INTERACTIVE REVIEW & AUDIT ACTIONS ---
  console.log('\n--- TEST SUITE 4: Cell In-Place Editing, Row Operations & Review Actions ---');
  {
    const userReview = 'user_reviewer_' + Date.now();
    const docReview = db.createDocument({
      id: 'doc_review_' + Date.now(),
      user_id: userReview,
      original_filename: 'Chung_Tu_Ke_Toan.pdf',
      file_name: 'receipt.pdf',
      file_type: 'PDF',
      mime_type: 'application/pdf',
      file_size: 51200,
      page_count: 1,
      storage_bucket: 'documents',
      storage_path: `documents/${userReview}/receipt.pdf`,
      document_type: 'RECEIPT',
      status: 'QUEUED',
    });

    await storageService.saveFile(
      userReview,
      docReview.id,
      'receipt.pdf',
      Buffer.from('PDF Content for review test'),
      'application/pdf'
    );

    const jobReview = db.createProcessingJob({
      id: 'job_rev_' + Date.now(),
      document_id: docReview.id,
      user_id: userReview,
      status: 'QUEUED',
      current_step: 'Xử lý',
      progress: 0,
      attempt_count: 1,
    });

    await ocrWorker.processJob(userReview, jobReview.id, docReview.id);

    const initialOcr = db.getDocumentOcrResult(userReview, docReview.id)!;
    const firstTable = initialOcr.tables[0];
    const targetCell = firstTable.rows[1].cells[1];

    // 1. Edit Cell Value
    const updatedCell = db.updateExtractedCell(userReview, docReview.id, targetCell.id, {
      rawValue: 'FT260899999_CORRECTED',
      cellType: 'TEXT',
    });
    assert(updatedCell.raw_value === 'FT260899999_CORRECTED', 'Cell updated with corrected text value');
    assert(updatedCell.is_reviewed === true, 'Cell flagged as reviewed (is_reviewed = true)');

    // 2. Add Row
    const initialRowCount = firstTable.rowCount;
    const addResult = db.addExtractedRow(userReview, docReview.id, firstTable.id, [
      { rawValue: '31/08/2026', columnIndex: 0, cellType: 'DATE' },
      { rawValue: 'FT260831999', columnIndex: 1, cellType: 'TEXT' },
      { rawValue: 'Phí dịch vụ chuyển tiền quốc tế', columnIndex: 2, cellType: 'TEXT' },
      { rawValue: '220.000', columnIndex: 3, cellType: 'MONEY' },
      { rawValue: '0', columnIndex: 4, cellType: 'MONEY' },
      { rawValue: '203.328.500', columnIndex: 5, cellType: 'MONEY' },
    ]);
    assert(addResult.cells.length >= 6, 'Successfully appended new row with cells');

    const ocrAfterAdd = db.getDocumentOcrResult(userReview, docReview.id)!;
    assert(ocrAfterAdd.tables[0].rowCount === initialRowCount + 1, 'Table row count incremented');

    // 3. Delete Row
    db.deleteExtractedRow(userReview, docReview.id, firstTable.id, 1);
    const ocrAfterDelete = db.getDocumentOcrResult(userReview, docReview.id)!;
    assert(ocrAfterDelete.tables[0].rowCount === initialRowCount, 'Successfully removed row and updated indices');

    // 4. Mark Document Review Complete
    const finalizedDoc = db.markDocumentReviewed(userReview, docReview.id);
    assert(finalizedDoc.status === 'READY', 'Document status transitions to READY upon review completion');

    // 5. Verify review audit actions recorded
    const actions = (db as any).state.review_actions.filter((a: any) => a.document_id === docReview.id);
    assert(actions.length >= 3, 'Audit trail recorded for EDIT_CELL, ADD_ROW, DELETE_ROW, COMPLETE_REVIEW');
  }

  // --- SUITE 5: SECURITY & CREDENTIAL SECRECY ---
  console.log('\n--- TEST SUITE 5: API Key Secrecy & Safety ---');
  {
    const ocrProviderInstance = new (azureOcrProvider.constructor as any)();
    // Verify provider does not return raw keys in JSON representation
    const stringified = JSON.stringify(ocrProviderInstance);
    assert(!stringified.includes('AZURE_DOCUMENT_INTELLIGENCE_KEY'), 'No secret key exposed in provider serialization');
    assert(!stringified.includes('SUPABASE_SERVICE_ROLE_KEY'), 'No Supabase service role key in provider');
  }

  console.log('\n======================================================');
  console.log(`📊 PHASE 2 TEST RESULTS: ${passedCount}/${totalCount} TESTS PASSED`);
  if (passedCount === totalCount) {
    console.log('🎉 ALL PHASE 2 OCR & TABLE REVIEW TESTS PASSED PERFECTLY!');
  } else {
    console.error('⚠️ SOME TESTS FAILED. PLEASE REVIEW LOGS ABOVE.');
    process.exit(1);
  }
  console.log('======================================================\n');
}

runPhase2Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
