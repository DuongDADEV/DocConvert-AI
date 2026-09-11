import { UnifiedTableService, normalizeVietnameseText } from '../server/services/unifiedTableService.js';

const positiveHeaders = [
  'SỐ GIAO DỊCH Transaction No',
  'Số giao dịch',
  'Mã giao dịch',
  'Transaction No',
  'Transaction Number',
  'Reference',
  'Reference No',
  'Reference Number',
  'Số tham chiếu',
  'Mã GD',
];

const negativeHeaders = [
  { header: 'Nội dung giao dịch', notExpected: 'REFERENCE' },
  { header: 'Diễn giải', notExpected: 'REFERENCE' },
  { header: 'Transaction Description', notExpected: 'REFERENCE' },
  { header: 'Ngày giao dịch', notExpected: 'REFERENCE' },
  { header: 'Transaction Date', notExpected: 'REFERENCE' },
  { header: 'Số tiền giao dịch', notExpected: 'REFERENCE' },
  { header: 'Transaction Amount', notExpected: 'REFERENCE' },
  { header: 'Số dư', notExpected: 'REFERENCE' },
  { header: 'Balance', notExpected: 'REFERENCE' },
  { header: 'Teller Code', notExpected: 'REFERENCE' },
  { header: 'Người tạo', notExpected: 'REFERENCE' },
  { header: 'Account No', notExpected: 'REFERENCE' },
  { header: 'Số tài khoản', notExpected: 'REFERENCE' },
];

console.log('| Header | Normalized Header | Actual Semantic Type | Expected | PASS/FAIL |');
console.log('|---|---|---|---|---|');

for (const h of positiveHeaders) {
  const norm = normalizeVietnameseText(h);
  const actual = UnifiedTableService.inferSemanticType(h, 1, 5, {});
  const pass = actual === 'REFERENCE' ? 'PASS' : 'FAIL';
  console.log(`| ${h} | \`${norm}\` | ${actual} | REFERENCE | ${pass} |`);
}

for (const item of negativeHeaders) {
  const norm = normalizeVietnameseText(item.header);
  const actual = UnifiedTableService.inferSemanticType(item.header, 1, 5, {});
  const pass = actual !== item.notExpected ? 'PASS' : 'FAIL';
  console.log(`| ${item.header} | \`${norm}\` | ${actual} | NOT REFERENCE | ${pass} |`);
}
