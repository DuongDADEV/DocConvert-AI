import assert from 'assert';
import { QUALITY_REASON_LABELS, formatQualityReason } from '../src/components/ocr/OcrReviewWorkspace';

console.log('Running Q2C.4 Quality Presentation Unit Tests:');

// 1. Verify all 16 backend quality reason codes are mapped to clear human-readable Vietnamese
const expectedCodes = [
  'LOW_OCR_CONFIDENCE',
  'MEDIUM_OCR_CONFIDENCE',
  'OCR_CONFIDENCE_UNAVAILABLE',
  'ALPHA_IN_MONEY',
  'LEADING_NOISE',
  'TRAILING_SEPARATOR',
  'MULTIPLE_SEPARATOR_NOISE',
  'FORMAT_OUTLIER',
  'REFERENCE_STRUCTURE_OUTLIER',
  'POSSIBLE_CHARACTER_CONFUSION',
  'DATE_TEXT_CONTAMINATION',
  'INVALID_DATE_STRUCTURE',
  'DATE_FORMAT_OUTLIER',
  'STT_TEXT_CONTAMINATION',
  'STT_NON_INTEGER',
  'CORRUPT_CHARACTERS',
];

for (const code of expectedCodes) {
  const label = QUALITY_REASON_LABELS[code];
  assert.ok(label, `Reason code ${code} must have a non-empty user-facing label`);
  assert.strictEqual(
    formatQualityReason({ code }),
    label,
    `formatQualityReason for ${code} must return the dictionary label`
  );
  // Verify tone: does not claim certainty (no "chắc chắn sai", no "bị lỗi", no "sai")
  assert.ok(!label.includes('chắc chắn sai') && !label.includes('bị lỗi') && !label.includes('chắc chắn lỗi'),
    `Label for ${code} should be explainable and avoid accusatory certainty: "${label}"`
  );
}
console.log(`  ✓ 1. All ${expectedCodes.length} backend quality reason codes mapped to non-accusatory Vietnamese explanations`);

// 2. Fallback formatting test
assert.strictEqual(
  formatQualityReason({ code: 'CUSTOM_UNKNOWN_CODE', message: 'Thông điệp tùy chỉnh' }),
  'Thông điệp tùy chỉnh',
  'Should fall back to reason.message if code is not in dictionary'
);
assert.strictEqual(
  formatQualityReason({ code: 'CUSTOM_UNKNOWN_CODE' }),
  'CUSTOM_UNKNOWN_CODE',
  'Should fall back to reason.code if message is not provided'
);
console.log('  ✓ 2. Fallback mechanisms function cleanly for unknown codes');

// 3. Presentation of the required test cases
interface MockQaCell {
  rawValue: string;
  normalizedValue?: string;
  confidence: number | null;
  confidenceSource?: string;
  qualityAssessment?: {
    severity: 'PASS' | 'WARNING' | 'CRITICAL';
    reasons: { code: string; message?: string }[];
  };
  isReviewed?: boolean;
}

function renderCellPresentation(cell: MockQaCell) {
  const qa = cell.qualityAssessment;
  const isCritical = qa?.severity === 'CRITICAL';
  const isWarning = qa?.severity === 'WARNING';
  const isPass = qa?.severity === 'PASS';
  const hasConf = typeof cell.confidence === 'number' && cell.confidence !== null;
  const confDisplay = hasConf ? `${(cell.confidence * 100).toFixed(1)}%` : 'N/A';
  const isCellReviewed = Boolean(cell.isReviewed);

  // Badge label
  let badgeText = '';
  if (isCellReviewed) badgeText = 'Đã kiểm tra';
  else if (isCritical) badgeText = 'Ưu tiên kiểm tra';
  else if (isWarning) badgeText = 'Cần kiểm tra';
  else if (isPass) badgeText = 'Không phát hiện bất thường';

  // Tooltip
  let cellTooltip = `Giá trị: ${cell.rawValue ?? cell.normalizedValue ?? '—'}`;
  if (isCellReviewed) {
    cellTooltip += `\nTrạng thái: Đã kiểm tra`;
    if (qa && (isCritical || isWarning)) {
      const machineSeverity = isCritical ? 'Ưu tiên kiểm tra' : 'Cần kiểm tra';
      cellTooltip += ` (Đánh giá ban đầu: ${machineSeverity})`;
    }
  } else if (qa) {
    const statusLabel = isCritical
      ? 'Ưu tiên kiểm tra'
      : isWarning
      ? 'Cần kiểm tra'
      : 'Không phát hiện bất thường';
    cellTooltip += `\nTrạng thái: ${statusLabel}`;
  }
  if (qa?.reasons && qa.reasons.length > 0) {
    cellTooltip += `\nLý do:\n` + qa.reasons.map((r: any) => `• ${formatQualityReason(r)}`).join('\n');
  }
  cellTooltip += `\nĐộ tin cậy OCR: ${confDisplay}`;

  return { badgeText, cellTooltip };
}

