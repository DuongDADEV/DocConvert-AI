import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));

console.log('=== PAGES INFO ===');
data.pages.forEach((p: any) => {
  console.log(`Page ${p.pageNumber}: width=${p.width}, height=${p.height}, unit=${p.unit}, lines=${p.lines.length}`);
});

console.log('\n=== TABLES INFO ===');
data.tables.forEach((t: any, i: number) => {
  const br = t.boundingRegions?.[0];
  console.log(`Table ${i}: page=${br?.pageNumber}, rows=${t.rowCount}, cols=${t.columnCount}, poly=${JSON.stringify(br?.polygon)}`);
});

console.log('\n=== KEY VALUE PAIRS ===');
data.keyValuePairs.forEach((kv: any, i: number) => {
  const k = kv.key?.content;
  const v = kv.value?.content;
  const page = kv.value?.boundingRegions?.[0]?.pageNumber || kv.key?.boundingRegions?.[0]?.pageNumber;
  const kPoly = kv.key?.boundingRegions?.[0]?.polygon;
  const vPoly = kv.value?.boundingRegions?.[0]?.polygon;
  console.log(`KV[${i}] (p${page}, conf=${kv.confidence}): [${k}] => [${v}]`);
});

console.log('\n=== PAGE 1 LINES (Normalized Y <= 0.35) ===');
const p1 = data.pages[0];
const h1 = p1.height;
p1.lines.forEach((l: any, i: number) => {
  const ys = [l.polygon[1], l.polygon[3], l.polygon[5], l.polygon[7]];
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const normTop = minY / h1;
  const normBottom = maxY / h1;
  if (normBottom <= 0.35) {
    console.log(`L[${i}] (normTop=${normTop.toFixed(3)}, normBot=${normBottom.toFixed(3)}): "${l.content}"`);
  }
});

console.log('\n=== PAGE 2 LINES (Normalized Y <= 0.35) ===');
const p2 = data.pages[1];
const h2 = p2.height;
p2.lines.forEach((l: any, i: number) => {
  const ys = [l.polygon[1], l.polygon[3], l.polygon[5], l.polygon[7]];
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const normTop = minY / h2;
  const normBottom = maxY / h2;
  if (normBottom <= 0.35) {
    console.log(`L[${i}] (normTop=${normTop.toFixed(3)}, normBot=${normBottom.toFixed(3)}): "${l.content}"`);
  }
});
