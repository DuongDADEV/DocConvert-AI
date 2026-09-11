import { performance } from 'perf_hooks';

export type CharClass = 'D' | 'L' | 'P' | 'S';

function getCharClass(ch: string): CharClass {
  if (/\d/.test(ch)) return 'D';
  if (/[a-zA-Z\u00C0-\u1EF9]/.test(ch)) return 'L';
  if (/[-/._#:\s]/.test(ch)) return 'P';
  return 'S';
}

function toMask(val: string): CharClass[] {
  return val.split('').map(getCharClass);
}

const DIGIT_TO_LETTER_CONFUSIONS: Record<string, string> = {
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B',
};

const LETTER_TO_DIGIT_CONFUSIONS: Record<string, string> = {
  'O': '0', 'o': '0', 'I': '1', 'i': '1', 'l': '1',
  'Z': '2', 'z': '2', 'S': '5', 's': '5', 'G': '6', 'g': '6',
  'B': '8', 'b': '8',
};

export function evaluateReferenceContextualRefined(
  val: string,
  allColumnValues: string[]
): { isOutlier: boolean; reasons: { code: string; message: string }[] } {
  const trimmed = val.trim();
  const noResult = { isOutlier: false, reasons: [] };

  if (!trimmed || trimmed === '-' || trimmed === '—') {
    return noResult;
  }

  // A. Leave-one-out: filter peers excluding exact index/occurrence
  const validPeers = allColumnValues
    .map((v) => (v || '').trim())
    .filter((v) => v !== '' && v !== '-' && v !== '—' && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v));

  const peerIndex = validPeers.indexOf(trimmed);
  const peers = peerIndex !== -1
    ? [...validPeers.slice(0, peerIndex), ...validPeers.slice(peerIndex + 1)]
    : validPeers;

  // Minimum sample requirement: at least 5 usable peer values
  if (peers.length < 5) {
    return noResult;
  }

  // B. Check 1: Homogeneous All-Numeric Column Guard
  // Only flags true corruption (e.g. "000123895O"), NOT distinct multi-letter codes (e.g. "ABC00010")
  const numericPeers = peers.filter((p) => /^\d+$/.test(p));
  if (numericPeers.length / peers.length >= 0.90) {
    if (/^\d+$/.test(trimmed)) {
      return noResult;
    }
    // If the value starts with 2+ letters, it is a distinct alphanumeric format, not an integer with OCR corruption
    const leadingLetterMatch = trimmed.match(/^[a-zA-Z]+/);
    if (leadingLetterMatch && leadingLetterMatch[0].length >= 2) {
      return noResult; // Legitimate distinct format (e.g. ABC00010)
    }

    // Isolated letter intrusion in an otherwise numeric code (e.g. 000123895O)
    let hasConfusion = false;
    for (const ch of trimmed) {
      if (ch in LETTER_TO_DIGIT_CONFUSIONS) {
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

  // C. Check 2: Prefix Family Cluster Analysis (for mixed or structured columns)
  let familyPeers: string[] = [];
  let familyPrefix = '';

  for (let pfxLen = Math.min(8, trimmed.length - 2); pfxLen >= 3; pfxLen--) {
    const pfx = trimmed.substring(0, pfxLen);
    // Family prefix must contain at least one letter to represent a transaction family rather than a raw numeric branch code
    if (!/[a-zA-Z]/.test(pfx)) continue;

    const matched = peers.filter((p) => p.startsWith(pfx));
    if (matched.length >= 5) {
      familyPeers = matched;
      familyPrefix = pfx;
      break;
    }
  }

  if (familyPeers.length >= 5) {
    // Length check within family
    const familyLengths = familyPeers.map((p) => p.length);
    const lengthCounts: Record<number, number> = {};
    for (const l of familyLengths) lengthCounts[l] = (lengthCounts[l] || 0) + 1;

    let domLen = -1;
    let domLenCount = 0;
    for (const [lStr, cnt] of Object.entries(lengthCounts)) {
      const l = Number(lStr);
      if (cnt > domLenCount) {
        domLenCount = cnt;
        domLen = l;
      }
    }

    if (domLenCount / familyPeers.length >= 0.90 && trimmed.length !== domLen) {
      return {
        isOutlier: true,
        reasons: [{
          code: 'REFERENCE_STRUCTURE_OUTLIER',
          message: 'Độ dài của mã tham chiếu khác biệt so với phần lớn dữ liệu cùng cột',
        }],
      };
    }

    const sameLenFamily = familyPeers.filter((p) => p.length === trimmed.length);
    if (sameLenFamily.length >= 5) {
      const valMask = toMask(trimmed);
      const famMasks = sameLenFamily.map(toMask);
      let positionalAnomaly = false;
      let hasConfusion = false;

      // Positional class consistency within family
      for (let pos = familyPrefix.length; pos < trimmed.length; pos++) {
        const counts: Record<string, number> = { D: 0, L: 0, P: 0, S: 0 };
        for (const fm of famMasks) {
          counts[fm[pos]] = (counts[fm[pos]] || 0) + 1;
        }

        let domClass: string | null = null;
        for (const [cls, cnt] of Object.entries(counts)) {
          if (cnt / sameLenFamily.length >= 0.90) {
            domClass = cls;
            break;
          }
        }

        if (domClass && valMask[pos] !== domClass) {
          positionalAnomaly = true;
          const ch = trimmed[pos];
          if (domClass === 'L' && valMask[pos] === 'D' && ch in DIGIT_TO_LETTER_CONFUSIONS) {
            hasConfusion = true;
          } else if (domClass === 'D' && valMask[pos] === 'L' && ch in LETTER_TO_DIGIT_CONFUSIONS) {
            hasConfusion = true;
          }
        }
      }

      // Suffix Segment Letter Constraint (tail of 2 characters)
      // Only applies if the value belongs to the family AND has suffix affinity
      if (!positionalAnomaly && trimmed.length >= 10) {
        const tailLen = 2;
        const peersWithTailLetter = sameLenFamily.filter((p) => {
          const tail = p.substring(p.length - tailLen);
          return /[a-zA-Z]/.test(tail);
        }).length;

        const tailLetterSupport = peersWithTailLetter / sameLenFamily.length;
        const valTail = trimmed.substring(trimmed.length - tailLen);
        const valTailHasLetter = /[a-zA-Z]/.test(valTail);

        if (tailLetterSupport >= 0.90 && !valTailHasLetter) {
          positionalAnomaly = true;
          for (const ch of valTail) {
            if (ch in DIGIT_TO_LETTER_CONFUSIONS) {
              hasConfusion = true;
              break;
            }
          }
        }
      }

      if (positionalAnomaly) {
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
    }

    return noResult;
  }

  // D. Check 3: Column-Wide Dominant Format (Conservative)
  // Only applies when:
  // 1. Same length as dominant format
  // 2. High mask dominance (>= 85%)
  // 3. Isolated class mutation (1 or 2 positions differing), NOT completely novel formats like PAY-9999
  const allMasks = peers.map((p) => toMask(p).join(''));
  const maskCounts: Record<string, number> = {};
  for (const ms of allMasks) maskCounts[ms] = (maskCounts[ms] || 0) + 1;

  let dominantMask = '';
  let dominantMaskCount = 0;
  for (const [ms, cnt] of Object.entries(maskCounts)) {
    if (cnt > dominantMaskCount) {
      dominantMaskCount = cnt;
      dominantMask = ms;
    }
  }

  if (dominantMaskCount / peers.length >= 0.85) {
    const valMaskStr = toMask(trimmed).join('');
    // Only compare if same length
    if (trimmed.length === dominantMask.length && valMaskStr !== dominantMask) {
      let mismatchCount = 0;
      let hasConfusion = false;
      for (let i = 0; i < trimmed.length; i++) {
        const expected = dominantMask[i];
        const actual = valMaskStr[i];
        const ch = trimmed[i];
        if (expected !== actual) {
          mismatchCount++;
          if (expected === 'L' && actual === 'D' && ch in DIGIT_TO_LETTER_CONFUSIONS) hasConfusion = true;
          if (expected === 'D' && actual === 'L' && ch in LETTER_TO_DIGIT_CONFUSIONS) hasConfusion = true;
        }
      }
      // Only flag if it's an isolated structural mutation (1 or 2 positions), which indicates an OCR corruption
      // If mismatchCount >= 3, it's a completely different format/family, so abstain!
      if (mismatchCount <= 2) {
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
    }
  }

  return noResult;
}

// Run comparison on test matrices
console.log('--- TESTING REFINED CONTEXTUAL REFERENCE LOGIC ---');

// Test Matrix A1: 9 num + 1 alpha (ABC00010)
const colA1 = ['10000001', '10000002', '10000003', '10000004', '10000005', '10000006', '10000007', '10000008', '10000009', 'ABC00010'];
console.log('A1 ABC00010:', evaluateReferenceContextualRefined('ABC00010', colA1));

// Test Matrix L1: 50 Dominant + 1 Novel Singleton (PAY-9999)
const colL1 = Array.from({ length: 50 }, (_, i) => `REF2024${(i + 1).toString().padStart(4, '0')}A`).concat(['PAY-9999']);
console.log('L1 PAY-9999:', evaluateReferenceContextualRefined('PAY-9999', colL1));

// Test Matrix L2: 50 Dominant + 1 Novel Numeric Singleton (1234567890)
const colL2 = Array.from({ length: 50 }, (_, i) => `REF2024${(i + 1).toString().padStart(4, '0')}A`).concat(['1234567890']);
console.log('L2 1234567890:', evaluateReferenceContextualRefined('1234567890', colL2));

// Test Matrix B: 95 Family A + 5 Family B
const colB = Array.from({ length: 95 }, (_, i) => `TXN2024${(i + 1).toString().padStart(4, '0')}A`).concat(
  Array.from({ length: 5 }, (_, i) => `EXT99${(i + 1).toString().padStart(3, '0')}Z`)
);
console.log('B EXT99001Z:', evaluateReferenceContextualRefined('EXT99001Z', colB));

// Test Matrix M: Case 1 Silent OCR Error (919ZTRF242991500)
const colM = Array.from({ length: 20 }, (_, i) => `919ZTRF2429915O${i % 10}`).concat(['919ZTRF242991500']);
console.log('M (Case 1 919ZTRF242991500):', evaluateReferenceContextualRefined('919ZTRF242991500', colM));

// Test Case 3: 9192hv6243011321
const colC3 = Array.from({ length: 20 }, (_, i) => `919ZTRF2429915O${i % 10}`).concat([
  '919GL3024129C4YA', '919NAP224152TOL6', '919CV00VND 00001', '9192hv6243011321'
]);
console.log('Case 3 (9192hv6243011321):', evaluateReferenceContextualRefined('9192hv6243011321', colC3));

// Test True numeric corruption (000123895O in all-numeric column)
const colNum = ['0001238951', '0001238952', '0001238953', '0001238954', '0001238955', '000123895O'];
console.log('True numeric corruption (000123895O):', evaluateReferenceContextualRefined('000123895O', colNum));
