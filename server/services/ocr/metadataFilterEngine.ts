import {
  OCRMetadataObservation,
  OCRMetadataItem,
  OCRExtractedTable,
  OCRPage,
  OCRLine,
  SemanticType,
  VisibilityClass,
  MetadataSourceType,
  MetadataFilterMetrics,
} from './types.js';

export interface MetadataFilterResult {
  canonicalMetadata: OCRMetadataItem[];
  metrics: MetadataFilterMetrics;
}

export const METADATA_CONFIG = {
  // Normalized position ratios (y / pageHeight)
  HEADER_STRONG_ZONE_RATIO: 0.18,
  HEADER_MAX_ZONE_RATIO: 0.28,

  // Table classification constants (multi-signal evidence, never hardcoded rowCount alone)
  TABLE_HEADER_MAX_NORM_TOP: 0.25,
  TABLE_HEADER_MIN_SCORE: 1.5,

  // Quality thresholds
  CORE_MIN_QUALITY: 0.50,
  ADDITIONAL_MIN_QUALITY: 0.35,

  // Label similarity threshold for near-duplicate merge
  NEAR_DUP_LABEL_SIMILARITY: 0.75,
};

export const SEMANTIC_TYPE_ORDER: Record<SemanticType, number> = {
  ACCOUNT_HOLDER: 1,
  ACCOUNT_NUMBER: 2,
  CUSTOMER_ID: 3,
  TAX_CODE: 4,
  STATEMENT_FROM: 5,
  STATEMENT_TO: 6,
  STATEMENT_DATE: 7,
  CURRENCY: 8,
  ACCOUNT_TYPE: 9,
  BRANCH: 10,
  ADDRESS: 11,
  OTHER: 12,
};

