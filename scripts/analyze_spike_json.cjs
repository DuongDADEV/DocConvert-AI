const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'scratch', 'azure_kv_spike_results.json');
if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

const chunks = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

console.log('--- CHUNK SUMMARY ---');
chunks.forEach((c) => {
  console.log(`Chunk ${c.chunkIndex + 1} (Orig Pages ${c.originalStartPage}-${c.originalEndPage}): ${c.keyValuePairs.length} KV pairs`);
});

const kvMap = new Map();
let totalKv = 0;
let missingValueCount = 0;

chunks.forEach((c) => {
  const pageOffset = c.pageOffset;
  c.keyValuePairs.forEach((kv) => {
    totalKv++;
    const rawKey = kv.key?.content?.trim() || '';
    const rawVal = kv.value?.content?.trim() || '';
    if (!rawVal) missingValueCount++;

    const keyPage = kv.key?.boundingRegions?.[0]?.pageNumber || 1;
    const valPage = kv.value?.boundingRegions?.[0]?.pageNumber || keyPage;
    const globalPage = pageOffset + valPage;

    const normKey = rawKey.toLowerCase().replace(/[:\s]+/g, ' ');
    const existing = kvMap.get(normKey) || [];
    existing.push({
      rawKey,
      rawVal,
      globalPage,
      localPage: valPage,
      chunkIndex: c.chunkIndex,
      confidence: kv.confidence,
      keyPoly: kv.key?.boundingRegions?.[0]?.polygon,
      valPoly: kv.value?.boundingRegions?.[0]?.polygon,
    });
    kvMap.set(normKey, existing);
  });
});

console.log(`\nTotal KeyValuePairs: ${totalKv}`);
console.log(`Missing Value Pairs (key present, value empty): ${missingValueCount}`);

console.log('\n--- TOP REPEATED METADATA FIELDS ACROSS PAGES ---');
const sortedKeys = Array.from(kvMap.entries()).sort((a, b) => b[1].length - a[1].length);
sortedKeys.forEach(([k, list]) => {
  if (list.length > 1) {
    console.log(`\nNormalized Key: "${k}" (Raw: "${list[0].rawKey}") | Total Occurrences: ${list.length}`);
    list.forEach((item, idx) => {
      console.log(`  [Obs #${idx + 1}] Global P${item.globalPage} (Chunk ${item.chunkIndex + 1} local P${item.localPage}) | Val: "${item.rawVal}" | Conf: ${item.confidence}`);
    });
  }
});

console.log('\n--- SINGLE OCCURRENCE METADATA FIELDS ---');
sortedKeys.filter(([k, list]) => list.length === 1).slice(0, 15).forEach(([k, list]) => {
  const item = list[0];
  console.log(`Key: "${item.rawKey}" | Val: "${item.rawVal}" | Global P${item.globalPage} | Conf: ${item.confidence}`);
});
