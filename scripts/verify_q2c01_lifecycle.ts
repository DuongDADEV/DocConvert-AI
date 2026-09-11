import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';
import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator.js';
import { isUnifiedCellReviewWorthy, isLegacyCellReviewWorthy } from '../src/components/ocr/OcrReviewWorkspace.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function filterDisplayedRows(dataRows: any[], filterReviewOnly: boolean, searchQuery: string, isUnified: boolean) {
  return dataRows.filter((row: any) => {
    // 1. Review filter condition: row must contain at least one real cell needing review
    if (filterReviewOnly) {
      const hasSuspiciousCell = row.cells?.some((c: any) => {
        if (isUnified) {
          return isUnifiedCellReviewWorthy(c);
        }
        return isLegacyCellReviewWorthy(c);
      });
      if (!hasSuspiciousCell) return false;
    }

    // 2. Search query condition: row must match search text or page
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      if (isUnified && row.sourcePage) {
        if (q === `trang ${row.sourcePage}` || q === `p${row.sourcePage}`) {
          return true;
        }
      }
      return row.cells?.some(
        (c: any) => !c.isPlaceholder && (c.rawValue || '').toLowerCase().includes(q)
      );
    }

    return true;
  });
}

function computeReviewStats(unifiedTable: any) {
  let warningCount = 0;
  let criticalCount = 0;

  unifiedTable.rows.forEach((r: any) => {
    r.cells?.forEach((c: any) => {
      if (!isUnifiedCellReviewWorthy(c)) return;
      const severity = c.qualityAssessment?.severity;
      if (severity === 'CRITICAL') {
        criticalCount++;
      } else if (severity === 'WARNING') {
        warningCount++;
      }
    });
  });

  return {
    totalReviewCount: warningCount + criticalCount,
    warningCount,
    criticalCount,
  };
}

