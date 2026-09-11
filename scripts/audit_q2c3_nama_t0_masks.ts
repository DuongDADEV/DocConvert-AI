import fs from 'fs';

async function main() {
  const data = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));
  const t0 = data.tables[0];
  const refCells = t0.cells.filter((c: any) => c.columnIndex === 3 && c.rowIndex > 0);
  console.log(`Found ${refCells.length} reference cells in Table 0:`);
  
  const values = refCells.map((c: any) => c.content?.trim()).filter(Boolean);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const mask = v.split('').map((ch: string) => /\d/.test(ch) ? 'D' : (/[a-zA-Z]/.test(ch) ? 'L' : 'P')).join('');
    console.log(`${String(i+1).padStart(2)}. ${v} -> ${mask} (len ${v.length})`);
  }
}

main().catch(console.error);
