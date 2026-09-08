import { CellType } from './types.js';

export interface NormalizedResult {
  rawValue: string;
  normalizedValue: string;
  cellType: CellType;
}

export class DataNormalizer {
  /**
   * Intelligently classify and normalize cell contents:
   * 1. DATE: Vietnamese and standard formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.)
   * 2. MONEY: VND, USD currency values with dots/commas (e.g., "15.000.000 đ", "2,500,000", "+ 1.250.000")
   * 3. NUMBER: pure integer/decimal or transaction references
   * 4. TEXT: general strings
   */
  static normalizeCell(rawValue: string, explicitType?: CellType): NormalizedResult {
    const raw = (rawValue || '').trim();
    if (!raw) {
      return { rawValue: '', normalizedValue: '', cellType: explicitType || 'TEXT' };
    }

    // Handle user-specified explicit types
    if (explicitType === 'MONEY') {
      const moneyNorm = this.tryNormalizeMoney(raw);
      return { rawValue: raw, normalizedValue: moneyNorm || raw, cellType: 'MONEY' };
    }

    if (explicitType === 'DATE') {
      const dateNorm = this.tryNormalizeDate(raw);
      return { rawValue: raw, normalizedValue: dateNorm || raw, cellType: 'DATE' };
    }

    if (explicitType === 'NUMBER') {
      const numberNorm = this.tryNormalizeNumber(raw);
      return { rawValue: raw, normalizedValue: numberNorm || raw, cellType: 'NUMBER' };
    }

    if (explicitType === 'TEXT') {
      return { rawValue: raw, normalizedValue: raw, cellType: 'TEXT' };
    }

    // Auto-inference when explicitType is not specified
    // 1. Try Date normalization
    const dateNorm = this.tryNormalizeDate(raw);
    if (dateNorm) {
      return { rawValue: raw, normalizedValue: dateNorm, cellType: 'DATE' };
    }

    // 2. Try Money normalization
    const moneyNorm = this.tryNormalizeMoney(raw);
    if (moneyNorm) {
      return { rawValue: raw, normalizedValue: moneyNorm, cellType: 'MONEY' };
    }

    // 3. Try Number normalization
    const numberNorm = this.tryNormalizeNumber(raw);
    if (numberNorm) {
      return { rawValue: raw, normalizedValue: numberNorm, cellType: 'NUMBER' };
    }

    return { rawValue: raw, normalizedValue: raw, cellType: 'TEXT' };
  }

  private static tryNormalizeDate(val: string): string | null {
    // Matches DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY/MM/DD, YYYY-MM-DD
    const dmyRegex = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/;
    const matchDmy = val.match(dmyRegex);
    if (matchDmy) {
      const day = matchDmy[1].padStart(2, '0');
      const month = matchDmy[2].padStart(2, '0');
      const year = matchDmy[3];
      const dNum = parseInt(day, 10);
      const mNum = parseInt(month, 10);
      if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
        return `${year}-${month}-${day}`;
      }
    }

    const ymdRegex = /^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/;
    const matchYmd = val.match(ymdRegex);
    if (matchYmd) {
      const year = matchYmd[1];
      const month = matchYmd[2].padStart(2, '0');
      const day = matchYmd[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return null;
  }

  private static tryNormalizeMoney(val: string): string | null {
    // Clean currency symbols and signs: "15.000.000 VND", "+ 2.500.000 đ", "$1,250.00", "500,000"
    const hasCurrencySymbol = /(đ|vnd|vnđ|\$|usd|eur)/i.test(val);
    const cleaned = val.replace(/[đvndvnđ\$usd\s]/gi, '').trim();

    // Check if it's formatted like 15.000.000 or 15,000,000 or -2.500.000
    const moneyRegex = /^[\+\-]?(\d{1,3}([\.,]\d{3})+|\d+)([\.,]\d{2})?$/;
    if (hasCurrencySymbol || moneyRegex.test(cleaned)) {
      // Convert standard Vietnamese dot thousand separator (15.000.000) or comma separator (15,000,000)
      const isNegative = cleaned.startsWith('-');
      const numOnly = cleaned.replace(/[^\d]/g, '');
      if (numOnly.length > 0 && !isNaN(Number(numOnly))) {
        const numVal = parseInt(numOnly, 10);
        return isNegative ? `-${numVal}` : `${numVal}`;
      }
    }

    return null;
  }

  private static tryNormalizeNumber(val: string): string | null {
    const cleaned = val.trim();
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      return cleaned;
    }
    return null;
  }
}
