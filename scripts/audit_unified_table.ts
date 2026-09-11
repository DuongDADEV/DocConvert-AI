import 'dotenv/config';
import { db } from '../server/db/db.js';

interface RegressionDoc {
  name: string;
  id: string;
  userId: string;
}

async function auditRealData() {
  const docs: RegressionDoc[] = [
    { name: 'HDBank (2 pages)', id: '80636c44-d41c-4a62-a502-a198d9d4fde3', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
    { name: 'ACB Medihub (8 pages)', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
    { name: 'Nam A Bank (4 pages)', id: '82537093-4f56-4328-962d-de5237e7a9eb', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
    { name: 'Ban Viet Bank (4 pages)', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  ];

  console.log('================================================================');
  console.log('UNIFIED TRANSACTION TABLE — REAL-DATA AUDIT');
  console.log('================================================================\n');

  for (const doc of docs) {
    console.log(`\n================================================================`);
    console.log(`DOCUMENT: ${doc.name}`);
    console.log(`ID: ${doc.id} | User: ${doc.userId}`);
    console.log(`================================================================`);

    const ocrData = await db.getDocumentOcrResult(doc.userId, doc.id);
    if (!ocrData) {
      console.log('No OCR data returned from DB.');
      continue;
    }

    const docRecord = await db.getUserDocumentById(doc.userId, doc.id);
    console.log(`Page Count in Document Record: ${docRecord?.page_count}`);
    console.log(`Total Extracted Tables: ${ocrData.tables?.length || 0}`);
    console.log(`Total Metadata Items: ${ocrData.documentMetadata?.length || 0}`);

    const tables = ocrData.tables || [];

    tables.forEach((t: any, idx: number) => {
      console.log(`\n------------------------------------------------`);
      console.log(`Physical Table #${idx + 1} (index: ${t.tableIndex}, id: ${t.id})`);
      console.log(`  Page Number: ${t.pageNumber}`);
      console.log(`  Row Count: ${t.rows?.length || 0} | Column Count: ${t.columnCount || 0}`);
      console.log(`  Headers (${t.headers?.length || 0}):`, JSON.stringify(t.headers));

      // Sample first 2 rows
      const dataRows = (t.rows || []).filter((r: any) => !r.isHeader);
      console.log(`  Data Rows Count: ${dataRows.length}`);
      if (dataRows.length > 0) {
        console.log(`  First Row Sample:`);
        const r0 = dataRows[0];
        console.log(`    Row Index: ${r0.rowIndex}, id: ${r0.id}`);
        const cellVals = (r0.cells || []).map((c: any) => `[col${c.columnIndex}] "${c.rawValue}" (conf: ${c.confidence}, poly: ${c.boundingPolygon?.length ? 'yes' : 'no'})`);
        console.log(`    Cells:`, cellVals.slice(0, 5).join(' | '), cellVals.length > 5 ? `... (${cellVals.length} total)` : '');
      }
      if (dataRows.length > 1) {
        const rLast = dataRows[dataRows.length - 1];
        console.log(`  Last Row Sample:`);
        const cellVals = (rLast.cells || []).map((c: any) => `[col${c.columnIndex}] "${c.rawValue}"`);
        console.log(`    Cells:`, cellVals.slice(0, 5).join(' | '));
      }
    });
  }
}

auditRealData().catch(console.error);
