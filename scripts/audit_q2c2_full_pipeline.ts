import fs from 'fs';
import { db } from '../server/db/db.js';
import { UnifiedTableService, UnifiedTableCell, UnifiedColumn, UnifiedRow } from '../server/services/unifiedTableService.js';
import { CellQualityEvaluator, QualitySeverity } from '../server/services/quality/CellQualityEvaluator.js';

interface CellAuditItem {
  id: string;
  sourceDoc: string;
  isFresh: boolean;
  page: number;
  rowIdx: number;
  colIdx: number;
  colHeader: string;
  colType: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number | null;
  confidenceSource: string;
  severity: QualitySeverity;
  reasons: string[];
  // Ground truth evaluation (if known)
  hasGroundTruth: boolean;
  groundTruthType?: 'MANUAL_PDF_VERIFIED' | 'REVIEW_ACTION_VERIFIED';
  groundTruthValue?: string;
  isCorrect?: boolean;
  tokenCount: number;
  charLength: number;
  // Multi-token simulations
  wordConfs?: number[];
  meanConf?: number;
  medianConf?: number;
  weightedMeanConf?: number;
}

async function runAudit() {
  console.log('=== Q2C.2 OCR CONFIDENCE CALIBRATION & AUDIT ENGINE ===\n');

  // Load raw Azure for word-level linkage
  const rawNama = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));
  const rawHd = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));

  const docsToAudit = [
    { key: 'FRESH_NAM_A', name: 'Nam A (Fresh OCR)', id: '70ec6614-ccdd-4326-b566-971a629e239c', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff', isFresh: true, raw: rawNama },
    { key: 'FRESH_HDBANK', name: 'HDBank (Fresh OCR)', id: 'd79873be-7dd7-4441-8c63-68c6077adfd0', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff', isFresh: true, raw: rawHd },
    { key: 'LEGACY_NAM_A_PROB', name: 'Nam A Problematic Stamp', id: 'fa982b65-94e8-4a21-9c74-e28ace4bad85', userId: '27a10269-da23-4bfd-aa19-5ed66b974eff', isFresh: false },
    { key: 'LEGACY_ACB', name: 'ACB Medihub', id: 'b55bb467-20ae-4939-b1c8-c28e0895854b', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c', isFresh: false },
    { key: 'LEGACY_BAN_VIET', name: 'Ban Viet', id: 'ffec64e8-f5d8-4e2d-929b-124882b3e099', userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c', isFresh: false }
  ];

  // Ground-truth verified library
  // Format: key = rawValue.trim()
  const groundTruthMap = new Map<string, { groundTruth: string; isCorrect: boolean; type: 'MANUAL_PDF_VERIFIED' | 'REVIEW_ACTION_VERIFIED' }>();

  // Acceptance Fixtures (from PDF Ground Truth verification)
  groundTruthMap.set('919ZTRF242991500', { groundTruth: '919ZTRF2429915O0', isCorrect: false, type: 'MANUAL_PDF_VERIFIED' });
  groundTruthMap.set('919ZTRF242991502', { groundTruth: '919ZTRF2429915O2', isCorrect: false, type: 'MANUAL_PDF_VERIFIED' });
  groundTruthMap.set('9192hv6243011321', { groundTruth: '9192hv6243011321', isCorrect: true, type: 'MANUAL_PDF_VERIFIED' });

  // Problematic stamp contaminated cells
  groundTruthMap.set('95,909 A', { groundTruth: '95,909', isCorrect: false, type: 'MANUAL_PDF_VERIFIED' });
  groundTruthMap.set('Lo ICH 50,000', { groundTruth: '50,000', isCorrect: false, type: 'MANUAL_PDF_VERIFIED' });
  groundTruthMap.set('50,039,', { groundTruth: '50,039', isCorrect: false, type: 'MANUAL_PDF_VERIFIED' });
  groundTruthMap.set('94.709', { groundTruth: '94,709', isCorrect: false, type: 'MANUAL_PDF_VERIFIED' });

  // Review actions verified from database
  groundTruthMap.set('51704070011450', { groundTruth: '051704070011450', isCorrect: false, type: 'REVIEW_ACTION_VERIFIED' });
  groundTruthMap.set('051704070011450', { groundTruth: '051704070011450', isCorrect: true, type: 'REVIEW_ACTION_VERIFIED' });
  groundTruthMap.set('1197145488', { groundTruth: '1197145488', isCorrect: true, type: 'REVIEW_ACTION_VERIFIED' });
  groundTruthMap.set('12650000', { groundTruth: '12650000', isCorrect: true, type: 'REVIEW_ACTION_VERIFIED' });

  // Verified correct cells from manual PDF inspection across Nam A, HDBank, ACB, Ban Viet:
  const manualCorrectValues = [
    '1,559,240,000', '1,200', '12,000', '50,000', '0', '-',
    '03/06/2024', '04/06/2024', '14/06/2024', '18/06/2024', '21/06/2024',
    '919ZTRF241520A6F', '919ZTRF241520A6H', '919ZTRF241520A6J', '919GL3024159C5LZ',
    '919ZTRF241770F2X', '919ZTRF241780FA9', '919ZTRF241850GQH', '919ZTRF241850GQL',
    '919ZTRF241850GQJ', '919GL3024191C6KY', '919ZTRF242070L3J', '919ZTRF242080LB1',
    '919ZTRF242160MZ5', '919ZTRF242160MZ7', '919ZTRF242160MZ9', '919ZTRF242380RIT',
    '919ZTRF242390RQH', '919ZTRF242420SHN', '919ZTRF242420SHP', '919ZTRF242420SHR',
    '919ZTRF242430SPX', '919ZTRF242430SPV', '919ZTRF2427710CL', '919ZTRF2427710CN',
    '919ZTRF2427710CP',
    '28/06/2024', '01/07/2024', '02/07/2024', '03/07/2024', '04/07/2024',
    '10,000,000', '20,000,000', '500,000', '1,000,000', '15,000,000',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
    '02-01', '03-01', '04-01', '05-01', '08-01', '09-01', '10-01', '11-01', '12-01', '15-01', // ACB DD-MM dates
    '100.000,00', '200.000,00', '50.000,00' // Ban Viet dot-thousands comma-decimal
  ];
  for (const v of manualCorrectValues) {
    if (!groundTruthMap.has(v)) {
      groundTruthMap.set(v, { groundTruth: v, isCorrect: true, type: 'MANUAL_PDF_VERIFIED' });
    }
  }

  const allCells: CellAuditItem[] = [];

  for (const docConfig of docsToAudit) {
    console.log(`Processing ${docConfig.name} (${docConfig.id})...`);
    const ocrData = await db.getDocumentOcrResult(docConfig.userId, docConfig.id);
    if (!ocrData || !ocrData.tables) {
      console.log(`  ERROR: No OCR data for ${docConfig.name}`);
      continue;
    }

    const unified = UnifiedTableService.projectDocumentTables(docConfig.id, ocrData.tables);
    if (!unified) {
      console.log(`  ERROR: Projection returned null for ${docConfig.name}`);
      continue;
    }

    console.log(`  Projected: ${unified.rows.length} rows, ${unified.columns.length} columns`);

    for (let rIdx = 0; rIdx < unified.rows.length; rIdx++) {
      const row = unified.rows[rIdx];
      for (let cIdx = 0; cIdx < row.cells.length; cIdx++) {
        const cell = row.cells[cIdx];
        if (cell.isPlaceholder) continue;

        const rawVal = (cell.rawValue || '').trim();
        const col = unified.columns[cIdx];

        // Link with words if fresh document
        let wordConfs: number[] = [];
        let meanConf = cell.confidence;
        let medianConf = cell.confidence;
        let weightedMeanConf = cell.confidence;

        if (docConfig.isFresh && docConfig.raw) {
          const p = docConfig.raw.pages?.find((page: any) => page.pageNumber === row.sourcePage);
          if (p && p.words) {
            // Match words whose text matches or substring matches cell
            // Or look up words directly
            // For single-token:
            const exactWord = p.words.find((w: any) => w.content === rawVal);
            if (exactWord) {
              wordConfs = [exactWord.confidence];
            } else {
              // Multi-word
              const tokens = rawVal.split(/\s+/).filter(Boolean);
              const foundTokens = p.words.filter((w: any) => tokens.includes(w.content));
              if (foundTokens.length > 0) {
                wordConfs = foundTokens.map((w: any) => w.confidence);
              }
            }
          }

          if (wordConfs.length > 0) {
            meanConf = Number((wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length).toFixed(4));
            const sorted = [...wordConfs].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            medianConf = sorted.length % 2 !== 0 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(4));
            weightedMeanConf = meanConf;
          }
        }

        const qa = cell.qualityAssessment || { severity: 'PASS' as QualitySeverity, reasons: [] };

        const gt = groundTruthMap.get(rawVal);

        allCells.push({
          id: cell.id || `virtual_${rIdx}_${cIdx}`,
          sourceDoc: docConfig.name,
          isFresh: docConfig.isFresh,
          page: row.sourcePage,
          rowIdx: rIdx,
          colIdx: cIdx,
          colHeader: col.header,
          colType: col.semanticType,
          rawValue: rawVal,
          normalizedValue: cell.normalizedValue,
          confidence: cell.confidence,
          confidenceSource: cell.confidenceSource || 'UNAVAILABLE',
          severity: qa.severity,
          reasons: qa.reasons.map(r => r.code),
          hasGroundTruth: Boolean(gt),
          groundTruthType: gt?.type,
          groundTruthValue: gt?.groundTruth,
          isCorrect: gt?.isCorrect,
          tokenCount: wordConfs.length > 0 ? wordConfs.length : (rawVal ? rawVal.split(/\s+/).length : 0),
          charLength: rawVal.length,
          wordConfs,
          meanConf,
          medianConf,
          weightedMeanConf
        });
      }
    }
  }

  console.log(`\nTotal collected cells across all 5 audited documents: ${allCells.length}`);

  const freshCells = allCells.filter(c => c.isFresh);
  const legacyCells = allCells.filter(c => !c.isFresh);
  console.log(`Fresh cells: ${freshCells.length} | Legacy cells: ${legacyCells.length}`);

  const nonEmptyFresh = freshCells.filter(c => c.rawValue !== '' && c.confidenceSource !== 'EMPTY_CELL');
  console.log(`Non-empty fresh cells (for confidence calibration): ${nonEmptyFresh.length}`);

  // 1. CONFIDENCE DISTRIBUTION BANDS (Fresh cells only!)
  const bands = [
    { label: '100–95%', min: 0.95, max: 1.001 },
    { label: '95–90%', min: 0.90, max: 0.95 },
    { label: '90–80%', min: 0.80, max: 0.90 },
    { label: '80–70%', min: 0.70, max: 0.80 },
    { label: '70–60%', min: 0.60, max: 0.70 },
    { label: '60–50%', min: 0.50, max: 0.60 },
    { label: '<50%', min: 0.0, max: 0.50 },
  ];

  console.log('\n======================================================');
  console.log('1. OCR CONFIDENCE DISTRIBUTION (Fresh Cells, N = ' + nonEmptyFresh.length + ')');
  console.log('======================================================');
  const bandCounts: Record<string, number> = {};
  for (const b of bands) bandCounts[b.label] = 0;
  let nullConfCount = 0;

  for (const c of nonEmptyFresh) {
    if (c.confidence === null) {
      nullConfCount++;
      continue;
    }
    for (const b of bands) {
      if (c.confidence >= b.min && c.confidence < b.max) {
        bandCounts[b.label]++;
        break;
      }
    }
  }

  for (const [k, v] of Object.entries(bandCounts)) {
    const pct = ((v / nonEmptyFresh.length) * 100).toFixed(1);
    console.log(`  ${k.padEnd(10)}: ${String(v).padStart(4)} cells (${pct}%)`);
  }
  console.log(`  NULL      : ${String(nullConfCount).padStart(4)} cells (${((nullConfCount / nonEmptyFresh.length) * 100).toFixed(1)}%)`);

  // 2. CONFIDENCE BY CANONICAL TYPE (Fresh cells)
  console.log('\n======================================================');
  console.log('2. CONFIDENCE DISTRIBUTION BY CANONICAL TYPE (Fresh Cells)');
  console.log('======================================================');
  const typeStats: Record<string, { count: number; sumConf: number; lowConfCount: number }> = {};
  for (const c of nonEmptyFresh) {
    const t = c.colType || 'OTHER';
    if (!typeStats[t]) typeStats[t] = { count: 0, sumConf: 0, lowConfCount: 0 };
    typeStats[t].count++;
    if (c.confidence !== null) {
      typeStats[t].sumConf += c.confidence;
      if (c.confidence < 0.70) typeStats[t].lowConfCount++;
    }
  }
  for (const [t, s] of Object.entries(typeStats)) {
    const avg = s.count > 0 ? (s.sumConf / s.count).toFixed(3) : '0';
    console.log(`  ${t.padEnd(14)}: N=${String(s.count).padStart(4)} | AvgConf=${avg} | LowConf (<0.70)=${s.lowConfCount} (${((s.lowConfCount / s.count) * 100).toFixed(1)}%)`);
  }

  // 3. GROUND TRUTH ACCURACY & METRICS
  const gtCells = allCells.filter(c => c.hasGroundTruth && c.rawValue !== '');
  console.log('\n======================================================');
  console.log(`3. GROUND TRUTH QUALITY & EVALUATION (Total N = ${gtCells.length})`);
  console.log('======================================================');
  const humanPdfVerified = gtCells.filter(c => c.groundTruthType === 'MANUAL_PDF_VERIFIED');
  const reviewActionDerived = gtCells.filter(c => c.groundTruthType === 'REVIEW_ACTION_VERIFIED');
  console.log(`  Human/PDF verified : N = ${humanPdfVerified.length}`);
  console.log(`  Review action derived: N = ${reviewActionDerived.length}`);
  console.log(`  OCR-only (no GT)   : N = ${allCells.length - gtCells.length}`);

  const correctGt = gtCells.filter(c => c.isCorrect === true);
  const incorrectGt = gtCells.filter(c => c.isCorrect === false);
  console.log(`  Actual Correct     : N = ${correctGt.length}`);
  console.log(`  Actual Incorrect   : N = ${incorrectGt.length}`);

  // Ground-Truth Accuracy by Confidence Band (Fresh verified subset only)
  const freshGt = gtCells.filter(c => c.isFresh && c.confidence !== null);
  console.log(`\n--- Ground-Truth Accuracy By Confidence Band (Fresh Verified Cells, N=${freshGt.length}) ---`);
  for (const b of bands) {
    const inBand = freshGt.filter(c => c.confidence! >= b.min && c.confidence! < b.max);
    const corr = inBand.filter(c => c.isCorrect === true).length;
    const incorr = inBand.filter(c => c.isCorrect === false).length;
    const rate = inBand.length >= 3 ? ((corr / inBand.length) * 100).toFixed(1) + '%' : (inBand.length > 0 ? `${((corr / inBand.length) * 100).toFixed(1)}% (PRELIMINARY, N=${inBand.length})` : 'INSUFFICIENT SAMPLE (N=0)');
    console.log(`  ${b.label.padEnd(10)} | N=${String(inBand.length).padStart(3)} | Correct=${String(corr).padStart(3)} | Incorrect=${String(incorr).padStart(2)} | Empirical Correctness: ${rate}`);
  }

  // False Warnings
  const falseWarnings = gtCells.filter(c => c.isCorrect === true && c.severity !== 'PASS');
  console.log(`\n--- False Warnings (N = ${falseWarnings.length} / ${correctGt.length} correct cells, Rate = ${((falseWarnings.length / correctGt.length) * 100).toFixed(1)}%) ---`);
  const fwReasonsCount: Record<string, number> = {};
  for (const fw of falseWarnings) {
    console.log(`    FW: "${fw.rawValue}" (Doc: ${fw.sourceDoc}, Conf: ${fw.confidence}) -> Reasons: [${fw.reasons.join(', ')}]`);
    for (const r of fw.reasons) {
      fwReasonsCount[r] = (fwReasonsCount[r] || 0) + 1;
    }
  }
  console.log('  Top False Warning Reasons:', fwReasonsCount);

  // Silent Errors
  const silentErrors = gtCells.filter(c => c.isCorrect === false && c.severity === 'PASS');
  console.log(`\n--- Silent Errors (N = ${silentErrors.length} / ${incorrectGt.length} incorrect cells, Rate = ${((silentErrors.length / incorrectGt.length) * 100).toFixed(1)}%) ---`);
  for (const se of silentErrors) {
    console.log(`    SILENT ERROR: OCR="${se.rawValue}" vs GroundTruth="${se.groundTruthValue}" | Conf: ${se.confidence} | Col: ${se.colType} | Reasons: [${se.reasons.join(', ')}] (Doc: ${se.sourceDoc})`);
  }

  // Detection Recall & Review Precision
  const detectedIncorrect = gtCells.filter(c => c.isCorrect === false && c.severity !== 'PASS');
  const allFlaggedGt = gtCells.filter(c => c.severity !== 'PASS');
  const recall = incorrectGt.length > 0 ? ((detectedIncorrect.length / incorrectGt.length) * 100).toFixed(1) : '0';
  const precision = allFlaggedGt.length > 0 ? ((detectedIncorrect.length / allFlaggedGt.length) * 100).toFixed(1) : '0';
  console.log(`\n--- Detection Recall & Review Precision ---`);
  console.log(`  Detection Recall: ${detectedIncorrect.length}/${incorrectGt.length} (${recall}%)`);
  console.log(`  Review Precision: ${detectedIncorrect.length}/${allFlaggedGt.length} (${precision}%)`);

  // Confusion Matrix
  const passCorrect = gtCells.filter(c => c.isCorrect === true && c.severity === 'PASS').length;
  const passIncorrect = gtCells.filter(c => c.isCorrect === false && c.severity === 'PASS').length;
  const warnCorrect = gtCells.filter(c => c.isCorrect === true && c.severity === 'WARNING').length;
  const warnIncorrect = gtCells.filter(c => c.isCorrect === false && c.severity === 'WARNING').length;
  const critCorrect = gtCells.filter(c => c.isCorrect === true && c.severity === 'CRITICAL').length;
  const critIncorrect = gtCells.filter(c => c.isCorrect === false && c.severity === 'CRITICAL').length;

  console.log(`\n--- Confusion Matrix ---`);
  console.log(`  Severity | Actual Correct | Actual Incorrect`);
  console.log(`  PASS     | ${String(passCorrect).padStart(14)} | ${String(passIncorrect).padStart(16)}`);
  console.log(`  WARNING  | ${String(warnCorrect).padStart(14)} | ${String(warnIncorrect).padStart(16)}`);
  console.log(`  CRITICAL | ${String(critCorrect).padStart(14)} | ${String(critIncorrect).padStart(16)}`);
  console.log(`  REVIEW (WARN+CRIT): Correct=${warnCorrect + critCorrect} | Incorrect=${warnIncorrect + critIncorrect}`);

  // Optical vs Semantic Contribution for detected anomalies
  let opticalOnly = 0;
  let semanticOnly = 0;
  let bothCount = 0;
  let neitherCount = silentErrors.length;

  for (const c of gtCells.filter(c => c.isCorrect === false)) {
    const hasOpt = c.confidence !== null && c.confidence < 0.70;
    const hasSem = c.reasons.some(r => r !== 'LOW_OCR_CONFIDENCE' && r !== 'OCR_CONFIDENCE_UNAVAILABLE');
    if (hasOpt && !hasSem) opticalOnly++;
    else if (!hasOpt && hasSem) semanticOnly++;
    else if (hasOpt && hasSem) bothCount++;
  }
  console.log(`\n--- Optical vs Semantic Contribution (on Incorrect cells, N=${incorrectGt.length}) ---`);
  console.log(`  Optical only : ${opticalOnly}`);
  console.log(`  Semantic only: ${semanticOnly}`);
  console.log(`  Both         : ${bothCount}`);
  console.log(`  Neither (Silent): ${neitherCount}`);

  // 4. THRESHOLD SIMULATION on fresh ground-truth cells
  console.log(`\n======================================================`);
  console.log(`4. THRESHOLD SIMULATION (Optical Threshold on Fresh Ground Truth, N=${freshGt.length})`);
  console.log('======================================================');
  const simThresholds = [0.50, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90];
  console.log('Thresh | ReviewQueue | DetectedErr | MissedErr | FalseWarn | SilentErr');
  for (const th of simThresholds) {
    let rqSize = 0;
    let detErr = 0;
    let misErr = 0;
    let fw = 0;
    let se = 0;

    for (const c of freshGt) {
      const isOpticalWarn = c.confidence !== null && c.confidence < th;
      const isSemanticWarn = c.reasons.some(r => r !== 'LOW_OCR_CONFIDENCE');
      const isFlagged = isOpticalWarn || isSemanticWarn;

      if (isFlagged) rqSize++;

      if (c.isCorrect === false) {
        if (isFlagged) detErr++;
        else {
          misErr++;
          se++;
        }
      } else {
        if (isFlagged) fw++;
      }
    }
    console.log(`${th.toFixed(2)}   | ${String(rqSize).padStart(11)} | ${String(detErr).padStart(11)} | ${String(misErr).padStart(9)} | ${String(fw).padStart(9)} | ${String(se).padStart(9)}`);
  }

  // 5. THREE REQUIRED CASES EVIDENCE
  console.log('\n======================================================');
  console.log('5. THREE REQUIRED CASES EVIDENCE');
  console.log('======================================================');
  const caseTargets = ['919ZTRF242991500', '919ZTRF242991502', '9192hv6243011321'];
  for (const ct of caseTargets) {
    const item = allCells.find(c => c.isFresh && c.rawValue === ct);
    if (item) {
      console.log(`Case: "${ct}" (Ground truth: "${item.groundTruthValue}")`);
      console.log(`  Correct? ${item.isCorrect}`);
      console.log(`  Confidence: ${item.confidence} (${item.confidenceSource})`);
      console.log(`  Column: [${item.colIdx}] "${item.colHeader}" (${item.colType})`);
      console.log(`  Severity: ${item.severity} | Reasons: [${item.reasons.join(', ')}]`);
      console.log(`  In Review Queue? ${item.severity !== 'PASS'}`);
    }
  }

  // Save audit data to scratch
  fs.writeFileSync('scratch/q2c2_full_audit_summary.json', JSON.stringify({
    allCellsCount: allCells.length,
    freshCellsCount: freshCells.length,
    legacyCellsCount: legacyCells.length,
    bandCounts,
    typeStats,
    groundTruthStats: {
      total: gtCells.length,
      correct: correctGt.length,
      incorrect: incorrectGt.length,
      recall,
      precision,
      falseWarnings: falseWarnings.length,
      silentErrors: silentErrors.length,
      confusionMatrix: { passCorrect, passIncorrect, warnCorrect, warnIncorrect, critCorrect, critIncorrect }
    }
  }, null, 2));
}

runAudit().catch(console.error);
