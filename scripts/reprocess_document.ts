import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { azureOcrProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { db } from '../server/db/db.js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function reprocessDoc() {
  console.log('Reprocessing document b55bb467-20ae-4939-b1c8-c28e0895854b with 8-page PDF chunking...');
  const supabase = createClient(url, key);
  const userId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';
  const docId = 'b55bb467-20ae-4939-b1c8-c28e0895854b';

  const { data: downloadData, error: downloadErr } = await supabase.storage
    .from('documents')
    .download(`${userId}/${docId}/original/sao-k__-acb-Medihub-2023.pdf`);

  if (!downloadData) {
    console.error('Failed to download PDF:', downloadErr);
    return;
  }

  const buffer = Buffer.from(await downloadData.arrayBuffer());
  console.log('File size:', buffer.length, 'bytes');

  const result = await azureOcrProvider.analyzeDocument(buffer, 'application/pdf');
  console.log(`OCR Analysis complete! Total pages: ${result.pages.length}, Total tables: ${result.tables.length}`);

  db.saveOcrAnalysis(userId, docId, result);
  db.updateDocumentPageCount(userId, docId, result.pages.length);
  db.updateDocumentStatus(userId, docId, 'READY');

  console.log('Successfully updated .data/database.json with all 8 pages!');
}

reprocessDoc().catch((err) => {
  console.error('Error reprocessing doc:', err);
  process.exit(1);
});
