import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));

let totalWords = 0;
let wordsWithConf = 0;
const confidences: number[] = [];

data.pages.forEach((p: any) => {
  if (Array.isArray(p.words)) {
    p.words.forEach((w: any) => {
      totalWords++;
      if (typeof w.confidence === 'number') {
        wordsWithConf++;
        confidences.push(w.confidence);
      }
    });
  }
});

confidences.sort((a, b) => a - b);

function percentile(arr: number[], p: number) {
  if (arr.length === 0) return 0;
  const idx = (arr.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return arr[lower] * (1 - weight) + arr[upper] * weight;
}

const sum = confidences.reduce((acc, v) => acc + v, 0);
const mean = confidences.length > 0 ? sum / confidences.length : 0;
const min = confidences[0] || 0;
const max = confidences[confidences.length - 1] || 0;
const median = percentile(confidences, 0.5);
const p10 = percentile(confidences, 0.1);
const p25 = percentile(confidences, 0.25);
const p75 = percentile(confidences, 0.75);
const p90 = percentile(confidences, 0.9);

console.log('=== WORD-LEVEL CONFIDENCE IN AZURE RESPONSE ===');
console.log(`Total Pages: ${data.pages.length}`);
console.log(`Total Words: ${totalWords}`);
console.log(`Words with confidence: ${wordsWithConf} (${((wordsWithConf / totalWords) * 100).toFixed(1)}%)`);
console.log(`Min: ${min.toFixed(4)}`);
console.log(`Max: ${max.toFixed(4)}`);
console.log(`Mean: ${mean.toFixed(4)}`);
console.log(`Median: ${median.toFixed(4)}`);
console.log(`P10: ${p10.toFixed(4)}`);
console.log(`P25: ${p25.toFixed(4)}`);
console.log(`P75: ${p75.toFixed(4)}`);
console.log(`P90: ${p90.toFixed(4)}`);

// Sample words with low confidence
console.log('\nSample lowest 10 word confidences:');
const lowestWords: any[] = [];
data.pages.forEach((p: any) => {
  p.words.forEach((w: any) => {
    lowestWords.push({ page: p.pageNumber, content: w.content, confidence: w.confidence, span: w.span });
  });
});
lowestWords.sort((a, b) => a.confidence - b.confidence);
lowestWords.slice(0, 10).forEach(w => console.log(`  P${w.page} "${w.content}" -> conf=${w.confidence}`));

console.log('\nSample word structure:');
console.log(data.pages[0].words[0]);
