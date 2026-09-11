/**
 * Cell Quality Evaluator
 *
 * Implements a conservative semantic quality evaluation layer on top of truthful
 * optical OCR confidence (Q2A/Q2A.1).
 *
 * Catches values that OCR reads confidently but are structurally inconsistent
 * or semantically suspicious (e.g. "94.709" in a comma-thousands column).
 *
 * PURE IN-MEMORY EVALUATION:
 * - Read-only: does not modify rawValue, normalizedValue, or OCR confidence.
 * - Generates CellQualityAssessment (PASS, WARNING, CRITICAL) per cell.
 * - No auto-correction.
 * - Generic rules only (no hardcoded bank names or document IDs).
 */

import { UnifiedCell, UnifiedColumn, UnifiedRow } from '../unifiedTableService.js';

export type QualitySeverity = 'PASS' | 'WARNING' | 'CRITICAL';

export interface QualityReason {
  code: string;
  message?: string;
}

export interface CellQualityAssessment {
  severity: QualitySeverity;
  reasons: QualityReason[];
}

export type MoneyFormatPattern =
  | 'COMMA_THOUSANDS'           // 95,909 or 1,559,240,000 or 1,559,240,000.00
  | 'DOT_THOUSANDS'             // 100.000 or 100.000,00 or 94.709
  | 'PLAIN_NUMBER'              // 50000 or 1200
  | 'UNKNOWN';

export type DateFormatPattern =
  | 'SHORT_DATE_DASH'           // DD-MM
  | 'SHORT_DATE_SLASH'          // DD/MM
  | 'FULL_DATE_SLASH'           // DD/MM/YYYY or DD/MM/YY
  | 'FULL_DATE_DASH'            // DD-MM-YYYY or DD-MM-YY
  | 'FULL_DATE_DOT'             // DD.MM.YYYY
  | 'UNKNOWN';

export interface ColumnQualityProfile {
  canonicalColumnIndex: number;
  effectiveRole: 'MONEY' | 'DATE' | 'STT' | 'REFERENCE' | 'DESCRIPTION' | 'TEXT';
  dominantMoneyPattern?: MoneyFormatPattern;
  dominantDatePattern?: DateFormatPattern;
  referenceSampleValues?: string[];
  sampleCount: number;
}

export class CellQualityEvaluator {
  private static TELLER_CODE_REGEX = /\b(gdv|teller|teller\s*code|nguoi\s*tao|nguoi\s*lap|ma\s*gdv|user|operator)\b/i;
  private static REFERENCE_HEADER_REGEX = /\b(ref|reference|so\s*gd|so\s*giao\s*dich|ma\s*gd|ma\s*giao\s*dich|transaction\s*no|trans\s*no|document\s*no|doc\s*no|chung\s*tu|so\s*ct|mgd|tham\s*chieu)\b/i;

  /**
   * Main entry point: Evaluates all cells in a projected UnifiedTransactionTable.
   * Modifies unifiedRows in-place by attaching `qualityAssessment` to each cell,
   * then returns the updated rows.
   */
  static evaluateTable(columns: UnifiedColumn[], rows: UnifiedRow[]): UnifiedRow[] {
    if (!columns || columns.length === 0 || !rows || rows.length === 0) {
      return rows;
    }

    // 1. Build column profiles for all logical columns
    const columnProfiles = this.buildColumnProfiles(columns, rows);

    // 2. Evaluate each cell linearly
    for (const row of rows) {
      for (let cIdx = 0; cIdx < row.cells.length; cIdx++) {
        const cell = row.cells[cIdx];
        const profile = columnProfiles[cIdx] || {
          canonicalColumnIndex: cIdx,
          effectiveRole: 'TEXT',
          sampleCount: 0,
        };

        cell.qualityAssessment = this.evaluateCell(cell, profile);
      }
    }

    return rows;
  }

