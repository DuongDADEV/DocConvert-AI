import fs from 'fs';
import { DataNormalizer } from '../server/services/ocr/normalizer.js';

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

function getWordsForCell(cell: Cell, pageWords: Word[]): Word[] {
  const spans = cell.spans || [];
  if (spans.length === 0) return [];
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

export function calculateCellConfidence(
  cell: Cell,
  words: Word[]
): { confidence: number; source: 'AZURE_WORD_AGGREGATE' | 'EMPTY_CELL' | 'UNAVAILABLE' } {
  const raw = cell.content?.trim() || '';

  // 1. Empty cell policy:
  if (!raw) {
    return { confidence: 1.0, source: 'EMPTY_CELL' };
  }

  // 2. If no words matched for non-empty cell:
  if (words.length === 0) {
    // If text exists but no words matched from Azure (e.g. unparsed symbol)
    return { confidence: 0.50, source: 'UNAVAILABLE' };
  }

  const wordConfs = words.map((w) => w.confidence);

  // 3. Header cells (rowIndex === 0 or kind === 'columnHeader' / 'rowHeader')
  const isHeader = cell.rowIndex === 0 || cell.kind === 'columnHeader' || cell.kind === 'rowHeader';
  if (isHeader) {
    const mean = wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length;
    return { confidence: Number(mean.toFixed(4)), source: 'AZURE_WORD_AGGREGATE' };
  }

  // 4. Content cells:
  // Determine if it's a short structured cell or long text
  const normalized = DataNormalizer.normalizeCell(raw);
  const isStructuredType = normalized.cellType === 'MONEY' || normalized.cellType === 'DATE' || normalized.cellType === 'NUMBER';
  const isShortText = words.length <= 3 && raw.length <= 35;

  if (isStructuredType || isShortText) {
    // MIN aggregation for structured cells to catch stamp artifacts, stray characters, and noise
    const min = Math.min(...wordConfs);
    return { confidence: Number(min.toFixed(4)), source: 'AZURE_WORD_AGGREGATE' };
  } else {
    // Long free text (Description / Narrative): use MEAN to avoid false positive alerts on single minor tokens
    const mean = wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length;
    return { confidence: Number(mean.toFixed(4)), source: 'AZURE_WORD_AGGREGATE' };
  }
}

// Test on Nam A raw response
const rawNama = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));
console.log('=== TESTING CONFIDENCE CALCULATION ON NAM A RAW AZURE ===\n');

const p1Words = rawNama.pages[0].words;
const t0 = rawNama.tables[0];

const targets = ['95,909 A', '94.709', 'Lo ICH 50,000', '50,039,', '50,000', '12,000', '1,200', ''];

t0.cells.forEach((c: Cell) => {
  const content = c.content?.trim();
  if (targets.includes(content) || (content.length > 40 && c.rowIndex < 5)) {
    const matchedWords = getWordsForCell(c, p1Words);
    const result = calculateCellConfidence(c, matchedWords);
    console.log(`Cell [r${c.rowIndex} c${c.columnIndex}] "${content.slice(0, 30)}..." (words: ${matchedWords.length}):`);
    console.log(`   -> confidence: ${result.confidence} (source: ${result.source})`);
  }
});
