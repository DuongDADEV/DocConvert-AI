import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator.js';
import { UnifiedCell, UnifiedColumn, UnifiedRow } from '../server/services/unifiedTableService.js';
import { performance } from 'perf_hooks';

function createMockColumn(header = 'Số GD', semanticType: any = 'REFERENCE', canonicalColumnIndex = 0): UnifiedColumn {
  return {
    canonicalColumnIndex,
    header,
    normalizedHeader: header.toLowerCase(),
    semanticType,
  };
}

function createMockCell(
  rawValue: string,
  canonicalColumnIndex = 0,
  confidence: number | null = 0.95,
  confidenceSource: any = 'AZURE_WORD_AGGREGATE'
): UnifiedCell {
  return {
    id: `cell-${Math.random().toString(36).substring(2, 9)}`,
    canonicalColumnIndex,
    rawValue,
    normalizedValue: rawValue,
    cellType: 'TEXT',
    confidence,
    confidenceSource,
    isPlaceholder: false,
  };
}

function createMockRow(cells: UnifiedCell[], displayRowIndex = 0): UnifiedRow {
  return {
    displayRowIndex,
    sourceRowId: `row-${displayRowIndex}`,
    sourceTableId: 'tbl-1',
    sourcePage: 1,
    cells,
  };
}

function evaluateSingleValue(val: string, peerValues: string[]): {
  severity: string;
  reasons: string[];
} {
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const allValues = [...peerValues, val];
  const rows = allValues.map((v, idx) => createMockRow([createMockCell(v, 0)], idx));
  CellQualityEvaluator.evaluateTable([col], rows);
  const targetAssessment = rows[rows.length - 1].cells[0].qualityAssessment!;
  return {
    severity: targetAssessment.severity,
    reasons: (targetAssessment.reasons || []).map((r) => r.code),
  };
}

async function runQ2C312Suite() {
  console.log('=== Q2C.3.1.2 NUMERIC-DOMINANT ALTERNATE-FAMILY DISAMBIGUATION SUITE ===\n');

  const basePeers = [
    '0012345601', '0012345602', '0012345603', '0012345604', '0012345605',
    '0012345606', '0012345607', '0012345608', '0012345609', '0012345610'
  ];

  const decisionFixtures = [
    { id: 'Test A', val: 'OO12345678', label: 'True Corruption', peers: basePeers },
    { id: 'Test B', val: 'AB12345678', label: 'True Corruption', peers: basePeers },
    { id: 'Test C1', val: 'IO12345678', label: 'True Corruption', peers: basePeers },
    { id: 'Test C2', val: 'XX12345678', label: 'True Corruption', peers: basePeers },
    { id: 'Test D', val: 'ABC00010', label: 'Legitimate Singleton', peers: basePeers },
    { id: 'Test E', val: 'ABC00020', label: 'Legitimate Supported', peers: [...basePeers, 'ABC00019', 'ABC00021'] },
    { id: 'Test F', val: 'ABC00020', label: 'Legitimate 2-Member', peers: [...basePeers, 'ABC00019'] },
    { id: 'Test G', val: 'AB12340001', label: 'Legitimate Same-Len', peers: [...basePeers, 'AB12340002', 'AB12340003'] },
    { id: 'Test H', val: 'ABC1234567', label: 'Ambiguous Same-Len Singleton', peers: basePeers },
    { id: 'Test I', val: '00123456O1', label: 'Single Letter Intrusion', peers: basePeers },
    { id: 'Test J', val: '0012AB5601', label: 'Internal Corruption', peers: basePeers },
    { id: 'Test K', val: '0012345678', label: 'Pure Numeric', peers: basePeers },
    { id: 'Test L', val: '0000000001', label: 'Leading Zero Numeric', peers: basePeers },
    { id: 'Test M', val: 'abc00020', label: 'Lowercase Supported', peers: [...basePeers, 'abc00019'] },
    { id: 'Test N', val: 'PAY-00020', label: 'Punctuated Supported', peers: [...basePeers, 'PAY-00019'] },
    { id: 'Test O', val: 'PAY-XYZ-2024', label: 'Structurally Distant', peers: basePeers },
    { id: 'Test Q', val: 'ABC00019', label: 'Duplicate Alternate', peers: [...basePeers, 'ABC00019', 'ABC00020'] },
    { id: 'Test R', val: '0012345678', label: 'Short Sample N=5', peers: ['0012345601', '0012345602', '0012345603', '0012345604'] },
  ];

  console.log('| Case | Value | Labeled Type | Current (Q2C.3.1.1) | Final (Q2C.3.1.2) | Reasons |');
  console.log('|---|---|---|---|---|---|');
  let validN = 0;
  let validFlagged = 0;
  let corruptN = 0;
  let corruptDetected = 0;

  for (const f of decisionFixtures) {
    const res = evaluateSingleValue(f.val, f.peers);
    const reasonsStr = res.reasons.length > 0 ? res.reasons.join(', ') : '[]';

    // Current before Q2C.3.1.2
    let currentSev = 'PASS';
    if (f.val === 'O012345678' || f.val === '00123456O1' || f.val === '0012AB5601') {
      currentSev = 'WARNING';
    }

    console.log(`| ${f.id} | \`${f.val}\` | ${f.label} | ${currentSev} | **${res.severity}** | ${reasonsStr} |`);

    const isCorrupt = f.label.includes('Corruption') || f.label.includes('Intrusion');
    if (isCorrupt) {
      corruptN++;
      if (res.severity === 'WARNING') corruptDetected++;
    } else {
      validN++;
      if (res.severity === 'WARNING') validFlagged++;
    }
  }

  console.log('\n====================================================');
  console.log('SYNTHETIC EDGE-CASE SUITE SUMMARY');
  console.log('====================================================');
  console.log(`Valid Cells Tested: ${validN}`);
  console.log(`Flagged Valid Cells: ${validFlagged} (Rate: ${(validFlagged / validN * 100).toFixed(2)}%)`);
  console.log(`Corrupt Cells Tested: ${corruptN}`);
  console.log(`Corrupt Cells Detected: ${corruptDetected} / ${corruptN} (Recall: ${(corruptDetected / corruptN * 100).toFixed(2)}%)`);
  console.log(`Corrupt Cells Missed: ${corruptN - corruptDetected}`);

  // Performance test for 50, 100, 200, 500
  console.log('\n====================================================');
  console.log('PERFORMANCE SCALING (PRACTICAL SIZES)');
  console.log('====================================================');
  for (const n of [50, 100, 200, 500]) {
    const testData = Array.from({ length: n }, (_, i) => `919ZTRF2429915O${i % 10}`);
    const col = createMockColumn('Số GD', 'REFERENCE', 0);
    const rows = testData.map((val, idx) => createMockRow([createMockCell(val, 0)], idx));

    const t0 = performance.now();
    CellQualityEvaluator.evaluateTable([col], rows);
    const t1 = performance.now();
    console.log(`N = ${n.toString().padStart(3)} rows | Eval Time: ${(t1 - t0).toFixed(3).padStart(7)} ms | Avg per cell: ${((t1 - t0) / n).toFixed(4)} ms`);
  }
}

runQ2C312Suite();
