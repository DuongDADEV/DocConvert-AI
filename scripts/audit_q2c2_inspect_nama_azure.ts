import fs from 'fs';

async function main() {
  const data = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));
  console.log('Pages count:', data.pages?.length);
  console.log('Tables count:', data.tables?.length);
  
  const foundWords: any[] = [];
  for (const p of data.pages || []) {
    for (const w of p.words || []) {
      if (w.content.includes('919') || w.content.includes('24299') || w.content.includes('624301') || w.content.includes('TRF')) {
        foundWords.push({ page: p.pageNumber, word: w });
      }
    }
  }
  console.log(`Found ${foundWords.length} matching words in nama_raw_azure.json:`);
  for (const item of foundWords) {
    console.log(`P${item.page}: "${item.word.content}" conf: ${item.word.confidence} span: ${JSON.stringify(item.word.span)}`);
  }

  // Also check tables cells
  console.log('\n--- Checking tables in nama_raw_azure.json ---');
  for (let tIdx = 0; tIdx < (data.tables || []).length; tIdx++) {
    const t = data.tables[tIdx];
    for (const c of t.cells || []) {
      if (c.content && (c.content.includes('919') || c.content.includes('24299') || c.content.includes('624301') || c.content.includes('TRF'))) {
        console.log(`Table ${tIdx} [r${c.rowIndex} c${c.columnIndex}]: "${c.content}" spans: ${JSON.stringify(c.spans)}`);
      }
    }
  }
}

main().catch(console.error);
