import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator.js';
import { UnifiedCell, UnifiedColumn, UnifiedRow } from '../server/services/unifiedTableService.js';

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

async function runPreGate() {
  console.log('=== Q2C.3.1.2 PRE-IMPLEMENTATION GATE ===\n');

  const numericPeers = [
    '0012345601', '0012345602', '0012345603', '0012345604', '0012345605',
    '0012345606', '0012345607', '0012345608', '0012345609', '0012345610'
  ];

  // A. numeric peers + ABC00010 -> PASS
  const resA = evaluateSingleValue('ABC00010', numericPeers);
  console.log('A. numeric peers + ABC00010: severity =', resA.severity, 'reasons =', resA.reasons);

  // B. numeric peers + ABC00020 with ABC00019 support -> PASS
  const resB = evaluateSingleValue('ABC00020', [...numericPeers, 'ABC00019']);
  console.log('B. numeric peers + ABC00020 (w/ ABC00019): severity =', resB.severity, 'reasons =', resB.reasons);

  // C. numeric peers + OO12345678 -> PASS (Known blind spot)
  const resC = evaluateSingleValue('OO12345678', numericPeers);
  console.log('C. numeric peers + OO12345678: severity =', resC.severity, 'reasons =', resC.reasons);

  // D. numeric peers + O012345678 -> WARNING
  const resD = evaluateSingleValue('O012345678', numericPeers);
  console.log('D. numeric peers + O012345678: severity =', resD.severity, 'reasons =', resD.reasons);

  // E. numeric peers + 00123456O1 -> WARNING
  const resE = evaluateSingleValue('00123456O1', numericPeers);
  console.log('E. numeric peers + 00123456O1: severity =', resE.severity, 'reasons =', resE.reasons);

  // F. numeric peers + 0012AB5601 -> WARNING
  const resF = evaluateSingleValue('0012AB5601', numericPeers);
  console.log('F. numeric peers + 0012AB5601: severity =', resF.severity, 'reasons =', resF.reasons);

  const passed =
    resA.severity === 'PASS' &&
    resB.severity === 'PASS' &&
    resC.severity === 'PASS' &&
    resD.severity === 'WARNING' &&
    resE.severity === 'WARNING' &&
    resF.severity === 'WARNING';

  console.log('\nPre-Implementation Gate Status:', passed ? 'VERIFIED (All 6 reproduced exactly)' : 'FAILED');
}

runPreGate();
