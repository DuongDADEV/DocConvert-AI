import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));

[0, 3].forEach(idx => {
  const t = data.tables[idx];
  console.log(`\n=== TABLE ${idx} (page ${t.boundingRegions?.[0]?.pageNumber}) ===`);
  t.cells.forEach((c: any) => {
    console.log(`  Row ${c.rowIndex}, Col ${c.columnIndex}: "${c.content}"`);
  });
});
