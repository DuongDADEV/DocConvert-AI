import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService, UnifiedTableCell } from '../server/services/unifiedTableService.js';

const AUDIT_DOCS = [
  { key: 'DOC_1_PROBLEM_STAMP', name: 'Nam A (Problematic Stamp / Chị Lan)', id: 'fa982b65-94e8-4a21-9c74-e28ace4bad85', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { key: 'DOC_2_HDBANK_REGRESSION', name: 'HDBank (Recent Upload)', id: '93c5f47f-659f-4e5f-be03-fd0ad073ab88', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { key: 'DOC_3_ACB_MEDIHUB', name: 'ACB Medihub', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  { key: 'DOC_4_NAM_A_CLEAN', name: 'Nam A Bank (Base Clean)', id: '82537093-4f56-4328-962d-de5237e7a9eb', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { key: 'DOC_5_BAN_VIET', name: 'Ban Viet Bank', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
];

export type MoneyFormatStyle = 
  | 'COMMA_THOUSANDS_INT'        // 1,234,567
  | 'COMMA_THOUSANDS_DEC_DOT'    // 1,234,567.89
  | 'DOT_THOUSANDS_DEC_COMMA'    // 1.234.567,89
  | 'DOT_THOUSANDS_INT'          // 1.234.567
  | 'PLAIN_NUMBER'               // 1234567 or 0
  | 'UNKNOWN';

export function classifyNumberFormat(val: string): MoneyFormatStyle {
  const s = val.trim();
  if (!s || s === '-' || s === '—' || s === '0' || s === '0,00' || s === '0.00') return 'PLAIN_NUMBER';
  // Comma thousands integer: 1,234,567
  if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return 'COMMA_THOUSANDS_INT';
  // Comma thousands decimal dot: 1,234,567.89
  if (/^-?\d{1,3}(,\d{3})+\.\d{2}$/.test(s)) return 'COMMA_THOUSANDS_DEC_DOT';
  // Dot thousands decimal comma: 1.234.567,89
  if (/^-?\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) return 'DOT_THOUSANDS_DEC_COMMA';
  // Dot thousands integer: 1.234.567
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return 'DOT_THOUSANDS_INT';
  // Plain integer or decimal: 12345
  if (/^-?\d+(\.\d+)?$/.test(s) || /^-?\d+(,\d+)?$/.test(s)) return 'PLAIN_NUMBER';
  return 'UNKNOWN';
}

function getDominantMoneyStyle(vals: string[]): { style: MoneyFormatStyle; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const v of vals) {
    const st = classifyNumberFormat(v);
    if (st !== 'PLAIN_NUMBER' && st !== 'UNKNOWN') {
      counts[st] = (counts[st] || 0) + 1;
    }
  }
  let bestStyle: MoneyFormatStyle = 'UNKNOWN';
  let bestCount = 0;
  for (const [st, cnt] of Object.entries(counts)) {
    if (cnt > bestCount) {
      bestCount = cnt;
      bestStyle = st as MoneyFormatStyle;
    }
  }
  return { style: bestStyle, counts };
}

// Check date formats: allow DD/MM/YYYY, DD-MM-YYYY, DD/MM, DD-MM
export function isValidDateFormat(s: string): boolean {
  const trimmed = s.trim();
  // Full dates: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(trimmed)) {
    const parts = trimmed.split(/[\/\-\.]/).map(Number);
    const [d, m] = parts;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
  }
  // Short dates: DD/MM or DD-MM (like ACB)
  if (/^\d{1,2}[\/\-\.]\d{1,2}$/.test(trimmed)) {
    const parts = trimmed.split(/[\/\-\.]/).map(Number);
    const [d, m] = parts;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
  }
  return false;
}

async function testAuditor() {
  console.log('=== RUNNING REFINED AUDITOR ===\n');

  for (const doc of AUDIT_DOCS) {
    const ocrData = await db.getDocumentOcrResult(doc.userId, doc.id);
    const unified = UnifiedTableService.projectDocumentTables(doc.id, ocrData.tables);
    console.log(`\n======================================================`);
    console.log(`[${doc.name}] ID: ${doc.id}`);
    console.log(`Rows: ${unified.rows.length}, Columns: ${unified.columns.length}`);

    // Analyze money columns
    const colStyles: Record<number, MoneyFormatStyle> = {};
    unified.columns.forEach((col, cIdx) => {
      if (['DEBIT', 'CREDIT', 'BALANCE'].includes(col.semanticType)) {
        // Exclude GDV column in Ban Viet if it's teller code!
        if (col.header.toLowerCase().includes('gdv') || col.header.toLowerCase().includes('teller')) {
          console.log(`  Col ${cIdx} [${col.header}] is TELLER CODE despite semanticType BALANCE`);
          return;
        }
        const vals = unified.rows.map(r => r.cells[cIdx]?.rawValue || '').filter(Boolean);
        const { style, counts } = getDominantMoneyStyle(vals);
        colStyles[cIdx] = style;
        console.log(`  Col ${cIdx} [${col.header}] (${col.semanticType}): Dominant Style = ${style}`, counts);
      }
    });

    // Check cells
    let flaggedCount = 0;
    unified.rows.forEach((r, rIdx) => {
      r.cells.forEach((c, cIdx) => {
        if (!c.isPlaceholder && c.id && c.rawValue) {
          const col = unified.columns[cIdx];
          const raw = c.rawValue.trim();
          const domStyle = colStyles[cIdx];

          // Check Money
          if (['DEBIT', 'CREDIT', 'BALANCE'].includes(col.semanticType) && !col.header.toLowerCase().includes('gdv')) {
            if (raw !== '-' && raw !== '—' && raw !== '0' && raw !== '0,00' && raw !== '0.00' && raw !== '') {
              const cellStyle = classifyNumberFormat(raw);
              const reasons: string[] = [];

              // Alpha in money
              if (/[A-Za-zÀ-ỹ]/.test(raw)) {
                reasons.push('ALPHA_IN_MONEY');
              }
              // Trailing separator
              if (/[,.]$/.test(raw)) {
                reasons.push('TRAILING_SEPARATOR');
              }
              // Format outlier: dominant is comma integer, but cell has dot or vice versa
              if (domStyle === 'COMMA_THOUSANDS_INT' && cellStyle === 'DOT_THOUSANDS_INT') {
                reasons.push('FORMAT_OUTLIER_DOT_INSTEAD_OF_COMMA');
              } else if (domStyle === 'DOT_THOUSANDS_DEC_COMMA' && (cellStyle === 'COMMA_THOUSANDS_INT' || cellStyle === 'COMMA_THOUSANDS_DEC_DOT')) {
                reasons.push('FORMAT_OUTLIER_COMMA_INSTEAD_OF_DOT');
              }

              if (reasons.length > 0) {
                flaggedCount++;
                console.log(`    FLAGGED MONEY [P${r.sourcePage} R${rIdx} C${cIdx}] "${col.header}": "${raw}" (conf: ${c.confidence}) -> [${reasons.join(', ')}] (cellId: ${c.id})`);
              }
            }
          }

          // Check Date
          if (['DATE', 'VALUE_DATE'].includes(col.semanticType)) {
            if (!isValidDateFormat(raw)) {
              flaggedCount++;
              console.log(`    FLAGGED DATE [P${r.sourcePage} R${rIdx} C${cIdx}] "${col.header}": "${raw}" (conf: ${c.confidence}) (cellId: ${c.id})`);
            }
          }
        }
      });
    });

    console.log(`Total Flagged in ${doc.name}: ${flaggedCount}`);
  }
}

testAuditor().catch(console.error);
