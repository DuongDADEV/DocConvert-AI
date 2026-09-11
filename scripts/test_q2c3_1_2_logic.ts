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

export function evaluateNumericDominantCell(
  val: string,
  allColumnValues: string[]
): { isOutlier: boolean; reasons: { code: string; message: string }[] } {
  const trimmed = val.trim();
  const noResult = { isOutlier: false, reasons: [] };

  if (!trimmed || trimmed === '-' || trimmed === '—') {
    return noResult;
  }

  // Leave-one-out
  const validPeers = allColumnValues
    .map((v) => (v || '').trim())
    .filter((v) => v !== '' && v !== '-' && v !== '—' && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v));

  const peerIndex = validPeers.indexOf(trimmed);
  const peers = peerIndex !== -1
    ? [...validPeers.slice(0, peerIndex), ...validPeers.slice(peerIndex + 1)]
    : validPeers;

  if (peers.length < 5) {
    return noResult;
  }

  // Check 1: Homogeneous All-Numeric Column Guard (>= 90% numeric peers)
  const numericPeers = peers.filter((p) => /^\d+$/.test(p));
  if (numericPeers.length / peers.length >= 0.90) {
    if (/^\d+$/.test(trimmed)) {
      return noResult;
    }

    // A. Check if this value has alternate-family peer support
    const valMaskStr = toMask(trimmed).join('');
    const leadingAlphaMatch = trimmed.match(/^[a-zA-Z]+/);
    const leadingAlpha = leadingAlphaMatch ? leadingAlphaMatch[0] : '';

    const hasAlternateFamilySupport = peers.some((p) => {
      if (/^\d+$/.test(p)) return false; // numeric peers don't support an alpha family
      // Same multi-letter prefix (>= 2 letters)
      if (leadingAlpha.length >= 2 && p.startsWith(leadingAlpha)) return true;
      // Or exact same structural mask
      if (toMask(p).join('') === valMaskStr) return true;
      return false;
    });

    if (hasAlternateFamilySupport) {
      return noResult; // Legitimate alternate family supported by peers
    }

    // B. Calculate dominant numeric length
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

    const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    // Near-numeric: matches dominant numeric length and has at most 2 letters/symbols
    const isNearNumeric = trimmed.length === domNumLen && letterCount <= 2;

    // Flag near-numeric anomalies or internal non-digit insertions
    if (isNearNumeric || (!leadingAlpha && letterCount > 0)) {
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

    // If it is structurally far from numeric family (e.g. ABC00010, PAY-XYZ-2024), abstain
    return noResult;
  }

  return noResult;
}

// ==========================================
// TEST SUITE
// ==========================================
console.log('=== TESTING DISAMBIGUATION LOGIC ===\n');

const basePeers = [
  '0012345601', '0012345602', '0012345603', '0012345604', '0012345605',
  '0012345606', '0012345607', '0012345608', '0012345609', '0012345610'
];

const testCases = [
  // Known Blind Spot
  { name: 'Test A: OO12345678 (Blind Spot fix)', val: 'OO12345678', peers: basePeers, expected: 'WARNING' },
  { name: 'Test B: AB12345678 (2-letter singleton)', val: 'AB12345678', peers: basePeers, expected: 'WARNING' },
  { name: 'Test C1: IO12345678 (Double confusion)', val: 'IO12345678', peers: basePeers, expected: 'WARNING' },
  { name: 'Test C2: XX12345678 (Non-confusion 2-letter)', val: 'XX12345678', peers: basePeers, expected: 'WARNING' },

  // Control cases (Must remain PASS)
  { name: 'Test D: ABC00010 (Distinct singleton format)', val: 'ABC00010', peers: basePeers, expected: 'PASS' },
  { name: 'Test E: ABC00020 (Supported by ABC00019, ABC00021)', val: 'ABC00020', peers: [...basePeers, 'ABC00019', 'ABC00021'], expected: 'PASS' },
  { name: 'Test F: ABC00020 (2-member family ABC00019)', val: 'ABC00020', peers: [...basePeers, 'ABC00019'], expected: 'PASS' },
  { name: 'Test G: AB12340001 (Same length supported family)', val: 'AB12340001', peers: [...basePeers, 'AB12340002', 'AB12340003'], expected: 'PASS' },

  // Existing cases
  { name: 'Test I: 00123456O1 (Single letter intrusion)', val: '00123456O1', peers: basePeers, expected: 'WARNING' },
  { name: 'Test J: 0012AB5601 (Internal 2-letter corruption)', val: '0012AB5601', peers: basePeers, expected: 'WARNING' },
  { name: 'Test K: 0012345678 (True numeric)', val: '0012345678', peers: basePeers, expected: 'PASS' },
  { name: 'Test L: 0000000001 (Numeric leading zeros)', val: '0000000001', peers: basePeers, expected: 'PASS' },
  { name: 'Test M: abc00020 (Lowercase supported family)', val: 'abc00020', peers: [...basePeers, 'abc00019'], expected: 'PASS' },
  { name: 'Test N: PAY-00020 (Punctuated supported family)', val: 'PAY-00020', peers: [...basePeers, 'PAY-00019'], expected: 'PASS' },
  { name: 'Test O: PAY-XYZ-2024 (Structurally distant singleton)', val: 'PAY-XYZ-2024', peers: basePeers, expected: 'PASS' },
  { name: 'Test Q: ABC00019 duplicate test', val: 'ABC00019', peers: [...basePeers, 'ABC00019', 'ABC00020'], expected: 'PASS' },
];

let allPassed = true;
for (const tc of testCases) {
  const res = evaluateNumericDominantCell(tc.val, [...tc.peers, tc.val]);
  const severity = res.isOutlier ? 'WARNING' : 'PASS';
  const ok = severity === tc.expected;
  if (!ok) allPassed = false;
  console.log(`${ok ? '✓' : '✗'} ${tc.name}: got ${severity} (expected ${tc.expected}) ${res.reasons.map(r => r.code).join(', ')}`);
}

console.log('\nAll test cases passed?', allPassed ? 'YES' : 'NO');
