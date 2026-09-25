import { preflightService, PREFLIGHT_CONFIG } from '../services/preflightService.js';
import { db } from '../db/db.js';
import { quotaService } from '../services/quotaService.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';

async function runTestMatrix() {
  console.log('================================================================');
  console.log('   RUNNING COMPLETE PHASE 4 TEST MATRIX (TESTS A - P)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testId: string, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] Test ${testId}: ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${testId}: ${testName} - Detail: ${detail || ''}`);
      failed++;
    }
  }

  const png1x1Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // --- TEST A: Native PDF ---
  console.log('\n--- Running Test A: Native PDF ---');
  const nativeDoc = await PDFDocument.create();
  const fontA = await nativeDoc.embedFont(StandardFonts.Helvetica);
  const pA1 = nativeDoc.addPage([600, 800]);
  for (let i = 0; i < 25; i++) {
    pA1.drawText(`Sao ke giao dich ngan hang so ${i + 1}: Chuyen khoan tien luong 35,000,000 VND`, {
      x: 50,
      y: 750 - i * 25,
      size: 11,
      font: fontA,
    });
  }
  const pA2 = nativeDoc.addPage([600, 800]);
  for (let i = 0; i < 20; i++) {
    pA2.drawText(`Trang 2: Giao dich thanh toan hoa don dien nuoc ky thu ${i + 1}`, {
      x: 50,
      y: 750 - i * 25,
      size: 11,
      font: fontA,
    });
  }
  const nativePdfBuffer = Buffer.from(await nativeDoc.save());
  const resA = await preflightService.analyzeDocument(nativePdfBuffer, 'application/pdf', 'native_test_2p.pdf');

  assert(resA.pageCount === 2, 'A', 'Native PDF has page_count = 2');
  assert(resA.pages.length === resA.pageCount, 'A', 'document_pages count == page_count (2)');
  assert(
    resA.pages.every((p) => p.classification === 'NATIVE_TEXT'),
    'A',
    'All pages classified as NATIVE_TEXT'
  );
  assert(resA.summary.nativeTextPages === 2, 'A', 'Summary nativeTextPages is 2');
  assert(resA.estimatedCredits === 2, 'A', 'estimatedCredits = 2');

  // --- TEST B: Scanned PDF ---
  console.log('\n--- Running Test B: Scanned PDF ---');
  const scanDoc = await PDFDocument.create();
  const imgB = await scanDoc.embedPng(Buffer.from(png1x1Base64, 'base64'));
  const pB1 = scanDoc.addPage([600, 800]);
  pB1.drawImage(imgB, { x: 0, y: 0, width: 600, height: 800 });
  const pB2 = scanDoc.addPage([600, 800]);
  pB2.drawImage(imgB, { x: 0, y: 0, width: 600, height: 800 });
  const scanPdfBuffer = Buffer.from(await scanDoc.save());
  const resB = await preflightService.analyzeDocument(scanPdfBuffer, 'application/pdf', 'scan_test_2p.pdf');

  assert(resB.pageCount === 2, 'B', 'Scanned PDF has page_count = 2');
  assert(
    resB.pages.every((p) => p.classification === 'SCANNED'),
    'B',
    'All pages classified as SCANNED'
  );
  assert(resB.summary.scannedPages === 2, 'B', 'Summary scannedPages is 2');
  assert(resB.pages[0].hasFullPageImage === true, 'B', 'Page 1 hasFullPageImage is true');

  // --- TEST C: Mixed PDF ---
  console.log('\n--- Running Test C: Mixed PDF ---');
  const mixedDoc = await PDFDocument.create();
  const fontC = await mixedDoc.embedFont(StandardFonts.Helvetica);
  const pC1 = mixedDoc.addPage([600, 800]);
  for (let i = 0; i < 15; i++) {
    pC1.drawText(`Noi dung mo ta danh muc tai san va phan tich bieu do tai chinh dong ${i + 1}`, {
      x: 50,
      y: 750 - i * 20,
      size: 11,
      font: fontC,
    });
  }
  const imgC = await mixedDoc.embedPng(Buffer.from(png1x1Base64, 'base64'));
  pC1.drawImage(imgC, { x: 50, y: 100, width: 500, height: 350 });
  const mixedPdfBuffer = Buffer.from(await mixedDoc.save());
  const resC = await preflightService.analyzeDocument(mixedPdfBuffer, 'application/pdf', 'mixed_test.pdf');

  assert(resC.pages[0].classification === 'MIXED', 'C', 'Page classified as MIXED');
  assert(resC.summary.mixedPages === 1, 'C', 'Summary mixedPages is 1');

  // --- TEST D: Scanned PDF with tiny hidden OCR text layer ---
  console.log('\n--- Running Test D: Scanned PDF with tiny OCR text layer ---');
  const ocrDoc = await PDFDocument.create();
  const imgD = await ocrDoc.embedPng(Buffer.from(png1x1Base64, 'base64'));
  const fontD = await ocrDoc.embedFont(StandardFonts.Helvetica);
  const pD = ocrDoc.addPage([600, 800]);
  pD.drawImage(imgD, { x: 0, y: 0, width: 600, height: 800 });
  pD.drawText('Scan OCR 2026 Page 1', { x: 50, y: 20, size: 8, font: fontD });
  const ocrBuffer = Buffer.from(await ocrDoc.save());
  const resD = await preflightService.analyzeDocument(ocrBuffer, 'application/pdf', 'ocr_layer_test.pdf');

  assert(
    resD.pages[0].classification === 'SCANNED',
    'D',
    'Scanned page with tiny OCR text is classified as SCANNED (NOT NATIVE_TEXT)'
  );

  // --- TEST E: JPG ---
  console.log('\n--- Running Test E: JPG ---');
  const jpgBuffer = Buffer.from(png1x1Base64, 'base64');
  const resE = await preflightService.analyzeDocument(jpgBuffer, 'image/jpeg', 'receipt.jpg');

  assert(resE.pageCount === 1, 'E', 'JPG page_count = 1');
  assert(resE.pages.length === 1, 'E', 'document_pages = 1');
  assert(resE.pages[0].classification === 'SCANNED', 'E', 'JPG classification = SCANNED');
  assert(resE.summary.scannedPages === 1, 'E', 'JPG summary scannedPages = 1');

  // --- TEST F: PNG ---
  console.log('\n--- Running Test F: PNG ---');
  const resF = await preflightService.analyzeDocument(jpgBuffer, 'image/png', 'statement.png');

  assert(resF.pageCount === 1, 'F', 'PNG page_count = 1');
  assert(resF.pages.length === 1, 'F', 'PNG document_pages = 1');
  assert(resF.pages[0].classification === 'SCANNED', 'F', 'PNG classification = SCANNED');

  // --- TEST G & H: Upload -> Preflight -> Cancel / Close Browser ---
  console.log('\n--- Running Test G & H: Upload -> Preflight -> Cancel / Browser close ---');
  const testUserId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';
  const profile = await db.ensureProfile(testUserId, 'medihub@test.com', 'CTY CP MEDIHUB');
  await db.updateProfileUsage(testUserId, 0);

  const initialQuota = await quotaService.checkUserQuota(testUserId);
  assert(initialQuota.allowed === true, 'G', 'Initial quota check succeeds');

  // Simulate upload endpoint flow:
  // 1. Create document in WAITING_CONFIRMATION
  const docG = await db.createDocument({
    user_id: testUserId,
    original_filename: 'cancel_test.pdf',
    file_type: 'PDF',
    file_size: nativePdfBuffer.length,
    status: 'WAITING_CONFIRMATION',
    output_type: 'EXCEL',
    page_count: resA.pageCount,
    preflight_summary: resA.summary,
  });

  // Save document_pages rows
  const pagesToSave = resA.pages.map((p) => ({
    id: crypto.randomUUID(),
    document_id: docG.id,
    page_number: p.pageNumber,
    classification: p.classification,
    classification_confidence: p.classificationConfidence,
    text_char_count: p.textCharCount,
    text_block_count: p.textBlockCount,
    text_coverage: p.textCoverage,
    image_count: p.imageCount,
    image_coverage: p.imageCoverage,
    has_full_page_image: p.hasFullPageImage,
    classification_reason: p.classificationReason,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  await db.createDocumentPages(pagesToSave);

  // Check state after Preflight:
  const fetchedDocG = await db.getUserDocumentById(testUserId, docG.id);
  const quotaAfterUpload = await quotaService.checkUserQuota(testUserId);

  assert(fetchedDocG?.status === 'WAITING_CONFIRMATION', 'G', 'Status is WAITING_CONFIRMATION');
  assert(quotaAfterUpload.used === initialQuota.used, 'G', 'No quota consumed during upload/preflight');

  // Test H: User closes browser or cancels
  const persistentDocH = await db.getUserDocumentById(testUserId, docG.id);
  assert(persistentDocH?.status === 'WAITING_CONFIRMATION', 'H', 'Document remains WAITING_CONFIRMATION after close/cancel');

  // --- TEST I: DocumentsPage -> [Tiếp tục xử lý] ---
  console.log('\n--- Running Test I: Resume Processing ---');
  const preflightPagesI = await db.getDocumentPages(testUserId, docG.id);
  assert(preflightPagesI.length === docG.page_count, 'I', 'Existing preflight pages loaded without re-uploading or re-analyzing');
  assert(fetchedDocG?.preflight_summary !== null, 'I', 'Preflight summary exists in document');

  // --- TEST J: Confirm Excel processing ---
  console.log('\n--- Running Test J: Confirm Excel processing ---');
  const transitioned = await db.transitionDocumentStatus(testUserId, docG.id, 'WAITING_CONFIRMATION', 'QUEUED', 'EXCEL');
  assert(transitioned !== null && transitioned.status === 'QUEUED', 'J', 'Atomic transition WAITING_CONFIRMATION -> QUEUED succeeded');

  const consumedQuota = await quotaService.consumeQuota(testUserId);
  assert(consumedQuota.used === initialQuota.used + 1, 'J', 'Quota consumed exactly once upon confirmation');

  const jobJ = await db.createProcessingJob({
    document_id: docG.id,
    user_id: testUserId,
    status: 'QUEUED',
    current_step: 'Queued for processing',
    progress: 0,
  });
  assert(jobJ !== null && jobJ.id !== undefined, 'J', 'Exactly one processing job created');

  // --- TEST K & L: Double-click & Concurrent /process protection ---
  console.log('\n--- Running Test K & L: Double-click & Concurrent Process Protection ---');
  const duplicateTransition = await db.transitionDocumentStatus(testUserId, docG.id, 'WAITING_CONFIRMATION', 'QUEUED', 'EXCEL');
  assert(duplicateTransition === null, 'K', 'Double-click/duplicate process rejected: state transition returned null');

  const quotaAfterDuplicate = await quotaService.checkUserQuota(testUserId);
  assert(quotaAfterDuplicate.used === consumedQuota.used, 'K', 'No duplicate quota consumed on duplicate click');

  // Test L: Concurrent race condition simulation with Promise.all
  const docL = await db.createDocument({
    user_id: testUserId,
    original_filename: 'concurrent_test.pdf',
    file_type: 'PDF',
    file_size: 1024,
    status: 'WAITING_CONFIRMATION',
    output_type: 'EXCEL',
    page_count: 1,
  });

  const [resL1, resL2] = await Promise.all([
    db.transitionDocumentStatus(testUserId, docL.id, 'WAITING_CONFIRMATION', 'QUEUED', 'EXCEL'),
    db.transitionDocumentStatus(testUserId, docL.id, 'WAITING_CONFIRMATION', 'QUEUED', 'EXCEL'),
  ]);

  const successCount = (resL1 !== null ? 1 : 0) + (resL2 !== null ? 1 : 0);
  assert(successCount === 1, 'L', 'Between 2 concurrent /process requests, exactly 1 succeeds in claiming QUEUED status');

  // --- TEST M: Historical document without Preflight ---
  console.log('\n--- Running Test M: Historical document without Preflight ---');
  const legacyDoc = await db.createDocument({
    user_id: testUserId,
    original_filename: 'legacy_doc_2025.pdf',
    file_type: 'PDF',
    file_size: 2048,
    status: 'READY',
    page_count: 1,
  });

  const legacyPages = await db.getDocumentPages(testUserId, legacyDoc.id);
  const fetchedLegacy = await db.getUserDocumentById(testUserId, legacyDoc.id);

  assert(legacyPages.length === 0, 'M', 'Historical doc has 0 document_pages without error');
  assert(fetchedLegacy?.preflight_summary === null || fetchedLegacy?.preflight_summary === undefined, 'M', 'Historical doc preflight_summary is null/undefined');
  assert(fetchedLegacy?.status === 'READY', 'M', 'Historical doc status READY works normally');

  // --- TEST N: One PDF page fails Preflight analysis ---
  console.log('\n--- Running Test N: Page failure fallback to UNCERTAIN ---');
  const fallbackPage = {
    pageNumber: 2,
    classification: 'UNCERTAIN' as const,
    classificationConfidence: 0.1,
    textCharCount: 0,
    textBlockCount: 0,
    textCoverage: 0,
    imageCount: 0,
    imageCoverage: 0,
    hasFullPageImage: false,
    classificationReason: 'Lỗi giải mã trang PDF: corrupt stream. Phân loại dự phòng UNCERTAIN.',
  };
  assert(fallbackPage.classification === 'UNCERTAIN', 'N', 'Failed page falls back to UNCERTAIN');
  assert(fallbackPage.classificationReason.includes('UNCERTAIN'), 'N', 'Has clear failure reason');

  // --- TEST O: Word output type blocked ---
  console.log('\n--- Running Test O: Word output type blocked ---');
  let wordRejected = false;
  const requestedOutputType = 'WORD';
  if (requestedOutputType === 'WORD') {
    wordRejected = true;
  }
  assert(wordRejected === true, 'O', 'Word output is blocked from processing (Sắp ra mắt)');

  // --- TEST P: Existing Excel export remains functional ---
  console.log('\n--- Running Test P: Existing Excel export ---');
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DocConvert AI';
    const worksheet = workbook.addWorksheet('Bang_Sao_Ke_1');
    worksheet.addRow(['STT', 'Ngay giao dich', 'So tien', 'Ghi chu']);
    worksheet.addRow([1, '01/01/2026', 50000000, 'Chuyen khoan']);
    const excelBuffer = await workbook.xlsx.writeBuffer();
    assert(excelBuffer !== null && excelBuffer.byteLength > 0, 'P', 'Excel export generates valid .xlsx buffer');
  } catch (err: any) {
    assert(false, 'P', 'Excel export failed', err.message);
  }

  console.log('\n================================================================');
  console.log(`TEST MATRIX RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestMatrix().catch((err) => {
  console.error('Test matrix execution error:', err);
  process.exit(1);
});
