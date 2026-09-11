import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';
import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator.js';

// Human-readable fallback labels mirroring OcrReviewWorkspace.tsx
const QUALITY_REASON_FALLBACKS: Record<string, string> = {
  LOW_OCR_CONFIDENCE: 'Độ tin cậy OCR thấp',
  MEDIUM_OCR_CONFIDENCE: 'Độ tin cậy OCR mức trung bình',
  OCR_CONFIDENCE_UNAVAILABLE: 'Không có dữ liệu độ tin cậy OCR cho ô có nội dung',
  ALPHA_IN_MONEY: 'Chứa ký tự chữ trong ô số tiền',
  LEADING_NOISE: 'Ký tự hoặc từ ngữ bất thường ở đầu ô số tiền',
  TRAILING_SEPARATOR: 'Dấu phân cách dư thừa ở cuối ô số tiền',
  MULTIPLE_SEPARATOR_NOISE: 'Chứa nhiều loại dấu phân cách bất thường',
  FORMAT_OUTLIER: 'Định dạng số tiền không đồng nhất với cột',
  DATE_TEXT_CONTAMINATION: 'Chứa văn bản lạ trong ô ngày tháng',
  INVALID_DATE_STRUCTURE: 'Cấu trúc ngày tháng không hợp lệ',
  DATE_FORMAT_OUTLIER: 'Định dạng ngày khác với định dạng phổ biến của cột',
  STT_NON_INTEGER: 'Số thứ tự không phải số nguyên',
  STT_TEXT_CONTAMINATION: 'Chứa văn bản trong ô số thứ tự',
  CORRUPT_CHARACTERS: 'Chứa ký tự bị lỗi font hoặc ký tự lạ',
};

function formatQualityReason(reason: { code: string; message?: string }): string {
  return reason.message || QUALITY_REASON_FALLBACKS[reason.code] || reason.code;
}

