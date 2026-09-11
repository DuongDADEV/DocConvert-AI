import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function diagnoseDoc(label: string, docId: string, userId: string) {
  console.log(`\n===============================================================`);
  console.log(`DIAGNOSTIC FOR [${label}] (ID: ${docId})`);
  console.log(`===============================================================`);

  const ocrData = await db.getDocumentOcrResult(userId, docId);
  if (!ocrData) {
    console.error('No OCR data returned from getDocumentOcrResult');
    return;
  }

  console.log(`Pages: ${ocrData.pages?.length || 0}`);
  console.log(`Physical Tables: ${ocrData.tables?.length || 0}`);
  console.log(`Document Metadata count: ${ocrData.documentMetadata?.length || 0}`);

  ocrData.tables.forEach((t: any, idx: number) => {
    console.log(`  Table #${idx} (p${t.pageNumber}): rows=${t.rowCount}, cols=${t.columnCount}, conf=${t.confidence}, headers=[${t.headers?.slice(0, 3).join(' | ')}...]`);
  });

  const unified = UnifiedTableService.projectDocumentTables(docId, ocrData.tables);
  if (!unified) {
    console.log('Unified table: null');
    return;
  }

  console.log('Unified Result:');
  console.log(`  Canonical Columns (${unified.columns.length}): [${unified.columns.map(c => c.header).join(' | ')}]`);
  console.log(`  Unified Rows: ${unified.rows.length}`);
  console.log(`  Summary Rows: ${unified.summaryRows.length}`);
  if (unified.rows.length > 0) {
    const r0 = unified.rows[0];
    console.log(`  Row 0 sample: sourcePage=${r0.sourcePage}, cellCount=${r0.cells.length}`);
    const firstCell = r0.cells[0];
    console.log(`    Cell 0: idPresent=${Boolean(firstCell.id)}, canColIdx=${firstCell.canonicalColumnIndex}, isReviewed=${firstCell.isReviewed}, conf=${firstCell.confidence}`);
  }
}

async function main() {
  await diagnoseDoc('NEW HDBank (user report)', '93c5f47f-659f-4e5f-be03-fd0ad073ab88', '27a10269-da23-4bfd-aa19-5ed66b974eff');
  await diagnoseDoc('PREVIOUS HDBank (2ab5ff2f)', '2ab5ff2f-0891-4d5f-9f90-b787ede1dea6', '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c');
  await diagnoseDoc('OLD HDBank (80636c44)', '80636c44-d41c-4a62-a502-a198d9d4fde3', '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c');
  await diagnoseDoc('ACB Medihub', 'b55bb467-20ae-4939-b1c8-c28e0895854b', '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c');
  await diagnoseDoc('Nam A Bank', '82537093-4f56-4328-962d-de5237e7a9eb', '27a10269-da23-4bfd-aa19-5ed66b974eff');
  await diagnoseDoc('Ban Viet Bank', 'ffec64e8-f5d8-4e2d-929b-124882b3e099', '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c');
}

main().catch(console.error);

