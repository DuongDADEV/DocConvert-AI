import assert from 'assert';
import { AzureDocumentIntelligenceProvider } from './AzureDocumentIntelligenceProvider.js';

console.log('Running deriveCellConfidence Unit Tests:');

const provider = new AzureDocumentIntelligenceProvider();
const derive = (c: any, words: any[], cellType: string) => {
  return (provider as any).deriveCellConfidence(c, words, cellType);
};

// 1. Single short code (DUNGTT4, 0.994)
{
  const cell = { content: 'DUNGTT4', rowIndex: 1 };
  const words = [{ content: 'DUNGTT4', confidence: 0.994 }];
  const res = derive(cell, words, 'TEXT');
  assert.strictEqual(res.confidence, 0.994);
  assert.strictEqual(res.source, 'AZURE_WORD_AGGREGATE');
  console.log('  ✓ 1. Single short code preserves word confidence (0.994)');
}

// 2. Short contaminated multi-word value (<= 35 chars, > 3 words, has low conf token)
{
  const cell = { content: 'DUNGTT4 GON * DỊCH VH', rowIndex: 1 };
  const words = [
    { content: 'DUNGTT4', confidence: 0.99 },
    { content: 'GON', confidence: 0.84 },
    { content: '*', confidence: 0.55 },
    { content: 'DỊCH', confidence: 0.92 },
    { content: 'VH', confidence: 0.77 },
  ];
  const res = derive(cell, words, 'TEXT');
  assert.strictEqual(res.confidence, 0.55, 'Must use MIN to preserve optical uncertainty');
  assert.strictEqual(res.source, 'AZURE_WORD_AGGREGATE');
  console.log('  ✓ 2. Contaminated short cell (<= 35 chars, 5 words) preserves MIN token confidence (0.55)');
}

// 3. Legitimate short multi-word text (TRAN VAN AN, uniformly high)
{
  const cell = { content: 'TRAN VAN AN', rowIndex: 1 };
  const words = [
    { content: 'TRAN', confidence: 0.98 },
    { content: 'VAN', confidence: 0.99 },
    { content: 'AN', confidence: 0.97 },
  ];
  const res = derive(cell, words, 'TEXT');
  assert.strictEqual(res.confidence, 0.97);
  assert.strictEqual(res.source, 'AZURE_WORD_AGGREGATE');
  console.log('  ✓ 3. Legitimate short text preserves high MIN confidence without artificial depression');
}

// 4. Long narrative text (> 35 chars) with one lower token uses MEAN
{
  const longText = 'From: NGUYEN THI TUYET LAN NOP TIEN VAO TAI KHOAN';
  assert.ok(longText.length > 35, 'Must be > 35 chars');
  const cell = { content: longText, rowIndex: 1 };
  const words = [
    { content: 'From:', confidence: 0.95 },
    { content: 'NGUYEN', confidence: 0.98 },
    { content: 'THI', confidence: 0.97 },
    { content: 'TUYET', confidence: 0.99 },
    { content: 'LAN', confidence: 0.96 },
    { content: 'NOP', confidence: 0.97 },
    { content: 'TIEN', confidence: 0.98 },
    { content: 'VAO', confidence: 0.60 }, // minor low-conf word in long narrative
    { content: 'TAI', confidence: 0.95 },
    { content: 'KHOAN', confidence: 0.97 },
  ];
  const res = derive(cell, words, 'TEXT');
  const expectedMean = Number((words.reduce((a, b) => a + b.confidence, 0) / words.length).toFixed(4));
  assert.strictEqual(res.confidence, expectedMean, 'Long text must use MEAN to avoid false positives');
  assert.strictEqual(res.source, 'AZURE_WORD_AGGREGATE');
  console.log(`  ✓ 4. Long description (> 35 chars) uses MEAN (${res.confidence}) and avoids single-token penalty`);
}

// 5. Structured MONEY / DATE / NUMBER always uses MIN
{
  const cellMoney = { content: '100,000,000.00', rowIndex: 1 };
  const wordsMoney = [
    { content: '100,000,000', confidence: 0.99 },
    { content: '.00', confidence: 0.72 },
  ];
  const resMoney = derive(cellMoney, wordsMoney, 'MONEY');
  assert.strictEqual(resMoney.confidence, 0.72, 'Structured MONEY must use MIN');

  const cellDate = { content: '16/07/2024', rowIndex: 1 };
  const wordsDate = [
    { content: '16/07', confidence: 0.98 },
    { content: '/2024', confidence: 0.88 },
  ];
  const resDate = derive(cellDate, wordsDate, 'DATE');
  assert.strictEqual(resDate.confidence, 0.88, 'Structured DATE must use MIN');
  console.log('  ✓ 5. Structured MONEY and DATE strictly preserve MIN word confidence');
}

// 6. Empty cell returns null with EMPTY_CELL source
{
  const cell = { content: '', rowIndex: 1 };
  const res = derive(cell, [], 'TEXT');
  assert.strictEqual(res.confidence, null);
  assert.strictEqual(res.source, 'EMPTY_CELL');
  console.log('  ✓ 6. Empty cell returns null with EMPTY_CELL source');
}

// 7. Non-empty cell with no matched words returns null with UNAVAILABLE source
{
  const cell = { content: 'SOME_VALUE', rowIndex: 1 };
  const res = derive(cell, [], 'TEXT');
  assert.strictEqual(res.confidence, null);
  assert.strictEqual(res.source, 'UNAVAILABLE');
  console.log('  ✓ 7. Non-empty cell without matched words returns null with UNAVAILABLE source');
}

// 8. Headers (rowIndex === 0 or kind === 'columnHeader') use MEAN
{
  const cell = { content: 'SỐ GIAO DỊCH (Reference Number)', rowIndex: 0, kind: 'columnHeader' };
  const words = [
    { content: 'SỐ', confidence: 0.95 },
    { content: 'GIAO', confidence: 0.98 },
    { content: 'DỊCH', confidence: 0.92 },
    { content: '(Reference', confidence: 0.90 },
    { content: 'Number)', confidence: 0.85 },
  ];
  const res = derive(cell, words, 'TEXT');
  const expectedMean = Number((words.reduce((a, b) => a + b.confidence, 0) / words.length).toFixed(4));
  assert.strictEqual(res.confidence, expectedMean);
  console.log('  ✓ 8. Header rows continue to use MEAN aggregation');
}

console.log('\nAll deriveCellConfidence Unit Tests Passed Successfully!\n');
