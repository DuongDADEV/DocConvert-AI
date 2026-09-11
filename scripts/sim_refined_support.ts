import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator';

function toCharClassMask(val: string): ('D' | 'L' | 'P' | 'S')[] {
  return val.split('').map((ch) => {
    if (/\d/.test(ch)) return 'D';
    if (/[a-zA-Z\u00C0-\u1EF9]/.test(ch)) return 'L';
    if (/[-/._#:\s]/.test(ch)) return 'P';
    return 'S';
  });
}

function evaluateReferenceContextualRefined(
  val: string,
  allColumnValues: string[]
) {
  const trimmed = val.trim();
  const noResult = { isOutlier: false, reasons: [] };

  if (!trimmed || trimmed === '-' || trimmed === '—') return noResult;

  const validPeers = allColumnValues
    .map((v) => (v || '').trim())
    .filter((v) => v !== '' && v !== '-' && v !== '—' && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v));

  const peerIndex = validPeers.indexOf(trimmed);
  const peers = peerIndex !== -1
    ? [...validPeers.slice(0, peerIndex), ...validPeers.slice(peerIndex + 1)]
    : validPeers;

  if (peers.length < 5) return noResult;

  const numericPeers = peers.filter((p) => /^\d+$/.test(p));
  const numRatio = numericPeers.length / peers.length;

  if (numRatio >= 0.90) {
    if (/^\d+$/.test(trimmed)) return noResult;

    const numLengths: Record<number, number> = {};
    for (const p of numericPeers) numLengths[p.length] = (numLengths[p.length] || 0) + 1;
    let domNumLen = -1;
    let domNumLenCount = 0;
    for (const [lStr, cnt] of Object.entries(numLengths)) {
      if (cnt > domNumLenCount) {
        domNumLenCount = cnt;
        domNumLen = Number(lStr);
      }
    }

    const valMaskStr = toCharClassMask(trimmed).join('');
    const leadingAlphaMatch = trimmed.match(/^[a-zA-Z]+/);
    const leadingAlpha = leadingAlphaMatch ? leadingAlphaMatch[0] : '';
    const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    const isNearNumeric = trimmed.length === domNumLen && letterCount <= 2;

    const hasAlternateFamilySupport = peers.some((p) => {
      if (/^\d+$/.test(p)) return false;
      if (p === trimmed) return false; // Distinct peer required
      
      if (leadingAlpha.length >= 2 && p.startsWith(leadingAlpha)) return true;
      if (!isNearNumeric && toCharClassMask(p).join('') === valMaskStr) return true;
      return false;
    });

    if (hasAlternateFamilySupport) {
      return noResult;
    }

    if (isNearNumeric || (!leadingAlpha && letterCount > 0)) {
      let hasConfusion = false;
      for (const ch of trimmed) {
        if (ch in { O: '0', o: '0', I: '1', l: '1', i: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', b: '8', G: '6', g: '6' }) {
          hasConfusion = true;
          break;
        }
      }
      const reasons = [
        {
          code: 'REFERENCE_STRUCTURE_OUTLIER',
          message: 'Mẫu ký tự của mã tham chiếu khác biệt so với phần lớn dữ liệu cùng cột',
        },
      ];
      if (hasConfusion) {
        reasons.push({
          code: 'POSSIBLE_CHARACTER_CONFUSION',
          message: 'Có khả năng nhầm ký tự chữ và số tại vị trí bất thường (ví dụ O/0)',
        });
      }
      return { isOutlier: true, reasons };
    }

    return noResult;
  }

  return noResult;
}

const num30 = Array.from({ length: 30 }, (_, i) => '00123456' + (i < 10 ? '0' + i : '' + i));

console.log('--- D1 with 30 numeric peers (ratio >= 90%) ---');
const resD1 = evaluateReferenceContextualRefined('OO12345678', [...num30, 'OO12345678', 'OO12345678', 'OO12345678']);
console.log('Triple duplicate OO with 30 peers:', resD1.isOutlier ? 'WARNING' : 'PASS', resD1.reasons);

console.log('--- F1 with 30 numeric peers (ratio >= 90%) ---');
const resF1 = evaluateReferenceContextualRefined('OO12345678', [...num30, 'OO12345678', 'AB12345679', 'IO12345680']);
console.log('OO in F1 with 30 peers:', resF1.isOutlier ? 'WARNING' : 'PASS', resF1.reasons);

console.log('--- A1 with 30 numeric peers (ratio >= 90%) ---');
const resA1 = evaluateReferenceContextualRefined('OO12345678', [...num30, 'OO12345678', 'OO12345679']);
console.log('Correlated OO in A1 with 30 peers:', resA1.isOutlier ? 'WARNING' : 'PASS', resA1.reasons);
