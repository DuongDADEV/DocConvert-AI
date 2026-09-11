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

export interface StressResult {
  matrix: string;
  name: string;
  totalValid: number;
  totalCorrupt: number;
  validFlagged: { val: string; reasons: string[] }[];
  corruptDetected: { val: string; reasons: string[] }[];
  corruptMissed: string[];
}

export function runMatrix(
  matrix: string,
  name: string,
  validValues: string[],
  corruptValues: string[] = [],
  header = 'Số GD'
): StressResult {
  const col = createMockColumn(header, 'REFERENCE', 0);
  const allValues = [...validValues, ...corruptValues];
  const rows = allValues.map((val, idx) => createMockRow([createMockCell(val, 0)], idx));

  CellQualityEvaluator.evaluateTable([col], rows);

  const validFlagged: { val: string; reasons: string[] }[] = [];
  const corruptDetected: { val: string; reasons: string[] }[] = [];
  const corruptMissed: string[] = [];

  for (let i = 0; i < validValues.length; i++) {
    const assessment = rows[i].cells[0].qualityAssessment;
    const reasons = (assessment?.reasons || []).map((r) => r.code);
    const hasStructuralWarning = reasons.some(
      (c) => c === 'REFERENCE_STRUCTURE_OUTLIER' || c === 'POSSIBLE_CHARACTER_CONFUSION'
    );
    if (hasStructuralWarning) {
      validFlagged.push({ val: validValues[i], reasons });
    }
  }

  for (let i = 0; i < corruptValues.length; i++) {
    const rowIdx = validValues.length + i;
    const assessment = rows[rowIdx].cells[0].qualityAssessment;
    const reasons = (assessment?.reasons || []).map((r) => r.code);
    const hasStructuralWarning = reasons.some(
      (c) => c === 'REFERENCE_STRUCTURE_OUTLIER' || c === 'POSSIBLE_CHARACTER_CONFUSION'
    );
    if (hasStructuralWarning) {
      corruptDetected.push({ val: corruptValues[i], reasons });
    } else {
      corruptMissed.push(corruptValues[i]);
    }
  }

  return {
    matrix,
    name,
    totalValid: validValues.length,
    totalCorrupt: corruptValues.length,
    validFlagged,
    corruptDetected,
    corruptMissed,
  };
}

