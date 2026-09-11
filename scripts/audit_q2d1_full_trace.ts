import fs from 'fs';
import 'dotenv/config';
import { db } from '../server/db/db.js';
import { UnifiedTableService, UnifiedCell, UnifiedColumn, UnifiedRow } from '../server/services/unifiedTableService.js';
import { CellQualityEvaluator, QualitySeverity } from '../server/services/quality/CellQualityEvaluator.js';

async function main() {
  const docId = '70ec6614-ccdd-4326-b566-971a629e239c';
  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';

  console.log('=== TRACING DOCUMENT:', docId, '===');
  const ocrData = await db.getDocumentOcrResult(userId, docId);
  if (!ocrData) {
    console.error('No OCR data found for doc:', docId);
    return;
  }

  // Load raw Azure JSON
  const rawAzure = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));

  // Run UnifiedTableService
  const unifiedTable = UnifiedTableService.projectDocumentTables(docId, ocrData.tables);
  if (unifiedTable) {
    CellQualityEvaluator.evaluateTable(unifiedTable.columns, unifiedTable.rows);
  }

  const results: any = {};

  const cases = [
    { label: 'CASE A (SILENT ERROR)', ocrVal: '919ZTRF242991500', gt: '919ZTRF2429915O0' },
    { label: 'CASE B (DETECTED ERROR)', ocrVal: '919ZTRF242991502', gt: '919ZTRF2429915O2' },
    { label: 'CASE C (CORRECT BUT WARNING)', ocrVal: '9192hv6243011321', gt: '9192hv6243011321' },
  ];

  for (const cs of cases) {
    console.log(`\n======================================================`);
    console.log(`>>> ${cs.label}: ${cs.ocrVal} (GT: ${cs.gt})`);
    console.log(`======================================================`);

    // 1. Raw Azure Word
    let matchedWord: any = null;
    let wordPage = -1;
    for (const p of rawAzure.pages || []) {
      for (const w of p.words || []) {
        if (w.content === cs.ocrVal) {
          matchedWord = w;
          wordPage = p.pageNumber;
          break;
        }
      }
      if (matchedWord) break;
    }

    console.log('1. Raw Azure Word:');
    if (matchedWord) {
      console.log(`   Page: ${wordPage}`);
      console.log(`   Content: "${matchedWord.content}"`);
      console.log(`   Confidence: ${matchedWord.confidence}`);
      console.log(`   Span: ${JSON.stringify(matchedWord.span)}`);
      console.log(`   Polygon (inches): ${JSON.stringify(matchedWord.polygon)}`);
    } else {
      console.log('   NOT FOUND exact match as single word!');
    }

    // 2. Raw Azure Table Cell
    let matchedTableCell: any = null;
    let matchedTableIdx = -1;
    for (let tIdx = 0; tIdx < (rawAzure.tables || []).length; tIdx++) {
      const t = rawAzure.tables[tIdx];
      for (const c of t.cells || []) {
        if (c.content && c.content.includes(cs.ocrVal)) {
          matchedTableCell = c;
          matchedTableIdx = tIdx;
          break;
        }
      }
      if (matchedTableCell) break;
    }

    console.log('2. Raw Azure Table Cell:');
    if (matchedTableCell) {
      console.log(`   Table: #${matchedTableIdx} (page ${matchedTableCell.boundingRegions?.[0]?.pageNumber})`);
      console.log(`   Row: ${matchedTableCell.rowIndex}, Col: ${matchedTableCell.columnIndex}`);
      console.log(`   Content: "${matchedTableCell.content}"`);
      console.log(`   Spans: ${JSON.stringify(matchedTableCell.spans)}`);
      console.log(`   Polygon: ${JSON.stringify(matchedTableCell.boundingRegions?.[0]?.polygon)}`);
    }

    // 3. DB Physical Cell
    let dbCell: any = null;
    for (const t of ocrData.tables) {
      for (const r of t.rows) {
        for (const c of r.cells) {
          if (c.rawValue === cs.ocrVal) {
            dbCell = c;
            break;
          }
        }
        if (dbCell) break;
      }
      if (dbCell) break;
    }

    console.log('3. DB Physical Extracted Cell:');
    if (dbCell) {
      console.log(`   ID: ${dbCell.id}`);
      console.log(`   Raw Value: "${dbCell.rawValue}"`);
      console.log(`   Normalized Value: "${dbCell.normalizedValue}"`);
      console.log(`   Cell Type: ${dbCell.cellType}`);
      console.log(`   Confidence: ${dbCell.confidence}`);
      console.log(`   Confidence Source: ${dbCell.confidenceSource}`);
      console.log(`   Is Reviewed: ${dbCell.isReviewed}`);
    }

    // 4. Unified Table & Quality Assessment
    let uCell: any = null;
    let uCol: any = null;
    let uRow: any = null;
    if (unifiedTable) {
      for (const r of unifiedTable.rows) {
        for (const c of r.cells) {
          if (c.rawValue === cs.ocrVal) {
            uCell = c;
            uRow = r;
            uCol = unifiedTable.columns.find((col) => col.canonicalColumnIndex === c.canonicalColumnIndex);
            break;
          }
        }
        if (uCell) break;
      }
    }

    console.log('4. Unified Table & Quality Assessment:');
    if (uCell) {
      console.log(`   Canonical Column: [${uCol?.canonicalColumnIndex}] "${uCol?.header}" (${uCol?.semanticType})`);
      console.log(`   Source Page: ${uRow?.sourcePage}`);
      console.log(`   Quality Severity: ${uCell.qualityAssessment?.severity}`);
      console.log(`   Quality Reasons:`, uCell.qualityAssessment?.reasons);
    }

    results[cs.label] = {
      case: cs,
      matchedWord,
      wordPage,
      matchedTableCell,
      matchedTableIdx,
      dbCell,
      uCell,
      uCol,
      uRowSourcePage: uRow?.sourcePage,
    };
  }
  fs.writeFileSync('scratch/q2d1_cases_diag.json', JSON.stringify(results, null, 2), 'utf-8');

  // Also print all references in the same column to inspect contextual peers!
  console.log('\n=== 5. ALL PEERS IN THE TRANSACTION NO COLUMN ===');
  if (unifiedTable) {
    // Find column with header containing "SỐ GIAO DỊCH" or "Transaction"
    const refCol = unifiedTable.columns.find(c =>
      c.header.toLowerCase().includes('giao dịch') ||
      c.header.toLowerCase().includes('transaction') ||
      c.semanticType === 'REFERENCE'
    );
    if (refCol) {
      console.log(`Found Reference Column: index ${refCol.canonicalColumnIndex}, header: "${refCol.header}", semanticType: ${refCol.semanticType}`);
      const colValues = unifiedTable.rows.map((r, i) => {
        const cell = r.cells.find(c => c.canonicalColumnIndex === refCol.canonicalColumnIndex);
        return {
          rowIdx: i,
          page: r.sourcePage,
          rawValue: cell?.rawValue,
          conf: cell?.confidence,
          confSource: cell?.confidenceSource,
          severity: cell?.qualityAssessment?.severity,
          reasons: cell?.qualityAssessment?.reasons?.map((x: any) => x.code),
        };
      });
      for (const cv of colValues) {
        console.log(`Row ${cv.rowIdx.toString().padStart(2, ' ')} (P${cv.page}) | "${cv.rawValue}" | conf: ${cv.conf} (${cv.confSource}) | severity: ${cv.severity} | reasons: ${cv.reasons?.join(',') || 'NONE'}`);
      }
      fs.writeFileSync('scratch/q2d1_col_peers.json', JSON.stringify(colValues, null, 2), 'utf-8');
    }
  }
}

main().catch(console.error);

