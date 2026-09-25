import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function runRegression() {
  console.log('=== REGRESSION VALIDATION FOR 4 DOCUMENTS ===\n');

  const targets = [
    {
      name: 'Bản Việt',
      docId: 'ffec64e8-f5d8-4e2d-929b-124882b3e099',
      userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c',
      expectedRows: 46,
    },
    {
      name: 'Nam Á',
      docId: '70ec6614-ccdd-4326-b566-971a629e239c',
      userId: '27a10269-da23-4bfd-aa19-5ed66b974eff',
      expectedRows: 55,
    },
    {
      name: 'HDBank',
      docId: 'd79873be-7dd7-4441-8c63-68c6077adfd0',
      userId: '27a10269-da23-4bfd-aa19-5ed66b974eff',
      expectedRows: 46,
    },
    {
      name: 'ACB Medihub',
      docId: 'b55bb467-20ae-4939-b1c8-c28e0895854b',
      userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c',
      expectedRows: 184,
    },
  ];

  let allPassed = true;

  for (const t of targets) {
    console.log(`--------------------------------------------------`);
    console.log(`Document: ${t.name} (${t.docId})`);
    const ocr = await db.getDocumentOcrResult(t.userId, t.docId);
    if (!ocr) {
      console.error(`❌ OCR result not found for ${t.name}!`);
      allPassed = false;
      continue;
    }

    // 1. Transaction rows check
    const u = UnifiedTableService.projectDocumentTables(t.docId, ocr.tables);
    const actualRows = u.rows.length;
    const rowsMatch = actualRows === t.expectedRows;
    if (rowsMatch) {
      console.log(`✅ Transaction Rows: ${actualRows} (expected: ${t.expectedRows})`);
    } else {
      console.error(`❌ Transaction Rows Mismatch: actual ${actualRows} vs expected ${t.expectedRows}`);
      allPassed = false;
    }

    // 2. Metadata check
    const meta = ocr.documentMetadata || [];
    const core = meta.filter((m: any) => m.visibilityClass === 'CORE');
    const additional = meta.filter((m: any) => m.visibilityClass === 'ADDITIONAL');
    const conflicts = meta.filter((m: any) => m.status === 'CONFLICT');

    console.log(`   Metadata Items: Total=${meta.length}, CORE=${core.length}, ADDITIONAL=${additional.length}, CONFLICTS=${conflicts.length}`);
    console.log(`   CORE Fields:`, core.map((c: any) => `[${c.semanticType}: "${c.value}"]`).join(', '));
    if (conflicts.length > 0) {
      console.log(`   CONFLICT Fields:`, conflicts.map((c: any) => `[${c.semanticType}: "${c.value}"]`).join(', '));
    }
  }

  console.log(`\n==================================================`);
  if (allPassed) {
    console.log(`ALL 4 DOCUMENTS PASSED REGRESSION CHECKS CLEANLY!`);
  } else {
    console.error(`REGRESSION CHECKS FAILED!`);
    throw new Error('Regression checks failed');
  }
}

runRegression().catch(console.error);