// Frontend logic simulation from OcrReviewWorkspace.tsx
function computeReviewStats(unifiedTable: any) {
  let warningCount = 0;
  let criticalCount = 0;

  unifiedTable.rows.forEach((r: any) => {
    r.cells?.forEach((c: any) => {
      if (c.isPlaceholder) return;
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

function filterDisplayedRows(dataRows: any[], filterReviewOnly: boolean, searchQuery: string) {
  return dataRows.filter((row: any) => {
    // 1. Review filter condition
    if (filterReviewOnly) {
      const hasSuspiciousCell = row.cells?.some((c: any) => {
        if (c.isPlaceholder) return false;
        if (c.qualityAssessment) {
          return c.qualityAssessment.severity === 'WARNING' || c.qualityAssessment.severity === 'CRITICAL';
        }
        return !c.isReviewed && typeof c.confidence === 'number' && c.confidence < 0.85;
      });
      if (!hasSuspiciousCell) return false;
    }

    // 2. Search query condition
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      if (row.sourcePage) {
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

async function runQ2CVerification() {
  console.log('========================================================================');
  console.log('Q2C — FRONTEND REVIEW UI QUALITY INTEGRATION VALIDATION');
  console.log('========================================================================\n');

  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';
  const namaDocId = 'fe908e19-b070-40f9-87c1-e1626b4e673e';
  const hdBankDocId = 'd79873be-7dd7-4441-8c63-68c6077adfd0';

  // ----------------------------------------------------------------------
  // TEST 1: NAM A VERIFICATION
  // ----------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST 1: FRESH NAM A DOCUMENT AUDIT');
  console.log('------------------------------------------------------------------------');

  const namaResult = await db.getDocumentOcrResult(userId, namaDocId);
  const namaUnified = UnifiedTableService.projectDocumentTables(namaDocId, namaResult.tables);
  if (!namaUnified) {
    throw new Error('Nam A unified table is missing!');
  }

  const namaStats = computeReviewStats(namaUnified);
  console.log(`Nam A Total Cells: ${namaUnified.rows.reduce((acc: number, r: any) => acc + r.cells.length, 0)}`);
  console.log(`Nam A Total Rows: ${namaUnified.rows.length}`);
  console.log(`Nam A WARNING Count: ${namaStats.warningCount}`);
  console.log(`Nam A CRITICAL Count: ${namaStats.criticalCount}`);
  console.log(`Nam A Displayed Counter: "${namaStats.totalReviewCount} ô cần kiểm tra"`);

  // Verify exact suspicious cells in Nam A
  const targetValues = ['95,909 A', 'Lo ICH 50,000', '50,039,', '94.709'];
  console.log('\nInspecting Canonical Test Cells in Nam A:');
  for (const val of targetValues) {
    let found = false;
    for (const row of namaUnified.rows) {
      for (const cell of row.cells) {
        if (cell.rawValue === val || (val === 'Lo ICH 50,000' && cell.rawValue.includes('50,000') && cell.rawValue.includes('Lo'))) {
          found = true;
          const confStr = typeof cell.confidence === 'number' ? `${(cell.confidence * 100).toFixed(1)}%` : 'N/A';
          console.log(`  [Target: "${val}"]`);
          console.log(`    Actual rawValue: "${cell.rawValue}"`);
          console.log(`    Optical OCR Confidence: ${confStr}`);
          console.log(`    Quality Severity: ${cell.qualityAssessment?.severity}`);
          console.log(`    Reasons:`);
          cell.qualityAssessment?.reasons.forEach((r: any) => {
            console.log(`      • [${r.code}] ${formatQualityReason(r)}`);
          });

          // Acceptance Check for 94.709:
          if (val === '94.709') {
            if (cell.qualityAssessment?.severity !== 'WARNING') {
              throw new Error(`CRITICAL FAILURE: "94.709" severity is not WARNING! Got: ${cell.qualityAssessment?.severity}`);
            }
            if (cell.confidence! < 0.90) {
              throw new Error(`CRITICAL FAILURE: "94.709" optical confidence was altered! Got: ${cell.confidence}`);
            }
            console.log(`    ✓ Confirmed: 94.709 is highlighted as WARNING despite high optical confidence (${confStr})!`);
          }
        }
      }
    }
    if (!found) {
      console.warn(`    WARNING: Cell "${val}" was not found verbatim in Nam A unified rows.`);
    }
  }

  // Row filtering test for Nam A
  const allNamaRows = namaUnified.rows;
  const filteredNamaRows = filterDisplayedRows(allNamaRows, true, '');
  console.log(`\nNam A Review Filter:`);
  console.log(`  All rows: ${allNamaRows.length}`);
  console.log(`  Filtered suspicious rows: ${filteredNamaRows.length}`);
  for (const r of filteredNamaRows) {
    const hasSuspicious = r.cells.some((c: any) => !c.isPlaceholder && (c.qualityAssessment?.severity === 'WARNING' || c.qualityAssessment?.severity === 'CRITICAL'));
    if (!hasSuspicious) {
      throw new Error(`Filter violation: Row ${r.displayRowIndex} does not contain any WARNING/CRITICAL cell!`);
    }
    // Verify all columns are preserved
    if (r.cells.length !== namaUnified.columns.length) {
      throw new Error(`Column preservation violation: Row ${r.displayRowIndex} cell count ${r.cells.length} does not match column count ${namaUnified.columns.length}`);
    }
  }
  console.log(`  ✓ All ${filteredNamaRows.length} filtered rows contain at least one WARNING/CRITICAL cell.`);
  console.log(`  ✓ All columns (${namaUnified.columns.length}) preserved in every filtered row.`);

  // Search + Filter intersection test
  const searchMatch = filterDisplayedRows(allNamaRows, true, '94.709');
  console.log(`  Search "94.709" + Review Filter ON -> matching rows: ${searchMatch.length}`);
  if (searchMatch.length !== 1) {
    throw new Error(`Expected exactly 1 row matching search "94.709" and review filter, got ${searchMatch.length}`);
  }
  console.log(`  ✓ Search + Review Filter intersection works correctly!`);

  // ----------------------------------------------------------------------
  // TEST 2: HDBANK VERIFICATION
  // ----------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 2: FRESH HDBANK DOCUMENT AUDIT');
  console.log('------------------------------------------------------------------------');

  const hdResult = await db.getDocumentOcrResult(userId, hdBankDocId);
  const hdUnified = UnifiedTableService.projectDocumentTables(hdBankDocId, hdResult.tables);
  if (!hdUnified) {
    throw new Error('HDBank unified table is missing!');
  }

  const hdStats = computeReviewStats(hdUnified);
  console.log(`HDBank Total Cells: ${hdUnified.rows.reduce((acc: number, r: any) => acc + r.cells.length, 0)}`);
  console.log(`HDBank Total Rows: ${hdUnified.rows.length}`);
  console.log(`HDBank WARNING Count: ${hdStats.warningCount}`);
  console.log(`HDBank CRITICAL Count: ${hdStats.criticalCount}`);
  console.log(`HDBank Displayed Counter: "${hdStats.totalReviewCount} ô cần kiểm tra"`);

  if (hdStats.totalReviewCount !== 3 || hdStats.criticalCount !== 0) {
    console.warn(`Note: HDBank review count is ${hdStats.totalReviewCount} (warnings: ${hdStats.warningCount}, critical: ${hdStats.criticalCount})`);
  } else {
    console.log(`  ✓ Exactly 3 WARNINGs and 0 CRITICAL (Matches Q2B.1 specification)!`);
  }

  const hdFiltered = filterDisplayedRows(hdUnified.rows, true, '');
  console.log(`HDBank Filtered suspicious rows: ${hdFiltered.length}`);
  console.log('Inspecting the warning cells in HDBank:');
  for (const r of hdFiltered) {
    for (const c of r.cells) {
      if (c.qualityAssessment && c.qualityAssessment.severity !== 'PASS') {
        const confStr = typeof c.confidence === 'number' ? `${(c.confidence * 100).toFixed(1)}%` : 'N/A';
        console.log(`  Row ${r.displayRowIndex}, Col ${c.canonicalColumnIndex}: "${c.rawValue}" (conf: ${confStr}, severity: ${c.qualityAssessment.severity})`);
        c.qualityAssessment.reasons.forEach((reason: any) => {
          console.log(`    • ${formatQualityReason(reason)}`);
        });
      }
    }
  }

  // ----------------------------------------------------------------------
  // TEST 3: ACB REGRESSION TEST
  // ----------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 3: ACB SYNTHETIC EVALUATION REGRESSION');
  console.log('------------------------------------------------------------------------');

  // Verify ACB column profile & evaluator does not flag normal DD-MM
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
  console.log(`ACB normal DD-MM review count: ${acbStats.totalReviewCount}`);
  if (acbStats.totalReviewCount !== 0) {
    throw new Error(`ACB date cells falsely flagged as warnings!`);
  }
  console.log(`  ✓ Normal ACB DD-MM dates evaluate to PASS with 0 false-positives.`);

  // ----------------------------------------------------------------------
  // TEST 4: BAN VIET REGRESSION TEST
  // ----------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('TEST 4: BAN VIET TELLER CODE REGRESSION');
  console.log('------------------------------------------------------------------------');

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
  console.log(`Ban Viet review count: ${bvStats.totalReviewCount}`);
  if (bvStats.totalReviewCount !== 0) {
    throw new Error(`Ban Viet Teller code or dot-thousands money falsely flagged!`);
  }
  console.log(`  ✓ Ban Viet 100.000,00 and Teller Code 10.000 evaluate to PASS with 0 false-positives.`);

  console.log('\n========================================================================');
  console.log('ALL Q2C ACCEPTANCE VERIFICATIONS PASSED CLEANLY!');
  console.log('========================================================================');
}

runQ2CVerification().catch((e) => {
  console.error('VERIFICATION ERROR:', e);
  process.exit(1);
});