async function runAllStressTests() {
  console.log('====================================================');
  console.log('Q2C.3.1 REFERENCE GENERALIZATION STRESS TEST SUITE');
  console.log('====================================================\n');

  // 1. Header regex audit
  console.log('--- SECTION 4: REFERENCE_HEADER_REGEX AUDIT ---');
  const REFERENCE_HEADER_REGEX = /\b(ref|reference|so\s*gd|so\s*giao\s*dich|ma\s*gd|ma\s*giao\s*dich|transaction\s*no|trans\s*no|document\s*no|doc\s*no|chung\s*tu|so\s*ct|mgd|tham\s*chieu)\b/i;
  function matchHeader(h: string): boolean {
    const normHeader = h.toLowerCase().trim();
    const unaccented = normHeader
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
    return REFERENCE_HEADER_REGEX.test(normHeader) || REFERENCE_HEADER_REGEX.test(unaccented);
  }

  const testHeaders = [
    { h: 'Reference', expected: true },
    { h: 'Reference No', expected: true },
    { h: 'Reference Number', expected: true },
    { h: 'Ref', expected: true },
    { h: 'Ref No', expected: true },
    { h: 'Transaction Ref', expected: true },
    { h: 'Transaction Reference', expected: true },
    { h: 'Transaction ID', expected: false },
    { h: 'Transaction No', expected: true },
    { h: 'Mã tham chiếu', expected: true },
    { h: 'Mã GD', expected: true },
    { h: 'Mã giao dịch', expected: true },
    { h: 'Số tham chiếu', expected: true },
    { h: 'Số GD', expected: true },
    { h: 'Số chứng từ', expected: true },
    { h: 'Document No', expected: true },
    { h: 'Voucher No', expected: false },
    { h: 'Sequence No', expected: false },
    { h: 'Teller Code', expected: false },
    { h: 'Account No', expected: false },
    { h: 'Account Number', expected: false },
    { h: 'Nội dung', expected: false },
    { h: 'Diễn giải', expected: false },
  ];

  console.log('| Header | Expected Match? | Actual Match? | Match Status |');
  console.log('|---|---|---|---|');
  for (const item of testHeaders) {
    const actual = matchHeader(item.h);
    const status = actual === item.expected ? 'PASS' : 'FAIL';
    console.log(`| ${item.h} | ${item.expected} | ${actual} | ${status} |`);
  }

  const results: StressResult[] = [];

  // Matrix A: 90% Numeric + 10% Legitimate Alphanumeric
  const validNum9 = ['10000001', '10000002', '10000003', '10000004', '10000005', '10000006', '10000007', '10000008', '10000009', 'ABC00010'];
  const resA1 = runMatrix('A1', '9 num + 1 alpha (90% num)', validNum9);
  results.push(resA1);

  const validNum19 = Array.from({ length: 19 }, (_, i) => `100000${(i + 1).toString().padStart(2, '0')}`).concat(['ABC00020']);
  const resA2 = runMatrix('A2', '19 num + 1 alpha (95% num)', validNum19);
  results.push(resA2);

  const validNum49 = Array.from({ length: 49 }, (_, i) => `100000${(i + 1).toString().padStart(2, '0')}`).concat(['ABC00050']);
  const resA3 = runMatrix('A3', '49 num + 1 alpha (98% num)', validNum49);
  results.push(resA3);

  // Matrix B: 95% Format A + 5% Format B
  const famA = Array.from({ length: 95 }, (_, i) => `TXN2024${(i + 1).toString().padStart(4, '0')}A`);
  const famB = Array.from({ length: 5 }, (_, i) => `EXT99${(i + 1).toString().padStart(3, '0')}Z`);
  const resB = runMatrix('B', '95 Family A + 5 Family B', [...famA, ...famB]);
  results.push(resB);

  // Matrix C: Three Legitimate Families (80% A, 15% B, 5% C)
  const cA = Array.from({ length: 80 }, (_, i) => `REF2024${(i + 1).toString().padStart(3, '0')}A`);
  const cB = Array.from({ length: 15 }, (_, i) => `GL3024${(i + 1).toString().padStart(3, '0')}B`);
  const cC = Array.from({ length: 5 }, (_, i) => `NAP224${(i + 1).toString().padStart(3, '0')}C`);
  const resC = runMatrix('C', '80% A + 15% B + 5% C', [...cA, ...cB, ...cC]);
  results.push(resC);

  // Matrix D: Numeric Prefix Families
  const d1 = Array.from({ length: 5 }, (_, i) => `1234500${i + 1}ABC`);
  const d2 = Array.from({ length: 5 }, (_, i) => `1234600${i + 1}XYZ`);
  const resD = runMatrix('D', 'Numeric Prefix Families', [...d1, ...d2]);
  results.push(resD);

  // Matrix E: Same Prefix, Multiple Valid Suffix Types
  const e1 = ['REF2024001A', 'REF2024002B', 'REF2024003C', 'REF2024004D', 'REF2024005E'];
  const e2 = ['REF20240100', 'REF20240101'];
  const resE_5_2 = runMatrix('E1', '5 letter-tail + 2 digit-tail', [...e1, ...e2]);
  results.push(resE_5_2);

  const e1_20 = Array.from({ length: 20 }, (_, i) => `REF20240${(i + 1).toString().padStart(2, '0')}A`);
  const resE_20_2 = runMatrix('E2', '20 letter-tail + 2 digit-tail', [...e1_20, ...e2]);
  results.push(resE_20_2);

  const e1_50 = Array.from({ length: 50 }, (_, i) => `REF20240${(i + 1).toString().padStart(2, '0')}A`);
  const resE_50_2 = runMatrix('E3', '50 letter-tail + 2 digit-tail', [...e1_50, ...e2]);
  results.push(resE_50_2);

  // Matrix F: Lowercase Legitimate Minority
  const fUpper = ['ABC001XYZ', 'ABC002XYZ', 'ABC003XYZ', 'ABC004XYZ', 'ABC005XYZ'];
  const fLower = ['abc006xyz', 'AbC007xYz'];
  const resF = runMatrix('F', 'Uppercase + Lowercase/Mixed', [...fUpper, ...fLower]);
  results.push(resF);

  // Matrix G: Variable Length Legitimate References
  const gVar = ['REF001', 'REF0002', 'REF00003', 'REF000004', 'REF0000005'];
  const resG1 = runMatrix('G1', 'All variable lengths', gVar);
  results.push(resG1);

  const g90 = Array.from({ length: 90 }, (_, i) => `REF2024${(i + 1).toString().padStart(3, '0')}`); // length 10
  const g10 = Array.from({ length: 10 }, (_, i) => `LONGREF2024${(i + 1).toString().padStart(3, '0')}`); // length 14
  const resG2 = runMatrix('G2', '90 len-10 + 10 len-14', [...g90, ...g10]);
  results.push(resG2);

  // Matrix H: Punctuation Families
  const hVals = ['REF/2024/001', 'REF/2024/002', 'REF-2024-003', 'REF-2024-004', 'REF_2024_005'];
  const resH = runMatrix('H', 'Punctuation variants', hVals);
  results.push(resH);

  // Matrix I: Duplicate References
  const iVals = ['ABC001', 'ABC001', 'ABC001', 'ABC002', 'ABC003', 'ABC004', 'ABC005'];
  const resI = runMatrix('I', 'Duplicates in column', iVals);
  results.push(resI);

  // Matrix J: Very Short Columns
  for (let n = 1; n <= 6; n++) {
    const jVals = Array.from({ length: n }, (_, i) => `REF00${i + 1}`);
    const resJ = runMatrix(`J${n}`, `Short column N=${n}`, jVals);
    results.push(resJ);
  }

  // Matrix L: Valid Novel Singleton
  const lDom = Array.from({ length: 50 }, (_, i) => `REF2024${(i + 1).toString().padStart(4, '0')}A`);
  const lSingleton = ['PAY-9999'];
  const resL1 = runMatrix('L1', '50 Dominant + 1 Novel Singleton (PAY-9999)', [...lDom, ...lSingleton]);
  results.push(resL1);

  const lSingleton2 = ['1234567890'];
  const resL2 = runMatrix('L2', '50 Dominant + 1 Novel Numeric Singleton', [...lDom, ...lSingleton2]);
  results.push(resL2);

  // Matrix M: True Corruption Inside Dominant Family (O/0)
  const mDom = Array.from({ length: 50 }, (_, i) => `919ZTRF2429915O${i % 10}`);
  const mCorrupt = ['919ZTRF242991500']; // Case 1 style
  const resM = runMatrix('M', 'True O->0 corruption inside dominant family', mDom, mCorrupt);
  results.push(resM);

  // Matrix N: True Length Corruption
  const nDom = Array.from({ length: 20 }, (_, i) => `REF202400${(i + 1).toString().padStart(2, '0')}`);
  const nCorrupt = ['REF2024000']; // 1 char truncated
  const resN = runMatrix('N', 'True Length Corruption', nDom, nCorrupt);
  results.push(resN);

  // Matrix O: Valid All-Numeric + Valid Second Family
  const oNum = ['0001238951', '0001238952', '0001238953', '0001238954', '0001238955'];
  const oSecond = ['ABC1238956'];
  const resO = runMatrix('O', '5 Numeric + 1 Alpha', [...oNum, ...oSecond]);
  results.push(resO);

  // Summary print
  console.log('\n====================================================');
  console.log('STRESS TEST RESULTS SUMMARY');
  console.log('====================================================');
  console.log('| Matrix | Name | Valid Cells | False Warnings | Corrupt Cells | Detected | Missed |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| ${r.matrix} | ${r.name} | ${r.totalValid} | ${r.validFlagged.length} | ${r.totalCorrupt} | ${r.corruptDetected.length} | ${r.corruptMissed.length} |`
    );
    if (r.validFlagged.length > 0) {
      for (const vf of r.validFlagged) {
        console.log(`    ⚠️ FALSE WARNING on valid: "${vf.val}" -> ${vf.reasons.join(', ')}`);
      }
    }
  }

  // Benchmark scaling (Section 17 & 36)
  console.log('\n====================================================');
  console.log('PERFORMANCE SCALING BENCHMARK');
  console.log('====================================================');
  const rowCounts = [50, 100, 500, 1000];
  for (const count of rowCounts) {
    const testData = Array.from({ length: count }, (_, i) => `919ZTRF2429915O${i % 10}`);
    const col = createMockColumn('Số GD', 'REFERENCE', 0);
    const rows = testData.map((val, idx) => createMockRow([createMockCell(val, 0)], idx));

    const t0 = performance.now();
    CellQualityEvaluator.evaluateTable([col], rows);
    const t1 = performance.now();
    console.log(`N = ${count.toString().padStart(5)} rows | Eval Time: ${(t1 - t0).toFixed(3).padStart(8)} ms | Avg per cell: ${((t1 - t0) / count).toFixed(4)} ms`);
  }
}

runAllStressTests();
