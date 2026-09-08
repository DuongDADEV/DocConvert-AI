import 'dotenv/config';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { azureOcrProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { db } from '../server/db/db.js';

interface RegressionDocSpec {
  name: string;
  storagePath?: string;
  cachedAzureJson?: string;
  userId: string;
  docId: string;
  fileName: string;
}

async function runRegressionSuite() {
  console.log('========================================================================================');
  console.log('PHASE 2A.1 — REAL PDF MULTI-BANK REGRESSION SUITE (HDBank, ACB Medihub, Nam A / AMABANK)');
  console.log('========================================================================================\n');

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  const testDocs: RegressionDocSpec[] = [
    {
      name: 'HDBank (2 pages)',
      cachedAzureJson: 'scratch/hdbank_raw_azure.json',
      storagePath: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c/80636c44-d41c-4a62-a502-a198d9d4fde3/original/sao-k__-HD-CH___-LAN.pdf',
      userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c',
      docId: '80636c44-d41c-4a62-a502-a198d9d4fde3',
      fileName: 'sao-ke-hdbank.pdf',
    },
    {
      name: 'ACB Medihub (8 pages)',
      cachedAzureJson: 'scratch/acb_raw_azure.json',
      storagePath: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c/b55bb467-20ae-4939-b1c8-c28e0895854b/original/sao-k__-acb-Medihub-2023.pdf',
      userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c',
      docId: 'b55bb467-20ae-4939-b1c8-c28e0895854b',
      fileName: 'sao-ke-acb-medihub-2023.pdf',
    },
    {
      name: 'Nam A Bank / AMABANK (4 pages)',
      cachedAzureJson: 'scratch/nama_raw_azure.json',
      storagePath: '27a10269-da23-4bfd-aa19-5ed66b974eff/82537093-4f56-4328-962d-de5237e7a9eb/original/sao-k__-NAM-__-CH___-LAN.pdf',
      userId: '27a10269-da23-4bfd-aa19-5ed66b974eff',
      docId: '82537093-4f56-4328-962d-de5237e7a9eb',
      fileName: 'sao-ke-nam-a-bank.pdf',
    },
    {
      name: 'Ban Viet Bank (4 pages)',
      cachedAzureJson: 'scratch/banviet_raw_azure.json',
      storagePath: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c/ffec64e8-f5d8-4e2d-929b-124882b3e099/original/sao-k__-B___N-VI___T-CH___-LAN.pdf',
      userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c',
      docId: 'ffec64e8-f5d8-4e2d-929b-124882b3e099',
      fileName: 'sao-ke-ban-viet.pdf',
    },
  ];

  const summaryMatrix: Array<{
    Document: string;
    Pages: number;
    RawKV: number;
    HeaderLines: number;
    HeaderTables: number;
    Candidates: number;
    Canonical: number;
    Core: number;
    Additional: number;
    Conflicts: number;
    Rejected: number;
    'False Core': number;
  }> = [];

  for (const docSpec of testDocs) {
    console.log(`\n----------------------------------------------------------------------------------------`);
    console.log(`PROCESSING: ${docSpec.name}`);
    console.log(`----------------------------------------------------------------------------------------`);

    let result: any;

    if (docSpec.cachedAzureJson && fs.existsSync(docSpec.cachedAzureJson)) {
      console.log(`Using raw Azure analyzeResult from ${docSpec.cachedAzureJson}...`);
      const rawData = JSON.parse(fs.readFileSync(docSpec.cachedAzureJson, 'utf-8'));
      result = (azureOcrProvider as any).parseAzureAnalyzeResult(rawData, 'prebuilt-layout');
    } else if (docSpec.storagePath) {
      console.log(`Downloading real PDF from Supabase storage: ${docSpec.storagePath}...`);
      const { data: fileData, error: dlErr } = await supabase.storage.from('documents').download(docSpec.storagePath);
      if (dlErr || !fileData) {
        console.error(`Download failed for ${docSpec.name}:`, dlErr);
        continue;
      }
      const buffer = Buffer.from(await fileData.arrayBuffer());
      console.log(`Downloaded ${buffer.length} bytes. Running azureOcrProvider.analyzeDocument()...`);
      result = await azureOcrProvider.analyzeDocument(buffer, 'application/pdf');
    }

    const metrics = result.metadataPipelineMetrics || ({} as any);
    const docMeta = result.documentMetadata || [];
    const coreItems = docMeta.filter((m: any) => m.visibilityClass === 'CORE');
    const additionalItems = docMeta.filter((m: any) => m.visibilityClass === 'ADDITIONAL');

    // Check false core count (decorative fragments or transaction rows falsely promoted)
    const falseCore = coreItems.filter(
      (m: any) =>
        m.rawLabel.toLowerCase().includes('ngân hàng') ||
        m.rawLabel.toLowerCase().includes('minh phụng') ||
        /^\d{1,3}(,\d{3})+$/.test(m.rawLabel) ||
        m.semanticType === 'OTHER'
    );

    summaryMatrix.push({
      Document: docSpec.name,
      Pages: result.pages.length,
      RawKV: metrics.rawKeyValueCount || 0,
      HeaderLines: metrics.headerLineCandidateCount || 0,
      HeaderTables: metrics.headerTableCandidateCount || 0,
      Candidates: metrics.candidateCount || 0,
      Canonical: metrics.canonicalCount || 0,
      Core: metrics.coreCount || 0,
      Additional: metrics.additionalCount || 0,
      Conflicts: metrics.conflictCount || 0,
      Rejected: metrics.rejectedCount || 0,
      'False Core': falseCore.length,
    });

    console.log('\n--- SANITIZED CANONICAL CORE METADATA ---');
    console.table(
      coreItems.map((m: any) => ({
        'Semantic Type': m.semanticType,
        'Raw Label': m.rawLabel,
        'Sanitized Value': m.value.length > 35 ? m.value.substring(0, 32) + '...' : m.value,
        'Confidence': `${(m.confidence * 100).toFixed(1)}%`,
        'Quality': `${((m.qualityScore || 0) * 100).toFixed(1)}%`,
        'Occurrences': m.occurrenceCount,
        'Status': m.status,
      }))
    );

    if (additionalItems.length > 0) {
      console.log('\n--- SANITIZED CANONICAL ADDITIONAL METADATA ---');
      console.table(
        additionalItems.map((m: any) => ({
          'Semantic Type': m.semanticType,
          'Raw Label': m.rawLabel,
          'Sanitized Value': m.value.length > 35 ? m.value.substring(0, 32) + '...' : m.value,
          'Confidence': `${(m.confidence * 100).toFixed(1)}%`,
          'Quality': `${((m.qualityScore || 0) * 100).toFixed(1)}%`,
          'Occurrences': m.occurrenceCount,
          'Status': m.status,
        }))
      );
    }

    // Persist to Supabase Database to verify end-to-end database saving
    console.log(`Persisting to Supabase database for ${docSpec.name}...`);
    try {
      // Ensure document record exists
      await supabase.from('documents').upsert({
        id: docSpec.docId,
        user_id: docSpec.userId,
        file_name: docSpec.fileName,
        original_filename: docSpec.fileName,
        file_type: 'PDF',
        mime_type: 'application/pdf',
        file_size: 500000,
        storage_path: docSpec.storagePath || '',
        status: 'READY',
      });

      await db.saveOcrAnalysis(docSpec.userId, docSpec.docId, result);
      const fetched = await db.getDocumentOcrResult(docSpec.userId, docSpec.docId);
      console.log(`Database persistence verified: ${fetched?.documentMetadata?.length} metadata records retrieved from DB.`);
    } catch (dbErr: any) {
      console.error(`Database persistence error for ${docSpec.name}:`, dbErr.message);
    }
  }

  console.log('\n========================================================================================');
  console.log('FINAL MULTI-BANK REGRESSION SUMMARY MATRIX');
  console.log('========================================================================================');
  console.table(summaryMatrix);
}

runRegressionSuite().catch((err) => {
  console.error('Regression suite failed:', err);
  process.exit(1);
});
