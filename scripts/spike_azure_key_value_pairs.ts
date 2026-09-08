import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';

async function runAzureKeyValuePairSpike() {
  console.log('======================================================================');
  console.log('REAL-DATA SPIKE: AZURE DOCUMENT INTELLIGENCE PREBUILT-LAYOUT + KEYVALUEPAIRS');
  console.log('======================================================================\n');

  const endpoint = (process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').trim().replace(/\/+$/, '');
  const key = (process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '').trim();
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!endpoint || !key) {
    console.error('FATAL: Azure credentials missing in environment!');
    process.exit(1);
  }

  // 1. Download real 8-page bank statement PDF from Supabase storage
  console.log('Downloading real 8-page PDF bank statement from Supabase storage...');
  const supabase = createClient(supabaseUrl, supabaseKey);
  const userId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';
  const docId = 'b55bb467-20ae-4939-b1c8-c28e0895854b';
  const filePath = `${userId}/${docId}/original/sao-k__-acb-Medihub-2023.pdf`;

  const { data: fileData, error: fileErr } = await supabase.storage.from('documents').download(filePath);
  if (fileErr || !fileData) {
    console.error('Failed to download file from Supabase storage:', fileErr);
    process.exit(1);
  }

  const pdfBuffer = Buffer.from(await fileData.arrayBuffer());
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPageCount = pdfDoc.getPageCount();
  console.log(`Successfully loaded real PDF. Total pages: ${totalPageCount}, File size: ${pdfBuffer.length} bytes.\n`);

  // 2. Chunking setup (max 2 pages per chunk)
  const maxPagesPerChunk = 2;
  const chunkCount = Math.ceil(totalPageCount / maxPagesPerChunk);
  console.log(`Splitting ${totalPageCount}-page PDF into ${chunkCount} chunks (${maxPagesPerChunk} pages/chunk)...`);

  const apiVersion = '2024-11-30';
  const modelId = 'prebuilt-layout';
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${modelId}:analyze?api-version=${apiVersion}&features=keyValuePairs`;

  console.log(`Exact Azure Endpoint Target:\n  POST ${endpoint}/documentintelligence/documentModels/${modelId}:analyze?api-version=${apiVersion}&features=keyValuePairs\n`);

  const chunkRawResponses: any[] = [];

  for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx++) {
    const startPage = chunkIdx * maxPagesPerChunk;
    const endPage = Math.min((chunkIdx + 1) * maxPagesPerChunk - 1, totalPageCount - 1);
    const pageRangeStr = `${startPage + 1}-${endPage + 1}`;

    console.log(`--- Processing Chunk ${chunkIdx + 1}/${chunkCount} (Original pages ${pageRangeStr}) ---`);

    // Create sub-PDF chunk
    const subPdf = await PDFDocument.create();
    const pageIndices = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
    const copiedPages = await subPdf.copyPages(pdfDoc, pageIndices);
    copiedPages.forEach((p) => subPdf.addPage(p));
    const chunkBytes = await subPdf.save();
    const chunkBuffer = Buffer.from(chunkBytes);

    // Send request to Azure with 429 retry
    let submitRes: Response | globalThis.Response | null = null;
    let submitAttempts = 0;
    while (submitAttempts < 5) {
      submitAttempts++;
      submitRes = await fetch(analyzeUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/pdf',
        },
        body: new Uint8Array(chunkBuffer),
      });

      if (submitRes.status === 429) {
        console.warn(`[HTTP 429 Rate Limit] Azure requested pause. Retrying submission in 10s... (Attempt ${submitAttempts}/5)`);
        await new Promise((r) => setTimeout(r, 10000));
        continue;
      }
      break;
    }

    if (!submitRes || !submitRes.ok) {
      const errText = submitRes ? await submitRes.text() : 'No response';
      console.error(`Azure Submission Error (HTTP ${submitRes?.status}):`, errText);
      process.exit(1);
    }

    const opLoc = submitRes.headers.get('operation-location') || submitRes.headers.get('Operation-Location');
    if (!opLoc) {
      console.error('Missing operation-location header in Azure response');
      process.exit(1);
    }

    // Poll for status
    let attempts = 0;
    let analyzeResult: any = null;
    while (attempts < 60) {
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;

      const pollRes = await fetch(opLoc, {
        method: 'GET',
        headers: { 'Ocp-Apim-Subscription-Key': key },
      });

      if (pollRes.status === 429) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      if (!pollRes.ok) {
        console.error(`Polling Error HTTP ${pollRes.status}`);
        continue;
      }

      const pollData: any = await pollRes.json();
      if (pollData.status === 'succeeded') {
        analyzeResult = pollData.analyzeResult;
        break;
      } else if (pollData.status === 'failed' || pollData.status === 'canceled') {
        console.error('Azure Analysis Failed:', pollData.error);
        process.exit(1);
      }
    }

    if (!analyzeResult) {
      console.error(`Chunk ${chunkIdx + 1} timed out polling Azure.`);
      process.exit(1);
    }

    const kvPairs = analyzeResult.keyValuePairs || [];
    console.log(`Chunk ${chunkIdx + 1} Succeeded! Pages returned: ${analyzeResult.pages?.length}, KeyValuePairs returned: ${kvPairs.length}`);

    chunkRawResponses.push({
      chunkIndex: chunkIdx,
      originalStartPage: startPage + 1,
      originalEndPage: endPage + 1,
      pageOffset: startPage,
      pageCount: analyzeResult.pages?.length || 0,
      keyValuePairs: kvPairs,
      tablesCount: analyzeResult.tables?.length || 0,
    });

    // Gentle pause between chunks to respect F0 tier rate limits
    if (chunkIdx < chunkCount - 1) {
      console.log('Pausing 3s before next chunk...');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // 3. Write raw results to local scratch JSON
  const scratchDir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const outputPath = path.join(scratchDir, 'azure_kv_spike_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(chunkRawResponses, null, 2), 'utf-8');
  console.log(`\nAll ${chunkCount} chunks processed successfully! Saved raw Azure results to:\n  ${outputPath}\n`);

  // 4. Summarize and analyze results
  console.log('======================================================================');
  console.log('ANALYSIS OF AZURE KEYVALUEPAIRS');
  console.log('======================================================================\n');

  let totalKvPairs = 0;
  chunkRawResponses.forEach((c) => {
    totalKvPairs += c.keyValuePairs.length;
  });

  console.log(`Total KeyValuePairs across all ${chunkCount} chunks (${totalPageCount} pages): ${totalKvPairs}`);

  console.log('\n--- SAMPLE KEYVALUEPAIRS STRUCTURE (First 5 pairs from Chunk 1) ---');
  const samplePairs = chunkRawResponses[0]?.keyValuePairs?.slice(0, 5) || [];
  samplePairs.forEach((kv: any, idx: number) => {
    console.log(`\n[Pair #${idx + 1}]`);
    console.log(`  Key Content: "${kv.key?.content}"`);
    console.log(`  Key BoundingRegion Page: ${kv.key?.boundingRegions?.[0]?.pageNumber}`);
    console.log(`  Key BoundingRegion Polygon:`, JSON.stringify(kv.key?.boundingRegions?.[0]?.polygon));
    console.log(`  Value Content: "${kv.value?.content}"`);
    console.log(`  Value BoundingRegion Page: ${kv.value?.boundingRegions?.[0]?.pageNumber}`);
    console.log(`  Value BoundingRegion Polygon:`, JSON.stringify(kv.value?.boundingRegions?.[0]?.polygon));
    console.log(`  Confidence: ${kv.confidence}`);
  });

  console.log('\n======================================================================');
  console.log('SPIKE COMPLETED SUCCESSFULLY');
  console.log('======================================================================');
}

runAzureKeyValuePairSpike().catch((err) => {
  console.error('Spike execution failed:', err);
  process.exit(1);
});
