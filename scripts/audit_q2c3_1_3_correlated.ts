import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator';
import { UnifiedCell, UnifiedColumn, UnifiedRow } from '../server/services/unifiedTableService';

function createMockColumn(header: string, semanticType: any = 'REFERENCE', canonicalColumnIndex = 0): UnifiedColumn {
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

function evaluateValues(values: string[]) {
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = values.map((v, i) => createMockRow([createMockCell(v, 0, 0.95)], i));
  CellQualityEvaluator.evaluateTable([col], rows);
  return rows.map((r, i) => ({
    value: values[i],
    assessment: r.cells[0].qualityAssessment!,
  }));
}

const numericPeers10 = [
  '0012345601',
  '0012345602',
  '0012345603',
  '0012345604',
  '0012345605',
  '0012345606',
  '0012345607',
  '0012345608',
  '0012345609',
  '0012345610',
];

console.log('=== SECTION 1: PRE-GATE BASELINE REPRODUCTION ===');
const baselineCases = [
  { name: 'A: OO singleton', val: 'OO12345678', list: [...numericPeers10, 'OO12345678'], exp: 'WARNING' },
  { name: 'B: AB singleton', val: 'AB12345678', list: [...numericPeers10, 'AB12345678'], exp: 'WARNING' },
  { name: 'C: ABC00010', val: 'ABC00010', list: [...numericPeers10, 'ABC00010'], exp: 'PASS' },
  { name: 'D: ABC00019 + ABC00020', val: 'ABC00019', list: [...numericPeers10, 'ABC00019', 'ABC00020'], exp: 'PASS' },
  { name: 'E: AB12340001 + AB12340002', val: 'AB12340001', list: [...numericPeers10, 'AB12340001', 'AB12340002'], exp: 'PASS' },
  { name: 'F: 00123456O1', val: '00123456O1', list: [...numericPeers10, '00123456O1'], exp: 'WARNING' },
  { name: 'G: 0012AB5601', val: '0012AB5601', list: [...numericPeers10, '0012AB5601'], exp: 'WARNING' },
];

let baselineAllPassed = true;
for (const tc of baselineCases) {
  const results = evaluateValues(tc.list);
  const targetRes = results.find(r => r.value === tc.val);
  const pass = targetRes?.assessment.severity === tc.exp;
  if (!pass) baselineAllPassed = false;
  console.log(`[${pass ? 'OK' : 'FAIL'}] ${tc.name}: got ${targetRes?.assessment.severity} (expected ${tc.exp}), reasons: ${targetRes?.assessment.reasons.map(r => r.code).join(',')}`);
}

console.log('Baseline reproduced successfully:', baselineAllPassed);

console.log('\n=== TESTING Q2C.3.1.3 SPECIFIC TESTS ===');

console.log('\n--- TEST A: TWO SAME-PREFIX CORRUPTIONS (OO12345678 + OO12345679) ---');
const resA = evaluateValues([...numericPeers10, 'OO12345678', 'OO12345679']);
for (const r of resA.filter(x => x.value.startsWith('OO'))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('\n--- TEST B: THREE SAME-PREFIX CORRUPTIONS (OO12345678 + OO12345679 + OO12345680) ---');
const resB = evaluateValues([...numericPeers10, 'OO12345678', 'OO12345679', 'OO12345680']);
for (const r of resB.filter(x => x.value.startsWith('OO'))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('\n--- TEST C: DUPLICATED CORRUPTION (OO12345678 x 2) ---');
const resC = evaluateValues([...numericPeers10, 'OO12345678', 'OO12345678']);
const cItems = resC.filter(x => x.value.startsWith('OO'));
console.log(`OO12345678 (dup count ${cItems.length}):`, cItems[0].assessment.severity, `[${cItems[0].assessment.reasons.map(x => x.code).join(',')}]`);

console.log('\n--- TEST D: THREE IDENTICAL DUPLICATED CORRUPTIONS (OO12345678 x 3) ---');
const resD = evaluateValues([...numericPeers10, 'OO12345678', 'OO12345678', 'OO12345678']);
const dItems = resD.filter(x => x.value.startsWith('OO'));
console.log(`OO12345678 (triple count ${dItems.length}):`, dItems[0].assessment.severity, `[${dItems[0].assessment.reasons.map(x => x.code).join(',')}]`);

console.log('\n--- TEST E: DIFFERENT PREFIX, SAME MASK (OO12345678 + AB12345679) ---');
const resE = evaluateValues([...numericPeers10, 'OO12345678', 'AB12345679']);
for (const r of resE.filter(x => !numericPeers10.includes(x.value))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('\n--- TEST F: THREE DIFFERENT PREFIXES, SAME MASK (OO12345678 + AB12345679 + IO12345680) ---');
const resF = evaluateValues([...numericPeers10, 'OO12345678', 'AB12345679', 'IO12345680']);
for (const r of resF.filter(x => !numericPeers10.includes(x.value))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('\n--- TEST G: REALISTIC O/0 CORRELATED ERRORS ---');
const resG = evaluateValues([...numericPeers10, 'OO12345678', 'OO12345679', 'OO12345680']);
for (const r of resG.filter(x => x.value.startsWith('OO'))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('\n--- TEST H: LEGITIMATE TWO-MEMBER FAMILY (ABC00019 + ABC00020) ---');
const resH = evaluateValues([...numericPeers10, 'ABC00019', 'ABC00020']);
for (const r of resH.filter(x => x.value.startsWith('ABC'))) {
  console.log(`${r.value}: ${r.assessment.severity}`);
}

console.log('\n--- TEST I: LEGITIMATE THREE-MEMBER FAMILY (ABC00019 + ABC00020 + ABC00021) ---');
const resI = evaluateValues([...numericPeers10, 'ABC00019', 'ABC00020', 'ABC00021']);
for (const r of resI.filter(x => x.value.startsWith('ABC'))) {
  console.log(`${r.value}: ${r.assessment.severity}`);
}

console.log('\n--- TEST J: LEGITIMATE SAME-LENGTH FAMILY (AB12340001 + AB12340002 + AB12340003) ---');
const resJ = evaluateValues([...numericPeers10, 'AB12340001', 'AB12340002', 'AB12340003']);
for (const r of resJ.filter(x => x.value.startsWith('AB'))) {
  console.log(`${r.value}: ${r.assessment.severity}`);
}

console.log('\n--- TEST K: LEGITIMATE SAME-MASK DIFFERENT PREFIX FAMILY (AB12340001 + CD12340002 + EF12340003) ---');
const resK = evaluateValues([...numericPeers10, 'AB12340001', 'CD12340002', 'EF12340003']);
for (const r of resK.filter(x => !numericPeers10.includes(x.value))) {
  console.log(`${r.value}: ${r.assessment.severity}`);
}

console.log('\n--- TEST L: LEGITIMATE REPEATED VALUE (ABC00019 x 2) ---');
const resL = evaluateValues([...numericPeers10, 'ABC00019', 'ABC00019']);
for (const r of resL.filter(x => x.value.startsWith('ABC'))) {
  console.log(`${r.value}: ${r.assessment.severity}`);
}

console.log('\n--- TEST M: MIXED LEGITIMATE + CORRUPT (ABC00019 + ABC00020 + OO12345678) ---');
const resM = evaluateValues([...numericPeers10, 'ABC00019', 'ABC00020', 'OO12345678']);
for (const r of resM.filter(x => !numericPeers10.includes(x.value))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('\n--- TEST N: MIXED SAME-MASK LEGITIMATE + CORRUPT (AB12340001 + AB12340002 + OO12345678) ---');
const resN = evaluateValues([...numericPeers10, 'AB12340001', 'AB12340002', 'OO12345678']);
for (const r of resN.filter(x => !numericPeers10.includes(x.value))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('\n--- TEST O: DIFFERENT LENGTH CORRUPTION (OO1234567) ---');
const resO = evaluateValues([...numericPeers10, 'OO1234567']);
const oItem = resO.find(x => x.value === 'OO1234567');
console.log(`OO1234567 (len 9): ${oItem?.assessment.severity} [${oItem?.assessment.reasons.map(x => x.code).join(',')}]`);

console.log('\n--- TEST P: SHORT COLUMN (N=5) ---');
const shortPeers = ['0012345601', '0012345602', '0012345603'];
const resP = evaluateValues([...shortPeers, 'OO12345678', 'OO12345679']);
for (const r of resP.filter(x => x.value.startsWith('OO'))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('\n--- TEST Q: 90% NUMERIC BOUNDARY ---');
// 9 numeric, 1 OO: total 10. numeric ratio in peers: 9/9 = 100% -> triggers Check 1
// What about 8 numeric, 2 OO? Total 10. numeric ratio in peers: 8/9 = 88.8% (<90%)!
console.log('Case Q1: 9 numeric + 1 OO (ratio 9/9 = 100%):');
const q1 = evaluateValues([...numericPeers10.slice(0, 9), 'OO12345678']);
console.log('OO12345678:', q1.find(x => x.value.startsWith('OO'))?.assessment.severity);

console.log('Case Q2: 18 numeric + 2 OO (ratio 18/19 = 94.7% >= 90%):');
const numPeers18 = Array.from({ length: 18 }, (_, i) => `00123456${i.toString().padStart(2, '0')}`);
const q2 = evaluateValues([...numPeers18, 'OO12345678', 'OO12345679']);
for (const r of q2.filter(x => x.value.startsWith('OO'))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}

console.log('Case Q3: 8 numeric + 2 OO (total 10, ratio 8/9 = 88.8% < 90%):');
const q3 = evaluateValues([...numericPeers10.slice(0, 8), 'OO12345678', 'OO12345679']);
for (const r of q3.filter(x => x.value.startsWith('OO'))) {
  console.log(`${r.value}: ${r.assessment.severity} [${r.assessment.reasons.map(x => x.code).join(',')}]`);
}
