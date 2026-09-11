import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator.js';
import { UnifiedTableService, normalizeVietnameseText } from '../server/services/unifiedTableService.js';

console.log('=== MONEY REGRESSION ===');
const col = { canonicalColumnIndex: 0, header: 'Số dư', normalizedHeader: 'so du', semanticType: 'BALANCE' as const };
const rows = [
  { displayRowIndex: 0, cells: [{ rawValue: '100,000', canonicalColumnIndex: 0, normalizedValue: '100,000', confidence: 0.99, id: '1' }] },
  { displayRowIndex: 1, cells: [{ rawValue: '200,000', canonicalColumnIndex: 0, normalizedValue: '200,000', confidence: 0.99, id: '2' }] },
  { displayRowIndex: 2, cells: [{ rawValue: '300,000', canonicalColumnIndex: 0, normalizedValue: '300,000', confidence: 0.99, id: '3' }] },
  { displayRowIndex: 3, cells: [{ rawValue: '400,000', canonicalColumnIndex: 0, normalizedValue: '400,000', confidence: 0.99, id: '4' }] },
  { displayRowIndex: 4, cells: [{ rawValue: '500,000', canonicalColumnIndex: 0, normalizedValue: '500,000', confidence: 0.99, id: '5' }] },
  { displayRowIndex: 5, cells: [{ rawValue: '95,909 A', canonicalColumnIndex: 0, normalizedValue: '95,909 A', confidence: 0.062, id: '6' }] },
  { displayRowIndex: 6, cells: [{ rawValue: 'Lo ICH 50,000', canonicalColumnIndex: 0, normalizedValue: 'Lo ICH 50,000', confidence: 0.105, id: '7' }] },
  { displayRowIndex: 7, cells: [{ rawValue: '50,039,', canonicalColumnIndex: 0, normalizedValue: '50,039,', confidence: 0.638, id: '8' }] },
  { displayRowIndex: 8, cells: [{ rawValue: '94.709', canonicalColumnIndex: 0, normalizedValue: '94.709', confidence: 0.917, id: '9' }] },
];

CellQualityEvaluator.evaluateTable([col], rows as any);

for (let i = 5; i <= 8; i++) {
  const c = rows[i].cells[0];
  const qa = (c as any).qualityAssessment;
  console.log(`[MONEY] "${c.rawValue}" -> ${qa.severity} (reasons: ${qa.reasons.map((r: any) => r.code).join(', ')})`);
}


console.log('\n=== OTHER DOCUMENTS REGRESSION ===');

// HDBank clean references remain clean / no warning flood
const hdbankPeerRefs = [
  'FT2401010001', 'FT2401010002', 'FT2401010003', 'FT2401010004', 'FT2401010005', 'FT2401010006'
];
const hdbankRes = CellQualityEvaluator.evaluateCell('FT2401010003', 'REFERENCE', 0.98, {
  peerValues: hdbankPeerRefs,
});
console.log(`[HDBank] clean reference FT2401010003 -> ${hdbankRes.severity} (expected PASS)`);

// ACB DD-MM dates remain accepted
const acbDates = ['12-05', '13-05', '14-05', '15-05', '16-05', '17-05'];
const acbRes = CellQualityEvaluator.evaluateCell('14-05', 'DATE', 0.98, {
  peerValues: acbDates,
});
console.log(`[ACB] DD-MM date 14-05 -> ${acbRes.severity} (expected PASS)`);

// Ban Viet: mixed valid reference suffixes remain accepted
const banVietRefs = ['0012345678', '0012345679', '0012345680', 'ABC00019', 'ABC00020'];
const bvRes1 = CellQualityEvaluator.evaluateCell('0012345678', 'REFERENCE', 0.98, {
  peerValues: banVietRefs,
});
const bvRes2 = CellQualityEvaluator.evaluateCell('ABC00020', 'REFERENCE', 0.98, {
  peerValues: banVietRefs,
});
console.log(`[Ban Viet] numeric 0012345678 -> ${bvRes1.severity} (expected PASS)`);
console.log(`[Ban Viet] alternate family ABC00020 -> ${bvRes2.severity} (expected PASS)`);

// Teller-related headers must not become REFERENCE
const tellerHeaders = ['Teller Code', 'GDV', 'NV Giao dịch', 'Người tạo', 'GDV/NV'];
for (const th of tellerHeaders) {
  const sem = UnifiedTableService.inferSemanticType(th, 1, 6, {});
  console.log(`[Teller Header] "${th}" -> ${sem} (expected NOT REFERENCE)`);
}
