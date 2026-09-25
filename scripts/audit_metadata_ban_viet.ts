import 'dotenv/config';
import { db } from '../server/db/db.js';
import { MetadataFilterEngine } from '../server/services/ocr/metadataFilterEngine.js';

async function auditMetadata() {
  console.log('=== AUDITING METADATA FOR BAN VIET ===');
  const userId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';
  const docId = 'ffec64e8-f5d8-4e2d-929b-124882b3e099';

  const client = (db as any).getClient();
  const { data: docRecord } = await client.from('documents').select('*').eq('id', docId);
  console.log('Document record:', docRecord);


  console.log(`Document ID: ${docId}`);
  console.log('\n=== ocr.documentMetadata RETURNED BY db.getDocumentOcrResult ===');
  ocr.documentMetadata.forEach((m: any, idx: number) => {
    console.log(`[${idx}] [${m.visibilityClass}] [${m.semanticType}] "${m.label}" = "${m.value}" | status=${m.status} | conf=${m.confidence} | p${m.sourcePage}`);
    if (m.alternatives && m.alternatives.length > 0) {
      console.log(`    alternatives:`, JSON.stringify(m.alternatives));
    }
  });

  const ocr = await db.getDocumentOcrResult(userId, docId);
  const { data: ocrRows } = await client.from('ocr_results').select('*').eq('document_id', docId);
  console.log(`\nFound ${ocrRows?.length} rows in ocr_results for document.`);
  ocrRows?.forEach((r: any) => {
    console.log(`Page ${r.page_number} keys in metadata:`, Object.keys(r.metadata || {}));
    if (r.metadata?.rawObservations) {
      console.log(`  Page ${r.page_number} has ${r.metadata.rawObservations.length} rawObservations`);
    }
  });

  const { data: rawMetaRows } = await client.from('document_metadata').select('*').eq('document_id', docId);
  console.log(`\nFound ${rawMetaRows?.length} rows in document_metadata.`);
  rawMetaRows?.forEach((m: any, idx: number) => {
    console.log(`[${idx}] label="${m.label}" val="${m.value}" status=${m.status} conf=${m.confidence_score} p${m.source_page}`);
    console.log(`    raw_label="${m.raw_label}" raw_val="${m.raw_value}" alt=`, JSON.stringify(m.alternatives));
  });

  console.log('\n--- TABLES IN OCR RESULT ---');
  console.log('Tables count:', ocr.tables?.length);
  const t0 = ocr.tables?.[0];
  if (t0) {
    console.log(`\nTable 0 (page ${t0.pageNumber}): ${t0.rowCount}x${t0.columnCount}`);
    t0.rows.forEach((r: any, ri: number) => {
      console.log(`  Row ${ri}: [${r.cells.map((c: any) => `"${c.rawValue}"`).join(', ')}]`);
    });
  }


  // 2. Re-run processObservations directly
  console.log('\n--- RE-RUNNING processObservations ---');
  const reResult = MetadataFilterEngine.processObservations(
    ocr.rawMetadataObservations || [],
    ocr.tables || [],
    ocr.pages || []
  );

  console.log(`Metrics: RawKV=${reResult.metrics.rawKeyValueCount}, HeaderLines=${reResult.metrics.headerLineCandidateCount}, HeaderTables=${reResult.metrics.headerTableCandidateCount}`);
  console.log(`Candidates=${reResult.metrics.candidateCount}, Canonical=${reResult.metrics.canonicalCount}, Core=${reResult.metrics.coreCount}, Additional=${reResult.metrics.additionalCount}, Conflicts=${reResult.metrics.conflictCount}`);

  console.log('\n--- RE-PROCESSED CANONICAL METADATA ---');
  reResult.canonicalMetadata.forEach((item, idx) => {
    console.log(`[${idx}] [${item.visibilityClass}] [${item.semanticType}] "${item.label}" = "${item.value}" | status=${item.status} | conf=${item.confidence} | p${item.sourcePage}`);
    if (item.alternatives && item.alternatives.length > 0) {
      console.log(`     Alternatives (${item.alternatives.length}):`, item.alternatives.map(a => `"${a.rawValue}" (p${a.sourcePage})`));
    }
  });

  // 3. Detailed trace of observations grouped by semantic type
  console.log('\n--- ALL RAW CANDIDATES GROUPED BY SEMANTIC TYPE ---');
  const candidatesByType = new Map<string, any[]>();
  for (const obs of (ocr.rawMetadataObservations || [])) {
    const st = obs.semanticType || 'OTHER';
    const arr = candidatesByType.get(st) || [];
    arr.push(obs);
    candidatesByType.set(st, arr);
  }

  for (const [st, items] of candidatesByType.entries()) {
    console.log(`\nSemanticType: ${st} (${items.length} observations):`);
    items.forEach((item, i) => {
      console.log(`  [${i}] p${item.sourcePage} | src=${item.sourceType || 'KVP'} | rawLabel="${item.rawLabel}" | rawValue="${item.rawValue}" | conf=${item.confidence}`);
    });
  }
}

auditMetadata().catch(console.error);
