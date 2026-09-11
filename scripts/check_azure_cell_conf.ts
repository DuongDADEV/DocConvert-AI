import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));

let totalCells = 0;
let cellsWithConfidence = 0;
let cellsWithoutConfidence = 0;

data.tables.forEach((t: any, tIdx: number) => {
  t.cells.forEach((c: any) => {
    totalCells++;
    if (typeof c.confidence === 'number') {
      cellsWithConfidence++;
    } else {
      cellsWithoutConfidence++;
    }
  });
});

console.log(`=== HDBANK RAW AZURE RESPONSE (apiVersion: ${data.apiVersion}, modelId: ${data.modelId}) ===`);
console.log(`Total Tables: ${data.tables.length}`);
console.log(`Total Table Cells: ${totalCells}`);
console.log(`Cells WITH c.confidence: ${cellsWithConfidence}`);
console.log(`Cells WITHOUT c.confidence: ${cellsWithoutConfidence}`);
console.log(`Sample cell keys:`, Object.keys(data.tables[0].cells[0]));
