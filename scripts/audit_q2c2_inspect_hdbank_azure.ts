import fs from 'fs';

async function main() {
  const data = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));
  console.log('HDBank raw Azure:');
  console.log('Pages count:', data.pages?.length);
  console.log('Tables count:', data.tables?.length);
  for (let i = 0; i < (data.tables?.length || 0); i++) {
    const t = data.tables[i];
    console.log(`Table ${i}: ${t.rowCount} rows, ${t.columnCount} cols, ${t.cells?.length} cells, page:`, t.boundingRegions?.[0]?.pageNumber);
  }
}

main().catch(console.error);