// Case 1: Money Contamination (95,909 A)
{
  const cell: MockQaCell = {
    rawValue: '95,909 A',
    confidence: 0.062,
    confidenceSource: 'AZURE_WORD_AGGREGATE',
    qualityAssessment: {
      severity: 'WARNING',
      reasons: [
        { code: 'LOW_OCR_CONFIDENCE' },
        { code: 'ALPHA_IN_MONEY' },
      ],
    },
  };
  const pres = renderCellPresentation(cell);
  assert.strictEqual(pres.badgeText, 'Cần kiểm tra');
  assert.ok(pres.cellTooltip.includes('Độ tin cậy OCR: 6.2%'));
  assert.ok(pres.cellTooltip.includes('• OCR chưa chắc chắn với nội dung này'));
  assert.ok(pres.cellTooltip.includes('• Giá trị tiền có ký tự chữ bất thường'));
  assert.ok(!pres.cellTooltip.includes('Độ chính xác'));
  console.log('  ✓ 3. Money Case "95,909 A" renders "Cần kiểm tra" with 6.2% OCR confidence and distinct reasons');
}

// Case 2: Leading Noise (Lo ICH 50,000)
{
  const cell: MockQaCell = {
    rawValue: 'Lo ICH 50,000',
    confidence: 0.105,
    confidenceSource: 'AZURE_WORD_AGGREGATE',
    qualityAssessment: {
      severity: 'CRITICAL',
      reasons: [
        { code: 'LOW_OCR_CONFIDENCE' },
        { code: 'LEADING_NOISE' },
        { code: 'ALPHA_IN_MONEY' },
      ],
    },
  };
  const pres = renderCellPresentation(cell);
  assert.strictEqual(pres.badgeText, 'Ưu tiên kiểm tra');
  assert.ok(pres.cellTooltip.includes('Độ tin cậy OCR: 10.5%'));
  assert.ok(pres.cellTooltip.includes('• Có ký tự bất thường ở đầu giá trị'));
  assert.ok(pres.cellTooltip.includes('• Giá trị tiền có ký tự chữ bất thường'));
  console.log('  ✓ 4. Leading Noise Case "Lo ICH 50,000" renders "Ưu tiên kiểm tra" with reasons and 10.5% OCR confidence');
}

// Case 3: Trailing Separator (50,039,)
{
  const cell: MockQaCell = {
    rawValue: '50,039,',
    confidence: 0.638,
    confidenceSource: 'AZURE_WORD_AGGREGATE',
    qualityAssessment: {
      severity: 'WARNING',
      reasons: [
        { code: 'LOW_OCR_CONFIDENCE' },
        { code: 'TRAILING_SEPARATOR' },
      ],
    },
  };
  const pres = renderCellPresentation(cell);
  assert.strictEqual(pres.badgeText, 'Cần kiểm tra');
  assert.ok(pres.cellTooltip.includes('• Có dấu phân cách bất thường ở cuối giá trị'));
  assert.ok(pres.cellTooltip.includes('Độ tin cậy OCR: 63.8%'));
  console.log('  ✓ 5. Trailing Separator Case "50,039," renders "Cần kiểm tra" with trailing separator reason');
}

// Case 4: Semantic-Only Warning (94.709 with high confidence 91.7%)
{
  const cell: MockQaCell = {
    rawValue: '94.709',
    confidence: 0.917,
    confidenceSource: 'AZURE_WORD_AGGREGATE',
    qualityAssessment: {
      severity: 'WARNING',
      reasons: [
        { code: 'FORMAT_OUTLIER' },
      ],
    },
  };
  const pres = renderCellPresentation(cell);
  assert.strictEqual(pres.badgeText, 'Cần kiểm tra');
  assert.ok(pres.cellTooltip.includes('• Định dạng khác với phần lớn dữ liệu trong cột'));
  assert.ok(pres.cellTooltip.includes('Độ tin cậy OCR: 91.7%'));
  console.log('  ✓ 6. Semantic-Only Warning "94.709" renders "Cần kiểm tra" despite 91.7% OCR confidence');
}

