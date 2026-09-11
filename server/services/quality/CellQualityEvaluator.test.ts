import assert from 'assert';
import { CellQualityEvaluator } from './CellQualityEvaluator.js';
import { UnifiedCell, UnifiedColumn, UnifiedRow } from '../unifiedTableService.js';

console.log('Running CellQualityEvaluator Unit Tests:');

function createMockColumn(header: string, semanticType: any, canonicalColumnIndex = 0): UnifiedColumn {
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

// -------------------------------------------------------------
// 1. MONEY: Comma Thousands, Dot Thousands, Dash, Zero variants
// -------------------------------------------------------------
{
  const col = createMockColumn('Số tiền', 'DEBIT', 0);
  const rows = [
    createMockRow([createMockCell('95,909', 0)]),
    createMockRow([createMockCell('1,559,240,000.00', 0)]),
    createMockRow([createMockCell('50,000', 0)]),
    createMockRow([createMockCell('12,000', 0)]),
    createMockRow([createMockCell('1,200', 0)]),
    createMockRow([createMockCell('-', 0)]),
    createMockRow([createMockCell('0', 0)]),
    createMockRow([createMockCell('0.00', 0)]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  rows.forEach((r, idx) => {
    assert.strictEqual(
      r.cells[0].qualityAssessment?.severity,
      'PASS',
      `Row ${idx} (${r.cells[0].rawValue}) should be PASS, got ${r.cells[0].qualityAssessment?.severity}`
    );
  });
  console.log('  ✓ 1. Valid comma-thousands, decimals, dashes, and zeros evaluate to PASS');
}

// -------------------------------------------------------------
// 2. MONEY: Dot Thousands Decimal Comma (e.g. Ban Viet)
// -------------------------------------------------------------
{
  const col = createMockColumn('Ghi Có', 'CREDIT', 0);
  const rows = [
    createMockRow([createMockCell('100.000,00', 0)]),
    createMockRow([createMockCell('250.000,00', 0)]),
    createMockRow([createMockCell('1.500.000,00', 0)]),
    createMockRow([createMockCell('75.000,00', 0)]),
    createMockRow([createMockCell('30.000,00', 0)]),
    createMockRow([createMockCell('0,00', 0)]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  rows.forEach((r, idx) => {
    assert.strictEqual(
      r.cells[0].qualityAssessment?.severity,
      'PASS',
      `Row ${idx} (${r.cells[0].rawValue}) should be PASS, got ${r.cells[0].qualityAssessment?.severity}`
    );
  });
  console.log('  ✓ 2. Valid dot-thousands with decimal-comma evaluates to PASS');
}

// -------------------------------------------------------------
// 3. MONEY: Anomalies (Alpha, Trailing Separator, Leading Noise)
// -------------------------------------------------------------
{
  const col = createMockColumn('Số dư', 'BALANCE', 0);
  const rows = [
    // Column context to establish comma-thousands
    createMockRow([createMockCell('100,000', 0)]),
    createMockRow([createMockCell('200,000', 0)]),
    createMockRow([createMockCell('300,000', 0)]),
    createMockRow([createMockCell('400,000', 0)]),
    createMockRow([createMockCell('500,000', 0)]),
    // Test targets
    createMockRow([createMockCell('95,909 A', 0, 0.062, 'AZURE_WORD_AGGREGATE')]),
    createMockRow([createMockCell('Lo ICH 50,000', 0, 0.105, 'AZURE_WORD_AGGREGATE')]),
    createMockRow([createMockCell('50,039,', 0, 0.638, 'AZURE_WORD_AGGREGATE')]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  // 95,909 A
  const cAlpha = rows[5].cells[0].qualityAssessment!;
  assert.ok(
    cAlpha.severity === 'WARNING' || cAlpha.severity === 'CRITICAL',
    '95,909 A should be at least WARNING'
  );
  assert.ok(cAlpha.reasons.some((r) => r.code === 'ALPHA_IN_MONEY'), 'Must have ALPHA_IN_MONEY');
  assert.ok(cAlpha.reasons.some((r) => r.code === 'LOW_OCR_CONFIDENCE'), 'Must have LOW_OCR_CONFIDENCE');

  // Lo ICH 50,000
  const cProse = rows[6].cells[0].qualityAssessment!;
  assert.strictEqual(cProse.severity, 'CRITICAL', 'Lo ICH 50,000 must be CRITICAL');
  assert.ok(cProse.reasons.some((r) => r.code === 'LEADING_NOISE'), 'Must have LEADING_NOISE');
  assert.ok(cProse.reasons.some((r) => r.code === 'LOW_OCR_CONFIDENCE'), 'Must have LOW_OCR_CONFIDENCE');

  // 50,039,
  const cTrailing = rows[7].cells[0].qualityAssessment!;
  assert.strictEqual(cTrailing.severity, 'WARNING', '50,039, should be WARNING');
  assert.ok(cTrailing.reasons.some((r) => r.code === 'TRAILING_SEPARATOR'), 'Must have TRAILING_SEPARATOR');
  assert.ok(cTrailing.reasons.some((r) => r.code === 'LOW_OCR_CONFIDENCE'), 'Must have LOW_OCR_CONFIDENCE');

  console.log('  ✓ 3. ALPHA_IN_MONEY, LEADING_NOISE, and TRAILING_SEPARATOR correctly detected');
}

// -------------------------------------------------------------
// 4. MONEY: FORMAT_OUTLIER ("94.709" in Comma-Thousands Column)
// -------------------------------------------------------------
{
  const col = createMockColumn('Số dư', 'BALANCE', 0);
  const rows = [
    createMockRow([createMockCell('100,000', 0)]),
    createMockRow([createMockCell('200,000', 0)]),
    createMockRow([createMockCell('300,000', 0)]),
    createMockRow([createMockCell('400,000', 0)]),
    createMockRow([createMockCell('500,000', 0)]),
    createMockRow([createMockCell('94.709', 0, 0.917, 'AZURE_WORD_AGGREGATE')]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  const cOutlier = rows[5].cells[0].qualityAssessment!;
  assert.strictEqual(cOutlier.severity, 'WARNING', '94.709 must be WARNING');
  assert.ok(cOutlier.reasons.some((r) => r.code === 'FORMAT_OUTLIER'), 'Must have FORMAT_OUTLIER');
  assert.strictEqual(rows[5].cells[0].confidence, 0.917, 'Optical confidence 0.917 must remain unchanged');
  console.log('  ✓ 4. Key Case 94.709 identified as FORMAT_OUTLIER (WARNING) with confidence 0.917 intact');
}

// -------------------------------------------------------------
// 5. DATE: DD-MM Dominant (ACB style) vs Contaminated Date
// -------------------------------------------------------------
{
  const col = createMockColumn('Ngày GD', 'DATE', 0);
  const rows = [
    createMockRow([createMockCell('15-08', 0)]),
    createMockRow([createMockCell('16-08', 0)]),
    createMockRow([createMockCell('17-08', 0)]),
    createMockRow([createMockCell('18-08', 0)]),
    createMockRow([createMockCell('19-08', 0)]),
    createMockRow([createMockCell('Ngay 20-08', 0)]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  // Rows 0..4 should be PASS
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(
      rows[i].cells[0].qualityAssessment?.severity,
      'PASS',
      `Row ${i} should be PASS for dominant DD-MM`
    );
  }

  // Row 5 has text contamination
  const cContam = rows[5].cells[0].qualityAssessment!;
  assert.strictEqual(cContam.severity, 'WARNING');
  assert.ok(cContam.reasons.some((r) => r.code === 'DATE_TEXT_CONTAMINATION'));
  console.log('  ✓ 5. ACB dominant short date DD-MM evaluates to PASS; text contamination flagged');
}

// -------------------------------------------------------------
// 6. STT: Valid integers & gaps allowed, non-integer flagged
// -------------------------------------------------------------
{
  const col = createMockColumn('STT', 'STT', 0);
  const rows = [
    createMockRow([createMockCell('1', 0)]),
    createMockRow([createMockCell('2', 0)]),
    createMockRow([createMockCell('4', 0)]), // Gap: 3 is missing -> ALLOWED!
    createMockRow([createMockCell('5', 0)]),
    createMockRow([createMockCell('ABC', 0)]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  assert.strictEqual(rows[0].cells[0].qualityAssessment?.severity, 'PASS');
  assert.strictEqual(rows[1].cells[0].qualityAssessment?.severity, 'PASS');
  assert.strictEqual(rows[2].cells[0].qualityAssessment?.severity, 'PASS', 'Gap in STT must be PASS');
  assert.strictEqual(rows[3].cells[0].qualityAssessment?.severity, 'PASS');

  const cInvalid = rows[4].cells[0].qualityAssessment!;
  assert.strictEqual(cInvalid.severity, 'WARNING');
  assert.ok(cInvalid.reasons.some((r) => r.code === 'STT_TEXT_CONTAMINATION'));
  console.log('  ✓ 6. STT integer gaps are allowed; alphabetic STT flagged');
}

// -------------------------------------------------------------
// 7. REFERENCE & DESCRIPTION: Permissive real-world text
// -------------------------------------------------------------
{
  const colRef = createMockColumn('Số GD', 'REFERENCE', 0);
  const colDesc = createMockColumn('Nội dung', 'DESCRIPTION', 1);

  const row = createMockRow([
    createMockCell('FT2123456789/REF-01', 0),
    createMockCell('CHUYEN TIEN THANH TOAN TIEN HANG HD 12345', 1),
  ]);

  CellQualityEvaluator.evaluateTable([colRef, colDesc], [row]);

  assert.strictEqual(row.cells[0].qualityAssessment?.severity, 'PASS');
  assert.strictEqual(row.cells[1].qualityAssessment?.severity, 'PASS');
  console.log('  ✓ 7. Legitimate alphanumeric REFERENCE and Vietnamese DESCRIPTION evaluate to PASS');
}

// -------------------------------------------------------------
// 8. TELLER CODE GUARD: "10.000" in GDV column not flagged as money
// -------------------------------------------------------------
{
  const col = createMockColumn('Mã GDV', 'BALANCE', 0); // Mistakenly labeled BALANCE
  const rows = [
    createMockRow([createMockCell('10.000', 0)]),
    createMockRow([createMockCell('10.000', 0)]),
    createMockRow([createMockCell('20.000', 0)]),
    createMockRow([createMockCell('10.000', 0)]),
    createMockRow([createMockCell('30.000', 0)]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  rows.forEach((r, idx) => {
    assert.strictEqual(
      r.cells[0].qualityAssessment?.severity,
      'PASS',
      `Teller code Row ${idx} should be PASS, got ${r.cells[0].qualityAssessment?.severity}`
    );
  });
  console.log('  ✓ 8. Teller Code Guard prevents GDV "10.000" from being evaluated as money anomaly');
}

// -------------------------------------------------------------
// 9. UNAVAILABLE & EMPTY_CELL Semantics
// -------------------------------------------------------------
{
  const col = createMockColumn('Ghi chú', 'OTHER', 0);
  const rows = [
    // Blank cell with EMPTY_CELL source
    createMockRow([createMockCell('', 0, null, 'EMPTY_CELL')]),
    // Non-empty cell with UNAVAILABLE source
    createMockRow([createMockCell('CHUA RO NGUON', 0, null, 'UNAVAILABLE')]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  assert.strictEqual(rows[0].cells[0].qualityAssessment?.severity, 'PASS', 'EMPTY_CELL must be PASS');

  const cUnavail = rows[1].cells[0].qualityAssessment!;
  assert.strictEqual(cUnavail.severity, 'WARNING', 'UNAVAILABLE non-empty cell must be WARNING');
  assert.ok(cUnavail.reasons.some((r) => r.code === 'OCR_CONFIDENCE_UNAVAILABLE'));
  console.log('  ✓ 9. EMPTY_CELL evaluates to PASS; UNAVAILABLE non-empty cell flagged as WARNING');
}

// -------------------------------------------------------------
// 10. REFERENCE: Case 1 Silent OCR Error (919ZTRF242991500)
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = [
    createMockRow([createMockCell('919ZTRF2429915O0', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O1', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O2', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O3', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O4', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O5', 0, 0.95)]),
    // Silent OCR error target: high optical confidence (0.834), but 0 instead of O
    createMockRow([createMockCell('919ZTRF242991500', 0, 0.834, 'AZURE_WORD_AGGREGATE')]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  const targetAssessment = rows[6].cells[0].qualityAssessment!;
  assert.strictEqual(targetAssessment.severity, 'WARNING', 'Silent error 919ZTRF242991500 must escalate to WARNING');
  assert.ok(
    targetAssessment.reasons.some((r) => r.code === 'REFERENCE_STRUCTURE_OUTLIER'),
    'Must have REFERENCE_STRUCTURE_OUTLIER'
  );
  assert.ok(
    targetAssessment.reasons.some((r) => r.code === 'POSSIBLE_CHARACTER_CONFUSION'),
    'Must have POSSIBLE_CHARACTER_CONFUSION'
  );
  assert.strictEqual(rows[6].cells[0].confidence, 0.834, 'Optical confidence 0.834 must remain immutable');
  console.log('  ✓ 10. Case 1 silent error 919ZTRF242991500 flagged as WARNING with structural outlier & confusion diagnostics');
}

// -------------------------------------------------------------
// 11. REFERENCE: Case 2 Low-Confidence + Structural Anomaly
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = [
    createMockRow([createMockCell('919ZTRF2429915O0', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O1', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O2', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O3', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O4', 0, 0.95)]),
    // Case 2: low confidence (0.645) and ends in 02 instead of O2
    createMockRow([createMockCell('919ZTRF242991502', 0, 0.645, 'AZURE_WORD_AGGREGATE')]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  const targetAssessment = rows[5].cells[0].qualityAssessment!;
  assert.strictEqual(targetAssessment.severity, 'WARNING');
  assert.ok(targetAssessment.reasons.some((r) => r.code === 'LOW_OCR_CONFIDENCE'));
  assert.ok(targetAssessment.reasons.some((r) => r.code === 'REFERENCE_STRUCTURE_OUTLIER'));
  assert.ok(targetAssessment.reasons.some((r) => r.code === 'POSSIBLE_CHARACTER_CONFUSION'));
  console.log('  ✓ 11. Case 2 retains WARNING and gains both optical and structural diagnostic explanations');
}

// -------------------------------------------------------------
// 12. REFERENCE: Case 3 Correct Low-Confidence Reference (9192hv6243011321)
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = [
    createMockRow([createMockCell('919ZTRF2429915O0', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O1', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O2', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O3', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O4', 0, 0.95)]),
    createMockRow([createMockCell('919ZTRF2429915O5', 0, 0.95)]),
    // Other transaction families present in the same statement (e.g. GL, NAP, CV)
    createMockRow([createMockCell('919GL3024129C4YA', 0, 0.95)]),
    createMockRow([createMockCell('919NAP224152TOL6', 0, 0.95)]),
    createMockRow([createMockCell('919CV00VND 00001', 0, 0.95)]),
    // Case 3: Different transaction type (not in 919ZTRF family), confidence 0.578
    createMockRow([createMockCell('9192hv6243011321', 0, 0.578, 'AZURE_WORD_AGGREGATE')]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  const targetAssessment = rows[9].cells[0].qualityAssessment!;
  assert.strictEqual(targetAssessment.severity, 'WARNING', 'Should only be WARNING due to low optical confidence');
  assert.ok(targetAssessment.reasons.some((r) => r.code === 'LOW_OCR_CONFIDENCE'));
  assert.ok(
    !targetAssessment.reasons.some((r) => r.code === 'REFERENCE_STRUCTURE_OUTLIER'),
    'Must NOT have false REFERENCE_STRUCTURE_OUTLIER'
  );
  assert.ok(
    !targetAssessment.reasons.some((r) => r.code === 'POSSIBLE_CHARACTER_CONFUSION'),
    'Must NOT have false POSSIBLE_CHARACTER_CONFUSION'
  );
  console.log('  ✓ 12. Case 3 correctly avoids false structural outlier warning; only LOW_OCR_CONFIDENCE emitted');
}

// -------------------------------------------------------------
// 13. REFERENCE: All-Numeric Column & Letter Intrusion Guard
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = [
    createMockRow([createMockCell('0001238951', 0)]),
    createMockRow([createMockCell('0001238952', 0)]),
    createMockRow([createMockCell('0001238953', 0)]),
    createMockRow([createMockCell('0001238954', 0)]),
    createMockRow([createMockCell('0001238955', 0)]),
    createMockRow([createMockCell('0001238956', 0)]),
    // Letter 'O' intrusion in all-numeric column
    createMockRow([createMockCell('000123895O', 0, 0.95)]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  // Rows 0..5 must be PASS
  for (let i = 0; i < 6; i++) {
    assert.strictEqual(rows[i].cells[0].qualityAssessment?.severity, 'PASS', `Numeric row ${i} must be PASS`);
  }

  // Row 6 (000123895O) must be WARNING
  const targetAssessment = rows[6].cells[0].qualityAssessment!;
  assert.strictEqual(targetAssessment.severity, 'WARNING');
  assert.ok(targetAssessment.reasons.some((r) => r.code === 'REFERENCE_STRUCTURE_OUTLIER'));
  assert.ok(targetAssessment.reasons.some((r) => r.code === 'POSSIBLE_CHARACTER_CONFUSION'));
  console.log('  ✓ 13. All-numeric references evaluate to PASS; letter intrusion flagged with confusion diagnostics');
}

// -------------------------------------------------------------
// 14. REFERENCE: Multi-Pattern / Mixed Valid Columns Guard
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = [
    createMockRow([createMockCell('FT21001', 0)]),
    createMockRow([createMockCell('FT21002', 0)]),
    createMockRow([createMockCell('FT21003', 0)]),
    createMockRow([createMockCell('99887766', 0)]),
    createMockRow([createMockCell('99887767', 0)]),
    createMockRow([createMockCell('99887768', 0)]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  rows.forEach((r, idx) => {
    assert.strictEqual(
      r.cells[0].qualityAssessment?.severity,
      'PASS',
      `Row ${idx} (${r.cells[0].rawValue}) should not be forced into false warning`
    );
  });
  console.log('  ✓ 14. Multi-pattern column without dominant structure evaluates safely to PASS');
}

// -------------------------------------------------------------
// 15. REFERENCE: Insufficient Peer Count (< 5) Guard
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = [
    createMockRow([createMockCell('ABC12345', 0)]),
    createMockRow([createMockCell('ABC12346', 0)]),
    createMockRow([createMockCell('XYZ999', 0)]), // Only 3 rows in entire column
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  rows.forEach((r, idx) => {
    assert.strictEqual(
      r.cells[0].qualityAssessment?.severity,
      'PASS',
      `Insufficient sample row ${idx} must be PASS`
    );
  });
  console.log('  ✓ 15. Insufficient peer count (< 5) returns PASS without structural warnings');
}

// -------------------------------------------------------------
// 16. REFERENCE: Punctuation Delimited References
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = [
    createMockRow([createMockCell('REF/2024/001', 0)]),
    createMockRow([createMockCell('REF/2024/002', 0)]),
    createMockRow([createMockCell('REF/2024/003', 0)]),
    createMockRow([createMockCell('REF/2024/004', 0)]),
    createMockRow([createMockCell('REF/2024/005', 0)]),
  ];

  CellQualityEvaluator.evaluateTable([col], rows);

  rows.forEach((r, idx) => {
    assert.strictEqual(
      r.cells[0].qualityAssessment?.severity,
      'PASS',
      `Punctuation row ${idx} must be PASS`
    );
  });
  console.log('  ✓ 16. Punctuation-delimited references evaluate cleanly to PASS');
}

// -------------------------------------------------------------
// 17. REFERENCE: Valid Novel Singleton Abstains (Matrix L)
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const domRows = Array.from({ length: 50 }, (_, i) =>
    createMockRow([createMockCell(`REF2024${(i + 1).toString().padStart(4, '0')}A`, 0)])
  );
  // Novel legitimate singleton with completely distinct structure (PAY-9999)
  const singletonRow = createMockRow([createMockCell('PAY-9999', 0, 0.95)]);
  const rows = [...domRows, singletonRow];

  CellQualityEvaluator.evaluateTable([col], rows);

  const singletonAssessment = singletonRow.cells[0].qualityAssessment!;
  assert.strictEqual(
    singletonAssessment.severity,
    'PASS',
    'Novel singleton from distinct family must abstain from false warning'
  );
  console.log('  ✓ 17. Valid novel singleton (PAY-9999) in dominant column correctly evaluates to PASS');
}

// -------------------------------------------------------------
// 18. REFERENCE: Numeric Column with Multi-Letter Prefix (Matrix A/O)
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const numRows = Array.from({ length: 19 }, (_, i) =>
    createMockRow([createMockCell(`100000${(i + 1).toString().padStart(2, '0')}`, 0)])
  );
  // Legitimate distinct alphanumeric code starting with multi-letter prefix (ABC00020)
  const alphaRow = createMockRow([createMockCell('ABC00020', 0, 0.95)]);
  const rows = [...numRows, alphaRow];

  CellQualityEvaluator.evaluateTable([col], rows);

  const alphaAssessment = alphaRow.cells[0].qualityAssessment!;
  assert.strictEqual(
    alphaAssessment.severity,
    'PASS',
    'Distinct multi-letter code in numeric column must NOT be flagged as OCR digit corruption'
  );
  console.log('  ✓ 18. Multi-letter alphanumeric code (ABC00020) in numeric column evaluates cleanly to PASS');
}

// -------------------------------------------------------------
// 19. REFERENCE: Diacritic Header Matching (Số GD, Mã GD, Số chứng từ)
// -------------------------------------------------------------
{
  const cols = [
    createMockColumn('Số GD', 'OTHER', 0),
    createMockColumn('Mã giao dịch', 'OTHER', 1),
    createMockColumn('Số chứng từ', 'OTHER', 2),
    createMockColumn('Document No', 'OTHER', 3),
  ];
  const sampleRows = Array.from({ length: 6 }, (_, i) =>
    createMockRow([
      createMockCell(`REF00${i + 1}`, 0),
      createMockCell(`TXN00${i + 1}`, 1),
      createMockCell(`DOC00${i + 1}`, 2),
      createMockCell(`DN00${i + 1}`, 3),
    ])
  );

  const profiles = CellQualityEvaluator.buildColumnProfiles(cols, sampleRows);
  assert.strictEqual(profiles[0].effectiveRole, 'REFERENCE', 'Số GD must match as REFERENCE');
  assert.strictEqual(profiles[1].effectiveRole, 'REFERENCE', 'Mã giao dịch must match as REFERENCE');
  assert.strictEqual(profiles[2].effectiveRole, 'REFERENCE', 'Số chứng từ must match as REFERENCE');
  assert.strictEqual(profiles[3].effectiveRole, 'REFERENCE', 'Document No must match as REFERENCE');
  console.log('  ✓ 19. Diacritic header variants match REFERENCE role accurately');
}

// -------------------------------------------------------------
// 20. REFERENCE: True Length Corruption in Stable Family (Matrix N)
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const domRows = Array.from({ length: 20 }, (_, i) =>
    createMockRow([createMockCell(`REF202400${(i + 1).toString().padStart(2, '0')}`, 0)])
  );
  // Truncated code from same prefix family
  const corruptRow = createMockRow([createMockCell('REF2024000', 0, 0.95)]);
  const rows = [...domRows, corruptRow];

  CellQualityEvaluator.evaluateTable([col], rows);

  const corruptAssessment = corruptRow.cells[0].qualityAssessment!;
  assert.strictEqual(corruptAssessment.severity, 'WARNING');
  assert.ok(corruptAssessment.reasons.some((r) => r.code === 'REFERENCE_STRUCTURE_OUTLIER'));
  console.log('  ✓ 20. Truncated reference code in stable family flagged as WARNING');
}

// -------------------------------------------------------------
// 21. REFERENCE: Blind Spot Fix (OO12345678 in Numeric Column)
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const numRows = Array.from({ length: 10 }, (_, i) =>
    createMockRow([createMockCell(`001234560${i}`, 0)])
  );
  // True OCR error: 00 misread as OO
  const corruptRow = createMockRow([createMockCell('OO12345678', 0, 0.95)]);
  const rows = [...numRows, corruptRow];

  CellQualityEvaluator.evaluateTable([col], rows);

  const corruptAssessment = corruptRow.cells[0].qualityAssessment!;
  assert.strictEqual(corruptAssessment.severity, 'WARNING', 'OO12345678 must be flagged as WARNING');
  assert.ok(
    corruptAssessment.reasons.some((r) => r.code === 'REFERENCE_STRUCTURE_OUTLIER'),
    'Must have REFERENCE_STRUCTURE_OUTLIER'
  );
  assert.ok(
    corruptAssessment.reasons.some((r) => r.code === 'POSSIBLE_CHARACTER_CONFUSION'),
    'Must have POSSIBLE_CHARACTER_CONFUSION'
  );
  console.log('  ✓ 21. Blind spot fixed: OO12345678 flagged as WARNING with structural outlier and confusion diagnostics');
}

// -------------------------------------------------------------
// 22. REFERENCE: Supported Alternate Family in Numeric Column
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const numRows = Array.from({ length: 18 }, (_, i) =>
    createMockRow([createMockCell(`00123456${i.toString().padStart(2, '0')}`, 0)])
  );
  // Supported alternate family members (ABC00019, ABC00020, ABC00021)
  const altRow1 = createMockRow([createMockCell('ABC00019', 0, 0.95)]);
  const altRow2 = createMockRow([createMockCell('ABC00020', 0, 0.95)]);
  const altRow3 = createMockRow([createMockCell('ABC00021', 0, 0.95)]);
  const rows = [...numRows, altRow1, altRow2, altRow3];

  CellQualityEvaluator.evaluateTable([col], rows);

  assert.strictEqual(altRow1.cells[0].qualityAssessment?.severity, 'PASS');
  assert.strictEqual(altRow2.cells[0].qualityAssessment?.severity, 'PASS');
  assert.strictEqual(altRow3.cells[0].qualityAssessment?.severity, 'PASS');
  console.log('  ✓ 22. Supported alternate family members (ABC00019-21) evaluate cleanly to PASS');
}

// -------------------------------------------------------------
// 23. REFERENCE: Structurally Distant Singletons in Numeric Column
// -------------------------------------------------------------
{
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const numRows = Array.from({ length: 10 }, (_, i) =>
    createMockRow([createMockCell(`001234560${i}`, 0)]) // length 10
  );
  // Structurally distant singletons (different length, distinct format)
  const distRow1 = createMockRow([createMockCell('ABC00010', 0, 0.95)]); // length 8
  const distRow2 = createMockRow([createMockCell('PAY-XYZ-2024', 0, 0.95)]); // length 12
  const rows = [...numRows, distRow1, distRow2];

  CellQualityEvaluator.evaluateTable([col], rows);

  assert.strictEqual(distRow1.cells[0].qualityAssessment?.severity, 'PASS', 'ABC00010 must abstain');
  assert.strictEqual(distRow2.cells[0].qualityAssessment?.severity, 'PASS', 'PAY-XYZ-2024 must abstain');
  console.log('  ✓ 23. Structurally distant singletons (ABC00010, PAY-XYZ-2024) abstain safely');
}

console.log('\nAll 23 CellQualityEvaluator Unit Tests Passed Successfully!\n');
