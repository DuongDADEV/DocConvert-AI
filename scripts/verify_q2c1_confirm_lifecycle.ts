import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';
import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator.js';
import { isUnifiedCellNeedsReview } from '../src/components/ocr/OcrReviewWorkspace.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function filterDisplayedRows(dataRows: any[], filterReviewOnly: boolean, searchQuery: string, isUnified: boolean) {
  return dataRows.filter((row: any) => {
    // 1. Review filter condition: row must contain at least one real cell needing review
    if (filterReviewOnly) {
      const hasSuspiciousCell = row.cells?.some((c: any) => {
        if (isUnified) {
          return isUnifiedCellNeedsReview(c);
        }
        return false;
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
      if (!isUnifiedCellNeedsReview(c)) return;
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

async function runQ2C1Verification() {
  console.log('========================================================================');
  console.log('Q2C.1 — GENERIC HUMAN REVIEW / CONFIRM-AS-IS LIFECYCLE VALIDATION');
  console.log('========================================================================\n');

  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';
  const namADocId = 'fe908e19-b070-40f9-87c1-e1626b4e673e';
  const hdBankDocId = 'd79873be-7dd7-4441-8c63-68c6077adfd0';
  const acbDocId = '3037eb96-03fc-4ce0-8d5f-3c66bf63c22b';
  const banVietDocId = '1ceceaf7-2c1b-4f01-92b6-ee97be7d193d';

  // ----------------------------------------------------------------------
  // TEST 1: CONFIRM WARNING AS-IS (Nam A: FORMAT_OUTLIER)
  // ----------------------------------------------------------------------
  console.log('--- TEST 1: Confirm WARNING Cell As-Is (Nam A) ---');
  let ocrResult = await db.getDocumentOcrResult(userId, namADocId);
  let unifiedTable = UnifiedTableService.projectDocumentTables(namADocId, ocrResult.tables)!;

  // Reset cells to unreviewed state first for repeatable test
  await supabase.from('extracted_cells').update({ is_reviewed: false }).neq('id', '00000000-0000-0000-0000-000000000000');
  
  ocrResult = await db.getDocumentOcrResult(userId, namADocId);
  unifiedTable = UnifiedTableService.projectDocumentTables(namADocId, ocrResult.tables)!;

  const initialStats = computeReviewStats(unifiedTable);
  const initialFilteredRows = filterDisplayedRows(unifiedTable.rows, true, '', true);
  console.log(`Initial Stats: totalReviewCount=${initialStats.totalReviewCount}, warnings=${initialStats.warningCount}, criticals=${initialStats.criticalCount}`);
  console.log(`Initial Filtered Rows: ${initialFilteredRows.length}`);

  // Find a WARNING cell (e.g. FORMAT_OUTLIER)
  const warningCell = unifiedTable.rows.flatMap((r: any) => r.cells).find(
    (c: any) => !c.isPlaceholder && c.qualityAssessment?.severity === 'WARNING'
  );
  if (!warningCell) throw new Error('Could not find WARNING cell in Nam A test fixture');

  console.log(`Target WARNING Cell ID: ${warningCell.id}`);
  console.log(`Before Confirm: rawValue="${warningCell.rawValue}", confidence=${warningCell.confidence}, severity=${warningCell.qualityAssessment?.severity}, reasons=${JSON.stringify(warningCell.qualityAssessment?.reasons.map((r: any) => r.code))}, isReviewed=${warningCell.isReviewed}`);

  // Perform Confirm As-Is via DB (simulates PUT /confirm-review)
  await db.updateExtractedCell(userId, namADocId, warningCell.id, { isReviewed: true });

  // Refetch & rebuild from server
  let postConfirmOcr = await db.getDocumentOcrResult(userId, namADocId);
  let postConfirmUnified = UnifiedTableService.projectDocumentTables(namADocId, postConfirmOcr.tables)!;
  let postWarningCell = postConfirmUnified.rows.flatMap((r: any) => r.cells).find((c: any) => c.id === warningCell.id);

  console.log(`After Confirm: rawValue="${postWarningCell.rawValue}", confidence=${postWarningCell.confidence}, severity=${postWarningCell.qualityAssessment?.severity}, reasons=${JSON.stringify(postWarningCell.qualityAssessment?.reasons.map((r: any) => r.code))}, isReviewed=${postWarningCell.isReviewed}`);

  // Assertions for Test 1
  if (postWarningCell.rawValue !== warningCell.rawValue) throw new Error('rawValue mutated on confirm!');
  if (postWarningCell.confidence !== warningCell.confidence) throw new Error('confidence mutated on confirm!');
  if (postWarningCell.qualityAssessment?.severity !== 'WARNING') throw new Error('Machine severity mutated on confirm (must remain WARNING)!');
  if (postWarningCell.isReviewed !== true) throw new Error('isReviewed not true after confirm!');

  const postStats = computeReviewStats(postConfirmUnified);
  const postFilteredRows = filterDisplayedRows(postConfirmUnified.rows, true, '', true);
  console.log(`Post-Confirm Stats: totalReviewCount=${postStats.totalReviewCount} (was ${initialStats.totalReviewCount}), warnings=${postStats.warningCount} (was ${initialStats.warningCount})`);
  console.log(`Post-Confirm Filtered Rows: ${postFilteredRows.length} (was ${initialFilteredRows.length})`);

  if (postStats.totalReviewCount !== initialStats.totalReviewCount - 1) {
    throw new Error(`Counter mathematical violation: expected ${initialStats.totalReviewCount - 1}, got ${postStats.totalReviewCount}`);
  }
  console.log('✓ TEST 1 PASS: WARNING confirmed as-is, machine quality immutable, counter decreased by exactly 1.\n');

  // ----------------------------------------------------------------------
  // TEST 2: CONFIRM CRITICAL AS-IS (Nam A: CRITICAL ANOMALY)
  // ----------------------------------------------------------------------
  console.log('--- TEST 2: Confirm CRITICAL Cell As-Is (Nam A) ---');
  const criticalCell = postConfirmUnified.rows.flatMap((r: any) => r.cells).find(
    (c: any) => !c.isPlaceholder && c.qualityAssessment?.severity === 'CRITICAL' && !c.isReviewed
  );
  if (!criticalCell) throw new Error('Could not find CRITICAL cell in Nam A test fixture');

  console.log(`Target CRITICAL Cell ID: ${criticalCell.id}`);
  console.log(`Before Confirm: rawValue="${criticalCell.rawValue}", severity=${criticalCell.qualityAssessment?.severity}, isReviewed=${criticalCell.isReviewed}`);

  await db.updateExtractedCell(userId, namADocId, criticalCell.id, { isReviewed: true });

  postConfirmOcr = await db.getDocumentOcrResult(userId, namADocId);
  postConfirmUnified = UnifiedTableService.projectDocumentTables(namADocId, postConfirmOcr.tables)!;
  let postCriticalCell = postConfirmUnified.rows.flatMap((r: any) => r.cells).find((c: any) => c.id === criticalCell.id);

  console.log(`After Confirm: rawValue="${postCriticalCell.rawValue}", severity=${postCriticalCell.qualityAssessment?.severity}, isReviewed=${postCriticalCell.isReviewed}`);

  if (postCriticalCell.qualityAssessment?.severity !== 'CRITICAL') {
    throw new Error('CRITICAL must NOT be downgraded on confirm!');
  }
  if (postCriticalCell.isReviewed !== true) throw new Error('isReviewed not true!');

  const postCritStats = computeReviewStats(postConfirmUnified);
  console.log(`Post-Critical Stats: totalReviewCount=${postCritStats.totalReviewCount} (was ${postStats.totalReviewCount}), criticalCount=${postCritStats.criticalCount} (was ${postStats.criticalCount})`);
  if (postCritStats.criticalCount !== postStats.criticalCount - 1) {
    throw new Error('Critical count did not decrement by 1!');
  }
  console.log('✓ TEST 2 PASS: CRITICAL confirmed as-is, machine severity remains CRITICAL, counter decreased by 1.\n');

  // ----------------------------------------------------------------------
  // TEST 3: HDBANK LOW_OCR_CONFIDENCE CONFIRM & PERSISTENCE
  // ----------------------------------------------------------------------
  console.log('--- TEST 3: HDBank LOW_OCR_CONFIDENCE Warning Confirm ---');
  const hdbOcr = await db.getDocumentOcrResult(userId, hdBankDocId);
  const hdbUnified = UnifiedTableService.projectDocumentTables(hdBankDocId, hdbOcr.tables)!;
  const hdbInitialStats = computeReviewStats(hdbUnified);
  console.log(`HDBank Initial Review Count: ${hdbInitialStats.totalReviewCount} (warnings: ${hdbInitialStats.warningCount})`);

  const hdbLowConfCell = hdbUnified.rows.flatMap((r: any) => r.cells).find(
    (c: any) => !c.isPlaceholder && c.qualityAssessment?.reasons.some((re: any) => re.code === 'LOW_OCR_CONFIDENCE')
  );
  if (!hdbLowConfCell) throw new Error('Could not find LOW_OCR_CONFIDENCE cell in HDBank fixture');

  console.log(`HDBank Target Cell: value="${hdbLowConfCell.rawValue}", conf=${hdbLowConfCell.confidence}, reasons=${JSON.stringify(hdbLowConfCell.qualityAssessment?.reasons.map((re: any) => re.code))}`);

  await db.updateExtractedCell(userId, hdBankDocId, hdbLowConfCell.id, { isReviewed: true });

  // Independent API fetch verification
  const hdbPostOcr = await db.getDocumentOcrResult(userId, hdBankDocId);
  const hdbPostUnified = UnifiedTableService.projectDocumentTables(hdBankDocId, hdbPostOcr.tables)!;
  const hdbPostCell = hdbPostUnified.rows.flatMap((r: any) => r.cells).find((c: any) => c.id === hdbLowConfCell.id);

  console.log(`HDBank Cell after Confirm: value="${hdbPostCell.rawValue}", conf=${hdbPostCell.confidence}, severity=${hdbPostCell.qualityAssessment?.severity}, isReviewed=${hdbPostCell.isReviewed}`);
  if (hdbPostCell.isReviewed !== true) throw new Error('HDBank cell isReviewed is not true on server!');
  if (hdbPostCell.qualityAssessment?.severity !== 'WARNING') throw new Error('Machine severity mutated!');

  const hdbPostStats = computeReviewStats(hdbPostUnified);
  console.log(`HDBank Post Stats: ${hdbPostStats.totalReviewCount} (was ${hdbInitialStats.totalReviewCount})`);
  if (hdbPostStats.totalReviewCount !== hdbInitialStats.totalReviewCount - 1) {
    throw new Error('HDBank review count did not decrease by 1!');
  }
  console.log('✓ TEST 3 PASS: HDBank LOW_OCR_CONFIDENCE confirmed as-is, server truth verified, counter decreased by 1.\n');

  // ----------------------------------------------------------------------
  // TEST 4: REVIEW_ACTIONS AUDIT RECORD
  // ----------------------------------------------------------------------
  console.log('--- TEST 4: Review Actions Audit Record ---');
  const { data: actions, error: actErr } = await supabase
    .from('review_actions')
    .select('*')
    .eq('cell_id', hdbLowConfCell.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (actErr || !actions || actions.length === 0) {
    throw new Error('No review_actions recorded!');
  }
  console.log(`Review action recorded: action_type=${actions[0].action_type}, cell_id=${actions[0].cell_id}, created_at=${actions[0].created_at}`);
  if (actions[0].action_type !== 'CONFIRM_AS_IS') {
    throw new Error(`Expected action_type 'CONFIRM_AS_IS', got '${actions[0].action_type}'`);
  }
  console.log('✓ TEST 4 PASS: review_actions record safely recorded with CONFIRM_AS_IS.\n');

  // ----------------------------------------------------------------------
  // TEST 5: REGRESSION SUITE (ACB DD-MM, Ban Viet Teller Code)
  // ----------------------------------------------------------------------
  console.log('--- TEST 5: Regression Fixtures (ACB & Ban Viet) ---');
  // Check ACB DD-MM dates
  const acbColumns: any[] = [
    { canonicalColumnIndex: 0, header: 'Ngày GD', normalizedHeader: 'NGAY GD', semanticType: 'DATE' },
    { canonicalColumnIndex: 1, header: 'Số tiền', normalizedHeader: 'SO TIEN', semanticType: 'DEBIT' },
  ];
  const acbRows: any[] = [
    { displayRowIndex: 0, sourceRowId: '1', sourceTableId: '1', sourcePage: 1, cells: [
      { id: 'c1', canonicalColumnIndex: 0, rawValue: '15-08', normalizedValue: '15/08', confidence: 0.95 },
      { id: 'c2', canonicalColumnIndex: 1, rawValue: '500,000', normalizedValue: '500000', confidence: 0.95 },
    ]},
    { displayRowIndex: 1, sourceRowId: '2', sourceTableId: '1', sourcePage: 1, cells: [
      { id: 'c3', canonicalColumnIndex: 0, rawValue: '16-08', normalizedValue: '16/08', confidence: 0.95 },
      { id: 'c4', canonicalColumnIndex: 1, rawValue: '1,200,000', normalizedValue: '1200000', confidence: 0.95 },
    ]},
    { displayRowIndex: 2, sourceRowId: '3', sourceTableId: '1', sourcePage: 1, cells: [
      { id: 'c5', canonicalColumnIndex: 0, rawValue: '17-08', normalizedValue: '17/08', confidence: 0.95 },
      { id: 'c6', canonicalColumnIndex: 1, rawValue: '300,000', normalizedValue: '300000', confidence: 0.95 },
    ]},
  ];
  CellQualityEvaluator.evaluateTable(acbColumns, acbRows);
  const acbStats = computeReviewStats({ rows: acbRows });
  console.log(`ACB Total Reviews: ${acbStats.totalReviewCount}, Warnings: ${acbStats.warningCount}`);
  if (acbStats.totalReviewCount !== 0) throw new Error('ACB DD-MM regression detected!');

  // Ban Viet Teller Code & Local Money
  const bvColumns: any[] = [
    { canonicalColumnIndex: 0, header: 'Số tiền GD', normalizedHeader: 'SO TIEN GD', semanticType: 'DEBIT' },
    { canonicalColumnIndex: 1, header: 'Mã GDV', normalizedHeader: 'MA GDV', semanticType: 'OTHER' },
  ];
  const bvRows: any[] = [
    { displayRowIndex: 0, sourceRowId: '1', sourceTableId: '1', sourcePage: 1, cells: [
      { id: 'b1', canonicalColumnIndex: 0, rawValue: '100.000,00', normalizedValue: '100000', confidence: 0.95 },
      { id: 'b2', canonicalColumnIndex: 1, rawValue: '10.000', normalizedValue: '10000', confidence: 0.95 },
    ]},
    { displayRowIndex: 1, sourceRowId: '2', sourceTableId: '1', sourcePage: 1, cells: [
      { id: 'b3', canonicalColumnIndex: 0, rawValue: '250.000,00', normalizedValue: '250000', confidence: 0.95 },
      { id: 'b4', canonicalColumnIndex: 1, rawValue: '10.000', normalizedValue: '10000', confidence: 0.95 },
    ]},
  ];
  CellQualityEvaluator.evaluateTable(bvColumns, bvRows);
  const bvStats = computeReviewStats({ rows: bvRows });
  console.log(`Ban Viet Total Reviews: ${bvStats.totalReviewCount}`);
  if (bvStats.totalReviewCount !== 0) throw new Error('Ban Viet Teller code regression detected!');
  console.log('✓ TEST 5 PASS: ACB DD-MM (0 false positives) & Ban Viet unaffected.\n');

  // Reset test cells back
  await supabase.from('extracted_cells').update({ is_reviewed: false }).in('id', [warningCell.id, criticalCell.id, hdbLowConfCell.id]);
  console.log('Reset test cells back to clean state.');

  console.log('========================================================================');
  console.log('ALL Q2C.1 VERIFICATIONS PASSED WITH ZERO VIOLATIONS!');
  console.log('========================================================================');
}

runQ2C1Verification().catch((err) => {
  console.error('Q2C.1 Verification FAILED:', err);
  process.exit(1);
});