  /**
   * Builds lightweight column profile for each canonical column based on data rows.
   */
  static buildColumnProfiles(columns: UnifiedColumn[], rows: UnifiedRow[]): ColumnQualityProfile[] {
    return columns.map((col, colIdx) => {
      // Step A: Determine effective role with Teller Code guard
      let effectiveRole: ColumnQualityProfile['effectiveRole'] = 'TEXT';

      const normHeader = (col.header || '').toLowerCase().trim();
      const unaccentedHeader = normHeader
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');

      const isTellerHeader = this.TELLER_CODE_REGEX.test(normHeader) || this.TELLER_CODE_REGEX.test(unaccentedHeader);

      if (isTellerHeader) {
        // Teller / GDV code guard: Force TEXT/CODE regardless of semanticType
        effectiveRole = 'TEXT';
      } else if (['DEBIT', 'CREDIT', 'BALANCE'].includes(col.semanticType)) {
        effectiveRole = 'MONEY';
      } else if (['DATE', 'VALUE_DATE'].includes(col.semanticType)) {
        effectiveRole = 'DATE';
      } else if (col.semanticType === 'STT') {
        effectiveRole = 'STT';
      } else if (
        col.semanticType === 'REFERENCE' ||
        this.REFERENCE_HEADER_REGEX.test(normHeader) ||
        this.REFERENCE_HEADER_REGEX.test(unaccentedHeader)
      ) {
        effectiveRole = 'REFERENCE';
      } else if (col.semanticType === 'DESCRIPTION') {
        effectiveRole = 'DESCRIPTION';
      }

      // Step B: Collect non-empty data values for this column
      const sampleValues: string[] = [];
      for (const row of rows) {
        const cell = row.cells[colIdx];
        if (cell && !cell.isPlaceholder && cell.rawValue) {
          const val = cell.rawValue.trim();
          if (val !== '') {
            sampleValues.push(val);
          }
        }
      }

      const profile: ColumnQualityProfile = {
        canonicalColumnIndex: colIdx,
        effectiveRole,
        sampleCount: sampleValues.length,
      };

      // Step C: Derive dominant patterns
      if (effectiveRole === 'MONEY') {
        profile.dominantMoneyPattern = this.deriveDominantMoneyPattern(sampleValues);
      } else if (effectiveRole === 'DATE') {
        profile.dominantDatePattern = this.deriveDominantDatePattern(sampleValues);
      } else if (effectiveRole === 'REFERENCE') {
        profile.referenceSampleValues = sampleValues;
      }

      return profile;
    });
  }

  /**
   * Derives dominant money formatting pattern across sample values.
   * Requires at least 5 parseable samples and >= 70% dominance.
   */
  private static deriveDominantMoneyPattern(sampleValues: string[]): MoneyFormatPattern {
    let commaCount = 0;
    let dotCount = 0;
    let totalSeparated = 0;

    for (const val of sampleValues) {
      if (this.isBaselineMoneyValue(val)) continue;

      // Comma thousands: 95,909 or 1,559,240,000 or 1,559,240,000.00
      if (/^-?\d{1,3}(,\d{3})+(\.\d{2})?$/.test(val)) {
        commaCount++;
        totalSeparated++;
      }
      // Dot thousands: 100.000 or 94.709 or 100.000,00
      else if (/^-?\d{1,3}(\.\d{3})+(,\d{2})?$/.test(val)) {
        dotCount++;
        totalSeparated++;
      }
    }

    if (totalSeparated >= 5) {
      if (commaCount / totalSeparated >= 0.70) {
        return 'COMMA_THOUSANDS';
      }
      if (dotCount / totalSeparated >= 0.70) {
        return 'DOT_THOUSANDS';
      }
    }

    return 'UNKNOWN';
  }

  /**
   * Derives dominant date pattern across sample values.
   * Requires at least 5 parseable samples and >= 70% dominance.
   */
  private static deriveDominantDatePattern(sampleValues: string[]): DateFormatPattern {
    const counts: Record<DateFormatPattern, number> = {
      SHORT_DATE_DASH: 0,
      SHORT_DATE_SLASH: 0,
      FULL_DATE_SLASH: 0,
      FULL_DATE_DASH: 0,
      FULL_DATE_DOT: 0,
      UNKNOWN: 0,
    };

    let totalDates = 0;

    for (const val of sampleValues) {
      if (val === '-' || val === '—') continue;

      let matched: DateFormatPattern | null = null;
      if (/^\d{1,2}-\d{1,2}$/.test(val)) matched = 'SHORT_DATE_DASH';
      else if (/^\d{1,2}\/\d{1,2}$/.test(val)) matched = 'SHORT_DATE_SLASH';
      else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(val)) matched = 'FULL_DATE_SLASH';
      else if (/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(val)) matched = 'FULL_DATE_DASH';
      else if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(val)) matched = 'FULL_DATE_DOT';

