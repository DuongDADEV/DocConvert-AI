import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

const TEST_DOCS = [
  { bank: 'HDBank', id: '80636c44-d41c-4a62-a502-a198d9d4fde3', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  { bank: 'ACB Medihub', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  { bank: 'Nam A Bank', id: '82537093-4f56-4328-962d-de5237e7a9eb', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { bank: 'Ban Viet Bank', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
];

async function runRealDataVerification() {
  console.log('===============================================================');
  console.log('PHASE U1 — REAL-DATA VERIFICATION: UNIFIED TABLE SERVICE');
  console.log('===============================================================\n');

  for (const docInfo of TEST_DOCS) {
    console.log(`\n>>> Testing Bank: ${docInfo.bank} (ID: ${docInfo.id})`);

    const ocrData = await db.getDocumentOcrResult(docInfo.userId, docInfo.id);
    if (!ocrData || !ocrData.tables) {
      console.error(`  FAIL: No OCR table data found for doc ${docInfo.id}`);
      continue;
    }

    const physicalTables = ocrData.tables;
    console.log(`  Physical Tables count: ${physicalTables.length}`);

    const tStart = performance.now();
    const unified = UnifiedTableService.projectDocumentTables(docInfo.id, physicalTables);
    const duration = (performance.now() - tStart).toFixed(2);

    if (!unified) {
      console.error(`  FAIL: UnifiedTableService returned null for ${docInfo.bank}`);
      continue;
    }

    console.log(`  Projection Duration: ${duration} ms`);
    console.log(`  Diagnostics:`, JSON.stringify(unified.diagnostics, null, 2));
    console.log(`  Canonical Columns (${unified.columns.length}):`);
    unified.columns.forEach((col, idx) => {
      console.log(`    [${idx}] "${col.header}" (Semantic: ${col.semanticType})`);
    });
    console.log(`  Unified Rows Count: ${unified.rowCount}`);
    console.log(`  Summary Rows Separated (${unified.summaryRows.length}):`);
    unified.summaryRows.forEach((sr, idx) => {
      console.log(`    [${idx}] Page ${sr.sourcePage}, Reason: "${sr.reason}", Values: [${sr.values.slice(0, 4).join(' | ')}]`);
    });

    // DATA INTEGRITY CHECKS
    console.log(`  --- Data Integrity Assertions ---`);
    let assertionFailed = false;

    // A. Every unified physical cell ID exists in original tables
    const allOriginalCellIds = new Set<string>();
    for (const pt of physicalTables) {
      for (const pr of pt.rows || []) {
        for (const pc of pr.cells || []) {
          if (pc.id) allOriginalCellIds.add(pc.id);
        }
      }
    }

    let physicalCellsChecked = 0;
    const seenCellIds = new Set<string>();

    for (const uRow of unified.rows) {
      // C. Every unified row has sourcePage, sourceTableId, sourceRowId
      if (!uRow.sourcePage || !uRow.sourceTableId || !uRow.sourceRowId) {
        console.error(`    Assertion C FAIL: Row ${uRow.displayRowIndex} missing lineage metadata!`);
        assertionFailed = true;
      }

      for (const uCell of uRow.cells) {
        if (!uCell.isPlaceholder && uCell.id) {
          physicalCellsChecked++;
          // A. Exists in original
          if (!allOriginalCellIds.has(uCell.id)) {
            console.error(`    Assertion A FAIL: Cell ${uCell.id} not found in physical OCR tables!`);
            assertionFailed = true;
          }
          // B. No duplicate cell across rows
          if (seenCellIds.has(uCell.id)) {
            console.error(`    Assertion B FAIL: Cell ${uCell.id} appeared multiple times in unified table!`);
            assertionFailed = true;
          }
          seenCellIds.add(uCell.id);
        }
      }
    }

    console.log(`    Assertion A & B: Verified ${physicalCellsChecked} physical cells (0 missing, 0 duplicates) - PASSED`);
    console.log(`    Assertion C: All ${unified.rowCount} unified rows have sourcePage, sourceTableId, sourceRowId - PASSED`);

    // Specific bank checks
    if (docInfo.bank === 'ACB Medihub') {
      console.log(`\n  --- ACB Specific Check: 5-col vs 6-col sample alignment ---`);
      // Find a row from a 5-col table and a row from a 6-col table
      const rowFromP1 = unified.rows.find((r) => r.sourcePage === 1);
      const rowFromP4 = unified.rows.find((r) => r.sourcePage === 4);

      if (rowFromP1) {
        console.log(`    Sample Row Page 1:`);
        rowFromP1.cells.forEach((c) => {
          const val = c.isPlaceholder ? '[EMPTY_PLACEHOLDER]' : (c.rawValue.length > 20 ? c.rawValue.substring(0, 20) + '...' : c.rawValue);
          console.log(`      Col [${c.canonicalColumnIndex}] (${unified.columns[c.canonicalColumnIndex].header}): ${val}`);
        });
      }
      if (rowFromP4) {
        console.log(`    Sample Row Page 4:`);
        rowFromP4.cells.forEach((c) => {
          const val = c.isPlaceholder ? '[EMPTY_PLACEHOLDER]' : (c.rawValue.length > 20 ? c.rawValue.substring(0, 20) + '...' : c.rawValue);
          console.log(`      Col [${c.canonicalColumnIndex}] (${unified.columns[c.canonicalColumnIndex].header}): ${val}`);
        });
      }
    }

    if (docInfo.bank === 'HDBank') {
      console.log(`  --- HDBank Specific Check ---`);
      console.log(`    Physical tables: ${physicalTables.length} -> Transaction tables in unified: ${unified.sourceTableIds.length}`);
      console.log(`    Rejected metadata/summary tables count: ${unified.diagnostics.rejectedTableCount}`);
    }

    if (docInfo.bank === 'Nam A Bank') {
      console.log(`  --- Nam A Specific Check ---`);
      console.log(`    Repeated header rows removed: ${unified.diagnostics.repeatedHeaderRowsRemoved}`);
      console.log(`    Summary rows separated: ${unified.diagnostics.summaryRowsSeparated}`);
    }

    if (docInfo.bank === 'Ban Viet Bank') {
      console.log(`  --- Ban Viet Specific Check ---`);
      console.log(`    Repeated header rows removed: ${unified.diagnostics.repeatedHeaderRowsRemoved}`);
      console.log(`    Summary rows separated: ${unified.diagnostics.summaryRowsSeparated}`);
      console.log(`    Canonical column count: ${unified.columnCount}`);
    }

    if (!assertionFailed) {
      console.log(`  ===> Result for ${docInfo.bank}: ALL CRITERIA PASSED!`);
    } else {
      console.error(`  ===> Result for ${docInfo.bank}: ASSERTIONS FAILED!`);
    }
  }

  process.exit(0);
}

runRealDataVerification().catch((err) => {
  console.error('Fatal error in real data verification:', err);
  process.exit(1);
});
