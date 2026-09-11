import dotenv from 'dotenv';
dotenv.config();
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

const AUDIT_DOCS = [
  { key: 'DOC_1_PROBLEM_STAMP', name: 'Nam A (Problematic Stamp)', id: 'fa982b65-94e8-4a21-9c74-e28ace4bad85', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { key: 'DOC_2_NAM_A_CLEAN', name: 'Nam A (Base Clean)', id: '82537093-4f56-4328-962d-de5237e7a9eb', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
  { key: 'DOC_3_ACB_MEDIHUB', name: 'ACB Medihub', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  { key: 'DOC_4_BAN_VIET', name: 'Ban Viet Bank', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c' },
  { key: 'DOC_5_HDBANK', name: 'HDBank', id: '93c5f47f-659f-4e5f-be03-fd0ad073ab88', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff' },
];

async function runRealDataRegression() {
  console.log('========================================================================');
  console.log('Q2B — SEMANTIC CELL QUALITY EVALUATOR REAL DATA REGRESSION');
  console.log('========================================================================\n');

  const docStats: any[] = [];

  for (const doc of AUDIT_DOCS) {
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`Auditing: ${doc.name} (ID: ${doc.id})`);

    const ocrData = await db.getDocumentOcrResult(doc.userId, doc.id);
    if (!ocrData || !ocrData.tables) {
      console.log(`  ERROR: No OCR data found for ${doc.name}`);
      continue;
    }

    const tStart = performance.now();
    const unified = UnifiedTableService.projectDocumentTables(doc.id, ocrData.tables);
    const tEnd = performance.now();
    const durationMs = tEnd - tStart;

    if (!unified) {
      console.log(`  ERROR: Unified projection returned null for ${doc.name}`);
      continue;
    }

    console.log(`  Projection & Evaluation Duration: ${durationMs.toFixed(2)} ms`);
    console.log(`  Rows: ${unified.rows.length}, Columns: ${unified.columns.length}`);

    let totalDataCells = 0;
    let passCount = 0;
    let warnCount = 0;
    let critCount = 0;

    const flaggedSamples: any[] = [];
    const unflaggedSamples: any[] = [];

    unified.rows.forEach((row, rIdx) => {
      row.cells.forEach((cell, cIdx) => {
        if (cell.isPlaceholder) return;
        totalDataCells++;

        const col = unified.columns[cIdx];
        const qa = cell.qualityAssessment || { severity: 'PASS', reasons: [] };

        if (qa.severity === 'CRITICAL') critCount++;
        else if (qa.severity === 'WARNING') warnCount++;
        else passCount++;

        if (qa.severity !== 'PASS') {
          if (flaggedSamples.length < 15) {
            flaggedSamples.push({
              page: row.sourcePage,
              row: rIdx + 1,
              col: col.header,
              val: cell.rawValue,
              conf: cell.confidence,
              severity: qa.severity,
              reasons: qa.reasons.map((r) => r.code).join(', '),
            });
          }
        } else {
          if (unflaggedSamples.length < 10 && cell.rawValue.trim() !== '') {
            unflaggedSamples.push({
              page: row.sourcePage,
              row: rIdx + 1,
              col: col.header,
              val: cell.rawValue,
              conf: cell.confidence,
              severity: qa.severity,
            });
          }
        }
      });
    });

    const flagRate = totalDataCells > 0 ? (((warnCount + critCount) / totalDataCells) * 100).toFixed(2) : '0';

    docStats.push({
      name: doc.name,
      totalCells: totalDataCells,
      pass: passCount,
      warning: warnCount,
      critical: critCount,
      flagRate: `${flagRate}%`,
      durationMs: `${durationMs.toFixed(2)} ms`,
    });

    // Detailed Target Cell Verification for Nam A Problematic
    if (doc.key === 'DOC_1_PROBLEM_STAMP') {
      console.log('\n  >>> NAM A PROBLEMATIC TARGET CELL VERIFICATION:');
      const targets = ['95,909 A', 'Lo ICH 50,000', '50,039,', '94.709'];
      for (const target of targets) {
        let found = false;
        for (let r = 0; r < unified.rows.length; r++) {
          for (let c = 0; c < unified.rows[r].cells.length; c++) {
            const cell = unified.rows[r].cells[c];
            if (cell.rawValue.trim() === target) {
              found = true;
              console.log(`    Target [${target}]:`);
              console.log(`      Confidence: ${cell.confidence} (${cell.confidenceSource})`);
              console.log(`      Severity:   ${cell.qualityAssessment?.severity}`);
              console.log(`      Reasons:    ${cell.qualityAssessment?.reasons.map((r) => r.code).join(', ')}`);
            }
          }
        }
        if (!found) {
          console.log(`    Target [${target}]: NOT FOUND in unified rows`);
        }
      }
    }

    // Detailed Verification for Ban Viet (100.000,00 and Teller Code)
    if (doc.key === 'DOC_4_BAN_VIET') {
      console.log('\n  >>> BAN VIET SPECIAL GUARDS VERIFICATION:');
      const gdvColIdx = unified.columns.findIndex((c) => /gdv|teller/i.test(c.header));
      console.log(`    GDV / Teller Column Index: ${gdvColIdx} (Header: "${unified.columns[gdvColIdx]?.header}")`);
      let gdvFlagged = 0;
      if (gdvColIdx !== -1) {
        unified.rows.forEach((r) => {
          const c = r.cells[gdvColIdx];
          if (c && c.qualityAssessment?.severity !== 'PASS') {
            gdvFlagged++;
          }
        });
      }
      console.log(`    GDV Column Flagged Cells: ${gdvFlagged} (Expected: 0)`);
    }

    // Detailed Verification for ACB (DD-MM Dates)
    if (doc.key === 'DOC_3_ACB_MEDIHUB') {
      console.log('\n  >>> ACB SHORT DATE VERIFICATION:');
      const dateColIdx = unified.columns.findIndex((c) => c.semanticType === 'DATE');
      console.log(`    Date Column Index: ${dateColIdx} (Header: "${unified.columns[dateColIdx]?.header}")`);
      let datePass = 0;
      let dateFlagged = 0;
      if (dateColIdx !== -1) {
        unified.rows.forEach((r) => {
          const c = r.cells[dateColIdx];
          if (c && /^\d{1,2}-\d{1,2}$/.test(c.rawValue.trim())) {
            if (c.qualityAssessment?.severity === 'PASS') datePass++;
            else dateFlagged++;
          }
        });
      }
      console.log(`    Normal DD-MM Dates in Date Column: ${datePass} PASS, ${dateFlagged} FLAGGED (Expected: 0 false positives)`);
    }

    console.log(`  Summary: Total=${totalDataCells} | PASS=${passCount} | WARN=${warnCount} | CRIT=${critCount} | FlagRate=${flagRate}%`);
  }

  console.log('\n========================================================================');
  console.log('FALSE POSITIVE MATRIX ACROSS REAL DOCUMENTS');
  console.log('========================================================================');
  console.table(docStats);

  // Dump 20 flagged and 20 unflagged cells
  const allFlagged: any[] = [];
  const allUnflagged: any[] = [];
  for (const doc of AUDIT_DOCS) {
    const ocrData = await db.getDocumentOcrResult(doc.userId, doc.id);
    if (!ocrData || !ocrData.tables) continue;
    const unified = UnifiedTableService.projectDocumentTables(doc.id, ocrData.tables);
    if (!unified) continue;

    for (const r of unified.rows) {
      for (let cIdx = 0; cIdx < r.cells.length; cIdx++) {
        const c = r.cells[cIdx];
        if (c.isPlaceholder || !c.rawValue || c.rawValue.trim() === '') continue;
        const col = unified.columns[cIdx];
        const item = {
          doc: doc.name.substring(0, 15),
          page: r.sourcePage,
          row: r.displayRowIndex + 1,
          header: col.header.substring(0, 15),
          type: col.semanticType,
          val: c.rawValue.trim().substring(0, 25),
          conf: c.confidence,
          sev: c.qualityAssessment?.severity,
          reasons: c.qualityAssessment?.reasons.map((x) => x.code).join(', ') || 'NONE',
        };
        if (c.qualityAssessment?.severity !== 'PASS' && allFlagged.length < 20) {
          allFlagged.push(item);
        } else if (c.qualityAssessment?.severity === 'PASS' && allUnflagged.length < 20) {
          allUnflagged.push(item);
        }
      }
    }
  }

  console.log('\n========================================================================');
  console.log('MANUAL SAMPLE REVIEW: 20 FLAGGED CELLS');
  console.log('========================================================================');
  console.table(allFlagged);

  console.log('\n========================================================================');
  console.log('MANUAL SAMPLE REVIEW: 20 UNFLAGGED CELLS');
  console.log('========================================================================');
  console.table(allUnflagged);

  // Verification directly on raw Azure response (with truthful optical word confidences)
  console.log('\n========================================================================');
  console.log('RAW AZURE RESPONSE VERIFICATION (TRUTHFUL OPTICAL WORD CONFIDENCES)');
  console.log('========================================================================');
  const fs = await import('fs');
  const { AzureDocumentIntelligenceProvider } = await import('../server/services/ocr/AzureDocumentIntelligenceProvider.js');
  const rawAzure = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));
  const provider = new AzureDocumentIntelligenceProvider();
  const ocrResult = (provider as any).parseAzureAnalyzeResult(rawAzure, 'prebuilt-layout');
  const rawUnified = UnifiedTableService.projectDocumentTables('test-raw-azure-nama', ocrResult.tables);

  if (rawUnified) {
    const targets = ['95,909 A', 'Lo ICH 50,000', '50,039,', '94.709'];
    for (const target of targets) {
      for (const r of rawUnified.rows) {
        for (const c of r.cells) {
          if (c.rawValue.trim() === target) {
            console.log(`  Target [${target}]:`);
            console.log(`    Confidence: ${c.confidence} (${c.confidenceSource})`);
            console.log(`    Severity:   ${c.qualityAssessment?.severity}`);
            console.log(`    Reasons:    ${c.qualityAssessment?.reasons.map((res) => `${res.code} (${res.message})`).join(' | ')}`);
          }
        }
      }
    }
  }
}

runRealDataRegression().catch(console.error);
