import 'dotenv/config';
import { db } from '../server/db/db.js';
import { storageService } from '../server/services/storageService.js';
import { AzureDocumentIntelligenceProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';
  const histHdDocId = '93c5f47f-659f-4e5f-be03-fd0ad073ab88';
  
  console.log('Downloading HDBank PDF from storage...');
  const hdFileData = await storageService.getFile(userId, histHdDocId);
  if (!hdFileData || !hdFileData.buffer) {
    throw new Error('Failed to download HDBank PDF');
  }

  // Check if a fresh HDBank document already exists
  const { data: existing } = await supabase.from('documents').select('id, original_filename').eq('original_filename', 'fresh-hdbank-test.pdf');
  let freshDocId: string;
  if (existing && existing.length > 0) {
    freshDocId = existing[0].id;
    console.log(`Found existing fresh HDBank test doc: ${freshDocId}`);
  } else {
    freshDocId = crypto.randomUUID();
    console.log(`Creating fresh HDBank doc: ${freshDocId}`);
    await supabase.from('documents').insert({
      id: freshDocId,
      user_id: userId,
      original_filename: 'fresh-hdbank-test.pdf',
      file_name: 'fresh-hdbank-test.pdf',
      file_type: 'PDF',
      file_size: hdFileData.buffer.length,
      mime_type: 'application/pdf',
      storage_path: `documents/test/${freshDocId}.pdf`,
      status: 'PROCESSING',
    });

    const provider = new AzureDocumentIntelligenceProvider();
    console.log('Analyzing HDBank with Azure AI Document Intelligence...');
    const analysis = await provider.analyzeDocument(hdFileData.buffer, 'application/pdf', { modelId: 'prebuilt-layout' });
    console.log('Saving OCR analysis to DB...');
    await db.saveOcrAnalysis(userId, freshDocId, analysis);
    await supabase.from('documents').update({ status: 'REVIEW_REQUIRED' }).eq('id', freshDocId);
  }

  const ocrData = await db.getDocumentOcrResult(userId, freshDocId);
  const unified = UnifiedTableService.projectDocumentTables(freshDocId, ocrData.tables);
  if (!unified) throw new Error('Unified projection failed');

  let total = 0;
  let pass = 0;
  let warn = 0;
  let crit = 0;
  const warningCells: any[] = [];

  for (const r of unified.rows) {
    for (const c of r.cells) {
      if (c.isPlaceholder) continue;
      total++;
      const sev = c.qualityAssessment?.severity;
      if (sev === 'CRITICAL') {
        crit++;
      } else if (sev === 'WARNING') {
        warn++;
        warningCells.push({ row: r.displayRowIndex, page: r.sourcePage, cell: c });
      } else {
        pass++;
      }
    }
  }

  console.log(`\nFresh HDBank Statistics:`);
  console.log(`  Total: ${total}`);
  console.log(`  PASS: ${pass}`);
  console.log(`  WARNING: ${warn}`);
  console.log(`  CRITICAL: ${crit}`);
  console.log(`\nWarning Cells Detail:`);
  for (const w of warningCells) {
    const conf = typeof w.cell.confidence === 'number' ? `${(w.cell.confidence * 100).toFixed(1)}%` : 'N/A';
    console.log(`  Row ${w.row} (P${w.page}), Col ${w.cell.canonicalColumnIndex}: "${w.cell.rawValue}" | Conf: ${conf} | Reasons:`, w.cell.qualityAssessment?.reasons);
  }
}

main().catch(console.error);
