import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function inspectBanViet() {
  console.log('=== INSPECTING BAN VIET BANK ===');
  const ocr5 = await db.getDocumentOcrResult('30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c', 'ffec64e8-f5d8-4e2d-929b-124882b3e099');
  const u5 = UnifiedTableService.projectDocumentTables('ffec64e8-f5d8-4e2d-929b-124882b3e099', ocr5.tables);
  console.log('Ban Viet Columns:', u5.columns.map((c, i) => `[${i}] "${c.header}" (${c.semanticType})`));
  console.log('Sample rows:');
  u5.rows.slice(0, 5).forEach((r, idx) => {
    console.log(`Row ${idx}:`);
    r.cells.forEach((c, cIdx) => {
      console.log(`  Col ${cIdx} [${u5.columns[cIdx].header}]: "${c.rawValue}" (conf: ${c.confidence})`);
    });
  });
}
inspectBanViet().catch(console.error);
