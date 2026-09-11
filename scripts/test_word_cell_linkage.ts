import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));

console.log('=== TESTING CELL <-> WORD LINKAGE VIA SPANS ===\n');

let totalCells = 0;
let cellsWithWordsMatched = 0;
let cellsWithoutWordsMatched = 0;

data.tables.forEach((t: any, tIdx: number) => {
  console.log(`\n--- Table #${tIdx} (rows=${t.rowCount}, cols=${t.columnCount}) ---`);
  t.cells.slice(0, 5).forEach((c: any, cIdx: number) => {
    totalCells++;
    const cellSpans = c.spans || [];
    const cellPage = c.boundingRegions?.[0]?.pageNumber;
    const pageWords = data.pages.find((p: any) => p.pageNumber === cellPage)?.words || [];

    // Match words falling within cell spans
    const matchedWords: any[] = [];
    for (const span of cellSpans) {
      const spanStart = span.offset;
      const spanEnd = span.offset + span.length;
      for (const w of pageWords) {
        const wStart = w.span?.offset;
        const wEnd = wStart + (w.span?.length || 0);
        // Overlap or containment
        if (wStart >= spanStart && wEnd <= spanEnd) {
          matchedWords.push(w);
        }
      }
    }

    if (matchedWords.length > 0) {
      cellsWithWordsMatched++;
    } else {
      cellsWithoutWordsMatched++;
    }

    const wordConfs = matchedWords.map(w => w.confidence);
    const minConf = wordConfs.length > 0 ? Math.min(...wordConfs) : null;
    const meanConf = wordConfs.length > 0 ? wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length : null;

    console.log(`  Cell [r${c.rowIndex}, c${c.columnIndex}] "${c.content}" (page ${cellPage}, spans=${JSON.stringify(cellSpans)}):`);
    console.log(`     Matched words (${matchedWords.length}): [${matchedWords.map(w => `"${w.content}" (${w.confidence})`).join(', ')}]`);
    console.log(`     Min word conf: ${minConf?.toFixed(4)}, Mean: ${meanConf?.toFixed(4)}`);
  });
});

console.log(`\nSummary:`);
console.log(`Total sample cells inspected: ${totalCells}`);
console.log(`Cells successfully matched with words: ${cellsWithWordsMatched}`);
console.log(`Cells without matched words: ${cellsWithoutWordsMatched}`);
