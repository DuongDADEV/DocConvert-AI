import 'dotenv/config';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';
import { CellQualityEvaluator } from '../server/services/quality/CellQualityEvaluator.js';

async function main() {
  const docId = '70ec6614-ccdd-4326-b566-971a629e239c';
  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';

  console.log('=== 1. DB TRACE ===');
  const doc = await db.getUserDocumentById(userId, docId);
  console.log('Document:', {
    id: doc?.id,
    filename: doc?.filename,
    original_filename: doc?.original_filename,
    status: doc?.status,
    created_at: doc?.created_at,
    updated_at: doc?.updated_at,
  });

  const job = await db.getJobByDocumentId(userId, docId);
  console.log('Latest Job:', {
    id: job?.id,
    status: job?.status,
    created_at: job?.created_at,
    completed_at: job?.completed_at,
  });

  // DB extracted_cells for the 3 target values
  const targets = ['919ZTRF242991500', '919ZTRF242991502', '9192hv6243011321'];
  const ocrData = await db.getDocumentOcrResult(userId, docId);
  const tables = ocrData?.tables || [];
  console.log('Physical extracted_tables count:', tables.length);

  for (const t of targets) {
    let foundCell: any = null;
    let foundTbl: any = null;
    let foundRow: any = null;
    for (const tbl of tables) {
      for (const row of tbl.rows || []) {
        for (const cell of row.cells || []) {
          if (cell.rawValue === t) {
            foundCell = cell;
            foundTbl = tbl;
            foundRow = row;
            break;
          }
        }
        if (foundCell) break;
      }
      if (foundCell) break;
    }
    console.log(`\nDB Physical Cell for "${t}":`);
    if (foundCell) {
      console.log('  id:', foundCell.id);
      console.log('  tableId:', foundTbl.id, 'page:', foundTbl.pageNumber);
      console.log('  rowId:', foundRow.id, 'rowIndex:', foundRow.rowIndex);
      console.log('  columnIndex:', foundCell.columnIndex);
      console.log('  rawValue:', foundCell.rawValue);
      console.log('  normalizedValue:', foundCell.normalizedValue);
      console.log('  confidence:', foundCell.confidence);
      console.log('  confidenceSource:', foundCell.confidenceSource);
      console.log('  cellType:', foundCell.cellType);
      console.log('  isReviewed:', foundCell.isReviewed);
    } else {
      console.log('  NOT FOUND in DB tables!');
    }
  }

  console.log('\n=== 2. PRODUCTION BACKEND FUNCTION TRACE ===');
  console.log('ocrData returned:', {
    documentId: ocrData?.document.id,
    pagesCount: ocrData?.pages.length,
    tablesCount: ocrData?.tables.length,
  });

  const unifiedTransactionTable = UnifiedTableService.projectDocumentTables(docId, ocrData!.tables);
  console.log('projectDocumentTables returned:', {
    id: unifiedTransactionTable?.id,
    rowCount: unifiedTransactionTable?.rowCount,
    colCount: unifiedTransactionTable?.columnCount,
    columns: unifiedTransactionTable?.columns.map(c => ({
      index: c.canonicalColumnIndex,
      header: c.header,
      semanticType: c.semanticType
    }))
  });

  // Check target cells in unified table
  for (const t of targets) {
    let uCell: any = null;
    let uRow: any = null;
    let uCol: any = null;
    for (const r of unifiedTransactionTable?.rows || []) {
      for (const c of r.cells) {
        if (c.rawValue === t) {
          uCell = c;
          uRow = r;
          uCol = unifiedTransactionTable?.columns.find(col => col.canonicalColumnIndex === c.canonicalColumnIndex);
          break;
        }
      }
      if (uCell) break;
    }

    console.log(`\nUnified Table Cell for "${t}":`);
    if (uCell) {
      console.log('  cell.id:', uCell.id);
      console.log('  displayRowIndex:', uRow.displayRowIndex, 'sourcePage:', uRow.sourcePage);
      console.log('  column:', `[${uCol.canonicalColumnIndex}] "${uCol.header}" (${uCol.semanticType})`);
      console.log('  confidence:', uCell.confidence, `(${uCell.confidenceSource})`);
      console.log('  isReviewed:', uCell.isReviewed);
      console.log('  qualityAssessment:', JSON.stringify(uCell.qualityAssessment));
    } else {
      console.log('  NOT FOUND in unified table!');
    }
  }

  console.log('\n=== 3. LIVE HTTP ENDPOINT TRACE ===');
  const token = `sbp_token_${userId}`;

  try {
    const httpRes = await fetch(`http://localhost:3000/api/documents/${docId}/ocr-result`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    console.log('HTTP GET /ocr-result status:', httpRes.status);
    const json: any = await httpRes.json();
    console.log('HTTP JSON success:', json.success);
    console.log('HTTP JSON unifiedTable exists:', Boolean(json.unifiedTransactionTable));
    console.log('HTTP JSON unifiedTable rows:', json.unifiedTransactionTable?.rows?.length);

    // Check Case A, B, C in the actual HTTP response JSON
    for (const t of targets) {
      let httpCell: any = null;
      let httpRow: any = null;
      for (const r of json.unifiedTransactionTable?.rows || []) {
        for (const c of r.cells) {
          if (c.rawValue === t) {
            httpCell = c;
            httpRow = r;
            break;
          }
        }
        if (httpCell) break;
      }
      console.log(`\nHTTP Response Cell for "${t}":`);
      if (httpCell) {
        console.log('  id:', httpCell.id);
        console.log('  displayRowIndex:', httpRow?.displayRowIndex);
        console.log('  rawValue:', httpCell.rawValue);
        console.log('  confidence:', httpCell.confidence);
        console.log('  isReviewed:', httpCell.isReviewed);
        console.log('  qualityAssessment:', JSON.stringify(httpCell.qualityAssessment));
      } else {
        console.log('  NOT FOUND in HTTP response unified table!');
      }
    }
    fs.writeFileSync('scratch/q2d1_1_http_response.json', JSON.stringify(json, null, 2), 'utf-8');
  } catch (httpErr: any) {
    console.error('HTTP fetch error:', httpErr.message);
  }
}

main().catch(console.error);
