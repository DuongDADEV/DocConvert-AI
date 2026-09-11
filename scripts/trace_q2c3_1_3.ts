import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator';
import { UnifiedCell, UnifiedColumn, UnifiedRow } from '../server/services/unifiedTableService';

function createMockColumn(header: string, semanticType: any = 'REFERENCE', canonicalColumnIndex = 0): UnifiedColumn {
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

function evaluateValues(values: string[]) {
  const col = createMockColumn('Số GD', 'REFERENCE', 0);
  const rows = values.map((v, i) => createMockRow([createMockCell(v, 0, 0.95)], i));
  CellQualityEvaluator.evaluateTable([col], rows);
  return rows.map((r, i) => ({
    value: values[i],
    assessment: r.cells[0].qualityAssessment!,
  }));
}

// Trace helper to inspect peer support logic
function traceFamilySupport(target: string, allValues: string[]) {
  const trimmed = target.trim();
  const validPeers = allValues
    .map((v) => (v || '').trim())
    .filter((v) => v !== '' && v !== '-' && v !== '—' && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v));

  const peerIndex = validPeers.indexOf(trimmed);
  const peers = peerIndex !== -1
    ? [...validPeers.slice(0, peerIndex), ...validPeers.slice(peerIndex + 1)]
    : validPeers;

  const numericPeers = peers.filter((p) => /^\d+$/.test(p));
  const numRatio = peers.length > 0 ? numericPeers.length / peers.length : 0;

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

  const toMask = (val: string) => val.split('').map((ch) => {
    if (/\d/.test(ch)) return 'D';
    if (/[a-zA-Z\u00C0-\u1EF9]/.test(ch)) return 'L';
    if (/[-/._#:\s]/.test(ch)) return 'P';
    return 'S';
  }).join('');

  const valMaskStr = toMask(trimmed);
  const leadingAlphaMatch = trimmed.match(/^[a-zA-Z]+/);
  const leadingAlpha = leadingAlphaMatch ? leadingAlphaMatch[0] : '';

  const samePrefixPeers = peers.filter((p) => {
    if (/^\d+$/.test(p)) return false;
    return leadingAlpha.length >= 2 && p.startsWith(leadingAlpha);
  });

  const sameMaskPeers = peers.filter((p) => {
    if (/^\d+$/.test(p)) return false;
    return toMask(p) === valMaskStr;
  });

  const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
  const isNearNumeric = trimmed.length === domNumLen && letterCount <= 2;

  let familySupportReason = 'NONE';
  if (samePrefixPeers.length > 0 && sameMaskPeers.length > 0) {
    familySupportReason = 'SAME_PREFIX_AND_MASK';
  } else if (samePrefixPeers.length > 0) {
    familySupportReason = 'SAME_PREFIX';
  } else if (sameMaskPeers.length > 0) {
    familySupportReason = 'SAME_MASK';
  }

  const evalRes = evaluateValues(allValues).find(r => r.value === target)?.assessment;

  return {
    target,
    peerCount: peers.length,
    numericRatio: (numRatio * 100).toFixed(1) + '%',
    domNumLen,
    leadingAlpha,
    mask: valMaskStr,
    samePrefixCount: samePrefixPeers.length,
    sameMaskCount: sameMaskPeers.length,
    familySupportReason,
    isNearNumeric,
    severity: evalRes?.severity,
    reasons: evalRes?.reasons.map(r => r.code).join(',') || 'NONE',
  };
}

const num10 = [
  '0012345601', '0012345602', '0012345603', '0012345604', '0012345605',
  '0012345606', '0012345607', '0012345608', '0012345609', '0012345610',
];
const num18 = Array.from({ length: 18 }, (_, i) => `00123456${i.toString().padStart(2, '0')}`);

console.log('=== FAMILY SUPPORT TRACES FOR ALL AUDIT CASES ===');

const casesToTrace = [
  { label: 'Test A1', target: 'OO12345678', list: [...num10, 'OO12345678', 'OO12345679'] },
  { label: 'Test A2', target: 'OO12345679', list: [...num10, 'OO12345678', 'OO12345679'] },
  { label: 'Test B1', target: 'OO12345678', list: [...num10, 'OO12345678', 'OO12345679', 'OO12345680'] },
  { label: 'Test C1', target: 'OO12345678', list: [...num10, 'OO12345678', 'OO12345678'] },
  { label: 'Test D1', target: 'OO12345678', list: [...num10, 'OO12345678', 'OO12345678', 'OO12345678'] },
  { label: 'Test E1', target: 'OO12345678', list: [...num10, 'OO12345678', 'AB12345679'] },
  { label: 'Test E2', target: 'AB12345679', list: [...num10, 'OO12345678', 'AB12345679'] },
  { label: 'Test F1', target: 'OO12345678', list: [...num10, 'OO12345678', 'AB12345679', 'IO12345680'] },
  { label: 'Test H1', target: 'ABC00019',   list: [...num10, 'ABC00019', 'ABC00020'] },
  { label: 'Test J1', target: 'AB12340001', list: [...num10, 'AB12340001', 'AB12340002', 'AB12340003'] },
  { label: 'Test K1', target: 'AB12340001', list: [...num10, 'AB12340001', 'CD12340002', 'EF12340003'] },
  { label: 'Test L1', target: 'ABC00019',   list: [...num10, 'ABC00019', 'ABC00019'] },
  { label: 'Test M1', target: 'OO12345678', list: [...num18, 'ABC00019', 'ABC00020', 'OO12345678'] },
  { label: 'Test N1', target: 'OO12345678', list: [...num18, 'AB12340001', 'AB12340002', 'OO12345678'] },
  { label: 'Test N2', target: 'AB12340001', list: [...num18, 'AB12340001', 'AB12340002', 'OO12345678'] },
  { label: 'Test O1', target: 'OO1234567',  list: [...num10, 'OO1234567'] },
];

for (const c of casesToTrace) {
  const t = traceFamilySupport(c.target, c.list);
  console.log(`[${c.label}] Target: ${t.target} | Peers: ${t.peerCount} | NumRatio: ${t.numericRatio} | DomLen: ${t.domNumLen} | Pfx: ${t.leadingAlpha} | Mask: ${t.mask} | SamePfx: ${t.samePrefixCount} | SameMask: ${t.sameMaskCount} | Reason: ${t.familySupportReason} | NearNum: ${t.isNearNumeric} | Result: ${t.severity} [${t.reasons}]`);
}
