import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService, UnifiedDocumentTable, UnifiedTableRow, UnifiedTableCell } from '../server/services/unifiedTableService.js';

interface AuditDocConfig {
  key: string;
  name: string;
  id: string;
  userId: string;
}

const AUDIT_DOCS: AuditDocConfig[] = [
  { key: 'DOC_1_PROBLEM_STAMP', name: 'Nam A (Problematic Stamp / Chị Lan)', id: 'fa982b65-94e8-4a21-9c74-e28ace4bad85', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { key: 'DOC_2_HDBANK_REGRESSION', name: 'HDBank (Recent Upload)', id: '93c5f47f-659f-4e5f-be03-fd0ad073ab88', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { key: 'DOC_3_ACB_MEDIHUB', name: 'ACB Medihub', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  { key: 'DOC_4_NAM_A_CLEAN', name: 'Nam A Bank (Base Clean)', id: '82537093-4f56-4328-962d-de5237e7a9eb', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { key: 'DOC_5_BAN_VIET', name: 'Ban Viet Bank', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
];

export interface AnomalyReport {
  cellId: string;
  sourcePage: number;
  rowIdx: number;
  colIdx: number;
  colHeader: string;
  semanticType: string;
  rawValue: string;
  confidence: number;
  reasons: string[];
  proposedSeverity: 'WARNING' | 'CRITICAL';
  polygon?: any;
}

// Dominant format analysis for money
function analyzeDominantMoneyFormat(values: string[]): {
  dominantStyle: 'COMMA_THOUSANDS' | 'DOT_THOUSANDS' | 'DECIMAL_POINT' | 'DECIMAL_COMMA' | 'PLAIN_INTEGER' | 'UNKNOWN';
  countCommaThousands: number;
  countDotThousands: number;
  countPlain: number;
  totalValid: number;
} {
  let countCommaThousands = 0; // e.g. 1,234,567
  let countDotThousands = 0;   // e.g. 1.234.567
  let countPlain = 0;          // e.g. 1234567

  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed || trimmed === '-' || trimmed === '0') continue;
    // Check if matches comma thousands: 1 to 3 digits followed by groups of ,3digits
    if (/^-?\d{1,3}(,\d{3})+$/.test(trimmed)) {
      countCommaThousands++;
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(trimmed)) {
      countDotThousands++;
    } else if (/^-?\d+$/.test(trimmed)) {
      countPlain++;
    }
  }

  const totalValid = countCommaThousands + countDotThousands + countPlain;
  let dominantStyle: any = 'UNKNOWN';
  if (countCommaThousands >= countDotThousands && countCommaThousands >= countPlain && countCommaThousands > 0) {
    dominantStyle = 'COMMA_THOUSANDS';
  } else if (countDotThousands >= countCommaThousands && countDotThousands >= countPlain && countDotThousands > 0) {
    dominantStyle = 'DOT_THOUSANDS';
  } else if (countPlain > 0) {
    dominantStyle = 'PLAIN_INTEGER';
  }

  return { dominantStyle, countCommaThousands, countDotThousands, countPlain, totalValid };
}

// Inspect single cell for anomalies
function evaluateCellAnomaly(
  cell: UnifiedTableCell,
  semanticType: string,
  dominantMoneyStyle: string,
  sourcePage: number,
  rowIdx: number,
  colIdx: number,
  colHeader: string
): AnomalyReport | null {
  if (cell.isPlaceholder || !cell.rawValue || cell.rawValue.trim() === '') return null;
  const raw = cell.rawValue.trim();
  const reasons: string[] = [];
  let severity: 'WARNING' | 'CRITICAL' = 'WARNING';

  // 1. Check OCR confidence
  if (cell.confidence < 0.70) {
    reasons.push('LOW_OCR_CONFIDENCE');
    severity = 'CRITICAL';
  } else if (cell.confidence < 0.85) {
    reasons.push('MED_OCR_CONFIDENCE');
  }

  // 2. MONEY column audit: DEBIT, CREDIT, BALANCE
  if (['DEBIT', 'CREDIT', 'BALANCE'].includes(semanticType)) {
    // Legitimate empty / dash / zero
    if (raw === '-' || raw === '—' || raw === '0') {
      return reasons.length > 0 ? {
        cellId: cell.id || '',
        sourcePage, rowIdx, colIdx, colHeader, semanticType, rawValue: raw, confidence: cell.confidence, reasons, proposedSeverity: severity, polygon: cell.boundingPolygon
      } : null;
    }

    // A. Alpha characters in money cell (e.g. "95,909 A", "Lo ICH 50,000")
    if (/[A-Za-zÀ-ỹ]/.test(raw)) {
      reasons.push('ALPHA_IN_MONEY');
      severity = 'CRITICAL';
    }

    // B. Trailing separator (e.g. "50,039," or "50,039.")
    if (/[,.]$/.test(raw)) {
      reasons.push('TRAILING_SEPARATOR');
      severity = 'CRITICAL';
    }

    // C. Leading separator (e.g. ",50,039" or ".50,039")
    if (/^[,.]/.test(raw)) {
      reasons.push('LEADING_SEPARATOR');
      severity = 'CRITICAL';
    }

    // D. Multiple consecutive separators (e.g. "50,,039" or "50..039")
    if (/[,.]{2,}/.test(raw)) {
      reasons.push('CONSECUTIVE_SEPARATORS');
      severity = 'CRITICAL';
    }

    // E. Dominant Format Outlier
    // If dominant style is COMMA_THOUSANDS (e.g. 95,909), and cell uses DOT_THOUSANDS (e.g. 94.709)
    if (dominantMoneyStyle === 'COMMA_THOUSANDS') {
      if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
        reasons.push('FORMAT_OUTLIER_DOT_VS_COMMA');
        severity = 'CRITICAL'; // High impact for bank statement reconciliation!
      }
    } else if (dominantMoneyStyle === 'DOT_THOUSANDS') {
      if (/^-?\d{1,3}(,\d{3})+$/.test(raw)) {
        reasons.push('FORMAT_OUTLIER_COMMA_VS_DOT');
        severity = 'CRITICAL';
      }
    }

    // F. Broken grouping (e.g. "50,39" where 2 digits follow separator)
    if (/,\d{1,2}$|\.\d{1,2}$/.test(raw) && !reasons.includes('FORMAT_OUTLIER_DOT_VS_COMMA')) {
      // Could be decimal cents or broken OCR
      if (!raw.includes(',') || (dominantMoneyStyle === 'COMMA_THOUSANDS' && raw.includes('.'))) {
        reasons.push('SUSPICIOUS_DECIMAL_OR_BROKEN_GROUP');
      }
    }

    // G. Multiple numeric tokens / whitespace separated numbers (e.g. "50 000 000" or "50,000 12,000")
    if (/\d+\s+\d+/.test(raw)) {
      reasons.push('MULTIPLE_NUMERIC_TOKENS');
      severity = 'CRITICAL';
    }

    // H. Multi-line content in money column (e.g. stamp text spanning lines)
    if (raw.includes('\n')) {
      reasons.push('MULTILINE_IN_MONEY');
      severity = 'CRITICAL';
    }
  }

  // 3. DATE / VALUE_DATE column audit
  if (['DATE', 'VALUE_DATE'].includes(semanticType)) {
    // Normal date patterns: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD
    const datePattern = /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/;
    if (!datePattern.test(raw)) {
      // Check if alpha contaminated: "07/06/2024 A"
      if (/[A-Za-zÀ-ỹ]/.test(raw)) {
        reasons.push('ALPHA_IN_DATE');
        severity = 'CRITICAL';
      } else if (raw.includes('\n')) {
        reasons.push('MULTILINE_IN_DATE');
        severity = 'CRITICAL';
      } else {
        reasons.push('INVALID_DATE_FORMAT');
      }
    } else {
      // Verify logical day/month
      const parts = raw.split(/[\/\-\.]/).map(Number);
      if (parts.length === 3) {
        const [p1, p2, p3] = parts;
        // Assume DD/MM/YYYY or YYYY/MM/DD
        let day = p1, month = p2;
        if (p1 > 1900) { // YYYY/MM/DD
          day = p3;
          month = p2;
        }
        if (month < 1 || month > 12 || day < 1 || day > 31) {
          reasons.push('LOGICAL_DATE_OUT_OF_RANGE');
          severity = 'CRITICAL';
        }
      }
    }
  }

  // 4. STT column audit
  if (semanticType === 'STT') {
    if (!/^\d+$/.test(raw)) {
      reasons.push('NON_INTEGER_STT');
      if (/[A-Za-z]/.test(raw)) {
        severity = 'CRITICAL';
      }
    }
  }

  // 5. REFERENCE column audit
  if (semanticType === 'REFERENCE') {
    // Only flag extreme contamination like multi-line prose or obvious stamp
    if (raw.includes('\n') && raw.split('\n').length > 3) {
      reasons.push('MULTILINE_PROSE_IN_REF');
    }
  }

  // 6. DESCRIPTION column
  // (Policy: loose, do not flag normal alphabetic or transaction notes)

  if (reasons.length > 0) {
    return {
      cellId: cell.id || '',
      sourcePage,
      rowIdx,
      colIdx,
      colHeader,
      semanticType,
      rawValue: raw,
      confidence: cell.confidence,
      reasons,
      proposedSeverity: severity,
      polygon: cell.boundingPolygon
    };
  }

  return null;
}

async function runAudit() {
  console.log('========================================================================');
  console.log('Q1 REAL-DATA CELL QUALITY AUDIT — RUNNING ACROSS 5 REAL BANK STATEMENTS');
  console.log('========================================================================\n');

  const summaryMatrix: any[] = [];

  for (const docConfig of AUDIT_DOCS) {
    console.log(`\n########################################################################`);
    console.log(`DOC: ${docConfig.name} [${docConfig.id}]`);
    console.log(`########################################################################`);

    const tStart = performance.now();
    const ocrData = await db.getDocumentOcrResult(docConfig.userId, docConfig.id);
    const dbTime = (performance.now() - tStart).toFixed(1);

    if (!ocrData || !ocrData.tables) {
      console.log(`  ERROR: No OCR table data found!`);
      continue;
    }

    const tProj = performance.now();
    const unified = UnifiedTableService.projectDocumentTables(docConfig.id, ocrData.tables);
    const projTime = (performance.now() - tProj).toFixed(1);

    if (!unified) {
      console.log(`  ERROR: Unified projection returned null!`);
      continue;
    }

    console.log(`  Pages: ${ocrData.pages?.length || 0} | Tables: ${ocrData.tables?.length || 0} | Unified Rows: ${unified.rowCount}`);
    console.log(`  Columns (${unified.columns.length}):`);
    unified.columns.forEach((c, idx) => console.log(`    [${idx}] "${c.header}" -> ${c.semanticType}`));

    // Analyze Dominant Money Format per money column
    const dominantFormats: Record<number, string> = {};
    unified.columns.forEach((col, cIdx) => {
      if (['DEBIT', 'CREDIT', 'BALANCE'].includes(col.semanticType)) {
        const vals = unified.rows.map(r => r.cells[cIdx]?.rawValue || '').filter(Boolean);
        const analysis = analyzeDominantMoneyFormat(vals);
        dominantFormats[cIdx] = analysis.dominantStyle;
        console.log(`  Money Col [${col.header}] (${col.semanticType}): Dominant=${analysis.dominantStyle} (comma=${analysis.countCommaThousands}, dot=${analysis.countDotThousands}, plain=${analysis.countPlain}, total=${analysis.totalValid})`);
      }
    });

    // Count physical cells & inspect anomalies
    let totalPhysicalCells = 0;
    let highConfCells = 0; // >= 0.90
    let medConfCells = 0;  // 0.70 - 0.89
    let lowConfCells = 0;  // < 0.70
    let suspiciousHighConfCells = 0;
    let moneyAnomalies = 0;
    let dateAnomalies = 0;
    let sttAnomalies = 0;
    let refAnomalies = 0;
    let falsePositiveCandidates = 0;

    const anomalies: AnomalyReport[] = [];
    const tEvalStart = performance.now();

    unified.rows.forEach((r, rIdx) => {
      r.cells.forEach((c, cIdx) => {
        if (!c.isPlaceholder && c.id) {
          totalPhysicalCells++;
          if (c.confidence >= 0.90) highConfCells++;
          else if (c.confidence >= 0.70) medConfCells++;
          else lowConfCells++;

          const col = unified.columns[cIdx];
          const domStyle = dominantFormats[cIdx] || 'UNKNOWN';
          const report = evaluateCellAnomaly(c, col.semanticType, domStyle, r.sourcePage, rIdx, cIdx, col.header);

          if (report) {
            anomalies.push(report);
            if (c.confidence >= 0.90) suspiciousHighConfCells++;

            if (['DEBIT', 'CREDIT', 'BALANCE'].includes(col.semanticType)) moneyAnomalies++;
            else if (['DATE', 'VALUE_DATE'].includes(col.semanticType)) dateAnomalies++;
            else if (col.semanticType === 'STT') sttAnomalies++;
            else if (col.semanticType === 'REFERENCE') refAnomalies++;
          }
        }
      });
    });

    const evalDuration = (performance.now() - tEvalStart).toFixed(2);
    console.log(`\n  Quality Evaluation Duration: ${evalDuration} ms for ${totalPhysicalCells} physical cells`);
    console.log(`  Physical Cells: ${totalPhysicalCells} (High >=90%: ${highConfCells}, Med: ${medConfCells}, Low: ${lowConfCells})`);
    console.log(`  Flagged Anomalies: ${anomalies.length} (High-conf suspicious: ${suspiciousHighConfCells})`);
    console.log(`    Money anomalies: ${moneyAnomalies}`);
    console.log(`    Date anomalies: ${dateAnomalies}`);
    console.log(`    STT anomalies: ${sttAnomalies}`);
    console.log(`    Ref anomalies: ${refAnomalies}`);

    console.log(`\n  --- Specific Flagged Cells (Sample up to 15) ---`);
    anomalies.slice(0, 15).forEach((a, aIdx) => {
      console.log(`    #${aIdx + 1} [P${a.sourcePage} R${a.rowIdx} C${a.colIdx}] [${a.colHeader}] (${a.semanticType}):`);
      console.log(`       Val: "${a.rawValue}" | Conf: ${a.confidence} | Severity: ${a.proposedSeverity} | Reasons: [${a.reasons.join(', ')}]`);
      console.log(`       Cell ID: ${a.cellId} | Has Polygon: ${Boolean(a.polygon)}`);
    });

    summaryMatrix.push({
      key: docConfig.key,
      name: docConfig.name,
      totalCells: totalPhysicalCells,
      highConf: highConfCells,
      suspiciousHighConf: suspiciousHighConfCells,
      moneyAnomalies,
      dateAnomalies,
      refAnomalies,
      totalRecommendedReview: anomalies.length,
      evalTimeMs: evalDuration,
    });
  }

  console.log('\n\n========================================================================');
  console.log('REGRESSION MATRIX SUMMARY');
  console.log('========================================================================');
  console.table(summaryMatrix);
}

runAudit().catch(console.error);
