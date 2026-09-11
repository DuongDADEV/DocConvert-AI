import { evaluateReferenceContextual, toMask } from './test_q2c3_logic.js';

const banVietRefs = [
  '068ZTRF24198000Z',
  '068ZTRF241980011',
  '068ZTRF241980015',
  '068ZTRF24198001N',
  '068ZTRF24198001P',
  '068ZTRF24198001T',
  '068ZTRF24198001X',
  '068ZTRF24198001Z',
];

console.log('Ban Viet masks:');
banVietRefs.forEach(v => console.log(v, toMask(v).join('')));

const res = evaluateReferenceContextual('068ZTRF241980011', banVietRefs);
console.log('Res:', res);
