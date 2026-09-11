import fs from 'fs';

const content = fs.readFileSync('src/components/ocr/OcrReviewWorkspace.tsx', 'utf-8');
const banned = [
  '95,909 A',
  'Lo ICH 50,000',
  '50,039,',
  '94.709',
  '919ZTRF',
  '9192hv',
  'Nam A',
  'HDBank',
  'ACB',
  'Ban Viet',
];

let found = 0;
for (const b of banned) {
  if (content.includes(b)) {
    console.log('FOUND BANNED FIXTURE:', b);
    found++;
  }
}
console.log('Total fixture matches in OcrReviewWorkspace.tsx:', found);
