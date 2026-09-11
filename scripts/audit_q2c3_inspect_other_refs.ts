import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function main() {
  const docs = [
    { name: 'HDBank Fresh', id: 'd79873be-7dd7-4441-8c63-68c6077adfd0', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
    { name: 'ACB Medihub', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
    { name: 'Ban Viet', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  ];

  for (const d of docs) {
    const ocr = await db.getDocumentOcrResult(d.userId, d.id);
    const unified = UnifiedTableService.projectDocumentTables(d.id, ocr?.tables || []);
    console.log(`\n==================================================`);
    console.log(`=== ${d.name} ===`);
    if (!unified) {
      console.log('Unified is null');
      continue;
    }
    console.log(`Columns:`, unified.columns.map((c, idx) => `[${idx}] "${c.header}" (${c.semanticType})`));

    // Find reference or candidate reference columns
    unified.columns.forEach((col, cIdx) => {
      const h = col.header.toLowerCase();
      if (col.semanticType === 'REFERENCE' || h.includes('ref') || h.includes('so gd') || h.includes('chung tu') || h.includes('mgd') || h.includes('doc no')) {
        const vals = unified.rows.map(r => r.cells[cIdx]?.rawValue?.trim()).filter(Boolean);
        console.log(`\nRef Column [${cIdx}] "${col.header}" (${col.semanticType}): ${vals.length} values`);
        console.log('Sample first 15 values:');
        vals.slice(0, 15).forEach((v, i) => {
          const mask = v!.split('').map((ch: string) => /\d/.test(ch) ? 'D' : (/[a-zA-Z]/.test(ch) ? 'L' : 'P')).join('');
          console.log(`  ${String(i+1).padStart(2)}. ${v} -> ${mask} (len ${v!.length})`);
        });
      }
    });
  }
}

main().catch(console.error);
