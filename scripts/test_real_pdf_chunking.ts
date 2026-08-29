import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { azureOcrProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { db } from '../server/db/db.js';
import { excelExportEngine } from '../server/services/excelExportEngine.js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function testRealPdfChunking() {
  console.log('==================================================');
  console.log('TESTING REAL 8-PAGE PDF BANK STATEMENT CHUNKING');
  console.log('==================================================\n');

  const supabase = createClient(url, key);
  const userId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';
  const docId = 'b55bb467-20ae-4939-b1c8-c28e0895854b';

  const { data: downloadData, error: downloadErr } = await supabase.storage
    .from('documents')
    .download(`${userId}/${docId}/original/sao-k__-acb-Medihub-2023.pdf`);

  if (!downloadData) {
    console.error('Failed to download real PDF:', downloadErr);
    return;
  }

  const buffer = Buffer.from(await downloadData.arrayBuffer());
  console.log('Downloaded real 8-page PDF buffer size:', buffer.length, 'bytes');

  console.log('Calling azureOcrProvider.analyzeDocument with 8-page PDF...');
  const result = await azureOcrProvider.analyzeDocument(buffer, 'application/pdf');

  console.log('\n--- MERGED OCR RESULT METRICS ---');
  console.log('Provider:', result.provider);
  console.log('ModelId:', result.modelId);
  console.log('Total Pages Count:', result.pages.length);
  console.log('Pages Numbers List:', result.pages.map((p) => p.pageNumber).join(', '));
  console.log('Total Tables Count:', result.tables.length);
  console.log('Table Page Numbers List:', result.tables.map((t) => t.pageNumber).join(', '));
  console.log('Table Indices List:', result.tables.map((t) => t.tableIndex).join(', '));
  console.log('Metadata:', result.metadata);

  console.assert(result.pages.length === 8, 'FAIL: Result should contain all 8 pages!');
  console.assert(result.tables.length >= 4, 'FAIL: Result should contain tables from all chunks!');

  // Save to DB and test DB persistence
  console.log('\nSaving merged OCR result to Database for document', docId);
  db.saveOcrAnalysis(userId, docId, result);

  const dbOcr = db.getDocumentOcrResult(userId, docId);
  console.log('DB Stored Pages Count:', dbOcr?.pages.length);
  console.log('DB Stored Document page_count:', dbOcr?.document.page_count);
  console.log('DB Stored Tables Count:', dbOcr?.tables.length);

  console.assert(dbOcr?.pages.length === 8, 'FAIL: DB should store 8 pages!');
  console.assert(dbOcr?.document.page_count === 8, 'FAIL: document.page_count in DB should be 8!');

  // Test Exporting Excel with full 8 pages data
  console.log('\nGenerating Excel Export for document', docId);
  const exportResult = await excelExportEngine.exportDocumentToExcel(userId, docId, {
    mode: 'NORMALIZED',
    includeReviewLog: true,
  });

  console.log('Excel Export File Name:', exportResult.fileName);
  console.log('Excel Export File Size:', exportResult.fileSize, 'bytes');
  console.log('Excel Export Tables Count:', exportResult.tablesCount);
  console.log('Excel Export Total Rows:', exportResult.totalRows);
  console.log('Excel Export Total Cells:', exportResult.totalCells);

  console.assert(exportResult.fileSize > 0, 'FAIL: Export file size must be > 0');
  console.assert(exportResult.tablesCount === result.tables.length, 'FAIL: Export tables count mismatch');

  console.log('\n==================================================');
  console.log('REAL 8-PAGE PDF BANK STATEMENT OCR CHUNKING PASSED! ✅');
  console.log('==================================================');
}

testRealPdfChunking().catch((err) => {
  console.error('REAL PDF TEST ERROR:', err);
  process.exit(1);
});
