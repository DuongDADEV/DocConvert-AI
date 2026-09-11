import fs from 'fs';

interface Word {
  content: string;
  polygon: number[];
  confidence: number;
  span: { offset: number; length: number };
}

interface Cell {
  kind?: string;
  rowIndex: number;
  columnIndex: number;
  content: string;
  boundingRegions?: Array<{ pageNumber: number; polygon: number[] }>;
  spans?: Array<{ offset: number; length: number }>;
  confidence?: number;
}

const raw = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));

console.log('========================================================================');
console.log('Q1.5 — AUDITING NAM A RAW AZURE RESPONSE CONFIDENCE PROVENANCE');
console.log('========================================================================\n');

console.log(`API Version: ${raw.apiVersion}`);
console.log(`Model ID: ${raw.modelId}`);
console.log(`Pages Count: ${raw.pages?.length}`);
console.log(`Tables Count: ${raw.tables?.length}`);

// 1. Table Cell Confidence Check
let totalCells = 0;
let cellsWithConfidence = 0;
let cellsWithoutConfidence = 0;

raw.tables.forEach((t: any, tIdx: number) => {
  t.cells.forEach((c: Cell) => {
    totalCells++;
    if (typeof c.confidence === 'number') {
      cellsWithConfidence++;
    } else {
      cellsWithoutConfidence++;
    }
  });
});

console.log(`\n--- 1. TABLE CELL CONFIDENCE AVAILABILITY ---`);
console.log(`Total Table Cells: ${totalCells}`);
console.log(`Cells WITH Azure c.confidence: ${cellsWithConfidence}`);
console.log(`Cells WITHOUT Azure c.confidence: ${cellsWithoutConfidence}`);
console.log(`Fallback 0.95 Rate: ${((cellsWithoutConfidence / totalCells) * 100).toFixed(1)}%`);

// 2. Word-Level Confidence Statistics
console.log(`\n--- 2. WORD-LEVEL CONFIDENCE OVERALL ---`);
const allWords: Word[] = [];
raw.pages.forEach((p: any) => {
  if (Array.isArray(p.words)) {
    p.words.forEach((w: Word) => allWords.push(w));
  }
});

const confs = allWords.map(w => w.confidence).sort((a, b) => a - b);
function percentile(arr: number[], p: number) {
  if (arr.length === 0) return 0;
  const idx = (arr.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return arr[lower] * (1 - weight) + arr[upper] * weight;
}

console.log(`Total Words: ${allWords.length}`);
console.log(`Min Confidence: ${confs[0]?.toFixed(4)}`);
console.log(`Max Confidence: ${confs[confs.length - 1]?.toFixed(4)}`);
console.log(`Mean Confidence: ${(confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(4)}`);
console.log(`Median Confidence: ${percentile(confs, 0.5).toFixed(4)}`);
console.log(`P10: ${percentile(confs, 0.1).toFixed(4)}`);
console.log(`P25: ${percentile(confs, 0.25).toFixed(4)}`);
console.log(`P75: ${percentile(confs, 0.75).toFixed(4)}`);
console.log(`P90: ${percentile(confs, 0.9).toFixed(4)}`);

// Helper to link cell to words via spans
function getWordsForCell(cell: Cell, pageWords: Word[]): Word[] {
  const spans = cell.spans || [];
  const matched: Word[] = [];
  for (const span of spans) {
    const sStart = span.offset;
    const sEnd = span.offset + span.length;
    for (const w of pageWords) {
      const wStart = w.span?.offset;
      const wEnd = wStart + (w.span?.length || 0);
      if (wStart >= sStart && wEnd <= sEnd) {
        matched.push(w);
      }
    }
  }
  return matched;
}

// 3. Inspect Specific Target Cells
console.log(`\n--- 3. DETAILED WORD CONFIDENCE FOR TARGET AND COMPARISON CELLS ---`);

const p1Words: Word[] = raw.pages[0]?.words || [];

// Target values from prompt
const targetValues = [
  '95,909 A',
  '94.709',
  'Lo ICH 50,000',
  '50,039,',
  // Clean comparison values
  '50,000',
  '12,000',
  '1,200',
  '31,441',
  '30,241',
  '13,000,000',
];

interface CellAnalysis {
  label: string;
  rowIndex: number;
  colIndex: number;
  content: string;
  storedCellConf: number;
  isSynthetic: boolean;
  words: Array<{ text: string; conf: number }>;
  minWordConf: number;
  meanWordConf: number;
  p25WordConf: number;
  weightedMeanConf: number;
  hybridConf: number;
}

const table1 = raw.tables[0];
const results: CellAnalysis[] = [];

table1.cells.forEach((c: Cell) => {
  const content = c.content?.trim();
  const match = targetValues.find(tv => tv === content);
  if (match) {
    const words = getWordsForCell(c, p1Words);
    const wConfs = words.map(w => w.confidence);
    const minW = wConfs.length > 0 ? Math.min(...wConfs) : 0;
    const meanW = wConfs.length > 0 ? wConfs.reduce((a, b) => a + b, 0) / wConfs.length : 0;
    const p25W = percentile([...wConfs].sort((a, b) => a - b), 0.25);
    
    // Length-weighted mean
    const totalLen = words.reduce((acc, w) => acc + w.content.length, 0);
    const weightedMean = totalLen > 0 ? words.reduce((acc, w) => acc + w.confidence * w.content.length, 0) / totalLen : 0;
    
    // Hybrid: 0.7 * mean + 0.3 * min
    const hybrid = 0.7 * meanW + 0.3 * minW;

    results.push({
      label: content === match ? match : content,
      rowIndex: c.rowIndex,
      colIndex: c.columnIndex,
      content,
      storedCellConf: 0.95, // What DocConvert currently stores
      isSynthetic: true,
      words: words.map(w => ({ text: w.content, conf: w.confidence })),
      minWordConf: minW,
      meanWordConf: meanW,
      p25WordConf: p25W,
      weightedMeanConf: weightedMean,
      hybridConf: hybrid,
    });
  }
});

console.table(results.map(r => ({
  content: r.content,
  row: r.rowIndex,
  wordsCount: r.words.length,
  wordsDetail: r.words.map(w => `"${w.text}" (${w.conf.toFixed(3)})`).join(' '),
  minWordConf: r.minWordConf.toFixed(4),
  meanWordConf: r.meanWordConf.toFixed(4),
  hybridConf: r.hybridConf.toFixed(4),
})));

// Benchmark linkage speed across all cells
console.log(`\n--- 4. LINKAGE PERFORMANCE BENCHMARK ---`);
const t0 = performance.now();
let matchedCellCount = 0;
table1.cells.forEach((c: Cell) => {
  const w = getWordsForCell(c, p1Words);
  if (w.length > 0) matchedCellCount++;
});
const t1 = performance.now();
console.log(`Linked ${matchedCellCount} cells to words in ${(t1 - t0).toFixed(2)} ms for ${table1.cells.length} cells`);