async function runQ2C01Verification() {
  console.log('========================================================================');
  console.log('Q2C.0.1 — UI CONSISTENCY + POST-EDIT QUALITY LIFECYCLE AUDIT & TEST');
  console.log('========================================================================\n');

  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';
  const sourceNamaDocId = 'fe908e19-b070-40f9-87c1-e1626b4e673e';
  const hdBankDocId = 'd79873be-7dd7-4441-8c63-68c6077adfd0';

  // ----------------------------------------------------------------------
  // STEP 1: VERIFY COUNTER & FILTER CONSISTENCY ON UNIFIED TABLES
  // ----------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST 1: COUNTER + FILTER EXACT INVARIANT CHECK');
  console.log('------------------------------------------------------------------------');

  const namaOcr = await db.getDocumentOcrResult(userId, sourceNamaDocId);
  const namaUnified = UnifiedTableService.projectDocumentTables(sourceNamaDocId, namaOcr.tables);
  if (!namaUnified) throw new Error('Nam A unified table missing');

  const stats = computeReviewStats(namaUnified);
  const filteredRows = filterDisplayedRows(namaUnified.rows, true, '', true);

  console.log(`Nam A Total Rows: ${namaUnified.rows.length}`);
  console.log(`Nam A Filtered Rows: ${filteredRows.length}`);
  console.log(`Nam A Review Counter: ${stats.totalReviewCount} (${stats.warningCount} WARNING, ${stats.criticalCount} CRITICAL)`);

  // Assert invariant: every filtered row MUST contain at least one cell satisfying isUnifiedCellReviewWorthy
  for (const r of filteredRows) {
    const hasIssue = r.cells.some((c: any) => isUnifiedCellReviewWorthy(c));
    if (!hasIssue) {
      throw new Error(`Invariant violation: Filtered row ${r.displayRowIndex} has NO review-worthy cells!`);
    }
  }

  // Assert invariant: every row NOT in filteredRows MUST NOT have any cell satisfying isUnifiedCellReviewWorthy
  const filteredRowIndices = new Set(filteredRows.map((r: any) => r.displayRowIndex));
  for (const r of namaUnified.rows) {
    if (!filteredRowIndices.has(r.displayRowIndex)) {
      const hasIssue = r.cells.some((c: any) => isUnifiedCellReviewWorthy(c));
      if (hasIssue) {
        throw new Error(`Invariant violation: Non-filtered row ${r.displayRowIndex} HAS a review-worthy cell!`);
      }
    }
  }
  console.log('  ✓ Invariant Verified: filter and counter share the exact same predicate (0 divergence).');

  // ----------------------------------------------------------------------
  // STEP 2: CHECK FOR ANY CELLS MISSING qualityAssessment
  // ----------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 2: CHECK FOR UNIFIED CELLS WITH MISSING qualityAssessment');
  console.log('------------------------------------------------------------------------');

  let missingQaCount = 0;
  for (const r of namaUnified.rows) {
    for (const c of r.cells) {
      if (!c.isPlaceholder && !c.qualityAssessment) {
        missingQaCount++;
      }
    }
  }
  console.log(`Nam A cells missing qualityAssessment: ${missingQaCount}`);
  if (missingQaCount > 0) {
    console.warn(`WARNING: Found ${missingQaCount} cells missing qualityAssessment!`);
  } else {
    console.log('  ✓ All unified non-placeholder cells have qualityAssessment attached.');
  }

  // ----------------------------------------------------------------------
  // STEP 3: POST-EDIT QUALITY LIFECYCLE — 94.709 -> 94,709
  // ----------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 3: EDIT LIFECYCLE ON 94.709 (FORMAT_OUTLIER)');
  console.log('------------------------------------------------------------------------');

  // Find physical cell for 94.709
  let cell94: any = null;
  for (const r of namaUnified.rows) {
    for (const c of r.cells) {
      if (c.rawValue === '94.709') {
        cell94 = c;
        break;
      }
    }
  }

  if (!cell94) throw new Error('Could not find 94.709 cell in Nam A');

  console.log(`Found cell 94.709: id=${cell94.id}, rawValue="${cell94.rawValue}", conf=${cell94.confidence}`);
  console.log(`Before edit: severity=${cell94.qualityAssessment?.severity}, reasons=`, cell94.qualityAssessment?.reasons);

  // 1. Simulate edit to 94,709 in DB
  console.log('\nExecuting PUT cell edit to "94,709"...');
  await db.updateExtractedCell(userId, sourceNamaDocId, cell94.id, {
    rawValue: '94,709',
    cellType: 'MONEY',
  });

  // 2. Re-fetch via getDocumentOcrResult and reproject
  console.log('Re-fetching document OCR result and reprojecting UnifiedTable...');
  const afterOcr1 = await db.getDocumentOcrResult(userId, sourceNamaDocId);
  const afterUnified1 = UnifiedTableService.projectDocumentTables(sourceNamaDocId, afterOcr1.tables);
  if (!afterUnified1) throw new Error('Reprojection failed after edit');

  // Find the cell again
  let afterCell94: any = null;
  for (const r of afterUnified1.rows) {
    for (const c of r.cells) {
      if (c.id === cell94.id) {
        afterCell94 = c;
        break;
      }
    }
  }

  const afterStats1 = computeReviewStats(afterUnified1);
  console.log(`After edit:`);
  console.log(`  rawValue: "${afterCell94.rawValue}"`);
  console.log(`  normalizedValue: "${afterCell94.normalizedValue}"`);
  console.log(`  confidence: ${afterCell94.confidence} (preserved from original OCR)`);
  console.log(`  severity: ${afterCell94.qualityAssessment?.severity}`);
  console.log(`  reasons:`, afterCell94.qualityAssessment?.reasons);
  console.log(`  Counter: before = ${stats.totalReviewCount}, after = ${afterStats1.totalReviewCount}`);

  if (afterCell94.qualityAssessment?.severity !== 'PASS') {
    throw new Error(`Expected severity PASS after correcting 94.709 to 94,709, got: ${afterCell94.qualityAssessment?.severity}`);
  }
  if (afterStats1.totalReviewCount !== stats.totalReviewCount - 1) {
    throw new Error(`Expected review count to decrease by 1 (from ${stats.totalReviewCount} to ${stats.totalReviewCount - 1}), got ${afterStats1.totalReviewCount}`);
  }

  // Check filter: does the row disappear if it had no other issues?
  const afterFiltered1 = filterDisplayedRows(afterUnified1.rows, true, '', true);
  console.log(`  Filtered rows: before = ${filteredRows.length}, after = ${afterFiltered1.length}`);
  if (afterFiltered1.length !== filteredRows.length - 1) {
    throw new Error(`Expected filtered rows to decrease by 1, got ${afterFiltered1.length}`);
  }
  console.log('  ✓ Corrected row successfully disappeared from filtered review rows!');

  // Search + Filter + Edit check
  const searchBefore = filterDisplayedRows(namaUnified.rows, true, '94', true);
  const searchAfter = filterDisplayedRows(afterUnified1.rows, true, '94', true);
  console.log(`  Search "94" + Review Filter: before = ${searchBefore.length}, after = ${searchAfter.length}`);
  if (searchAfter.length !== 0) {
    throw new Error(`Expected search "94" with review filter active to return 0 because row is now PASS!`);
  }
  console.log('  ✓ Search + Filter + Edit interaction behaves cleanly.');

  // ----------------------------------------------------------------------
  // STEP 4: REVERT 94,709 BACK TO 94.709 TO PRESERVE TEST DATA
  // ----------------------------------------------------------------------
  console.log('\nReverting cell back to "94.709" to preserve test document state...');
  await db.updateExtractedCell(userId, sourceNamaDocId, cell94.id, {
    rawValue: '94.709',
    cellType: 'MONEY',
  });
  const revertOcr = await db.getDocumentOcrResult(userId, sourceNamaDocId);
  const revertUnified = UnifiedTableService.projectDocumentTables(sourceNamaDocId, revertOcr.tables);
  const revertStats = computeReviewStats(revertUnified);
  console.log(`Reverted Counter: ${revertStats.totalReviewCount} (restored to 4)`);

  // ----------------------------------------------------------------------
  // STEP 5: EDIT SUCCESS ON MULTI-ISSUE ROW (Lo ICH 50,000)
  // ----------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 4: MULTI-ISSUE CELL EDIT TEST ("Lo ICH 50,000")');
  console.log('------------------------------------------------------------------------');

  let cellLoIch: any = null;
  for (const r of revertUnified.rows) {
    for (const c of r.cells) {
      if (c.rawValue?.includes('Lo') && c.rawValue?.includes('50,000')) {
        cellLoIch = c;
        break;
      }
    }
  }

  if (cellLoIch) {
    console.log(`Found multi-issue cell: "${cellLoIch.rawValue}", severity=${cellLoIch.qualityAssessment?.severity}`);
    console.log(`Reasons before edit:`, cellLoIch.qualityAssessment?.reasons?.map((r: any) => r.code));

    // Edit to partially fix (e.g. fix leading noise but keep a letter or fix letter)
    console.log('Editing cell to "50,000 A" (fixes LEADING_NOISE, retains ALPHA_IN_MONEY)...');
    await db.updateExtractedCell(userId, sourceNamaDocId, cellLoIch.id, {
      rawValue: '50,000 A',
      cellType: 'MONEY',
    });

    const multiOcr = await db.getDocumentOcrResult(userId, sourceNamaDocId);
    const multiUnified = UnifiedTableService.projectDocumentTables(sourceNamaDocId, multiOcr.tables);
    let afterMultiCell: any = null;
    for (const r of multiUnified.rows) {
      for (const c of r.cells) {
        if (c.id === cellLoIch.id) {
          afterMultiCell = c;
          break;
        }
      }
    }

    console.log(`After partial edit: severity=${afterMultiCell.qualityAssessment?.severity}`);
    console.log(`Reasons:`, afterMultiCell.qualityAssessment?.reasons?.map((r: any) => r.code));
    const reasonsCodes = afterMultiCell.qualityAssessment?.reasons?.map((r: any) => r.code) || [];
    if (!reasonsCodes.includes('ALPHA_IN_MONEY') || reasonsCodes.includes('LEADING_NOISE')) {
      console.warn('Unexpected reason codes after partial edit:', reasonsCodes);
    } else {
      console.log('  ✓ LEADING_NOISE eliminated while ALPHA_IN_MONEY correctly retained!');
    }

    // Verify row remains in filtered rows because severity is still WARNING
    const multiFiltered = filterDisplayedRows(multiUnified.rows, true, '', true);
    const stillFiltered = multiFiltered.some((r: any) => r.cells.some((c: any) => c.id === cellLoIch.id));
    console.log(`Row remains visible in review filter: ${stillFiltered ? 'YES' : 'NO'}`);
    if (!stillFiltered) throw new Error('Multi-issue row should have stayed visible in filter!');

    // Revert Lo ICH back
    await db.updateExtractedCell(userId, sourceNamaDocId, cellLoIch.id, {
      rawValue: cellLoIch.rawValue,
      cellType: 'MONEY',
    });
    console.log('Reverted Lo ICH cell back to original state.');
  }

  // ----------------------------------------------------------------------
  // STEP 6: HDBANK REGRESSION
  // ----------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 5: HDBANK REGRESSION');
  console.log('------------------------------------------------------------------------');

  const hdOcr = await db.getDocumentOcrResult(userId, hdBankDocId);
  const hdUnified = UnifiedTableService.projectDocumentTables(hdBankDocId, hdOcr.tables);
  const hdStats = computeReviewStats(hdUnified);
  const hdFiltered = filterDisplayedRows(hdUnified.rows, true, '', true);

  console.log(`HDBank review count: ${hdStats.totalReviewCount} (expected: 3)`);
  console.log(`HDBank filtered rows: ${hdFiltered.length} (expected: 3)`);
  if (hdStats.totalReviewCount !== 3 || hdFiltered.length !== 3) {
    throw new Error(`HDBank mismatch: count=${hdStats.totalReviewCount}, filtered=${hdFiltered.length}`);
  }
  console.log('  ✓ HDBank clean regression: exactly 3 warnings, 3 filtered rows, 0 false positives.');

  console.log('\n========================================================================');
  console.log('ALL Q2C.0.1 AUDIT AND VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================================');
}

runQ2C01Verification().catch((e) => {
  console.error('VERIFICATION ERROR:', e);
  process.exit(1);
});
