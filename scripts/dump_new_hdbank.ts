import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function checkHDBank() {
  const docId = '93c5f47f-659f-4e5f-be03-fd0ad073ab88';
  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';
  const ocrData = await db.getDocumentOcrResult(userId, docId);
  const unified = UnifiedTableService.projectDocumentTables(docId, ocrData.tables);
  console.log(`Columns (${unified.columns.length}):`, unified.columns.map(c => `[${c.semanticType}] ${c.header}`));
  unified.rows.forEach((r, idx) => {
    console.log(`Row ${idx} (p${r.sourcePage}):`);
    r.cells.forEach((c, cIdx) => {
      const col = unified.columns[cIdx];
      console.log(`  Col ${cIdx} [${col.header}] (${col.semanticType}): "${c.rawValue}" (conf: ${c.confidence})`);
    });
  });
}
checkHDBank().catch(console.error);