      if (matched) {
        counts[matched]++;
        totalDates++;
      }
    }

    if (totalDates >= 5) {
      for (const [pattern, count] of Object.entries(counts) as [DateFormatPattern, number][]) {
        if (pattern !== 'UNKNOWN' && count / totalDates >= 0.70) {
          return pattern;
        }
      }
    }

    return 'UNKNOWN';
  }

  /**
   * Evaluates a single cell against optical and semantic rules.
   */
  static evaluateCell(cell: UnifiedCell, profile: ColumnQualityProfile): CellQualityAssessment {
    const reasons: QualityReason[] = [];
    let severity: QualitySeverity = 'PASS';

    // Rule 1: Placeholders & Empty Cells
    if (cell.isPlaceholder) {
      return { severity: 'PASS', reasons: [] };
    }

    const raw = (cell.rawValue || '').trim();

    if (cell.confidenceSource === 'EMPTY_CELL' && !raw) {
      return { severity: 'PASS', reasons: [] };
    }

    // Rule 2: Optical Confidence Rules
    if (cell.confidenceSource === 'UNAVAILABLE' && raw) {
      reasons.push({
        code: 'OCR_CONFIDENCE_UNAVAILABLE',
        message: 'Độ tin cậy OCR không khả dụng cho ô có nội dung',
      });
      severity = this.escalateSeverity(severity, 'WARNING');
    } else if (typeof cell.confidence === 'number' && cell.confidence < 0.70) {
      reasons.push({
        code: 'LOW_OCR_CONFIDENCE',
        message: `Độ tin cậy OCR thấp (${Math.round(cell.confidence * 100)}%)`,
      });
      severity = this.escalateSeverity(severity, 'WARNING');
    }

    // Rule 3: Semantic Structured Validation based on Effective Role
    if (raw !== '') {
      switch (profile.effectiveRole) {
        case 'MONEY': {
          const moneyAssessment = this.evaluateMoneyCell(raw, profile.dominantMoneyPattern, cell.confidence);
          reasons.push(...moneyAssessment.reasons);
          severity = this.escalateSeverity(severity, moneyAssessment.severity);
          break;
        }
        case 'DATE': {
          const dateAssessment = this.evaluateDateCell(raw, profile.dominantDatePattern);
          reasons.push(...dateAssessment.reasons);
          severity = this.escalateSeverity(severity, dateAssessment.severity);
          break;
        }
        case 'STT': {
          const sttAssessment = this.evaluateSttCell(raw);
          reasons.push(...sttAssessment.reasons);
          severity = this.escalateSeverity(severity, sttAssessment.severity);
          break;
        }
        case 'REFERENCE': {
          const refAssessment = this.evaluateReferenceCell(raw, profile.referenceSampleValues);
          reasons.push(...refAssessment.reasons);
          severity = this.escalateSeverity(severity, refAssessment.severity);
          break;
        }
        case 'DESCRIPTION': {
          const descAssessment = this.evaluateDescriptionCell(raw);
          reasons.push(...descAssessment.reasons);
          severity = this.escalateSeverity(severity, descAssessment.severity);
          break;
        }
      }
    }

    // Deduplicate reasons by code
    const uniqueReasons: QualityReason[] = [];
    const seenCodes = new Set<string>();
    for (const r of reasons) {
      if (!seenCodes.has(r.code)) {
        seenCodes.add(r.code);
        uniqueReasons.push(r);
      }
    }

    return {
      severity,
      reasons: uniqueReasons,
    };
  }

  /**
   * Validates MONEY cells conservatively.
   */
  private static evaluateMoneyCell(
    raw: string,
    dominantPattern?: MoneyFormatPattern,
    confidence?: number | null
  ): CellQualityAssessment {
    if (this.isBaselineMoneyValue(raw)) {
      return { severity: 'PASS', reasons: [] };
    }

    const reasons: QualityReason[] = [];
    let severity: QualitySeverity = 'PASS';

    // 1. Noise check: Multiple or corrupt punctuation noise (e.g. "1:559,240,000.00,")
    if (/[:;!@#$%\^&*]|\.{2,}|,{2,}/.test(raw)) {
      reasons.push({
        code: 'MULTIPLE_SEPARATOR_NOISE',
        message: 'Ký tự phân cách hoặc dấu câu bất thường trong ô số tiền',
      });
      severity = this.escalateSeverity(severity, 'WARNING');
    }

    // 2. Trailing separator: e.g. "50,039," or "100.000."
    if (/[,.]$/.test(raw)) {
      reasons.push({
        code: 'TRAILING_SEPARATOR',
        message: 'Dấu phân cách ở cuối ô số tiền',
      });
      severity = this.escalateSeverity(severity, 'WARNING');
    }

    // 3. Leading noise / Prose words at the beginning
    // e.g. "Lo ICH 50,000" starts with letters before the number
    const hasLeadingWords = /^[a-zA-Z\u00C0-\u1EF9\s]+[\d]/.test(raw);
    const hasLeadingSymbols = /^[^\d\-+\s]/.test(raw);

    if (hasLeadingWords || hasLeadingSymbols) {
      reasons.push({
        code: 'LEADING_NOISE',
        message: 'Ký tự hoặc từ ngữ bất thường ở đầu ô số tiền',
      });
      // Multi-word prose contamination (e.g. "Lo ICH") inside a money cell is CRITICAL
      if (hasLeadingWords) {
        severity = this.escalateSeverity(severity, 'CRITICAL');
      } else {
        severity = this.escalateSeverity(severity, 'WARNING');
      }
    }

    // 4. Alpha characters inside money: e.g. "95,909 A" or "Lo ICH 50,000"
    if (/[a-zA-Z\u00C0-\u1EF9]/.test(raw)) {
      reasons.push({
        code: 'ALPHA_IN_MONEY',
        message: 'Chứa ký tự chữ trong ô số tiền',
      });
      // If combined with low optical confidence (< 0.70) and prominent words, can be CRITICAL or WARNING
      severity = this.escalateSeverity(severity, 'WARNING');
    }

    // 5. Format Outlier:
    // When column has proven dominant format, check if value contradicts it
    if (dominantPattern === 'COMMA_THOUSANDS') {
      // E.g. "94.709" uses dot-thousands while column is comma-thousands
      if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
        reasons.push({
          code: 'FORMAT_OUTLIER',
          message: 'Định dạng số tiền sử dụng dấu chấm thay vì dấu phẩy phân cách hàng nghìn',
        });
        severity = this.escalateSeverity(severity, 'WARNING');
      }
    } else if (dominantPattern === 'DOT_THOUSANDS') {
      // E.g. "94,709" uses comma-thousands while column is dot-thousands
      if (/^-?\d{1,3}(,\d{3})+$/.test(raw)) {
        reasons.push({
          code: 'FORMAT_OUTLIER',
          message: 'Định dạng số tiền sử dụng dấu phẩy thay vì dấu chấm phân cách hàng nghìn',
        });
        severity = this.escalateSeverity(severity, 'WARNING');
      }
    }

    return { severity, reasons };
  }

  /**
   * Validates DATE cells based on dominant pattern and standard structure.
   */
  private static evaluateDateCell(raw: string, dominantPattern?: DateFormatPattern): CellQualityAssessment {
    if (raw === '-' || raw === '—') {
      return { severity: 'PASS', reasons: [] };
    }

    const reasons: QualityReason[] = [];
    let severity: QualitySeverity = 'PASS';

    // 1. Text contamination in date: e.g. "Ngay 15/08"
    if (/[a-zA-Z\u00C0-\u1EF9]/.test(raw)) {
      reasons.push({
        code: 'DATE_TEXT_CONTAMINATION',
        message: 'Chứa ký tự chữ trong ô ngày tháng',
      });
      severity = this.escalateSeverity(severity, 'WARNING');
    }

    // 2. Validate calendar structure (day/month bounds)
    const dateMatch = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
    if (!dateMatch) {
      if (!reasons.some((r) => r.code === 'DATE_TEXT_CONTAMINATION')) {
        reasons.push({
          code: 'INVALID_DATE_STRUCTURE',
          message: 'Cấu trúc ngày tháng không hợp lệ',
        });
        severity = this.escalateSeverity(severity, 'WARNING');
      }
    } else {
      const d = parseInt(dateMatch[1], 10);
      const m = parseInt(dateMatch[2], 10);
      if (d < 1 || d > 31 || m < 1 || m > 12) {
        reasons.push({
          code: 'INVALID_DATE_STRUCTURE',
          message: `Giá trị ngày (${d}) hoặc tháng (${m}) vượt quá phạm vi hợp lệ`,
        });
        severity = this.escalateSeverity(severity, 'WARNING');
      }

      // 3. Format Outlier check against dominant format
      // Note: DD-MM is valid when SHORT_DATE_DASH is dominant (ACB)
      if (dominantPattern === 'FULL_DATE_SLASH' && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
        if (/^\d{1,2}-\d{1,2}$/.test(raw)) {
          reasons.push({
            code: 'DATE_FORMAT_OUTLIER',
            message: 'Thiếu năm so với định dạng ngày tháng chung của cột',
          });
          severity = this.escalateSeverity(severity, 'WARNING');
        }
      }
    }

    return { severity, reasons };
  }

  /**
   * Validates STT (sequence number) cells.
   * Sequence gaps (1, 2, 4, 5) are legitimate and allowed.
   */
  private static evaluateSttCell(raw: string): CellQualityAssessment {
    if (raw === '-' || raw === '—') {
      return { severity: 'PASS', reasons: [] };
    }

    const reasons: QualityReason[] = [];
    let severity: QualitySeverity = 'PASS';

    // Must be integer
    if (/^\d+$/.test(raw)) {
      return { severity: 'PASS', reasons: [] };
    }

    if (/[a-zA-Z\u00C0-\u1EF9]/.test(raw)) {
      reasons.push({
        code: 'STT_TEXT_CONTAMINATION',
        message: 'Cột STT chứa ký tự chữ',
      });
      severity = this.escalateSeverity(severity, 'WARNING');
    } else {
      reasons.push({
        code: 'STT_NON_INTEGER',
        message: 'Cột STT không phải là số nguyên',
      });
      severity = this.escalateSeverity(severity, 'WARNING');
    }

    return { severity, reasons };
  }

  private static DIGIT_TO_LETTER_CONFUSIONS: Record<string, string> = {
    '0': 'O',
    '1': 'I',
    '2': 'Z',
    '5': 'S',
    '6': 'G',
    '8': 'B',
  };

  private static LETTER_TO_DIGIT_CONFUSIONS: Record<string, string> = {
    'O': '0', 'o': '0',
    'I': '1', 'i': '1', 'l': '1',
    'Z': '2', 'z': '2',
    'S': '5', 's': '5',
    'G': '6', 'g': '6',
    'B': '8', 'b': '8',
  };

  /**
   * Validates REFERENCE cells conservatively with generic contextual peer analysis.
   * Normal alphanumeric codes, hyphens, slashes are valid.
   */
  private static evaluateReferenceCell(raw: string, peerValues?: string[]): CellQualityAssessment {
    if (raw === '-' || raw === '—') {
      return { severity: 'PASS', reasons: [] };
    }

    // 1. Only flag extreme corruption or control characters
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(raw)) {
      return {
        severity: 'CRITICAL',
        reasons: [{ code: 'CORRUPT_CHARACTERS', message: 'Mã tham chiếu chứa ký tự điều khiển không hợp lệ' }],
      };
    }

    // 2. Generic Contextual Reference Validation
    if (peerValues && peerValues.length >= 5) {
      const contextual = this.evaluateReferenceContextual(raw, peerValues);
      if (contextual.isOutlier) {
        return {
          severity: 'WARNING',
          reasons: contextual.reasons,
        };
      }
    }

    return { severity: 'PASS', reasons: [] };
  }

  /**
   * Evaluates a single reference value against its peer values in the same column (leave-one-out).
   */
  private static evaluateReferenceContextual(
    val: string,
    allColumnValues: string[]
  ): { isOutlier: boolean; reasons: QualityReason[] } {
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
    const numericPeers = peers.filter((p) => /^\d+$/.test(p));
    if (numericPeers.length / peers.length >= 0.90) {
      if (/^\d+$/.test(trimmed)) {
        return noResult;
      }

      // Check if this value has alternate-family peer support in the column
      const valMaskStr = this.toCharClassMask(trimmed).join('');
      const leadingAlphaMatch = trimmed.match(/^[a-zA-Z]+/);
      const leadingAlpha = leadingAlphaMatch ? leadingAlphaMatch[0] : '';

      const hasAlternateFamilySupport = peers.some((p) => {
        if (/^\d+$/.test(p)) return false;
        // Same multi-letter prefix (>= 2 letters)
        if (leadingAlpha.length >= 2 && p.startsWith(leadingAlpha)) return true;
        // Or exact same structural mask
        if (this.toCharClassMask(p).join('') === valMaskStr) return true;
        return false;
      });

      if (hasAlternateFamilySupport) {
        return noResult; // Legitimate alternate family supported by peers
      }

      // Calculate dominant numeric length
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
          if (ch in this.LETTER_TO_DIGIT_CONFUSIONS) {
            hasConfusion = true;
            break;
          }
        }
        const reasons: QualityReason[] = [
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

      // Structurally distant formats without near-numeric affinity (e.g. ABC00010, PAY-XYZ-2024) abstain
      return noResult;
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
        const valMask = this.toCharClassMask(trimmed);
        const famMasks = sameLenFamily.map((p) => this.toCharClassMask(p));
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
            if (domClass === 'L' && valMask[pos] === 'D' && ch in this.DIGIT_TO_LETTER_CONFUSIONS) {
              hasConfusion = true;
            } else if (domClass === 'D' && valMask[pos] === 'L' && ch in this.LETTER_TO_DIGIT_CONFUSIONS) {
              hasConfusion = true;
            }
          }
        }

        // Suffix Segment Letter Constraint (tail of 2 characters)
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
              if (ch in this.DIGIT_TO_LETTER_CONFUSIONS) {
                hasConfusion = true;
                break;
              }
            }
          }
        }

        if (positionalAnomaly) {
          const reasons: QualityReason[] = [
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

    // D. Check 3: Column-Wide Single Dominant Format (Conservative)
    const allMasks = peers.map((p) => this.toCharClassMask(p).join(''));
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
      const valMaskStr = this.toCharClassMask(trimmed).join('');
      // Only compare if same length as dominant format
      if (trimmed.length === dominantMask.length && valMaskStr !== dominantMask) {
        let mismatchCount = 0;
        let hasConfusion = false;
        for (let i = 0; i < trimmed.length; i++) {
          const expected = dominantMask[i];
          const actual = valMaskStr[i];
          const ch = trimmed[i];
          if (expected !== actual) {
            mismatchCount++;
            if (expected === 'L' && actual === 'D' && ch in this.DIGIT_TO_LETTER_CONFUSIONS) hasConfusion = true;
            if (expected === 'D' && actual === 'L' && ch in this.LETTER_TO_DIGIT_CONFUSIONS) hasConfusion = true;
          }
        }
        // Only flag if it is an isolated structural mutation (<= 2 positions differing)
        // If >= 3 positions differ, it is a completely distinct structural family, so abstain
        if (mismatchCount <= 2) {
          const reasons: QualityReason[] = [
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

  private static toCharClassMask(val: string): ('D' | 'L' | 'P' | 'S')[] {
    return val.split('').map((ch) => {
      if (/\d/.test(ch)) return 'D';
      if (/[a-zA-Z\u00C0-\u1EF9]/.test(ch)) return 'L';
      if (/[-/._#:\s]/.test(ch)) return 'P';
      return 'S';
    });
  }

  /**
   * Validates DESCRIPTION cells.
   * Free-form text is allowed; only flags control characters or extreme binary garbage.
   */
  private static evaluateDescriptionCell(raw: string): CellQualityAssessment {
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(raw)) {
      return {
        severity: 'CRITICAL',
        reasons: [{ code: 'CORRUPT_CHARACTERS', message: 'Nội dung chứa ký tự điều khiển không hợp lệ' }],
      };
    }

    return { severity: 'PASS', reasons: [] };
  }

  /**
   * Checks if raw money value is a valid blank, dash, or zero variant.
   */
  private static isBaselineMoneyValue(val: string): boolean {
    const s = val.trim();
    return s === '' || s === '-' || s === '—' || s === '–' || s === '0' || s === '0.00' || s === '0,00';
  }

  /**
   * Escalates severity level conservatively: PASS < WARNING < CRITICAL.
   */
  private static escalateSeverity(current: QualitySeverity, next: QualitySeverity): QualitySeverity {
    if (current === 'CRITICAL' || next === 'CRITICAL') return 'CRITICAL';
    if (current === 'WARNING' || next === 'WARNING') return 'WARNING';
    return 'PASS';
  }
}
