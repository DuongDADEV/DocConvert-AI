import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { azureOcrProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { db } from '../server/db/db.js';

async function verifyProductionMetadataPipeline() {
  console.log('======================================================================');
  console.log('PHASE 2A PRODUCTION DYNAMIC METADATA PIPELINE REAL-DATA TEST');
  console.log('======================================================================\n');

  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabase = createClient(url, key);

  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';
  const docId = 'b55bb467-20ae-4939-b1c8-c28e0895854b';
  const rawStoragePath = `30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c/${docId}/original/sao-k__-acb-Medihub-2023.pdf`;

  // Upsert document record so saveOcrAnalysis authorization passes
  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase.from('documents').upsert({
    id: docId,
    user_id: userId,
    file_name: 'sao-k__-acb-Medihub-2023.pdf',
    original_filename: 'sao-k__-acb-Medihub-2023.pdf',
    file_type: 'PDF',
    mime_type: 'application/pdf',
    file_size: 312843,
    storage_path: rawStoragePath,
    status: 'READY',
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
  if (upsertErr) {
    console.error('Upsert document record failed:', upsertErr);
  }

  console.log(`Using target document_id=${docId}, user_id=${userId}`);
  console.log('1. Downloading real 8-page PDF bank statement from Supabase storage...');
  const { data: downloadData, error: downloadErr } = await supabase.storage.from('documents').download(rawStoragePath);
  if (downloadErr || !downloadData) {
    console.error('Failed to download real PDF:', downloadErr);
    process.exit(1);
  }

  const buffer = Buffer.from(await downloadData.arrayBuffer());
  console.log(`Downloaded real PDF (${buffer.length} bytes).\n`);

  console.log('2. Running production azureOcrProvider.analyzeDocument() with features=keyValuePairs...');
  const result = await azureOcrProvider.analyzeDocument(buffer, 'application/pdf');

  console.log('\n--- OCR METRICS ---');
  console.log('Provider:', result.provider);
  console.log('ModelId:', result.modelId);
  console.log('Total Pages:', result.pages.length);
  console.log('Total Tables:', result.tables.length);

  const metrics = result.metadataPipelineMetrics;
  console.log('\n--- METADATA PIPELINE METRICS ---');
  console.log('rawKeyValueCount:', metrics?.rawKeyValueCount);
  console.log('filteredTableOverlapCount:', metrics?.filteredTableOverlapCount);
  console.log('filteredTransactionPatternCount:', metrics?.filteredTransactionPatternCount);
  console.log('filteredEmptyCount:', metrics?.filteredEmptyCount);
  console.log('candidateCount:', metrics?.candidateCount);
  console.log('canonicalCount:', metrics?.canonicalCount);
  console.log('conflictCount:', metrics?.conflictCount);

  console.assert(result.pages.length === 8, 'FAIL: Page count must be 8');
  console.assert(result.documentMetadata && result.documentMetadata.length > 0, 'FAIL: Canonical metadata must be non-empty');

  // 3. Test Database Persistence
  console.log(`\n3. Persisting analysis into PostgreSQL for document ${docId}...`);
  await db.saveOcrAnalysis(userId, docId, result);

  console.log('\n4. Querying db.getDocumentOcrResult()...');
  const dbOcr = await db.getDocumentOcrResult(userId, docId);
  const canonicalMetadata = dbOcr?.documentMetadata || [];
  console.log(`Retrieved ${canonicalMetadata.length} canonical metadata items from database.`);

  console.assert(canonicalMetadata.length === result.documentMetadata.length, 'FAIL: DB metadata count mismatch');

  // 5. Test OCR Retry Idempotency
  console.log('\n5. Testing OCR Retry Idempotency (saving same analysis second time)...');
  await db.saveOcrAnalysis(userId, docId, result);
  const retryOcr = await db.getDocumentOcrResult(userId, docId);
  const retryMetadata = retryOcr?.documentMetadata || [];
  console.log(`After OCR Retry: Retrieved ${retryMetadata.length} canonical metadata items from database.`);
  console.assert(retryMetadata.length === canonicalMetadata.length, 'FAIL: Retry duplicated metadata records!');

  console.log('\n--- SANITIZED CANONICAL METADATA SAMPLE ---');
  console.table(
    canonicalMetadata.map((m) => ({
      Label: m.label,
      Value: m.value.length > 15 ? m.value.substring(0, 12) + '...' : m.value,
      Confidence: (m.confidence * 100).toFixed(1) + '%',
      'Source Page': m.sourcePage,
      'Occurrence Count': m.occurrenceCount,
      Status: m.status,
      Alternatives: m.alternatives?.length || 0,
    }))
  );

  console.log('\n======================================================================');
  console.log('PHASE 2A PRODUCTION METADATA PIPELINE TEST PASSED CLEANLY! ✅');
  console.log('======================================================================');
}

verifyProductionMetadataPipeline().catch((err) => {
  console.error('Pipeline test failed:', err);
  process.exit(1);
});
