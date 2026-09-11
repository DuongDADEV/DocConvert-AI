import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';
import { AzureDocumentIntelligenceProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';

interface CellRecord {
  id: string;
  docId: string;
  docName: string;
  isLegacy: boolean;
  page: number;
  rowIdx: number;
  colIdx: number;
  header: string;
  colType: string;
  rawValue: string;
  confidence: number | null;
  confidenceSource: string;
  severity: string;
  reasons: string[];
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('=== LOADING ALL DOCUMENTS & OCR DATA ===');
  const { data: docs } = await supabase.from('documents').select('*').order('created_at', { ascending: false });
  console.log(`Found ${docs?.length || 0} documents.`);

  // Categorize docs by fresh vs legacy
  // Legacy docs are those populated before Q2A or having uniform 0.95
  const docConfidenceProfiles: any[] = [];
  const allAuditedCells: CellRecord[] = [];

  for (const doc of docs || []) {
    const { data: ocrRows } = await supabase.from('ocr_results').select('*').eq('document_id', doc.id);
    const { data: tables } = await supabase.from('extracted_tables').select('*').eq('document_id', doc.id);

    if (!tables || tables.length === 0) continue;

    // Fetch rows and cells
    const tableIds = tables.map(t => t.id);
    const { data: rows } = await supabase.from('extracted_rows').select('*').in('table_id', tableIds);
    if (!rows || rows.length === 0) continue;

    const rowIds = rows.map(r => r.id);
    // Batch fetch cells
    const { data: cells } = await supabase.from('extracted_cells').select('*').in('row_id', rowIds);
    if (!cells || cells.length === 0) continue;

    // Check confidences
    const confs = cells.map(c => c.confidence_score).filter(c => typeof c === 'number');
    const hasOnlyPoint95 = confs.length > 0 && confs.every(c => c === 0.95);
    const isLegacy = hasOnlyPoint95 || doc.created_at < '2026-09-08';

    docConfidenceProfiles.push({
      id: doc.id,
      name: doc.original_filename || doc.file_name,
      createdAt: doc.created_at,
      status: doc.status,
      tableCount: tables.length,
      rowCount: rows.length,
      cellCount: cells.length,
      confsCount: confs.length,
      isLegacy,
      sampleConfs: Array.from(new Set(confs)).slice(0, 5)
    });
  }

  console.log('--- Document Confidence Profiles ---');
  console.table(docConfidenceProfiles);

  // Now inspect review actions
  console.log('\n=== REVIEW ACTIONS AUDIT ===');
  const { data: actions } = await supabase.from('review_actions').select('*').order('created_at', { ascending: false });
  console.log(`Total review actions: ${actions?.length || 0}`);
  
  const editActions = actions?.filter(a => a.action_type === 'EDIT_CELL') || [];
  const confirmActions = actions?.filter(a => a.action_type === 'CONFIRM_AS_IS') || [];

  console.log(`EDIT_CELL actions count: ${editActions.length}`);
  console.log(`CONFIRM_AS_IS actions count: ${confirmActions.length}`);

  // Inspect CONFIRM_AS_IS cells in detail
  const confirmedDetails: any[] = [];
  for (const ca of confirmActions) {
    if (!ca.cell_id) continue;
    const { data: cell } = await supabase.from('extracted_cells').select('*').eq('id', ca.cell_id).single();
    if (cell) {
      confirmedDetails.push({
        cellId: cell.id,
        val: cell.raw_value,
        conf: cell.confidence_score,
        isReviewed: cell.is_reviewed
      });
    }
  }
  console.log('CONFIRM_AS_IS Details sample:', confirmedDetails.slice(0, 10));

  // Inspect EDIT_CELL actions in detail
  const editDetails: any[] = [];
  for (const ea of editActions) {
    editDetails.push({
      cellId: ea.cell_id,
      oldVal: ea.old_value,
      newVal: ea.new_value,
      createdAt: ea.created_at
    });
  }
  console.log('EDIT_CELL Details:', editDetails);

  // Save full profile to JSON
  fs.writeFileSync('scratch/audit_q2c2_doc_profiles.json', JSON.stringify({
    docProfiles: docConfidenceProfiles,
    editActions: editDetails,
    confirmActions: confirmedDetails
  }, null, 2));
}

main().catch(console.error);
