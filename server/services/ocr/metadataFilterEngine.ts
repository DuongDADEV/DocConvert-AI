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
  STATEMENT_PERIOD: 3,
  STATEMENT_FROM: 4,
  STATEMENT_TO: 5,
  CURRENCY: 6,
  CUSTOMER_ID: 7,
  BRANCH: 8,
  ACCOUNT_TYPE: 9,
  TAX_CODE: 10,
  ADDRESS: 11,
  OPENING_DATE: 12,
  OPENING_BALANCE: 13,
  CLOSING_BALANCE: 14,
  STATEMENT_DATE: 15,
  STATEMENT_TIMESTAMP: 16,
  OTHER: 99,
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
   * Semantic Date Normalization:
   * Parses DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD, YYYY/MM/DD
   * Returns canonical "YYYY-MM-DD" if confident, or null.
   */
  static normalizeDate(val: string): string | null {
    if (!val) return null;
    const clean = val.trim();
    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const dmy = clean.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
    if (dmy) {
      const d = dmy[1].padStart(2, '0');
      const m = dmy[2].padStart(2, '0');
      const y = dmy[3];
      return `${y}-${m}-${d}`;
    }
    // YYYY-MM-DD or YYYY/MM/DD
    const ymd = clean.match(/^(\d{4})[\/\-. ](\d{1,2})[\/\-. ](\d{1,2})$/);
    if (ymd) {
      const y = ymd[1];
      const m = ymd[2].padStart(2, '0');
      const d = ymd[3].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  /**
   * Semantic Amount Normalization:
   * Parses European/Vietnamese (497.503,00 or 0,00) and US (497,503.00 or 0.00).
   * Returns canonical decimal string or null.
   */
  static normalizeAmount(val: string): string | null {
    if (!val) return null;
    let clean = val.trim().replace(/[^\d.,-]/g, '');
    if (!clean) return null;
    // Check European/Vietnamese format: 1.234.567,89 or 0,00
    if (/\d+\.\d{3},\d{2}$/.test(clean) || /^\d+,\d{2}$/.test(clean)) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (/\d+,\d{3}\.\d{2}$/.test(clean) || /^\d+\.\d{2}$/.test(clean)) {
      // US format: 1,234,567.89
      clean = clean.replace(/,/g, '');
    } else if (/^\d+$/.test(clean)) {
      clean = `${clean}.00`;
    }
    const num = parseFloat(clean);
    if (isNaN(num)) return null;
    return num.toFixed(2);
  }

  /**
   * Conservative Text Normalization for Comparison:
   * Normalizes whitespace, linebreaks, punctuation spacing, case.
   */
  static normalizeTextForComparison(val: string): string {
    if (!val) return '';
    let norm = val.trim().toLowerCase();
    norm = norm.replace(/,([^\s])/g, ', $1');
    norm = norm.replace(/;([^\s])/g, '; $1');
    norm = norm.replace(/:([^\s])/g, ': $1');
    norm = norm.replace(/\s+/g, ' ');
    norm = norm.replace(/[.,;:]+$/, '');
    return norm.trim();
  }

  /**
   * Strict Alphanumeric Normalization for Containment/Subsequence Checks:
   */
  static normalizeAlphaNumeric(val: string): string {
    if (!val) return '';
    return this.removeDiacritics(val)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Orientation Normalization Helper:
   * Maps any raw Azure angle (e.g. -90.22, 0.3, 89.8, 179.9, 269.8)
   * to nearest canonical quadrant: 0, 90, 180, or 270 degrees.
   */
  static normalizeAngle(angle?: number): number {
    if (typeof angle !== 'number' || isNaN(angle)) return 0;
    const normalized = ((angle % 360) + 360) % 360;
    return (Math.round(normalized / 90) % 4) * 90;
  }

  /**
   * Generic Visual Coordinate Normalization:
   * Converts raw Azure polygon coordinates into normalized visual page coordinates
   * where visualTop=0, visualBottom=1, visualLeft=0, visualRight=1
   * regardless of whether page orientation is 0°, 90°, 180°, or 270°.
   */
  static normalizePolygonToVisualBounds(
    polygon?: number[],
    pageWidth: number = 8.5,
    pageHeight: number = 11.0,
    pageAngle: number = 0
  ): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    centerX: number;
    centerY: number;
  } | null {
    if (!polygon || polygon.length < 8) return null;
    const normAngle = this.normalizeAngle(pageAngle);

    const vxs: number[] = [];
    const vys: number[] = [];

    const numPoints = Math.floor(polygon.length / 2);
    for (let i = 0; i < numPoints; i++) {
      const x = polygon[i * 2];
      const y = polygon[i * 2 + 1];

      let vx: number;
      let vy: number;

      if (normAngle === 0) {
        vx = x / pageWidth;
        vy = y / pageHeight;
      } else if (normAngle === 90) {
        vx = y / pageHeight;
        vy = (pageWidth - x) / pageWidth;
      } else if (normAngle === 180) {
        vx = (pageWidth - x) / pageWidth;
        vy = (pageHeight - y) / pageHeight;
      } else {
        // 270 degrees (or -90 degrees)
        vx = (pageHeight - y) / pageHeight;
        vy = x / pageWidth;
      }

      vxs.push(Math.max(0, Math.min(1, vx)));
      vys.push(Math.max(0, Math.min(1, vy)));
    }

    const minX = Math.min(...vxs);
    const maxX = Math.max(...vxs);
    const minY = Math.min(...vys);
    const maxY = Math.max(...vys);

    const left = Number(minX.toFixed(4));
    const top = Number(minY.toFixed(4));
    const right = Number(maxX.toFixed(4));
    const bottom = Number(maxY.toFixed(4));
    const centerX = Number(((left + right) / 2).toFixed(4));
    const centerY = Number(((top + bottom) / 2).toFixed(4));

    return { left, top, right, bottom, centerX, centerY };
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
      // Guard: do not misclassify "loai tai khoan", "chu tai khoan", "ten tai khoan", "account name", "ngay mo tai khoan", etc. as account number
      if (
        !clean.includes('loai') &&
        !clean.includes('type') &&
        !clean.includes('chu') &&
        !clean.includes('ten') &&
        !clean.includes('name') &&
        !clean.includes('holder') &&
        !clean.includes('ngay') &&
        !clean.includes('date')
      ) {
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

    // 8c. Statement Timestamps (ADDITIONAL)
    if (
      clean.includes('statement timestamp') ||
      clean.includes('thoi gian in') ||
      clean.includes('thoi diem in') ||
      clean.includes('thoi gian lap')
    ) {
      return 'STATEMENT_TIMESTAMP';
    }

    // 9. STATEMENT_PERIOD
    if (
      clean.includes('ky sao ke') ||
      clean.includes('statement period') ||
      clean.includes('ky bao cao') ||
      clean.includes('billing period')
    ) {
      return 'STATEMENT_PERIOD';
    }

    // 10. STATEMENT_DATE
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

    // 11. OPENING_DATE
    if (
      clean.includes('ngay mo') ||
      clean.includes('open date') ||
      clean.includes('opening date') ||
      clean.includes('date opened') ||
      clean.includes('date of open')
    ) {
      return 'OPENING_DATE';
    }

    // 12. OPENING_BALANCE
    if (
      clean.includes('so du dau ky') ||
      clean.includes('so du ban dau') ||
      clean.includes('opening balance') ||
      clean.includes('opening bal') ||
      clean.includes('so du dau') ||
      clean.includes('dau ky')
    ) {
      return 'OPENING_BALANCE';
    }

    // 13. CLOSING_BALANCE
    if (
      clean.includes('so du cuoi ky') ||
      clean.includes('closing balance') ||
      clean.includes('closing bal') ||
      clean.includes('so du cuoi') ||
      clean.includes('cuoi ky')
    ) {
      return 'CLOSING_BALANCE';
    }

    // 14. BRANCH
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

    // 15. ADDRESS
    if (clean.includes('dia chi') || clean.includes('address')) {
      return 'ADDRESS';
    }

    return 'OTHER';
  }

  /**
   * Multi-Signal Header Table Classifier
   * headerTableScore = positionEvidence + semanticEvidence + repetitionEvidence + structuralEvidence - transactionEvidence
   * Orientation-aware visual position and semantic keyword density over arbitrary row count.
   */
  static isHeaderTable(
    table: OCRExtractedTable,
    pageHeight: number = 11.69,
    allTables: OCRExtractedTable[] = [],
    page?: OCRPage
  ): boolean {
    const br = table.boundingRegions?.[0] || (table as any).bounding_regions?.[0];
    if (!br || !Array.isArray(br.polygon) || br.polygon.length < 8) return false;

    const pw = page?.width || 8.5;
    const ph = page?.height || pageHeight;
    const pAngle = page?.angle || 0;

    const visualBounds = this.normalizePolygonToVisualBounds(br.polygon, pw, ph, pAngle);
    const visualTop = visualBounds ? visualBounds.top : 0.5;

    let score = 0;

    // 1. Position evidence (Orientation-aware visual coordinate)
    if (visualTop <= 0.20) {
      score += 2.0;
    } else if (visualTop <= 0.35) {
      score += 1.2;
    } else if (visualTop <= 0.50) {
      score += 0.5;
    } else {
      score -= 2.5; // Below header zone
    }

    // 2. Semantic and transaction evidence inside table cells
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
      'cif',
      'dia chi',
      'address',
      'so du ban dau',
      'so du cuoi ky',
      'opening balance',
      'closing balance',
      'ngay mo',
      'open date',
      'loai tien',
      'so tk',
      'chu tk',
      'chu tai khoan',
      'ten tai khoan',
      'account name',
      'account no',
    ];

    const transactionKeywords = [
      'ps no',
      'ps co',
      'debit',
      'credit',
      'rut tien',
      'chuyen khoan',
      'so chung tu',
      'dien giai',
      'trans type',
      'so du sau moi gd',
      'ngay hieu luc',
      'effective date',
      'transaction date',
      'so gd',
      'ma gd',
      'so du',
      'balance',
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
            // Opening and closing balances are header fields, not transaction rows
            if (
              (tk === 'so du' || tk === 'balance') &&
              (text.includes('dau') ||
                text.includes('cuoi') ||
                text.includes('opening') ||
                text.includes('closing') ||
                text.includes('ban dau'))
            ) {
              continue;
            }
            transactionKeywordCount++;
            break;
          }
        }
        // Check if cell is formatted currency amount (e.g. 125,450,000)
        if (
          /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cell.rawValue.trim()) ||
          /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cell.rawValue.trim())
        ) {
          amountCellCount++;
        }
      }
    }

    // Content Semantic Density:
    // If table has high header keyword count and low transaction keyword count,
    // it is overwhelmingly a statement header table regardless of row count!
    const isRichHeaderContent =
      headerKeywordCount >= 3 &&
      (transactionKeywordCount <= 2 || headerKeywordCount >= transactionKeywordCount * 2);

    if (isRichHeaderContent) {
      score += 3.5;
    } else {
      score += Math.min(headerKeywordCount * 0.5, 2.0);
      score -= Math.min(transactionKeywordCount * 1.0, 3.0);
      if (amountCellCount > 5) {
        score -= 2.0;
      }
    }

    // 3. Structural evidence
    if (table.rowCount <= 3) {
      score += 1.2;
    } else if (table.rowCount <= 5) {
      score += 0.5;
    } else if (!isRichHeaderContent) {
      score -= 2.0; // Large row count without header keywords strongly implies transaction table
    }

    if (table.columnCount <= 4) {
      score += 0.8;
    } else if (table.columnCount >= 7) {
      score -= 2.0; // Many columns strongly implies transaction ledger
    }

    // 4. Repetition evidence: check if another page has a table at nearly identical position
    const duplicatePageTable = allTables.find(
      (other) =>
        other.pageNumber !== table.pageNumber &&
        other.rowCount === table.rowCount &&
        other.columnCount === table.columnCount
    );
    if (duplicatePageTable && isRichHeaderContent) {
      score += 0.5;
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
    pageHeight: number = 11.69,
    pages: OCRPage[] = []
  ): boolean {
    if (!tables || tables.length === 0) return false;

    const keyBox = this.polygonToBoundingBox(obs.keyBoundingPolygon);
    const valBox = this.polygonToBoundingBox(obs.valueBoundingPolygon);
    if (!keyBox && !valBox) return false;

    const pageTables = tables.filter((t) => t.pageNumber === obs.sourcePage);
    const pageObj = pages.find((p) => p.pageNumber === obs.sourcePage);

    for (const table of pageTables) {
      // If table is classified as a header metadata table, it does NOT act as an exclusion zone
      if (this.isHeaderTable(table, pageHeight, tables, pageObj)) {
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
   * Low-Value Metadata Suppression Guard:
   * Suppresses generic page counters, sign-off roles, and footer control artifacts.
   * Strictly preserves business metadata (negative controls: Account Number, Reference Number, Customer Number, Branch, etc.).
   */
  static isSuppressedLowValueMetadata(
    rawLabel: string,
    rawValue: string,
    semanticType?: SemanticType
  ): boolean {
    // 1. Negative controls: never suppress recognized core/business metadata
    if (
      semanticType &&
      semanticType !== 'OTHER' &&
      semanticType !== 'STATEMENT_TIMESTAMP'
    ) {
      return false;
    }

    const cleanL = this.removeDiacritics(this.normalizeLabel(rawLabel));
    const cleanV = this.removeDiacritics(this.normalizeValueForMatch(rawValue));

    // Negative controls check on raw label strings
    if (
      cleanL.includes('account number') ||
      cleanL.includes('so tai khoan') ||
      cleanL.includes('reference number') ||
      cleanL.includes('so tham chieu') ||
      cleanL.includes('customer number') ||
      cleanL.includes('ma khach hang') ||
      cleanL.includes('cif') ||
      cleanL.includes('branch') ||
      cleanL.includes('chi nhanh') ||
      cleanL.includes('account holder') ||
      cleanL.includes('chu tai khoan')
    ) {
      return false;
    }

    // 2. PAGE_COUNTER patterns (e.g. "Page", "Trang số", "Page 1 of 4", "1 of 4")
    if (
      /^(trang(\s*so)?|page(\s*(no|number))?)$/.test(cleanL) ||
      /^(trang\s+\d+(\s*[/]\s*\d+)?|page\s+\d+(\s*(of|[/])\s*\d+)?)$/.test(cleanL)
    ) {
      return true;
    }
    if (/^\d+\s*(of|[/])\s*\d+$/.test(cleanV)) {
      return true;
    }

    // 3. SIGNOFF_ROLE / Workflow roles (e.g. "Prepared by", "Supervisor", "Người lập", "Kiểm soát", "GDV")
    if (
      /^(nguoi lap|nguoi lap bieu|lap bang|prepared by|maker)\b/.test(cleanL) ||
      /^(kiem soat|supervisor|checker|approver|nguoi phe duyet)\b/.test(cleanL) ||
      /^(gdv|giao dich vien|teller|nv giao dich|nhan vien giao dich)\b/.test(cleanL) ||
      /^(thu quy|cashier)\b/.test(cleanL)
    ) {
      return true;
    }

    // 4. Footers / Control artifacts
    if (
      /^(chu ky|signature|ky va dong dau|ky ten)\b/.test(cleanL) ||
      /^(ma bao mat|security code|barcode|ma vach)\b/.test(cleanL)
    ) {
      return true;
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

    // Parenthesized sub-header text mistaken as value: e.g. "(Opening Date)", "(Maturity Date)", "(Address)"
    if (/^\s*\([a-zA-Z\s]{3,}\)\s*$/.test(rawV)) {
      return true;
    }

    // Date semantic type must contain at least one digit
    const sem = obs.semanticType || this.resolveSemanticType(rawK, rawV);
    if (
      (sem === 'OPENING_DATE' || sem === 'STATEMENT_DATE' || sem === 'STATEMENT_FROM' || sem === 'STATEMENT_TO') &&
      !/\d/.test(rawV)
    ) {
      return true;
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
  /**
   * Source B: Header-Zone Lines Candidate Extraction
   * Scans upper page lines for key-value structures, compound date ranges, currency, and account types.
   * Uses orientation-aware visual coordinate normalization.
   * Protects timestamps from improper colon splitting.
   */
  static extractHeaderLineCandidates(
    pages: OCRPage[],
    allTables: OCRExtractedTable[] = []
  ): OCRMetadataObservation[] {
    const candidates: OCRMetadataObservation[] = [];

    for (const page of pages) {
      const pageHeight = page.height || 11.69;
      const pageWidth = page.width || 8.5;
      const pageAngle = page.angle || 0;
      const lines = page.lines || [];

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const poly = line.polygon;
        if (!poly || poly.length < 8) continue;

        const visualBounds = this.normalizePolygonToVisualBounds(poly, pageWidth, pageHeight, pageAngle);
        const normTop = visualBounds ? visualBounds.top : 0.5;
        const normBottom = visualBounds ? visualBounds.bottom : 0.5;

        // Header zone constraint (orientation-aware)
        if (normBottom > 0.40 && normTop > 0.30) {
          continue;
        }

        const content = line.content.trim();
        if (!content) continue;

        // Sub-case 0: Standalone timestamp in header zone (e.g. "01/11/2024 10:17:06" or "10:17:06")
        if (/^(\d{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4}\s+)?\d{1,2}:\d{2}(:\d{2})?$/.test(content)) {
          candidates.push({
            rawLabel: 'Statement Timestamp',
            rawValue: content,
            confidence: 0.95,
            sourcePage: page.pageNumber,
            keyBoundingPolygon: poly,
            valueBoundingPolygon: poly,
            sourceType: 'HEADER_LINE',
            normalizedTop: Number(normTop.toFixed(4)),
            normalizedBottom: Number(normBottom.toFixed(4)),
            semanticType: 'STATEMENT_TIMESTAMP',
          });
          continue;
        }

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

          // Guard against splitting timestamps like "01/11/2024 10:17:06" at ":"
          const hasLetters = /[a-zA-Z\p{L}]/u.test(lbl);
          const isDateFragment = /^\d{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4}\s+\d+$/.test(lbl);

          if (hasLetters && !isDateFragment && lbl.length > 2 && val.length > 0) {
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
   * Supports 2-column, 4-column multi-pair grid header tables, and grouped client identifier tables.
   */
  static extractHeaderTableCandidates(
    tables: OCRExtractedTable[],
    pageHeight: number = 11.69,
    pages: OCRPage[] = []
  ): OCRMetadataObservation[] {
    const candidates: OCRMetadataObservation[] = [];

    for (const table of tables) {
      const tablePage = pages.find((p) => p.pageNumber === table.pageNumber);
      if (!this.isHeaderTable(table, pageHeight, tables, tablePage)) {
        continue;
      }

      const br = table.boundingRegions?.[0];
      const pw = tablePage?.width || 8.5;
      const ph = tablePage?.height || pageHeight;
      const pAngle = tablePage?.angle || 0;
      const visualBounds = this.normalizePolygonToVisualBounds(br?.polygon, pw, ph, pAngle);
      const normTop = visualBounds ? visualBounds.top : 0.10;
      const normBottom = visualBounds ? visualBounds.bottom : 0.20;

      for (const row of table.rows || []) {
        const cells = row.cells || [];
        if (cells.length < 2) continue;

        // Skip bilingual sub-header rows where all non-empty cells are parenthesized labels (e.g. "(Opening Date)", "(Maturity Date)")
        const nonEmptyCells = cells.filter((c) => c.rawValue && c.rawValue.trim().length > 0);
        if (nonEmptyCells.length === 0) continue;
        const allParenthesizedLabels = nonEmptyCells.every((c) => /^\s*\([^\)]+\)\s*$/.test(c.rawValue.trim()));
        if (allParenthesizedLabels) {
          continue;
        }

        // Check for 4-column grid header pair (e.g. Bản Việt Table 0: [Label1, Val1, Label2, Val2])
        if (cells.length === 4) {
          const col0Text = cells[0].rawValue.trim();
          const col1Text = cells[1].rawValue.trim();
          const col2Text = cells[2].rawValue.trim();
          const col3Text = cells[3].rawValue.trim();

          const isCol2Label =
            col2Text.includes(':') ||
            (this.resolveSemanticType(col2Text) !== 'OTHER' && !/^\s*\(/.test(col2Text));

          if (isCol2Label) {
            const pairs = [
              { labelCell: cells[0], valCell: cells[1] },
              { labelCell: cells[2], valCell: cells[3] },
            ];
            for (const pair of pairs) {
              const rawLabel = pair.labelCell.rawValue.trim();
              const rawVal = pair.valCell.rawValue.trim();
              if (!rawLabel || !rawVal) continue;
              const sem = this.resolveSemanticType(rawLabel, rawVal);
              candidates.push({
                rawLabel,
                rawValue: rawVal,
                confidence: pair.valCell.confidence || pair.labelCell.confidence || 0.95,
                sourcePage: table.pageNumber,
                keyBoundingPolygon: pair.labelCell.boundingPolygon,
                valueBoundingPolygon: pair.valCell.boundingPolygon,
                sourceType: 'HEADER_TABLE',
                normalizedTop: Number(normTop.toFixed(4)),
                normalizedBottom: Number(normBottom.toFixed(4)),
                semanticType: sem,
              });
            }
            continue;
          } else {
            // col0 is a label, and columns 1, 2, 3 represent a multi-column value (e.g. full address or notes)
            const rawLabel = col0Text;
            const combinedVal = [col1Text, col2Text, col3Text].filter(Boolean).join(' ').trim();
            if (rawLabel && combinedVal) {
              const sem = this.resolveSemanticType(rawLabel, combinedVal);
              candidates.push({
                rawLabel,
                rawValue: combinedVal,
                confidence: cells[1].confidence || cells[0].confidence || 0.95,
                sourcePage: table.pageNumber,
                keyBoundingPolygon: cells[0].boundingPolygon,
                valueBoundingPolygon: cells[cells.length - 1].boundingPolygon || cells[1].boundingPolygon,
                sourceType: 'HEADER_TABLE',
                normalizedTop: Number(normTop.toFixed(4)),
                normalizedBottom: Number(normBottom.toFixed(4)),
                semanticType: sem,
              });
              continue;
            }
          }
        }

        // Standard 2-column or multi-value cell processing (HDBank etc.)
        const labelCell = cells[0];
        const rawLabel = labelCell.rawValue.trim();
        const sem = this.resolveSemanticType(rawLabel);

        const valueCells = cells.slice(1).filter((c) => c.rawValue.trim().length > 0);
        if (valueCells.length === 0) continue;

        if (sem === 'ACCOUNT_HOLDER') {
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

          // Check if currency or account type is embedded in remaining cells
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
   * First Meaningful Statement Page Discovery:
   * Evaluates pages in ascending order to find the first page with strong statement-header evidence.
   * Isolates metadata candidate collection to this single primary page,
   * completely suppressing cross-page footer/page/signature noise.
   */
  static discoverPrimaryMetadataPage(
    pages: OCRPage[],
    tables: OCRExtractedTable[] = [],
    rawObservations: OCRMetadataObservation[] = []
  ): number {
    if (!pages || pages.length <= 1) return 1;

    const pageScores: Array<{ pageNumber: number; score: number }> = [];

    for (const page of pages) {
      const pNum = page.pageNumber;
      let score = 0;

      // 1. Evidence from rawObservations on this page
      const pageObs = rawObservations.filter((o) => o.sourcePage === pNum);
      for (const obs of pageObs) {
        const sem = obs.semanticType || this.resolveSemanticType(obs.rawLabel, obs.rawValue);
        if (sem === 'ACCOUNT_NUMBER' || sem === 'ACCOUNT_HOLDER') {
          score += 3.0;
        } else if (sem === 'CUSTOMER_ID' || sem === 'TAX_CODE') {
          score += 2.0;
        } else if (sem === 'STATEMENT_FROM' || sem === 'STATEMENT_TO' || sem === 'STATEMENT_PERIOD') {
          score += 2.0;
        } else if (sem === 'CURRENCY' || sem === 'ACCOUNT_TYPE') {
          score += 1.5;
        } else if (sem === 'BRANCH' || sem === 'ADDRESS' || sem === 'OPENING_DATE') {
          score += 1.0;
        } else if (sem !== 'OTHER') {
          score += 0.8;
        } else {
          if (this.isSuppressedLowValueMetadata(obs.rawLabel, obs.rawValue, sem)) {
            score -= 1.0;
          } else {
            score += 0.2;
          }
        }
      }

      // 2. Evidence from tables on this page
      const pageTables = tables.filter((t) => t.pageNumber === pNum);
      for (const table of pageTables) {
        if (this.isHeaderTable(table, page.height || 11.69, tables, page)) {
          score += 4.0;
        }
      }

      // 3. Evidence from lines on this page
      const lines = page.lines || [];
      for (const line of lines) {
        const text = line.content || '';
        if (/T[ừu]\s*ng[àa]y/i.test(text) && /(?:đ|d)[ếe]n\s*ng[àa]y/i.test(text)) {
          score += 2.5;
        }
        const cleanT = this.removeDiacritics(text).toLowerCase();
        if (cleanT.includes('so tai khoan') || cleanT.includes('account no') || cleanT.includes('chu tai khoan')) {
          score += 1.5;
        }
      }

      pageScores.push({ pageNumber: pNum, score });

      if (score >= 4.0) {
        return pNum;
      }
    }

    // Fallback: earliest page with the highest score, or page 1
    pageScores.sort((a, b) => b.score - a.score);
    return pageScores[0]?.score > 0 ? pageScores[0].pageNumber : 1;
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
   * isolates to primary header page, applies structural filters, deduplication, conflict detection,
   * quality scoring, and classification.
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

    // 0. Primary Metadata Page Discovery & Page Isolation
    let isolatedObservations = rawObservations;
    let isolatedPages = pages;
    let isolatedTables = tables;

    if (pages.length > 1) {
      const primaryPage = this.discoverPrimaryMetadataPage(pages, tables, rawObservations);
      isolatedObservations = rawObservations.filter((o) => o.sourcePage === primaryPage);
      isolatedPages = pages.filter((p) => p.pageNumber === primaryPage);
      isolatedTables = tables.filter((t) => t.pageNumber === primaryPage);
    }

    // 1. Gather all candidate observations from 3 sources on primary page
    const allRawCandidates: OCRMetadataObservation[] = [];

    // Source A: keyValuePairs
    for (const obs of isolatedObservations) {
      const clone = { ...obs, sourceType: obs.sourceType || ('KEY_VALUE' as MetadataSourceType) };
      if (!clone.normalizedTop && clone.keyBoundingPolygon) {
        const obsPage = pages.find((p) => p.pageNumber === clone.sourcePage);
        const visualBounds = this.normalizePolygonToVisualBounds(
          clone.keyBoundingPolygon,
          obsPage?.width || 8.5,
          obsPage?.height || pageHeight,
          obsPage?.angle || 0
        );
        if (visualBounds) {
          clone.normalizedTop = visualBounds.top;
          clone.normalizedBottom = visualBounds.bottom;
        }
      }
      allRawCandidates.push(clone);
    }

    // Source B: Header-zone Lines
    if (isolatedPages.length > 0) {
      const lineCandidates = this.extractHeaderLineCandidates(isolatedPages, tables);
      headerLineCandidateCount = lineCandidates.length;
      allRawCandidates.push(...lineCandidates);
    }

    // Source C: Header Tables
    if (isolatedTables.length > 0) {
      const tableCandidates = this.extractHeaderTableCandidates(isolatedTables, pageHeight, pages);
      headerTableCandidateCount = tableCandidates.length;
      allRawCandidates.push(...tableCandidates);
    }

    // 2. Structural Quality & Noise Filters
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

      // Low-value suppression (page counters, sign-off roles, footers)
      if (this.isSuppressedLowValueMetadata(rawK, rawV, obs.semanticType)) {
        rejectedCount++;
        continue;
      }

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
      if (this.isTransactionTableOverlap(obs, tables, pageHeight, pages)) {
        filteredTableOverlapCount++;
        rejectedCount++;
        continue;
      }

      validCandidates.push(obs);
    }

    const candidateCount = validCandidates.length;

    // 3. Cluster Candidates for Deduplication & Conflict Resolution
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
      const sem = cluster.semanticType;

      // Structure to group semantically equivalent observations
      interface ValueGroup {
        canonicalKey: string;
        primaryObs: OCRMetadataObservation;
        observations: OCRMetadataObservation[];
        totalConfidence: number;
      }

      const valGroups: ValueGroup[] = [];

      for (const obs of obsGroup) {
        const rawV = obs.rawValue.trim();
        let matchedGroup: ValueGroup | undefined;

        // Equivalence matching based on semantic type
        if (sem === 'OPENING_DATE' || sem === 'STATEMENT_DATE' || sem === 'STATEMENT_FROM' || sem === 'STATEMENT_TO') {
          const d = this.normalizeDate(rawV);
          if (d) {
            matchedGroup = valGroups.find((g) => g.canonicalKey === `DATE:${d}`);
          }
        } else if (sem === 'OPENING_BALANCE' || sem === 'CLOSING_BALANCE') {
          const a = this.normalizeAmount(rawV);
          if (a) {
            matchedGroup = valGroups.find((g) => g.canonicalKey === `AMT:${a}`);
          }
        } else if (sem === 'ADDRESS' || sem === 'BRANCH' || sem === 'ACCOUNT_HOLDER') {
          const t = this.normalizeTextForComparison(rawV);
          matchedGroup = valGroups.find((g) => g.canonicalKey === `TXT:${t}`);
        } else {
          // Identifiers & OTHER: conservative match
          const k = obs.normalizedValueForMatch!;
          matchedGroup = valGroups.find((g) => g.canonicalKey === `RAW:${k}`);
        }

        if (matchedGroup) {
          matchedGroup.observations.push(obs);
          matchedGroup.totalConfidence += obs.confidence;
          if (obs.confidence > matchedGroup.primaryObs.confidence) {
            matchedGroup.primaryObs = obs;
          }
        } else {
          let cKey: string;
          if (sem === 'OPENING_DATE' || sem === 'STATEMENT_DATE' || sem === 'STATEMENT_FROM' || sem === 'STATEMENT_TO') {
            const d = this.normalizeDate(rawV);
            cKey = d ? `DATE:${d}` : `RAW:${obs.normalizedValueForMatch}`;
          } else if (sem === 'OPENING_BALANCE' || sem === 'CLOSING_BALANCE') {
            const a = this.normalizeAmount(rawV);
            cKey = a ? `AMT:${a}` : `RAW:${obs.normalizedValueForMatch}`;
          } else if (sem === 'ADDRESS' || sem === 'BRANCH' || sem === 'ACCOUNT_HOLDER') {
            cKey = `TXT:${this.normalizeTextForComparison(rawV)}`;
          } else {
            cKey = `RAW:${obs.normalizedValueForMatch}`;
          }

          valGroups.push({
            canonicalKey: cKey,
            primaryObs: obs,
            observations: [obs],
            totalConfidence: obs.confidence,
          });
        }
      }

      // Subsequence / Containment check (especially for ADDRESS and text fields)
      // If one group is a clear prefix or substring of another group, prefer the more complete group!
      if (valGroups.length > 1 && (sem === 'ADDRESS' || sem === 'ACCOUNT_HOLDER' || sem === 'BRANCH' || sem === 'OTHER')) {
        // Sort groups by string length descending (longest first)
        valGroups.sort((a, b) => b.primaryObs.rawValue.length - a.primaryObs.rawValue.length);

        const mergedIndices = new Set<number>();
        for (let i = 0; i < valGroups.length; i++) {
          if (mergedIndices.has(i)) continue;
          const longerNorm = this.normalizeAlphaNumeric(valGroups[i].primaryObs.rawValue);
          if (!longerNorm || longerNorm.length < 5) continue;

          for (let j = i + 1; j < valGroups.length; j++) {
            if (mergedIndices.has(j)) continue;
            const shorterNorm = this.normalizeAlphaNumeric(valGroups[j].primaryObs.rawValue);
            if (!shorterNorm || shorterNorm.length < 3) continue;

            // Check if longerNorm starts with or contains shorterNorm
            if (longerNorm.startsWith(shorterNorm) || longerNorm.includes(shorterNorm)) {
              // Group j is a partial / truncated version of Group i!
              valGroups[i].observations.push(...valGroups[j].observations);
              valGroups[i].totalConfidence += valGroups[j].totalConfidence;
              mergedIndices.add(j);
              nearDuplicateMergeCount += valGroups[j].observations.length;
            }
          }
        }

        if (mergedIndices.size > 0) {
          const remainingGroups = valGroups.filter((_, idx) => !mergedIndices.has(idx));
          valGroups.length = 0;
          valGroups.push(...remainingGroups);
        }
      }

      // Check distinct semantic groups count
      const distinctValCount = valGroups.length;

      if (distinctValCount === 1) {
        // --- ALL OBSERVATIONS AGREE ON VALUE OR WERE MERGED AS COMPLETE SUPERSET -> AUTO CANONICAL ITEM ---
        if (obsGroup.length > 1) {
          nearDuplicateMergeCount += obsGroup.length - 1;
        }

        const winnerGroup = valGroups[0];
        // Sort winner group observations: prefer longer (more complete), then confidence, then source page
        winnerGroup.observations.sort(
          (a, b) => b.rawValue.length - a.rawValue.length || b.confidence - a.confidence || a.sourcePage - b.sourcePage
        );
        const best = winnerGroup.observations[0];

        if (this.isDecorativeFragment(best, obsGroup.length)) {
          rejectedCount += obsGroup.length;
          continue;
        }

        const qualityScore = this.calculateQualityScore(best, obsGroup.length, cluster.semanticType);

        // Core fields vs Additional fields according to Product Priority
        const isCoreCandidate =
          cluster.semanticType !== 'OTHER' &&
          cluster.semanticType !== 'STATEMENT_TIMESTAMP' &&
          cluster.semanticType !== 'OPENING_DATE' &&
          cluster.semanticType !== 'OPENING_BALANCE' &&
          cluster.semanticType !== 'CLOSING_BALANCE' &&
          cluster.semanticType !== 'ADDRESS';

        let visibilityClass: VisibilityClass = 'ADDITIONAL';
        if (isCoreCandidate && qualityScore >= METADATA_CONFIG.CORE_MIN_QUALITY) {
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
          label: this.cleanDisplayLabel(best.rawLabel),
          value: best.rawValue.trim(),
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
        // --- GENUINE CONFLICT (DIFFERENT VALUES FOR SAME CONCEPT) -> CONFLICT ITEM ---
        conflictCount++;
        // Sort valGroups by total confidence / primary confidence
        valGroups.sort((a, b) => b.totalConfidence - a.totalConfidence || b.primaryObs.confidence - a.primaryObs.confidence);
        const primary = valGroups[0].primaryObs;

        const alternatives: Array<{
          rawLabel: string;
          rawValue: string;
          confidence: number;
          sourcePage: number;
        }> = [];

        for (let i = 1; i < valGroups.length; i++) {
          const altObs = valGroups[i].primaryObs;
          alternatives.push({
            rawLabel: altObs.rawLabel,
            rawValue: altObs.rawValue.trim(),
            confidence: altObs.confidence,
            sourcePage: altObs.sourcePage,
          });
        }

        const qualityScore = this.calculateQualityScore(primary, obsGroup.length, cluster.semanticType);
        const isCoreCandidate =
          cluster.semanticType !== 'OTHER' &&
          cluster.semanticType !== 'STATEMENT_TIMESTAMP' &&
          cluster.semanticType !== 'OPENING_DATE' &&
          cluster.semanticType !== 'OPENING_BALANCE' &&
          cluster.semanticType !== 'CLOSING_BALANCE' &&
          cluster.semanticType !== 'ADDRESS';

        let visibilityClass: VisibilityClass = 'ADDITIONAL';
        if (isCoreCandidate && qualityScore >= METADATA_CONFIG.CORE_MIN_QUALITY) {
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

    // 4b. Canonical STATEMENT_PERIOD synthesis from STATEMENT_FROM + STATEMENT_TO
    const fromItem = canonicalMetadata.find((m) => m.semanticType === 'STATEMENT_FROM');
    const toItem = canonicalMetadata.find((m) => m.semanticType === 'STATEMENT_TO');
    const hasPeriod = canonicalMetadata.some((m) => m.semanticType === 'STATEMENT_PERIOD');

    if (fromItem && toItem && !hasPeriod) {
      const periodVal = `${fromItem.value} → ${toItem.value}`;
      canonicalMetadata.push({
        label: 'Kỳ sao kê / Statement Period',
        value: periodVal,
        rawLabel: 'Kỳ sao kê (Statement Period)',
        rawValue: periodVal,
        confidence: Number((Math.min(fromItem.confidence, toItem.confidence)).toFixed(4)),
        sourcePage: fromItem.sourcePage,
        keyBoundingPolygon: fromItem.keyBoundingPolygon,
        valueBoundingPolygon: toItem.valueBoundingPolygon,
        occurrenceCount: (fromItem.occurrenceCount || 1) + (toItem.occurrenceCount || 1),
        status: fromItem.status === 'CONFLICT' || toItem.status === 'CONFLICT' ? 'CONFLICT' : 'AUTO',
        semanticType: 'STATEMENT_PERIOD',
        qualityScore: Math.max(fromItem.qualityScore || 0.8, toItem.qualityScore || 0.8),
        visibilityClass: 'CORE',
      });
      coreCount++;

      // Demote individual FROM and TO items to ADDITIONAL so only 1 period card is shown in CORE
      if (fromItem.visibilityClass === 'CORE') {
        fromItem.visibilityClass = 'ADDITIONAL';
        coreCount--;
        additionalCount++;
      }
      if (toItem.visibilityClass === 'CORE') {
        toItem.visibilityClass = 'ADDITIONAL';
        coreCount--;
        additionalCount++;
      }
    }

    // 5. Stable Core Sorting
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

  /**
   * Post-Processing Canonical Metadata Clean-up:
   * Dedupes repeated CORE singleton cards (e.g. STATEMENT_PERIOD),
   * resolves false conflicts where alternatives are partial/full forms of the same address,
   * removes bilingual label noise from OPENING_DATE,
   * suppresses isolated address continuation fragments,
   * and ensures STATEMENT_FROM + STATEMENT_TO do not duplicate STATEMENT_PERIOD in CORE.
   */
  static canonicalizeMetadata(items: OCRMetadataItem[]): OCRMetadataItem[] {
    if (!items || items.length === 0) return [];

    // Filter out unattached address/table continuation fragments
    let cleaned = items.filter((m) => {
      if (m.semanticType === 'OTHER') {
        const normK = this.normalizeLabel(m.rawLabel || m.label);
        const normV = this.normalizeLabel(m.rawValue || m.value);
        // Generic continuation fragment check: contains address district/ward/city words without any standard label
        if (
          (normK.includes('an lac') || normK.includes('quan') || normK.includes('phuong')) &&
          (normV.includes('hcm') || normV.includes('tan') || normV.includes('tp'))
        ) {
          return false;
        }
      }
      return true;
    });

    // Check if STATEMENT_PERIOD is present or synthesized
    const fromItem = cleaned.find((m) => m.semanticType === 'STATEMENT_FROM');
    const toItem = cleaned.find((m) => m.semanticType === 'STATEMENT_TO');
    const existingPeriod = cleaned.find((m) => m.semanticType === 'STATEMENT_PERIOD');

    if (fromItem && toItem && !existingPeriod) {
      const periodVal = `${fromItem.value} → ${toItem.value}`;
      cleaned.push({
        id: `period-${fromItem.id || 'from'}-${toItem.id || 'to'}`,
        label: 'Kỳ sao kê / Statement Period',
        value: periodVal,
        rawLabel: 'Kỳ sao kê (Statement Period)',
        rawValue: periodVal,
        confidence: Number((Math.min(fromItem.confidence, toItem.confidence)).toFixed(4)),
        sourcePage: fromItem.sourcePage,
        keyBoundingPolygon: fromItem.keyBoundingPolygon,
        valueBoundingPolygon: toItem.valueBoundingPolygon,
        occurrenceCount: (fromItem.occurrenceCount || 1) + (toItem.occurrenceCount || 1),
        status: fromItem.status === 'CONFLICT' || toItem.status === 'CONFLICT' ? 'CONFLICT' : 'AUTO',
        semanticType: 'STATEMENT_PERIOD',
        qualityScore: Math.max(fromItem.qualityScore || 0.8, toItem.qualityScore || 0.8),
        visibilityClass: 'CORE',
      });
    }

    // Demote STATEMENT_FROM and STATEMENT_TO to ADDITIONAL if STATEMENT_PERIOD exists
    const hasPeriod = cleaned.some((m) => m.semanticType === 'STATEMENT_PERIOD');
    if (hasPeriod) {
      cleaned.forEach((m) => {
        if ((m.semanticType === 'STATEMENT_FROM' || m.semanticType === 'STATEMENT_TO') && m.visibilityClass === 'CORE') {
          m.visibilityClass = 'ADDITIONAL';
        }
      });
    }

    // Deduplicate duplicate STATEMENT_PERIOD items in CORE
    const periods = cleaned.filter((m) => m.semanticType === 'STATEMENT_PERIOD');
    if (periods.length > 1) {
      periods.sort((a, b) => b.confidence - a.confidence);
      const keep = periods[0];
      cleaned = cleaned.filter((m) => m.semanticType !== 'STATEMENT_PERIOD' || m === keep);
    }

    // Clean false conflicts
    cleaned.forEach((m) => {
      // 1. ADDRESS: partial vs full address
      if (m.semanticType === 'ADDRESS' && m.status === 'CONFLICT' && m.alternatives && m.alternatives.length > 0) {
        const normVal = this.normalizeAlphaNumeric(m.value);
        let bestVal = m.value;
        let bestConf = m.confidence;
        let isContained = true;

        for (const alt of m.alternatives) {
          const normAlt = this.normalizeAlphaNumeric(alt.rawValue);
          if (normVal.startsWith(normAlt) || normAlt.startsWith(normVal) || normVal.includes(normAlt) || normAlt.includes(normVal)) {
            if (alt.rawValue.length > bestVal.length) {
              bestVal = alt.rawValue;
              bestConf = Math.max(bestConf, alt.confidence);
            }
          } else {
            isContained = false;
            break;
          }
        }

        if (isContained) {
          m.value = bestVal;
          m.rawValue = bestVal;
          m.confidence = bestConf;
          m.status = 'AUTO';
          m.alternatives = undefined;
        }
      }

      // 2. OPENING_DATE: bilingual sub-label noise in alternatives (e.g. "(Maturity Date)")
      if (m.semanticType === 'OPENING_DATE' && m.status === 'CONFLICT' && m.alternatives && m.alternatives.length > 0) {
        const realAlts = m.alternatives.filter(
          (alt) => /\d/.test(alt.rawValue) && !/^\s*\([a-zA-Z\s]+\)\s*$/.test(alt.rawValue)
        );
        if (realAlts.length === 0) {
          m.status = 'AUTO';
          m.alternatives = undefined;
        } else {
          // Check if all real alternatives normalize to the same date
          const normD = this.normalizeDate(m.value);
          const allSameDate = normD && realAlts.every((alt) => this.normalizeDate(alt.rawValue) === normD);
          if (allSameDate) {
            m.status = 'AUTO';
            m.alternatives = undefined;
          } else {
            m.alternatives = realAlts;
          }
        }
      }

      // 3. General Date fields: check if alternatives normalize to same date
      if (
        (m.semanticType === 'STATEMENT_DATE' || m.semanticType === 'STATEMENT_FROM' || m.semanticType === 'STATEMENT_TO') &&
        m.status === 'CONFLICT' &&
        m.alternatives &&
        m.alternatives.length > 0
      ) {
        const normD = this.normalizeDate(m.value);
        if (normD && m.alternatives.every((alt) => this.normalizeDate(alt.rawValue) === normD)) {
          m.status = 'AUTO';
          m.alternatives = undefined;
        }
      }
    });

    // Stable sort
    cleaned.sort((a, b) => {
      if (a.visibilityClass === 'CORE' && b.visibilityClass !== 'CORE') return -1;
      if (a.visibilityClass !== 'CORE' && b.visibilityClass === 'CORE') return 1;

      if (a.visibilityClass === 'CORE' && b.visibilityClass === 'CORE') {
        const orderA = a.semanticType ? SEMANTIC_TYPE_ORDER[a.semanticType] || 99 : 99;
        const orderB = b.semanticType ? SEMANTIC_TYPE_ORDER[b.semanticType] || 99 : 99;
        if (orderA !== orderB) return orderA - orderB;
      }

      return a.sourcePage - b.sourcePage;
    });

    return cleaned;
  }
}
