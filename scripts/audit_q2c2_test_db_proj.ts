import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function test() {
  const docs = [
    { name: 'Fresh Nam A', id: '70ec6614-ccdd-4326-b566-971a629e239c', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
    { name: 'Fresh HDBank', id: 'd79873be-7dd7-4441-8c63-68c6077adfd0', userId: 'test' },
    { name: 'Nam A Problematic', id: 'fa982b65-94e8-4a21-9c74-e28ace4bad85', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
    { name: 'ACB Medihub', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
    { name: 'Ban Viet', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  ];

  for (const d of docs) {
    const ocr = await db.getDocumentOcrResult(d.userId, d.id);
    console.log(`\nDoc ${d.name} (${d.id}): tables in ocr = ${ocr?.tables?.length}`);
    const unified = UnifiedTableService.projectDocumentTables(d.id, ocr?.tables || []);
    console.log(`  Unified: ${unified ? `rows=${unified.rows?.length}, cols=${unified.columns?.length}` : 'NULL'}`);
  }
}

test().catch(console.error);
