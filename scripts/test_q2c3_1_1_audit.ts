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

async function runAudit() {
  console.log('====================================================');
  console.log('Q2C.3.1.1 REFERENCE FINAL CLOSURE AUDIT');
  console.log('====================================================\n');

  // Base numeric peers (10 rows, all 10-digit integers)
  const numericPeers = [
    '0012345601', '0012345602', '0012345603', '0012345604', '0012345605',
    '0012345606', '0012345607', '0012345608', '0012345609', '0012345610'
  ];

  console.log('--- TEST A & B: TRUE MULTI-LETTER CORRUPTIONS IN NUMERIC PEERS ---');
  const corruptions = [
    { gt: '0012345678', ocr: 'AB12345678', desc: 'Arbitrary 2 letters AB' },
    { gt: '0012345678', ocr: 'OO12345678', desc: 'Double O confusion (OO -> 00)' },
    { gt: '0012345678', ocr: 'O012345678', desc: 'Single O + digit 0' },
    { gt: '0012345678', ocr: 'IO12345678', desc: 'Double confusion (IO -> 10)' },
    { gt: '0012345678', ocr: 'XX12345678', desc: 'Double non-confusion letters XX' },
  ];

  console.log('| Ground Truth | OCR Value | Description | Severity | Reasons | Silent Error? |');
  console.log('|---|---|---|---|---|---|');
  for (const c of corruptions) {
    const res = evaluateSingleValue(c.ocr, numericPeers);
    const isSilent = res.severity === 'PASS';
    console.log(`| ${c.gt} | ${c.ocr} | ${c.desc} | ${res.severity} | ${res.reasons.join(', ') || '[]'} | ${isSilent ? 'YES (SILENT ERROR)' : 'NO'} |`);
  }

  console.log('\n--- TEST C: LEGITIMATE ABC00010 (Control) ---');
  const resC = evaluateSingleValue('ABC00010', numericPeers);
  console.log('ABC00010 in numeric peers -> Severity:', resC.severity, 'Reasons:', resC.reasons);

  console.log('\n--- TEST D: TWO LEGITIMATE ALPHA PEERS (ABC00019, ABC00020) ---');
  const numPeersWithAlpha = [...numericPeers, 'ABC00019'];
  const resD = evaluateSingleValue('ABC00020', numPeersWithAlpha);
  console.log('ABC00020 with ABC00019 peer -> Severity:', resD.severity, 'Reasons:', resD.reasons);

  console.log('\n--- TEST E: TRUE SINGLE-LETTER INTRUSION (00123456O1) ---');
  const resE = evaluateSingleValue('00123456O1', numericPeers);
  console.log('00123456O1 -> Severity:', resE.severity, 'Reasons:', resE.reasons);

  console.log('\n--- TEST F: TRUE INTERNAL MULTI-LETTER CORRUPTION (0012AB5601) ---');
  const resF = evaluateSingleValue('0012AB5601', numericPeers);
  console.log('0012AB5601 -> Severity:', resF.severity, 'Reasons:', resF.reasons);

  console.log('\n====================================================');
  console.log('PERFORMANCE SCALING: 5,000 ROW BENCHMARK');
  console.log('====================================================');
  const testData5000 = Array.from({ length: 5000 }, (_, i) => `919ZTRF2429915O${i % 10}`);
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows5000 = testData5000.map((val, idx) => createMockRow([createMockCell(val, 0)], idx));

  const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;
  const t0 = performance.now();
  CellQualityEvaluator.evaluateTable([col], rows5000);
  const t1 = performance.now();
  const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;

  const totalTimeSec = (t1 - t0) / 1000;
  console.log(`5,000 rows completed in: ${(t1 - t0).toFixed(2)} ms (${totalTimeSec.toFixed(2)} s)`);
  console.log(`Average time per cell: ${((t1 - t0) / 5000).toFixed(3)} ms`);
  console.log(`Heap memory before: ${memBefore.toFixed(2)} MB, after: ${memAfter.toFixed(2)} MB, delta: ${(memAfter - memBefore).toFixed(2)} MB`);
}

runAudit();
