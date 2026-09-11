import fs from 'fs';

async function main() {
  const data = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));
  const p2 = data.pages[1]; // Page 2 (1-indexed is pageNumber 2)
  console.log(`Page 2 words count: ${p2.words.length}`);

  // Check if character-level confidence exists anywhere in page words or lines or anywhere
  const sampleWord = p2.words[0];
  console.log('Sample word structure:', sampleWord);
  let hasCharConfidence = false;
  for (const w of p2.words) {
    if ((w as any).characters || (w as any).characterConfidence || (w as any).symbols) {
      hasCharConfidence = true;
      break;
    }
  }
  console.log('Has character-level confidence in words?:', hasCharConfidence);

  const targets = [
    { name: 'Case 1 (O0 -> 00)', target: '919ZTRF242991500' },
    { name: 'Case 2 (O2 -> 02)', target: '919ZTRF242991502' },
    { name: 'Case 3 (9192hv6243011321)', target: '9192hv6243011321' }
  ];

  const t1 = data.tables[1];
  for (const item of targets) {
    console.log(`\n========================================`);
    console.log(`=== ${item.name}: ${item.target} ===`);
    const cell = t1.cells.find((c: any) => c.content?.trim() === item.target);
    if (!cell) {
      console.log('Cell not found in Table 1');
      continue;
    }
    console.log('Cell:', {
      rowIndex: cell.rowIndex,
      columnIndex: cell.columnIndex,
      content: cell.content,
      spans: cell.spans,
      polygon: cell.boundingRegions?.[0]?.polygon
    });

    // Find words matching cell span
    const sStart = cell.spans[0].offset;
    const sEnd = sStart + cell.spans[0].length;
    const matchedWords = p2.words.filter((w: any) => {
      const wStart = w.span?.offset;
      const wEnd = wStart + (w.span?.length || 0);
      return wStart >= sStart && wEnd <= sEnd;
    });

    console.log(`Matched words count: ${matchedWords.length}`);
    for (const w of matchedWords) {
      console.log(`  Word: "${w.content}" | Confidence: ${w.confidence} | Span: offset=${w.span.offset}, len=${w.span.length} | Polygon:`, w.polygon);
    }
  }
}

main().catch(console.error);
