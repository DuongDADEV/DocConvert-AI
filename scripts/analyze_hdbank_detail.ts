import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));

console.log('=== TABLES DETAIL ===');
data.tables.forEach((t: any, i: number) => {
  const br = t.boundingRegions?.[0];
  const pageHeight = data.pages.find((p: any) => p.pageNumber === br?.pageNumber)?.height || 11.69;
  const ys = [br?.polygon[1], br?.polygon[3], br?.polygon[5], br?.polygon[7]];
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  console.log(`Table ${i}: page=${br?.pageNumber}, rows=${t.rowCount}, cols=${t.columnCount}, minY=${minY.toFixed(3)}, maxY=${maxY.toFixed(3)}, normTop=${(minY/pageHeight).toFixed(3)}`);
});

console.log('\n=== KEY VALUE PAIRS DETAIL ===');
data.keyValuePairs.forEach((kv: any, i: number) => {
  const k = kv.key?.content;
  const v = kv.value?.content;
  const kBr = kv.key?.boundingRegions?.[0];
  const vBr = kv.value?.boundingRegions?.[0];
  const page = vBr?.pageNumber || kBr?.pageNumber;
  const pageHeight = data.pages.find((p: any) => p.pageNumber === page)?.height || 11.69;
  const ys = kBr ? [kBr.polygon[1], kBr.polygon[3], kBr.polygon[5], kBr.polygon[7]] : [];
  const minY = ys.length ? Math.min(...ys) : 0;
  console.log(`KV[${i}] (p${page}, conf=${kv.confidence}, normTop=${(minY/pageHeight).toFixed(3)}): [${k}] => [${v}]`);
});
