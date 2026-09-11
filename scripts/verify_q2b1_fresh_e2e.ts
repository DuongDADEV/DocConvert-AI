import 'dotenv/config';
import { db } from '../server/db/db.js';
import { storageService } from '../server/services/storageService.js';
import { AzureDocumentIntelligenceProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function cleanupDocument(docId: string) {
  try {
    await supabase.from('ocr_document_metadata').delete().eq('document_id', docId);
    const { data: tbls } = await supabase.from('extracted_tables').select('id').eq('document_id', docId);
    if (tbls && tbls.length > 0) {
      const tableIds = tbls.map((t) => t.id);
      const { data: rows } = await supabase.from('extracted_rows').select('id').in('table_id', tableIds);
      if (rows && rows.length > 0) {
        const rowIds = rows.map((r) => r.id);
        await supabase.from('extracted_cells').delete().in('row_id', rowIds);
        await supabase.from('extracted_rows').delete().in('table_id', tableIds);
      }
      await supabase.from('extracted_tables').delete().eq('document_id', docId);
    }
    await supabase.from('ocr_pages').delete().eq('document_id', docId);
    await supabase.from('processing_jobs').delete().eq('document_id', docId);
    await supabase.from('documents').delete().eq('id', docId);
  } catch (e: any) {
    console.warn(`Cleanup error for ${docId}:`, e.message);
  }
}

async function runFreshValidation() {
  console.log('========================================================================');
  console.log('Q2B.1 — FRESH OCR END-TO-END PIPELINE VALIDATION');
  console.log('========================================================================\n');

  // Pre-cleanup any stale test documents
  await cleanupDocument('d1add5e1-8739-463a-824e-e6b6c1217e90');

  const provider = new AzureDocumentIntelligenceProvider();
  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';

  // ========================================================================
  // PART 1: FRESH NAM A PROBLEMATIC STATEMENT VALIDATION
  // ========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('STEP 1: FRESH OCR FOR NAM A PROBLEMATIC STATEMENT');
  console.log('------------------------------------------------------------------------');

  const histNamaDocId = 'fa982b65-94e8-4a21-9c74-e28ace4bad85';
  console.log('Downloading original Nam A PDF from private storage...');
  const namaFileData = await storageService.getFile(userId, histNamaDocId);
  if (!namaFileData || !namaFileData.buffer) {
    throw new Error('Failed to download Nam A PDF from storage');
  }
  console.log(`Downloaded Nam A PDF: ${namaFileData.buffer.length} bytes`);

  // Create temporary test document record in DB
  const testNamaDocId = crypto.randomUUID();
  console.log(`Creating isolated temporary test document: ${testNamaDocId}`);
  const { error: docInsertErr } = await supabase.from('documents').insert({
    id: testNamaDocId,
    user_id: userId,
    original_filename: 'test-fresh-nama.pdf',
    file_name: 'test-fresh-nama.pdf',
    file_type: 'PDF',
    file_size: namaFileData.buffer.length,
    mime_type: 'application/pdf',
    storage_path: `documents/test/${testNamaDocId}.pdf`,
    status: 'PROCESSING',
  });
  if (docInsertErr) throw new Error(`Failed to create test doc: ${docInsertErr.message}`);

  // 1. Run fresh Azure Document Intelligence OCR
  console.log('Executing live Azure AI Document Intelligence analysis with current pipeline...');
  const tOcrStart = Date.now();
  const namaOcrAnalysis = await provider.analyzeDocument(
    namaFileData.buffer,
    'application/pdf',
    { modelId: 'prebuilt-layout' }
  );
  console.log(`Fresh Azure OCR completed in ${Date.now() - tOcrStart} ms`);
  console.log(`Pages: ${namaOcrAnalysis.pages.length}, Tables: ${namaOcrAnalysis.tables.length}`);

  // 2. Inspect Pre-Save Target Cells
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 2: PRE-SAVE TARGET CELLS INSPECTION (In-Memory OCR Result)');
  console.log('------------------------------------------------------------------------');
  const targetMap: Record<string, any> = {
    '95,909 A': null,
    'Lo ICH 50,000': null,
    '50,039,': null,
    '94.709': null,
  };

  let preSaveEmptyCount = 0;
  let preSaveTotalCells = 0;

  for (const t of namaOcrAnalysis.tables) {
    for (const r of t.rows) {
      for (const c of r.cells) {
        preSaveTotalCells++;
        const raw = c.rawValue.trim();
        if (raw === '') preSaveEmptyCount++;
        if (targetMap.hasOwnProperty(raw)) {
          targetMap[raw] = {
            rawValue: c.rawValue,
            confidence: c.confidence,
            confidenceSource: c.confidenceSource,
            cellType: c.cellType,
          };
        }
      }
    }
  }

  console.log('Pre-Save Targets:');
  for (const [k, v] of Object.entries(targetMap)) {
    console.log(`  [${k}]: conf=${v?.confidence}, source=${v?.confidenceSource}`);
  }
  console.log(`Pre-Save Empty Cells: ${preSaveEmptyCount} / ${preSaveTotalCells}`);

  // 3. Save to Database using production saveOcrAnalysis
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 3: SAVE TO DATABASE (db.saveOcrAnalysis)');
  console.log('------------------------------------------------------------------------');
  await db.saveOcrAnalysis(userId, testNamaDocId, namaOcrAnalysis);
  console.log('Saved structured OCR results into PostgreSQL successfully');

  // 4. Query Database directly from extracted_cells
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 4: DIRECT DATABASE QUERY (extracted_cells table)');
  console.log('------------------------------------------------------------------------');
  const { data: dbTables } = await supabase
    .from('extracted_tables')
    .select('id, page_number')
    .eq('document_id', testNamaDocId);

  const tableIds = (dbTables || []).map((t) => t.id);
  const tablePageMap = new Map((dbTables || []).map((t) => [t.id, t.page_number]));

  const { data: dbRows } = await supabase
    .from('extracted_rows')
    .select('id, table_id, row_index')
    .in('table_id', tableIds);

  const rowIds = (dbRows || []).map((r) => r.id);
  const rowMap = new Map((dbRows || []).map((r) => [r.id, r]));

  const { data: dbCells, error: dbErr } = await supabase
    .from('extracted_cells')
    .select('id, row_id, column_index, raw_value, confidence_score')
    .in('row_id', rowIds);

  if (dbErr) throw new Error(`DB query failed: ${dbErr.message}`);
  console.log(`Total cells returned from database: ${dbCells?.length}`);

  const dbTargetMatches: any[] = [];
  for (const targetKey of Object.keys(targetMap)) {
    const match = (dbCells || []).find((c: any) => (c.raw_value || '').trim() === targetKey);
    if (match) {
      const rowInfo = rowMap.get(match.row_id);
      const page = rowInfo ? tablePageMap.get(rowInfo.table_id) : undefined;
      dbTargetMatches.push({
        target: targetKey,
        raw_value: match.raw_value,
        confidence_score: match.confidence_score,
        page,
        row_index: rowInfo?.row_index,
        column_index: match.column_index,
        id: match.id,
      });
      console.log(`  DB Match [${targetKey}]: confidence_score=${match.confidence_score}, page=${page}, row=${rowInfo?.row_index}, col=${match.column_index}, id=${match.id}`);
    }
  }

  // 5. Reload using production getDocumentOcrResult
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 5: PRODUCTION DB RELOAD (db.getDocumentOcrResult)');
  console.log('------------------------------------------------------------------------');
  const reloadedOcr = await db.getDocumentOcrResult(userId, testNamaDocId);
  console.log(`Reloaded Pages: ${reloadedOcr.pages.length}, Tables: ${reloadedOcr.tables.length}`);

  const reloadedTargets: Record<string, any> = {};
  for (const t of reloadedOcr.tables) {
    for (const r of t.rows) {
      for (const c of r.cells) {
        const raw = (c.rawValue || '').trim();
        if (targetMap.hasOwnProperty(raw)) {
          reloadedTargets[raw] = {
            rawValue: c.rawValue,
            confidence: c.confidence,
            confidenceSource: c.confidenceSource,
            id: c.id,
          };
          console.log(`  Reloaded [${raw}]: conf=${c.confidence}, source=${c.confidenceSource}, id=${c.id}`);
        }
      }
    }
  }

  // 6. Unified Table Projection & Semantic Quality Evaluation
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 6: UNIFIED TABLE PROJECTION & QUALITY EVALUATOR');
  console.log('------------------------------------------------------------------------');
  const unified = UnifiedTableService.projectDocumentTables(testNamaDocId, reloadedOcr.tables);
  if (!unified) throw new Error('Unified projection failed');

  console.log(`Unified Rows: ${unified.rows.length}, Columns: ${unified.columns.length}`);

  const unifiedTargets: Record<string, any> = {};
  for (const r of unified.rows) {
    for (const c of r.cells) {
      const raw = (c.rawValue || '').trim();
      if (targetMap.hasOwnProperty(raw)) {
        unifiedTargets[raw] = {
          rawValue: c.rawValue,
          confidence: c.confidence,
          confidenceSource: c.confidenceSource,
          severity: c.qualityAssessment?.severity,
          reasons: c.qualityAssessment?.reasons,
          cellId: c.id,
        };
      }
    }
  }

  console.log('Unified & Quality Assessment Targets:');
  for (const [k, v] of Object.entries(unifiedTargets)) {
    console.log(`  [${k}]:`);
    console.log(`    Confidence: ${v.confidence} (${v.confidenceSource})`);
    console.log(`    Severity:   ${v.severity}`);
    console.log(`    Reasons:    ${v.reasons?.map((r: any) => `${r.code} (${r.message})`).join(' | ')}`);
  }

  // 7. Historical vs Fresh Comparison
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 7: HISTORICAL (OLD) VS FRESH OCR COMPARISON');
  console.log('------------------------------------------------------------------------');
  const historicalOcr = await db.getDocumentOcrResult(userId, histNamaDocId);
  const histUnified = UnifiedTableService.projectDocumentTables(histNamaDocId, historicalOcr.tables);

  const histTargets: Record<string, any> = {};
  if (histUnified) {
    for (const r of histUnified.rows) {
      for (const c of r.cells) {
        const raw = (c.rawValue || '').trim();
        if (targetMap.hasOwnProperty(raw)) {
          histTargets[raw] = c.confidence;
        }
      }
    }
  }

  const comparisonTable = Object.keys(targetMap).map((k) => ({
    target: k,
    historical_db_conf: histTargets[k],
    fresh_ocr_db_conf: unifiedTargets[k]?.confidence,
    confidence_source: unifiedTargets[k]?.confidenceSource,
    severity: unifiedTargets[k]?.severity,
    reasons: unifiedTargets[k]?.reasons?.map((r: any) => r.code).join(', '),
  }));
  console.table(comparisonTable);

  // 8. Empty Cell & Unavailable Inspection
  let freshEmptyCount = 0;
  let freshEmptyNullCount = 0;
  let freshEmptySourceCount = 0;
  let freshEmptyPassCount = 0;
  let freshUnavailableCount = 0;

  for (const r of unified.rows) {
    for (const c of r.cells) {
      if (c.isPlaceholder) continue;
      if (!c.rawValue || c.rawValue.trim() === '') {
        freshEmptyCount++;
        if (c.confidence === null) freshEmptyNullCount++;
        if (c.confidenceSource === 'EMPTY_CELL') freshEmptySourceCount++;
        if (c.qualityAssessment?.severity === 'PASS') freshEmptyPassCount++;
      } else if (c.confidenceSource === 'UNAVAILABLE') {
        freshUnavailableCount++;
      }
    }
  }

  console.log('\nEmpty Cell Round-Trip in Fresh Document:');
  console.log(`  Total empty cells: ${freshEmptyCount}`);
  console.log(`  Confidence === null: ${freshEmptyNullCount}/${freshEmptyCount}`);
  console.log(`  Source === 'EMPTY_CELL': ${freshEmptySourceCount}/${freshEmptyCount}`);
  console.log(`  Quality === 'PASS': ${freshEmptyPassCount}/${freshEmptyCount}`);
  console.log(`  Unavailable cells count: ${freshUnavailableCount}`);

  // ========================================================================
  // PART 2: FRESH HDBANK CLEAN REGRESSION
  // ========================================================================
  console.log('\n========================================================================');
  console.log('STEP 8: FRESH OCR FOR HDBANK (CLEAN STATEMENT REGRESSION)');
  console.log('========================================================================');

  const histHdDocId = '93c5f47f-659f-4e5f-be03-fd0ad073ab88';
  console.log('Downloading original HDBank PDF from storage...');
  const hdFileData = await storageService.getFile(userId, histHdDocId);
  if (!hdFileData || !hdFileData.buffer) {
    throw new Error('Failed to download HDBank PDF from storage');
  }
  console.log(`Downloaded HDBank PDF: ${hdFileData.buffer.length} bytes`);

  const testHdDocId = crypto.randomUUID();
  console.log(`Creating isolated temporary test document for HDBank: ${testHdDocId}`);
  const { error: hdDocErr } = await supabase.from('documents').insert({
    id: testHdDocId,
    user_id: userId,
    original_filename: 'test-fresh-hdbank.pdf',
    file_name: 'test-fresh-hdbank.pdf',
    file_type: 'PDF',
    file_size: hdFileData.buffer.length,
    mime_type: 'application/pdf',
    storage_path: `documents/test/${testHdDocId}.pdf`,
    status: 'PROCESSING',
  });
  if (hdDocErr) throw new Error(`Failed to create test HDBank doc: ${hdDocErr.message}`);

  console.log('Executing live Azure AI Document Intelligence analysis for HDBank...');
  const tHdStart = Date.now();
  const hdOcrAnalysis = await provider.analyzeDocument(
    hdFileData.buffer,
    'application/pdf',
    { modelId: 'prebuilt-layout' }
  );
  console.log(`Fresh HDBank Azure OCR completed in ${Date.now() - tHdStart} ms`);
  console.log(`Pages: ${hdOcrAnalysis.pages.length}, Tables: ${hdOcrAnalysis.tables.length}`);

  console.log('Saving HDBank OCR results to database...');
  await db.saveOcrAnalysis(userId, testHdDocId, hdOcrAnalysis);

  console.log('Reloading HDBank OCR results via db.getDocumentOcrResult...');
  const reloadedHdOcr = await db.getDocumentOcrResult(userId, testHdDocId);
  const unifiedHd = UnifiedTableService.projectDocumentTables(testHdDocId, reloadedHdOcr.tables);
  if (!unifiedHd) throw new Error('Unified projection failed for HDBank');

  console.log(`HDBank Unified Rows: ${unifiedHd.rows.length}, Columns: ${unifiedHd.columns.length}`);

  let hdTotalCells = 0;
  let hdPass = 0;
  let hdWarn = 0;
  let hdCrit = 0;

  for (const r of unifiedHd.rows) {
    for (const c of r.cells) {
      if (c.isPlaceholder) continue;
      hdTotalCells++;
      const sev = c.qualityAssessment?.severity;
      if (sev === 'CRITICAL') hdCrit++;
      else if (sev === 'WARNING') hdWarn++;
      else hdPass++;
    }
  }

  const hdFlagRate = hdTotalCells > 0 ? (((hdWarn + hdCrit) / hdTotalCells) * 100).toFixed(2) : '0';
  console.log(`HDBank Fresh Summary: Total=${hdTotalCells} | PASS=${hdPass} | WARN=${hdWarn} | CRIT=${hdCrit} | FlagRate=${hdFlagRate}%`);

  // ========================================================================
  // CLEANUP TEMPORARY TEST DATA
  // ========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 9: CLEANUP TEMPORARY TEST RECORDS');
  console.log('------------------------------------------------------------------------');

  for (const docId of [testNamaDocId, testHdDocId]) {
    console.log(`Cleaning up test document ${docId}...`);
    // Delete in dependency order
    await supabase.from('ocr_document_metadata').delete().eq('document_id', docId);
    
    // Find tables
    const { data: tbls } = await supabase.from('extracted_tables').select('id').eq('document_id', docId);
    if (tbls && tbls.length > 0) {
      const tableIds = tbls.map((t) => t.id);
      // Find rows
      const { data: rows } = await supabase.from('extracted_rows').select('id').in('table_id', tableIds);
      if (rows && rows.length > 0) {
        const rowIds = rows.map((r) => r.id);
        await supabase.from('extracted_cells').delete().in('row_id', rowIds);
        await supabase.from('extracted_rows').delete().in('table_id', tableIds);
      }
      await supabase.from('extracted_tables').delete().eq('document_id', docId);
    }
    await supabase.from('ocr_pages').delete().eq('document_id', docId);
    await supabase.from('processing_jobs').delete().eq('document_id', docId);
    await supabase.from('documents').delete().eq('id', docId);
    console.log(`  Cleanup completed for ${docId}`);
  }

  console.log('\n========================================================================');
  console.log('Q2B.1 FRESH VALIDATION RUN COMPLETED SUCCESSFULLY');
  console.log('========================================================================\n');
}

runFreshValidation().catch((err) => {
  console.error('Validation failed with error:', err);
  process.exit(1);
});
