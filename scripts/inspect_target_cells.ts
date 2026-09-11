import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function inspectDoc(name: string, userId: string, docId: string) {
  console.log(`\n=================== ${name} (${docId}) ===================`);
  const ocrData = await db.getDocumentOcrResult(userId, docId);
  if (!ocrData) {
    console.log('No data');
    return;
  }
  const unified = UnifiedTableService.projectDocumentTables(docId, ocrData.tables);
  if (!unified) {
    console.log('No unified table');
    return;
  }
  console.log('Columns:');
  unified.columns.forEach((c, idx) => console.log(`  [${idx}] "${c.header}" (type: ${c.semanticType})`));

  console.log(`\nTotal rows: ${unified.rows.length}`);
  unified.rows.forEach((r, rIdx) => {
    const rowCells = r.cells.map((c, cIdx) => {
      const col = unified.columns[cIdx];
      return `[${col.semanticType}]: "${c.rawValue}" (conf: ${c.confidence})`;
    });
    // Check if row contains any of the target numbers or interesting text
    const text = r.cells.map(c => c.rawValue || '').join(' ');
    if (
      text.includes('95,909') ||
      text.includes('94.709') ||
      text.includes('94,709') ||
      text.includes('50,000') ||
      text.includes('50,039') ||
      text.includes('ICH') ||
      text.includes('Lo') ||
      text.includes('A') ||
      rIdx < 10
    ) {
      console.log(`Row ${rIdx} (Page ${r.sourcePage}):`);
      r.cells.forEach((c, cIdx) => {
        const col = unified.columns[cIdx];
        console.log(`    Col ${cIdx} [${col.header}] (${col.semanticType}): "${c.rawValue}" | conf=${c.confidence}`);
      });
    }
  });
}

async function run() {
  await inspectDoc('NEW HDBank', '27a10269-da23-4bfd-aa19-5ed66b974eff', '93c5f47f-659f-4e5f-be03-fd0ad073ab88');
  await inspectDoc('Nam A Bank', '27a10269-da23-4bfd-aa19-5ed66b974eff', '82537093-4f56-4328-962d-de5237e7a9eb');
}

run().catch(console.error);
