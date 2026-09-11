import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function inspectDocDetails() {
  // 1. DOC_1 Nam A Problematic
  console.log('=== INSPECTING DOC_1: Nam A (Problematic Stamp / Chị Lan) ===');
  const ocr1 = await db.getDocumentOcrResult('27a10269-da23-4bfd-aa19-5ed66b974eff', 'fa982b65-94e8-4a21-9c74-e28ace4bad85');
  const u1 = UnifiedTableService.projectDocumentTables('fa982b65-94e8-4a21-9c74-e28ace4bad85', ocr1.tables);
  u1.rows.forEach((r, rIdx) => {
    r.cells.forEach((c, cIdx) => {
      const col = u1.columns[cIdx];
      const val = c.rawValue || '';
      if (val.includes('95,909') || val.includes('94.709') || val.includes('50,000') || val.includes('50,039') || val.includes('ICH')) {
        console.log(`[P${r.sourcePage} Row ${rIdx} Col ${cIdx} "${col.header}" (${col.semanticType})]:`);
        console.log(`   rawValue: "${val}" | conf: ${c.confidence} | id: ${c.id}`);
      }
    });
  });

  // 2. ACB Medihub Dates
  console.log('\n=== INSPECTING ACB Medihub DATE format ===');
  const ocr3 = await db.getDocumentOcrResult('30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c', 'b55bb467-20ae-4939-b1c8-c28e0895854b');
  const u3 = UnifiedTableService.projectDocumentTables('b55bb467-20ae-4939-b1c8-c28e0895854b', ocr3.tables);
  console.log('ACB Columns:', u3.columns.map((c, i) => `[${i}] "${c.header}" (${c.semanticType})`));
  console.log('Sample first 10 rows date column:');
  u3.rows.slice(0, 10).forEach((r, idx) => {
    console.log(`  Row ${idx}: date="${r.cells[0]?.rawValue}" (conf: ${r.cells[0]?.confidence})`);
  });
}

inspectDocDetails().catch(console.error);
