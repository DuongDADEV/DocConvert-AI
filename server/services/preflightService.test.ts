import { preflightService, PREFLIGHT_CONFIG } from './preflightService.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function runTests() {
  console.log('=== RUNNING PREFLIGHT SERVICE UNIT & INTEGRATION TESTS ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} - ${detail || ''}`);
      failed++;
    }
  }

  // 1. TEST NATIVE PDF
  console.log('\n--- 1. Testing Native Text PDF ---');
  const nativeDoc = await PDFDocument.create();
  const font = await nativeDoc.embedFont(StandardFonts.Helvetica);
  const page1 = nativeDoc.addPage([600, 800]);
  for (let i = 0; i < 30; i++) {
    page1.drawText(`Dong sao ke tai chinh ngan hang thu ${i + 1} voi noi dung giao dich chuyen khoan hop le 50,000,000 VND.`, {
      x: 50,
      y: 750 - i * 22,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  const nativeBuffer = Buffer.from(await nativeDoc.save());
  const nativeResult = await preflightService.analyzeDocument(nativeBuffer, 'application/pdf', 'native_test.pdf');

  assert(nativeResult.pageCount === 1, 'Native PDF pageCount is 1');
  assert(nativeResult.pages[0].classification === 'NATIVE_TEXT', 'Page 1 classified as NATIVE_TEXT', `Got: ${nativeResult.pages[0].classification}`);
  assert(nativeResult.summary.nativeTextPages === 1, 'Summary nativeTextPages is 1');
  assert(nativeResult.pages[0].textCoverage > 0.1, 'Text coverage > 10%');
  assert(nativeResult.pages[0].imageCoverage === 0, 'Image coverage is 0');
  assert(nativeResult.estimatedCredits === 1, 'Estimated credits is 1');

  // 2. TEST FULL SCANNED PDF
  console.log('\n--- 2. Testing Scanned PDF ---');
  const scannedDoc = await PDFDocument.create();
  const png1x1Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const pngImg = await scannedDoc.embedPng(Buffer.from(png1x1Base64, 'base64'));
  const page2 = scannedDoc.addPage([600, 800]);
  page2.drawImage(pngImg, { x: 0, y: 0, width: 600, height: 800 });
  const scannedBuffer = Buffer.from(await scannedDoc.save());
  const scannedResult = await preflightService.analyzeDocument(scannedBuffer, 'application/pdf', 'scan_test.pdf');

  assert(scannedResult.pageCount === 1, 'Scanned PDF pageCount is 1');
  assert(scannedResult.pages[0].classification === 'SCANNED', 'Page 1 classified as SCANNED', `Got: ${scannedResult.pages[0].classification}`);
  assert(scannedResult.summary.scannedPages === 1, 'Summary scannedPages is 1');
  assert(scannedResult.pages[0].hasFullPageImage === true, 'hasFullPageImage is true');
  assert(scannedResult.pages[0].imageCoverage > 0.8, 'Image coverage > 80%');

  // 3. TEST MIXED PDF
  console.log('\n--- 3. Testing Mixed PDF ---');
  const mixedDoc = await PDFDocument.create();
  const font3 = await mixedDoc.embedFont(StandardFonts.Helvetica);
  const page3 = mixedDoc.addPage([600, 800]);
  for (let i = 0; i < 18; i++) {
    page3.drawText(`Noi dung mo ta danh muc tai san va phan tich bieu do tai chinh so ${i + 1} voi cac thong so chi tiet.`, {
      x: 50,
      y: 750 - i * 20,
      size: 11,
      font: font3,
    });
  }
  const imgMixed = await mixedDoc.embedPng(Buffer.from(png1x1Base64, 'base64'));
  page3.drawImage(imgMixed, { x: 50, y: 100, width: 500, height: 320 });
  const mixedBuffer = Buffer.from(await mixedDoc.save());
  const mixedResult = await preflightService.analyzeDocument(mixedBuffer, 'application/pdf', 'mixed_test.pdf');

  assert(mixedResult.pageCount === 1, 'Mixed PDF pageCount is 1');
  assert(mixedResult.pages[0].classification === 'MIXED', 'Page 1 classified as MIXED', `Got: ${mixedResult.pages[0].classification}`);
  assert(mixedResult.summary.mixedPages === 1, 'Summary mixedPages is 1');

  // 4. TEST SCANNED PDF WITH TINY OCR LAYER
  console.log('\n--- 4. Testing Scanned PDF with Tiny OCR Layer ---');
  const ocrLayerDoc = await PDFDocument.create();
  const img4 = await ocrLayerDoc.embedPng(Buffer.from(png1x1Base64, 'base64'));
  const font4 = await ocrLayerDoc.embedFont(StandardFonts.Helvetica);
  const page4 = ocrLayerDoc.addPage([600, 800]);
  page4.drawImage(img4, { x: 0, y: 0, width: 600, height: 800 });
  page4.drawText('Scan OCR 2026 Page 1', { x: 50, y: 20, size: 8, font: font4 }); // tiny footer OCR text
  const ocrLayerBuffer = Buffer.from(await ocrLayerDoc.save());
  const ocrLayerResult = await preflightService.analyzeDocument(ocrLayerBuffer, 'application/pdf', 'ocr_layer_test.pdf');

  assert(
    ocrLayerResult.pages[0].classification === 'SCANNED',
    'Scanned page with tiny OCR layer must NOT be classified as NATIVE_TEXT',
    `Got: ${ocrLayerResult.pages[0].classification}`
  );

  // 5. TEST DIRECT IMAGE INPUT (.JPG / .PNG)
  console.log('\n--- 5. Testing Image Input ---');
  const imgBuffer = Buffer.from(png1x1Base64, 'base64');
  const imgResult = await preflightService.analyzeDocument(imgBuffer, 'image/png', 'statement_photo.png');

  assert(imgResult.pageCount === 1, 'Image pageCount is 1');
  assert(imgResult.pages[0].classification === 'SCANNED', 'Image classified as SCANNED');
  assert(imgResult.summary.scannedPages === 1, 'Summary scannedPages is 1');
  assert(imgResult.estimatedCredits === 1, 'Estimated credits is 1');

  // 6. TEST CORRUPTED / INVALID PDF
  console.log('\n--- 6. Testing Corrupted / Invalid PDF ---');
  const corruptedBuffer = Buffer.from('NOT_A_VALID_PDF_CORRUPTED_STREAM');
  let threwExpectedError = false;
  try {
    await preflightService.analyzeDocument(corruptedBuffer, 'application/pdf', 'corrupted.pdf');
  } catch (err: any) {
    threwExpectedError = true;
    console.log(`Expected error caught safely: ${err.message}`);
  }
  assert(threwExpectedError, 'Corrupted PDF throws user-facing error safely');

  console.log(`\n======================================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
