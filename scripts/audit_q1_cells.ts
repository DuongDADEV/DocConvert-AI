import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

const TEST_DOCS = [
  { bank: 'NEW HDBank (user report)', id: '93c5f47f-659f-4e5f-be03-fd0ad073ab88', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { bank: 'OLD HDBank (80636c44)', id: '80636c44-d41c-4a62-a502-a198d9d4fde3', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  { bank: 'ACB Medihub', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  { bank: 'Nam A Bank', id: '82537093-4f56-4328-962d-de5237e7a9eb', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { bank: 'Ban Viet Bank', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
];

async function main() {
  console.log('=== SEARCHING CELLS ACROSS REAL DOCUMENTS ===\n');

  for (const doc of TEST_DOCS) {
    const ocrData = await db.getDocumentOcrResult(doc.userId, doc.id);
    if (!ocrData) {
      console.log(`Doc [${doc.bank}] ${doc.id} - NO DATA`);
      continue;
    }
    const unified = UnifiedTableService.projectDocumentTables(doc.id, ocrData.tables);
    console.log(`\n>>> DOC: [${doc.bank}] (ID: ${doc.id})`);
    console.log(`Canonical columns (${unified?.columns.length}):`);
    unified?.columns.forEach((c, idx) => console.log(`  [${idx}] "${c.header}" (semantic: ${c.semanticType})`));

    // Search for suspicious cells or target strings in unified table
    for (const r of unified?.rows || []) {
      for (const cell of r.cells) {
        const val = cell.rawValue || '';
        if (
          val.includes('50,000') ||
          val.includes('94.709') ||
          val.includes('95,909') ||
          val.includes('50,039') ||
          val.toLowerCase().includes('ich') ||
          val.includes('Lo') ||
          /[,.][A-Za-z]/.test(val) ||
          /[A-Za-z][,.0-9]+[A-Za-z]/.test(val)
        ) {
          const col = unified?.columns[cell.canonicalColumnIndex];
          console.log(`  MATCH: Page ${r.sourcePage} Col [${col?.header}] (semantic: ${col?.semanticType})`);
          console.log(`    rawValue: "${val}" | norm: "${cell.normalizedValue}" | conf: ${cell.confidence} | isRev: ${cell.isReviewed} | cellId: ${cell.id}`);
        }
      }
    }
  }
}

main().catch(console.error);