export class MetadataFilterEngine {
  /**
   * Helper: Removes Vietnamese diacritics for label matching comparison only.
   * Preserves raw string for display.
   */
  static removeDiacritics(str: string): string {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  /**
   * Conservative Label Normalization for Matching:
   * Trims whitespace, punctuation, converts to lowercase, collapses multiple spaces.
   */
  static normalizeLabel(rawLabel: string): string {
    if (!rawLabel) return '';
    let norm = rawLabel.trim().toLowerCase();
    norm = norm.replace(/^[\s:_.-]+|[\s:_.-]+$/g, '');
    norm = norm.replace(/\s+/g, ' ');
    return norm;
  }

  /**
   * Conservative Value Normalization for Duplicate Comparison Only:
   * Trims whitespace, collapses spaces, strips trailing OCR noise.
   */
  static normalizeValueForMatch(rawValue: string): string {
    if (!rawValue) return '';
    let norm = rawValue.trim();
    norm = norm.replace(/['.]+$|\s+$/g, '');
    norm = norm.replace(/\s+/g, ' ');
    return norm.toLowerCase();
  }

  /**
   * Helper: Converts an 8-number polygon [x1, y1, x2, y2, x3, y3, x4, y4] to bounding rect
   */
  static polygonToBoundingBox(poly?: number[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (!poly || poly.length < 8) return null;
    const xs = [poly[0], poly[2], poly[4], poly[6]];
    const ys = [poly[1], poly[3], poly[5], poly[7]];
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }

  /**
   * Helper: Calculates area of overlap ratio between a region box and a target box
   */
  static isBoxInside(
    box: { minX: number; minY: number; maxX: number; maxY: number } | null,
    targetBox: { minX: number; minY: number; maxX: number; maxY: number } | null
  ): boolean {
    if (!box || !targetBox) return false;

    const interMinX = Math.max(box.minX, targetBox.minX);
    const interMinY = Math.max(box.minY, targetBox.minY);
    const interMaxX = Math.min(box.maxX, targetBox.maxX);
    const interMaxY = Math.min(box.maxY, targetBox.maxY);

    if (interMaxX <= interMinX || interMaxY <= interMinY) {
      return false;
    }

    const interArea = (interMaxX - interMinX) * (interMaxY - interMinY);
    const boxArea = (box.maxX - box.minX) * (box.maxY - box.minY);

    if (boxArea <= 0) return false;
    return interArea / boxArea >= 0.5;
  }

  /**
   * String similarity using token overlap and normalized Levenshtein distance
   */
  static calculateLabelSimilarity(labelA: string, labelB: string): number {
    const cleanA = this.removeDiacritics(this.normalizeLabel(labelA));
    const cleanB = this.removeDiacritics(this.normalizeLabel(labelB));

    if (cleanA === cleanB) return 1.0;
    if (!cleanA || !cleanB) return 0.0;

    // Token overlap (Jaccard similarity on words)
    const tokensA = new Set(cleanA.split(/[\s/()_-]+/).filter(Boolean));
    const tokensB = new Set(cleanB.split(/[\s/()_-]+/).filter(Boolean));
    const arrA = Array.from(tokensA);
    const arrB = Array.from(tokensB);
    const intersection = new Set(arrA.filter((x) => tokensB.has(x)));
    const union = new Set(arrA.concat(arrB));
    const jaccard = union.size > 0 ? intersection.size / union.size : 0;

    if (jaccard >= 0.7) return Math.max(jaccard, 0.85);

    // Levenshtein distance
    const m = cleanA.length;
    const n = cleanB.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (cleanA[i - 1] === cleanB[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    const maxLen = Math.max(m, n);
    const levSim = maxLen > 0 ? (maxLen - dp[m][n]) / maxLen : 0;
    return Math.max(jaccard, levSim);
  }

  /**
   * Generic Bilingual Semantic Resolver
   * Maps common banking header labels to SemanticType using diacritic-folded matching.
   * Follows strict zero-guessing: does not infer CUSTOMER_ID, CIF, or TAX_CODE without explicit label keywords.
   */
  static resolveSemanticType(rawLabel: string, rawValue?: string): SemanticType {
    if (!rawLabel) return 'OTHER';
    const clean = this.removeDiacritics(this.normalizeLabel(rawLabel));

    // 1. ACCOUNT_NUMBER (Check before generic keywords)
    if (
      clean.includes('so tai khoan') ||
      clean.includes('so tk') ||
      clean.includes('tai khoan') ||
      clean.includes('account no') ||
      clean.includes('accountno') ||
      clean.includes('accno') ||
      clean.includes('account number') ||
      clean.includes('acc no') ||
      clean.includes('acct no') ||
      clean.includes('acct number') ||
      /^account\b/.test(clean) ||
      /^so tk\b/.test(clean)
    ) {
      // Guard: do not misclassify "loai tai khoan" as account number
      if (!clean.includes('loai') && !clean.includes('type')) {
        return 'ACCOUNT_NUMBER';
      }
    }

    // 2. ACCOUNT_HOLDER
    if (
      clean.includes('chu tai khoan') ||
      clean.includes('chu tk') ||
      clean.includes('ten tai khoan') ||
      clean.includes('ten tk') ||
      clean.includes('ten khach hang') ||
      clean.includes('khach hang') ||
      clean.includes('client') ||
      clean.includes('account holder') ||
      clean.includes('account name') ||
      clean.includes('customer name') ||
      clean.includes('beneficiary name')
    ) {
      if (!clean.includes('ma') && !clean.includes('id') && !clean.includes('cif')) {
        // Zero-guessing: If value is purely numeric (e.g. client ID codes), do NOT classify as person/holder name!
        if (rawValue && /^[\d\s\n.-]+$/.test(rawValue.trim())) {
          return 'OTHER';
        }
        return 'ACCOUNT_HOLDER';
      }
    }

    // 3. STATEMENT_FROM
    if (
      clean.includes('tu ngay') ||
      clean.includes('from date') ||
      clean.includes('effective date from') ||
      clean.includes('period from') ||
      /^from\b/.test(clean) ||
      clean === 'tu ngay'
    ) {
      return 'STATEMENT_FROM';
    }

    // 4. STATEMENT_TO
    if (
      clean.includes('den ngay') ||
      clean.includes('to date') ||
      clean.includes('effective date to') ||
      clean.includes('period to') ||
      /^to\b/.test(clean) ||
      clean === 'den ngay'
    ) {
      return 'STATEMENT_TO';
    }

    // 5. CURRENCY
    if (
      clean.includes('loai tien') ||
      clean.includes('tien te') ||
      clean.includes('currency') ||
      clean.includes('ccy') ||
      clean.includes('curr') ||
      clean === 'loai tien' ||
      clean === 'currency'
    ) {
      return 'CURRENCY';
    }

    // 6. ACCOUNT_TYPE
    if (
      clean.includes('loai tai khoan') ||
      clean.includes('loai tk') ||
      clean.includes('loai hinh') ||
      clean.includes('hinh thuc') ||
      clean.includes('account type') ||
      clean.includes('type of account') ||
      clean.includes('product type')
    ) {
      return 'ACCOUNT_TYPE';
    }

    // 7. TAX_CODE (Explicit only)
    if (
      clean.includes('ma so thue') ||
      clean.includes('mst') ||
      clean.includes('tax code') ||
      clean.includes('vat no') ||
      clean.includes('tin')
    ) {
      return 'TAX_CODE';
    }

    // 8. CUSTOMER_ID (Explicit only)
    if (
      clean.includes('ma khach hang') ||
      clean.includes('ma kh') ||
      clean.includes('cif') ||
      clean.includes('customer id') ||
      clean.includes('client id') ||
      clean.includes('cust no')
    ) {
      return 'CUSTOMER_ID';
    }

    // 8b. Operational Print Timestamps (Must NOT be STATEMENT_DATE / CORE)
    if (
      clean.includes('in luc') ||
      clean.includes('print time') ||
      clean.includes('printed at') ||
      clean.includes('printed on') ||
      clean.includes('printed time')
    ) {
      return 'OTHER';
    }

    // 9. STATEMENT_DATE
    if (
      clean.includes('ngay sao ke') ||
      clean.includes('statement date') ||
      clean.includes('ngay lap') ||
      clean.includes('ngay bao cao') ||
      clean.includes('date of issue') ||
      clean.includes('issued date') ||
      clean === 'date' ||
      clean === 'ngay' ||
      clean === 'ngay (date)'
    ) {
      return 'STATEMENT_DATE';
    }

    // 10. BRANCH
    if (
      clean.includes('chi nhanh') ||
      clean.includes('don vi') ||
      clean.includes('phong giao dich') ||
      clean.includes('pgd') ||
      clean.includes('branch') ||
      clean.includes('sub-branch')
    ) {
      return 'BRANCH';
    }

    // 11. ADDRESS
    if (clean.includes('dia chi') || clean.includes('address')) {
      return 'ADDRESS';
    }

    return 'OTHER';
  }

  /**
   * Multi-Signal Header Table Classifier
   * headerTableScore = positionEvidence + semanticEvidence + repetitionEvidence + structuralEvidence - transactionEvidence
   */
  static isHeaderTable(
    table: OCRExtractedTable,
    pageHeight: number = 11.69,
    allTables: OCRExtractedTable[] = []
  ): boolean {
    const br = table.boundingRegions?.[0];
    if (!br || !Array.isArray(br.polygon) || br.polygon.length < 8) return false;

    const ys = [br.polygon[1], br.polygon[3], br.polygon[5], br.polygon[7]];
    const minY = Math.min(...ys);
    const normTop = minY / pageHeight;

    let score = 0;

    // 1. Position evidence
    if (normTop <= 0.15) {
      score += 1.8;
    } else if (normTop <= METADATA_CONFIG.TABLE_HEADER_MAX_NORM_TOP) {
      score += 1.0;
    } else {
      score -= 2.5; // Below header zone
    }

    // 2. Structural evidence
    if (table.rowCount <= 3) {
      score += 1.2;
    } else if (table.rowCount <= 5) {
      score += 0.5;
    } else {
      score -= 2.0; // Large row count strongly implies transaction table
    }

    if (table.columnCount <= 4) {
      score += 0.8;
    } else if (table.columnCount >= 7) {
      score -= 1.5; // Many columns strongly implies transaction ledger
    }

    // 3. Semantic and transaction evidence inside table cells
    let headerKeywordCount = 0;
    let transactionKeywordCount = 0;
    let amountCellCount = 0;

    const headerKeywords = [
      'khach hang',
      'client',
      'tai khoan',
      'acct',
      'account',
      'vnd',
      'currency',
      'branch',
      'chi nhanh',
      'ky sao ke',
      'from',
      'to',
      'tu ngay',
      'den ngay',
    ];

    const transactionKeywords = [
      'so du',
      'balance',
      'debit',
      'credit',
      'ps no',
      'ps co',
      'stt',
      'doc no',
      'ref no',
      'trans type',
      'dien giai',
      'description',
      'rut tien',
      'chuyen khoan',
      'so chung tu',
      'ngay hieu luc',
    ];

    for (const row of table.rows || []) {
      for (const cell of row.cells || []) {
        const text = this.removeDiacritics((cell.rawValue || '').toLowerCase());
        for (const hk of headerKeywords) {
          if (text.includes(hk)) {
            headerKeywordCount++;
            break;
          }
        }
        for (const tk of transactionKeywords) {
          if (text.includes(tk)) {
            transactionKeywordCount++;
            break;
          }
        }
        // Check if cell is formatted currency amount (e.g. 125,450,000)
        if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cell.rawValue.trim()) || /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cell.rawValue.trim())) {
          amountCellCount++;
        }
      }
    }

    score += Math.min(headerKeywordCount * 0.5, 2.0);
    score -= Math.min(transactionKeywordCount * 1.0, 3.0);
    if (amountCellCount > 3) {
      score -= 2.0;
    }

    // 4. Repetition evidence: check if another page has a table at nearly identical position
    const duplicatePageTable = allTables.find(
      (other) =>
        other.pageNumber !== table.pageNumber &&
        other.rowCount === table.rowCount &&
        other.columnCount === table.columnCount
    );
    if (duplicatePageTable) {
      score += 0.8;
    }

    return score >= METADATA_CONFIG.TABLE_HEADER_MIN_SCORE;
  }

  /**
   * Checks if observation key or value overlaps with an extracted TRANSACTION table on the same page.
   * Header tables are excluded from this rejection check.
   */
  static isTransactionTableOverlap(
    obs: OCRMetadataObservation,
    tables: OCRExtractedTable[],
    pageHeight: number = 11.69
  ): boolean {
    if (!tables || tables.length === 0) return false;

    const keyBox = this.polygonToBoundingBox(obs.keyBoundingPolygon);
    const valBox = this.polygonToBoundingBox(obs.valueBoundingPolygon);
    if (!keyBox && !valBox) return false;

    const pageTables = tables.filter((t) => t.pageNumber === obs.sourcePage);
    for (const table of pageTables) {
      // If table is classified as a header metadata table, it does NOT act as an exclusion zone
      if (this.isHeaderTable(table, pageHeight, tables)) {
        continue;
      }

      const tableRegions = table.boundingRegions || [];
      for (const region of tableRegions) {
        if (region.pageNumber === obs.sourcePage && Array.isArray(region.polygon)) {
          const tableBox = this.polygonToBoundingBox(region.polygon);
          if (tableBox) {
            if (this.isBoxInside(keyBox, tableBox) || this.isBoxInside(valBox, tableBox)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Transaction Pattern Filter: Rejects keys that are purely dates or numbers without descriptive words.
   */
  static isTransactionPatternKey(normLabel: string): boolean {
    if (!normLabel) return true;
    const isPureDate = /^(\d{1,2}[-/\.]\d{1,2}(\s*[-/\.]\s*\d{2,4})?)$/.test(normLabel);
    if (isPureDate) return true;
    const isPureNumber = /^\d+$/.test(normLabel);
    if (isPureNumber) return true;
    return false;
  }

  /**
   * Malformed / Compound Observation Filter:
   * Generic detection of noisy or mismatched compound observations.
   */
  static isMalformedObservation(obs: OCRMetadataObservation): boolean {
    const rawK = (obs.rawLabel || '').trim();
    const rawV = (obs.rawValue || '').trim();

    if (rawK.length === 0 || rawV.length === 0) return true;

    // Check multi-line compound keys/values with line count >= 3
    const keyLines = rawK.split('\n').map((l) => l.trim()).filter(Boolean);
    const valLines = rawV.split('\n').map((l) => l.trim()).filter(Boolean);

    // If key has >= 3 lines or value has >= 4 lines, highly likely malformed compound OCR pairing
    if (keyLines.length >= 3 || valLines.length >= 4) {
      return true;
    }

    // Check for suspicious mismatch: 2-line key where lines belong to conflicting concepts (e.g. "Number of Check:\nOrgNbr")
    if (keyLines.length === 2 && valLines.length === 2) {
      const typeA = this.resolveSemanticType(keyLines[0]);
      const typeB = this.resolveSemanticType(keyLines[1]);
      if (typeA !== typeB && typeA !== 'OTHER' && typeB !== 'OTHER') {
        return true;
      }
    }

    return false;
  }

  /**
   * Decorative Text / Fragment Filter:
   * Detects low-value isolated fragments such as "NGÂN HÀNG -> PHÁT TRIỂN" or stamp fragments.
   */
  static isDecorativeFragment(
    obs: OCRMetadataObservation,
    occurrenceCount: number = 1
  ): boolean {
    const normK = this.normalizeLabel(obs.rawLabel);
    const normV = this.normalizeLabel(obs.rawValue);
    const semanticType = obs.semanticType || this.resolveSemanticType(obs.rawLabel);

    // Recognized core semantic types are not decorative fragments
    if (semanticType !== 'OTHER') {
      return false;
    }

    // Single-word generic fragments appearing only once
    const isSingleWordKey = !normK.includes(' ') && normK.length < 12;
    const isSingleWordVal = !normV.includes(' ') && normV.length < 12;

    // Examples: "ngan hang" -> "phat trien", "minh phung" -> "<name>"
    if (isSingleWordKey && isSingleWordVal && occurrenceCount === 1) {
      // If confidence is not near-perfect or position is not strong header
      if ((obs.confidence < 0.95 || (obs.normalizedTop && obs.normalizedTop > 0.40))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Structural Quality Score Calculator (0.0 to 1.0)
   */
  static calculateQualityScore(
    obs: OCRMetadataObservation,
    occurrenceCount: number,
    semanticType: SemanticType
  ): number {
    let score = obs.confidence; // Baseline: Azure confidence (typically 0.85 - 0.99)

    // Bonus for repetition across pages
    if (occurrenceCount >= 2) {
      score += 0.15;
    }

    // Bonus for placement in strong upper header zone
    if (obs.normalizedBottom && obs.normalizedBottom <= METADATA_CONFIG.HEADER_STRONG_ZONE_RATIO) {
      score += 0.10;
    } else if (obs.normalizedBottom && obs.normalizedBottom <= METADATA_CONFIG.HEADER_MAX_ZONE_RATIO) {
      score += 0.05;
    } else if (obs.normalizedTop && obs.normalizedTop > 0.40) {
      // Lower document area penalty for non-date/teller metadata
      score -= 0.20;
    }

    // Bonus for recognized semantic concept
    if (semanticType !== 'OTHER') {
      score += 0.10;
    }

    // Clean single-line structure bonus
    if (!obs.rawLabel.includes('\n') && !obs.rawValue.includes('\n')) {
      score += 0.05;
    } else {
      score -= 0.15;
    }

    // Clamp between 0.0 and 1.0
    return Math.max(0.0, Math.min(1.0, Number(score.toFixed(4))));
  }

  /**
   * Source B: Header-Zone Lines Candidate Extraction
   * Scans upper page lines for key-value structures, compound date ranges, currency, and account types.
   */
  static extractHeaderLineCandidates(
    pages: OCRPage[],
    allTables: OCRExtractedTable[] = []
  ): OCRMetadataObservation[] {
    const candidates: OCRMetadataObservation[] = [];

    for (const page of pages) {
      const pageHeight = page.height || 11.69;
      const lines = page.lines || [];

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const poly = line.polygon;
        if (!poly || poly.length < 8) continue;

        const ys = [poly[1], poly[3], poly[5], poly[7]];
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const normTop = minY / pageHeight;
        const normBottom = maxY / pageHeight;

        // Header zone constraint
        if (normBottom > METADATA_CONFIG.HEADER_MAX_ZONE_RATIO) {
          continue;
        }

        const content = line.content.trim();
        if (!content) continue;

        // Sub-case 1: Compound bilingual date range (e.g. "Từ ngày(from): 01/05/2024 đến ngày(to): 31/10/2024")
        const compoundDateMatch = content.match(/T[ừu]\s*ng[àa]y[^:]*:\s*([0-9]{2}[-/.][0-9]{2}[-/.][0-9]{4})\s*(?:đ|d)[ếe]n\s*ng[àa]y[^:]*:\s*([0-9]{2}[-/.][0-9]{2}[-/.][0-9]{4})/i);
        if (compoundDateMatch) {
          candidates.push({
            rawLabel: 'Từ ngày (From)',
            rawValue: compoundDateMatch[1],
            confidence: 0.98,
            sourcePage: page.pageNumber,
            keyBoundingPolygon: poly,
            valueBoundingPolygon: poly,
            sourceType: 'HEADER_LINE',
            normalizedTop: Number(normTop.toFixed(4)),
            normalizedBottom: Number(normBottom.toFixed(4)),
            semanticType: 'STATEMENT_FROM',
          });
          candidates.push({
            rawLabel: 'Đến ngày (To)',
            rawValue: compoundDateMatch[2],
            confidence: 0.98,
            sourcePage: page.pageNumber,
            keyBoundingPolygon: poly,
            valueBoundingPolygon: poly,
            sourceType: 'HEADER_LINE',
            normalizedTop: Number(normTop.toFixed(4)),
            normalizedBottom: Number(normBottom.toFixed(4)),
            semanticType: 'STATEMENT_TO',
          });
          continue;
        }

        // Sub-case 2: Single line with delimiter ":" (e.g. "TÀI KHOẢN (Acct No.): 051704070011450")
        if (content.includes(':')) {
          const colonIdx = content.indexOf(':');
          const lbl = content.substring(0, colonIdx).trim();
          const val = content.substring(colonIdx + 1).trim();

          if (lbl.length > 2 && val.length > 0) {
            const sem = this.resolveSemanticType(lbl, val);
            candidates.push({
              rawLabel: lbl,
              rawValue: val,
              confidence: 0.96,
              sourcePage: page.pageNumber,
              keyBoundingPolygon: poly,
              valueBoundingPolygon: poly,
              sourceType: 'HEADER_LINE',
              normalizedTop: Number(normTop.toFixed(4)),
              normalizedBottom: Number(normBottom.toFixed(4)),
              semanticType: sem,
            });
            continue;
          }
        }

        // Sub-case 3: Standalone known currency or account type in header zone
        if (/^(VND|USD|EUR|GBP|JPY|AUD|CAD|SGD)$/i.test(content)) {
          candidates.push({
            rawLabel: 'Currency',
            rawValue: content.toUpperCase(),
            confidence: 0.95,
            sourcePage: page.pageNumber,
            keyBoundingPolygon: poly,
            valueBoundingPolygon: poly,
            sourceType: 'HEADER_LINE',
            normalizedTop: Number(normTop.toFixed(4)),
            normalizedBottom: Number(normBottom.toFixed(4)),
            semanticType: 'CURRENCY',
          });
          continue;
        }

        // Sub-case 4: Standalone Account Type patterns in header zone (e.g. "TGTT TRONG NUOC CN/365", "TIEN GUI KKH")
        if (/^(TGTT|TIEN GUI|THANH TOAN|TIEN GUI KKH|CURRENT ACCOUNT)/i.test(content)) {
          candidates.push({
            rawLabel: 'Account Type',
            rawValue: content,
            confidence: 0.94,
            sourcePage: page.pageNumber,
            keyBoundingPolygon: poly,
            valueBoundingPolygon: poly,
            sourceType: 'HEADER_LINE',
            normalizedTop: Number(normTop.toFixed(4)),
            normalizedBottom: Number(normBottom.toFixed(4)),
            semanticType: 'ACCOUNT_TYPE',
          });
          continue;
        }
      }
    }

    return candidates;
  }

  /**
   * Source C: Header Tables Candidate Extraction
   * Safely extracts key-value observations from tables classified as Header Tables.
   * Enforces zero-guessing: does not map multiple numeric client codes to fabricated CIF/MST.
   */
  static extractHeaderTableCandidates(
    tables: OCRExtractedTable[],
    pageHeight: number = 11.69
  ): OCRMetadataObservation[] {
    const candidates: OCRMetadataObservation[] = [];

    for (const table of tables) {
      if (!this.isHeaderTable(table, pageHeight, tables)) {
        continue;
      }

      const br = table.boundingRegions?.[0];
      const ys = br?.polygon ? [br.polygon[1], br.polygon[3], br.polygon[5], br.polygon[7]] : [];
      const normTop = ys.length ? Math.min(...ys) / pageHeight : 0.10;
      const normBottom = ys.length ? Math.max(...ys) / pageHeight : 0.20;

      for (const row of table.rows || []) {
        const cells = row.cells || [];
        if (cells.length < 2) continue;

        // Strategy: First cell often contains label, subsequent cells contain values
        const labelCell = cells[0];
        const rawLabel = labelCell.rawValue.trim();
        const sem = this.resolveSemanticType(rawLabel);

        const valueCells = cells.slice(1).filter((c) => c.rawValue.trim().length > 0);
        if (valueCells.length === 0) continue;

        if (sem === 'ACCOUNT_HOLDER') {
          // In real HDBank: "KHÁCH HÀNG: CLIENT" | "02917178" | "242119000" | "NGUYEN THI TUYET LAN"
          // Safe rule: Find string with alphabetic name (ACCOUNT_HOLDER)
          const nameCell = valueCells.find((c) => /^[A-Z\s]{4,}$/.test(c.rawValue.trim()));
          if (nameCell) {
            candidates.push({
              rawLabel: 'Khách hàng / Client',
              rawValue: nameCell.rawValue.trim(),
              confidence: nameCell.confidence,
              sourcePage: table.pageNumber,
              keyBoundingPolygon: labelCell.boundingPolygon,
              valueBoundingPolygon: nameCell.boundingPolygon,
              sourceType: 'HEADER_TABLE',
              normalizedTop: Number(normTop.toFixed(4)),
              normalizedBottom: Number(normBottom.toFixed(4)),
              semanticType: 'ACCOUNT_HOLDER',
            });
          }

          // Preserve numeric identifiers grouped together WITHOUT fabricating CIF/MST
          const numCells = valueCells.filter((c) => /^\d{6,15}$/.test(c.rawValue.trim()));
          if (numCells.length > 0) {
            const groupedVal = numCells.map((c) => c.rawValue.trim()).join(' · ');
            candidates.push({
              rawLabel: 'Client Identifiers',
              rawValue: groupedVal,
              confidence: 0.95,
              sourcePage: table.pageNumber,
              keyBoundingPolygon: labelCell.boundingPolygon,
              valueBoundingPolygon: numCells[0].boundingPolygon,
              sourceType: 'HEADER_TABLE',
              normalizedTop: Number(normTop.toFixed(4)),
              normalizedBottom: Number(normBottom.toFixed(4)),
              semanticType: 'OTHER',
            });
          }
        } else if (sem === 'ACCOUNT_NUMBER') {
          // Look for account number digit sequence (e.g. "051704070011450")
          const accCell = valueCells.find((c) => /^\d{8,20}$/.test(c.rawValue.trim()));
          if (accCell) {
            candidates.push({
              rawLabel: 'Tài khoản / Acct No.',
              rawValue: accCell.rawValue.trim(), // Preserve exact leading zeros
              confidence: accCell.confidence,
              sourcePage: table.pageNumber,
              keyBoundingPolygon: labelCell.boundingPolygon,
              valueBoundingPolygon: accCell.boundingPolygon,
              sourceType: 'HEADER_TABLE',
              normalizedTop: Number(normTop.toFixed(4)),
              normalizedBottom: Number(normBottom.toFixed(4)),
              semanticType: 'ACCOUNT_NUMBER',
            });
          }

          // Check if currency or account type is embedded in remaining cells (e.g. "VND TGTT TRONG NUOC CN/365")
          for (const extraCell of valueCells) {
            if (extraCell === accCell) continue;
            const extraText = extraCell.rawValue.trim();

            const ccyMatch = extraText.match(/\b(VND|USD|EUR|GBP)\b/i);
            if (ccyMatch) {
              candidates.push({
                rawLabel: 'Currency',
                rawValue: ccyMatch[1].toUpperCase(),
                confidence: extraCell.confidence,
                sourcePage: table.pageNumber,
                keyBoundingPolygon: extraCell.boundingPolygon,
                valueBoundingPolygon: extraCell.boundingPolygon,
                sourceType: 'HEADER_TABLE',
                normalizedTop: Number(normTop.toFixed(4)),
                normalizedBottom: Number(normBottom.toFixed(4)),
                semanticType: 'CURRENCY',
              });
            }

            const cleanAccType = extraText.replace(/\b(VND|USD|EUR|GBP)\b/gi, '').trim();
            if (cleanAccType.length > 3) {
              candidates.push({
                rawLabel: 'Account Type',
                rawValue: cleanAccType,
                confidence: extraCell.confidence,
                sourcePage: table.pageNumber,
                keyBoundingPolygon: extraCell.boundingPolygon,
                valueBoundingPolygon: extraCell.boundingPolygon,
                sourceType: 'HEADER_TABLE',
                normalizedTop: Number(normTop.toFixed(4)),
                normalizedBottom: Number(normBottom.toFixed(4)),
                semanticType: 'ACCOUNT_TYPE',
              });
            }
          }
        } else {
          // Generic 2-column or multi-column cell pairing
          const val = valueCells.map((c) => c.rawValue.trim()).join(' ');
          candidates.push({
            rawLabel: rawLabel,
            rawValue: val,
            confidence: labelCell.confidence,
            sourcePage: table.pageNumber,
            keyBoundingPolygon: labelCell.boundingPolygon,
            valueBoundingPolygon: valueCells[0].boundingPolygon,
            sourceType: 'HEADER_TABLE',
            normalizedTop: Number(normTop.toFixed(4)),
            normalizedBottom: Number(normBottom.toFixed(4)),
            semanticType: sem,
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Clean label presentation string (strips trailing punctuation)
   */
  static cleanDisplayLabel(rawLabel: string): string {
    if (!rawLabel) return '';
    return rawLabel.trim().replace(/[:_.-]+$/g, '').trim();
  }

  /**
   * Main Multi-Source Processing Method
   * Fuses Source A (keyValuePairs), Source B (header lines), Source C (header tables),
   * applies structural filters, deduplication, conflict detection, quality scoring, and classification.
   */
  static processObservations(
    rawObservations: OCRMetadataObservation[] = [],
    tables: OCRExtractedTable[] = [],
    pages: OCRPage[] = []
  ): MetadataFilterResult {
    let rawKeyValueCount = rawObservations.length;
    let headerLineCandidateCount = 0;
    let headerTableCandidateCount = 0;
    let filteredTableOverlapCount = 0;
    let filteredTransactionPatternCount = 0;
    let filteredEmptyCount = 0;
    let filteredMalformedCount = 0;
    let nearDuplicateMergeCount = 0;
    let rejectedCount = 0;

    const pageHeight = pages[0]?.height || 11.69;

    // 1. Gather all candidate observations from 3 sources
    const allRawCandidates: OCRMetadataObservation[] = [];

    // Source A: keyValuePairs
    for (const obs of rawObservations) {
      const clone = { ...obs, sourceType: obs.sourceType || ('KEY_VALUE' as MetadataSourceType) };
      if (!clone.normalizedTop && clone.keyBoundingPolygon) {
        const box = this.polygonToBoundingBox(clone.keyBoundingPolygon);
        if (box) {
          clone.normalizedTop = Number((box.minY / pageHeight).toFixed(4));
          clone.normalizedBottom = Number((box.maxY / pageHeight).toFixed(4));
        }
      }
      allRawCandidates.push(clone);
    }

    // Source B: Header-zone Lines
    if (pages.length > 0) {
      const lineCandidates = this.extractHeaderLineCandidates(pages, tables);
      headerLineCandidateCount = lineCandidates.length;
      allRawCandidates.push(...lineCandidates);
    }

    // Source C: Header Tables
    if (tables.length > 0) {
      const tableCandidates = this.extractHeaderTableCandidates(tables, pageHeight);
      headerTableCandidateCount = tableCandidates.length;
      allRawCandidates.push(...tableCandidates);
    }

    // 2. Structural Quality Filters
    const validCandidates: OCRMetadataObservation[] = [];

    for (const obs of allRawCandidates) {
      // Empty / Invalid filter
      const rawK = (obs.rawLabel || '').trim();
      const rawV = (obs.rawValue || '').trim();
      if (!rawK || !rawV) {
        filteredEmptyCount++;
        rejectedCount++;
        continue;
      }

      const normLabel = this.normalizeLabel(rawK);
      const normVal = this.normalizeValueForMatch(rawV);
      if (!normLabel || !normVal) {
        filteredEmptyCount++;
        rejectedCount++;
        continue;
      }

      obs.normalizedLabel = normLabel;
      obs.normalizedValueForMatch = normVal;
      obs.semanticType = obs.semanticType || this.resolveSemanticType(rawK, rawV);

      // Malformed / compound check
      if (this.isMalformedObservation(obs)) {
        filteredMalformedCount++;
        rejectedCount++;
        continue;
      }

      // Transaction pattern key check
      if (this.isTransactionPatternKey(normLabel)) {
        filteredTransactionPatternCount++;
        rejectedCount++;
        continue;
      }

      // Transaction table overlap check (header tables are NOT treated as overlap)
      if (this.isTransactionTableOverlap(obs, tables, pageHeight)) {
        filteredTableOverlapCount++;
        rejectedCount++;
        continue;
      }

      validCandidates.push(obs);
    }

    const candidateCount = validCandidates.length;

    // 3. Cluster Candidates for Deduplication & Conflict Resolution
    // Grouping criteria:
    // If semanticType is recognized (not OTHER): group by semanticType!
    // If semanticType is OTHER: group by normalizedLabel!
    const clusters: Array<{
      clusterKey: string;
      semanticType: SemanticType;
      items: OCRMetadataObservation[];
    }> = [];

    for (const obs of validCandidates) {
      let matchedCluster: (typeof clusters)[0] | undefined;

      if (obs.semanticType && obs.semanticType !== 'OTHER') {
        matchedCluster = clusters.find((c) => c.semanticType === obs.semanticType);
      } else {
        // Match by high label similarity (>= 0.75) for OTHER
        matchedCluster = clusters.find(
          (c) =>
            c.semanticType === 'OTHER' &&
            this.calculateLabelSimilarity(c.items[0].rawLabel, obs.rawLabel) >=
              METADATA_CONFIG.NEAR_DUP_LABEL_SIMILARITY
        );
      }

      if (matchedCluster) {
        matchedCluster.items.push(obs);
      } else {
        clusters.push({
          clusterKey: obs.semanticType !== 'OTHER' ? obs.semanticType : obs.normalizedLabel!,
          semanticType: obs.semanticType || 'OTHER',
          items: [obs],
        });
      }
    }

    const canonicalMetadata: OCRMetadataItem[] = [];
    let conflictCount = 0;
    let coreCount = 0;
    let additionalCount = 0;

    // 4. Resolve each cluster
    for (const cluster of clusters) {
      const obsGroup = cluster.items;

      // Sub-group by normalizedValueForMatch
      const valGroups = new Map<string, OCRMetadataObservation[]>();
      for (const obs of obsGroup) {
        const vk = obs.normalizedValueForMatch!;
        const arr = valGroups.get(vk) || [];
        arr.push(obs);
        valGroups.set(vk, arr);
      }

      const distinctValCount = valGroups.size;

      if (distinctValCount === 1) {
        // --- ALL OBSERVATIONS AGREE ON VALUE -> AUTO CANONICAL ITEM ---
        if (obsGroup.length > 1) {
          nearDuplicateMergeCount += obsGroup.length - 1;
        }

        // Sort by confidence descending, then earliest source page
        obsGroup.sort((a, b) => b.confidence - a.confidence || a.sourcePage - b.sourcePage);
        const best = obsGroup[0];

        // Check for decorative fragment filter (e.g. "NGÂN HÀNG -> PHÁT TRIỂN")
        if (this.isDecorativeFragment(best, obsGroup.length)) {
          rejectedCount += obsGroup.length;
          continue;
        }

        const qualityScore = this.calculateQualityScore(best, obsGroup.length, cluster.semanticType);

        // Visibility Classification
        let visibilityClass: VisibilityClass = 'ADDITIONAL';
        if (cluster.semanticType !== 'OTHER' && qualityScore >= METADATA_CONFIG.CORE_MIN_QUALITY) {
          visibilityClass = 'CORE';
          coreCount++;
        } else if (qualityScore >= METADATA_CONFIG.ADDITIONAL_MIN_QUALITY) {
          visibilityClass = 'ADDITIONAL';
          additionalCount++;
        } else {
          visibilityClass = 'REJECTED';
          rejectedCount += obsGroup.length;
          continue; // Do not emit rejected items to canonicalMetadata
        }

        canonicalMetadata.push({
          label: this.cleanDisplayLabel(best.rawLabel),
          value: best.rawValue.trim(), // Preserve exact raw string (leading zeros, etc.)
          rawLabel: best.rawLabel,
          rawValue: best.rawValue,
          confidence: best.confidence,
          sourcePage: best.sourcePage,
          keyBoundingPolygon: best.keyBoundingPolygon,
          valueBoundingPolygon: best.valueBoundingPolygon,
          occurrenceCount: obsGroup.length,
          status: 'AUTO',
          semanticType: cluster.semanticType,
          qualityScore,
          visibilityClass,
        });
      } else {
        // --- DIFFERENT VALUES FOR SAME SEMANTIC CONCEPT -> CONFLICT ITEM ---
        conflictCount++;
        obsGroup.sort((a, b) => b.confidence - a.confidence || a.sourcePage - b.sourcePage);
        const primary = obsGroup[0];

        const alternatives: Array<{
          rawLabel: string;
          rawValue: string;
          confidence: number;
          sourcePage: number;
        }> = [];
        const seenVals = new Set<string>();
        seenVals.add(primary.normalizedValueForMatch!);

        for (const obs of obsGroup) {
          if (!seenVals.has(obs.normalizedValueForMatch!)) {
            seenVals.add(obs.normalizedValueForMatch!);
            alternatives.push({
              rawLabel: obs.rawLabel,
              rawValue: obs.rawValue.trim(),
              confidence: obs.confidence,
              sourcePage: obs.sourcePage,
            });
          }
        }

        const qualityScore = this.calculateQualityScore(primary, obsGroup.length, cluster.semanticType);
        let visibilityClass: VisibilityClass = 'ADDITIONAL';
        if (cluster.semanticType !== 'OTHER' && qualityScore >= METADATA_CONFIG.CORE_MIN_QUALITY) {
          visibilityClass = 'CORE';
          coreCount++;
        } else if (qualityScore >= METADATA_CONFIG.ADDITIONAL_MIN_QUALITY) {
          visibilityClass = 'ADDITIONAL';
          additionalCount++;
        } else {
          visibilityClass = 'REJECTED';
          rejectedCount += obsGroup.length;
          continue;
        }

        canonicalMetadata.push({
          label: this.cleanDisplayLabel(primary.rawLabel),
          value: primary.rawValue.trim(),
          rawLabel: primary.rawLabel,
          rawValue: primary.rawValue,
          confidence: primary.confidence,
          sourcePage: primary.sourcePage,
          keyBoundingPolygon: primary.keyBoundingPolygon,
          valueBoundingPolygon: primary.valueBoundingPolygon,
          occurrenceCount: obsGroup.length,
          status: 'CONFLICT',
          semanticType: cluster.semanticType,
          qualityScore,
          visibilityClass,
          alternatives: alternatives.length > 0 ? alternatives : undefined,
        });
      }
    }

    // 5. Stable Core Sorting
    // CORE items first sorted by SEMANTIC_TYPE_ORDER, followed by ADDITIONAL sorted by sourcePage
    canonicalMetadata.sort((a, b) => {
      if (a.visibilityClass === 'CORE' && b.visibilityClass !== 'CORE') return -1;
      if (a.visibilityClass !== 'CORE' && b.visibilityClass === 'CORE') return 1;

      if (a.visibilityClass === 'CORE' && b.visibilityClass === 'CORE') {
        const orderA = a.semanticType ? SEMANTIC_TYPE_ORDER[a.semanticType] || 99 : 99;
        const orderB = b.semanticType ? SEMANTIC_TYPE_ORDER[b.semanticType] || 99 : 99;
        if (orderA !== orderB) return orderA - orderB;
      }

      return a.sourcePage - b.sourcePage;
    });

    const metrics: MetadataFilterMetrics = {
      rawKeyValueCount,
      headerLineCandidateCount,
      headerTableCandidateCount,
      filteredTableOverlapCount,
      filteredTransactionPatternCount,
      filteredEmptyCount,
      filteredMalformedCount,
      candidateCount,
      nearDuplicateMergeCount,
      canonicalCount: canonicalMetadata.length,
      coreCount,
      additionalCount,
      conflictCount,
      rejectedCount,
    };

    return {
      canonicalMetadata,
      metrics,
    };
  }
}