// Case 5: Reference Structural Outlier (919ZTRF242991500)
{
  const cell: MockQaCell = {
    rawValue: '919ZTRF242991500',
    confidence: 0.834,
    confidenceSource: 'AZURE_WORD_AGGREGATE',
    qualityAssessment: {
      severity: 'WARNING',
      reasons: [
        { code: 'REFERENCE_STRUCTURE_OUTLIER' },
        { code: 'POSSIBLE_CHARACTER_CONFUSION' },
      ],
    },
  };
  const pres = renderCellPresentation(cell);
  assert.strictEqual(pres.badgeText, 'Cần kiểm tra');
  assert.ok(pres.cellTooltip.includes('• Cấu trúc mã khác với phần lớn dữ liệu trong cột'));
  assert.ok(pres.cellTooltip.includes('• Có khả năng OCR nhầm ký tự'));
  assert.ok(pres.cellTooltip.includes('Độ tin cậy OCR: 83.4%'));
  console.log('  ✓ 7. Reference Outlier "919ZTRF242991500" renders "Cần kiểm tra" with structural & confusion diagnostics');
}

// Case 6: Low OCR Only (9192hv6243011321)
{
  const cell: MockQaCell = {
    rawValue: '9192hv6243011321',
    confidence: 0.578,
    confidenceSource: 'AZURE_WORD_AGGREGATE',
    qualityAssessment: {
      severity: 'WARNING',
      reasons: [
        { code: 'LOW_OCR_CONFIDENCE' },
      ],
    },
  };
  const pres = renderCellPresentation(cell);
  assert.strictEqual(pres.badgeText, 'Cần kiểm tra');
  assert.ok(pres.cellTooltip.includes('• OCR chưa chắc chắn với nội dung này'));
  assert.ok(!pres.cellTooltip.includes('Cấu trúc mã khác với phần lớn'));
  assert.ok(pres.cellTooltip.includes('Độ tin cậy OCR: 57.8%'));
  console.log('  ✓ 8. Low-OCR Only "9192hv6243011321" renders without fake structural warnings');
}

// Case 7: Human Reviewed Warning (Confirm as-is)
{
  const cell: MockQaCell = {
    rawValue: '919ZTRF242991500',
    confidence: 0.834,
    confidenceSource: 'AZURE_WORD_AGGREGATE',
    isReviewed: true,
    qualityAssessment: {
      severity: 'WARNING',
      reasons: [
        { code: 'REFERENCE_STRUCTURE_OUTLIER' },
        { code: 'POSSIBLE_CHARACTER_CONFUSION' },
      ],
    },
  };
  const pres = renderCellPresentation(cell);
  assert.strictEqual(pres.badgeText, 'Đã kiểm tra');
  assert.ok(pres.cellTooltip.includes('Trạng thái: Đã kiểm tra (Đánh giá ban đầu: Cần kiểm tra)'));
  assert.ok(pres.cellTooltip.includes('• Cấu trúc mã khác với phần lớn dữ liệu trong cột'));
  assert.ok(pres.cellTooltip.includes('Độ tin cậy OCR: 83.4%'));
  console.log('  ✓ 9. Human-reviewed cell displays "Đã kiểm tra" badge while preserving machine quality audit in tooltip');
}

// Case 8: Unavailable confidence / Empty cell
{
  const cell: MockQaCell = {
    rawValue: '-',
    confidence: null,
    confidenceSource: 'EMPTY_CELL',
    qualityAssessment: {
      severity: 'PASS',
      reasons: [],
    },
  };
  const pres = renderCellPresentation(cell);
  assert.strictEqual(pres.badgeText, 'Không phát hiện bất thường');
  assert.ok(pres.cellTooltip.includes('Độ tin cậy OCR: N/A'));
  console.log('  ✓ 10. Empty / unavailable confidence renders N/A cleanly without false warning');
}

console.log('\nAll 10 Q2C.4 Quality Presentation Unit Tests Passed Successfully!\n');
