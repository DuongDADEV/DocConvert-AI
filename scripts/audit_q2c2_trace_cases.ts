import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('=== SEARCHING FOR 9192 / 624301 / hv624 IN CELLS ===');
  const { data: cells1 } = await supabase
    .from('extracted_cells')
    .select('id, row_id, raw_value, confidence_score')
    .ilike('raw_value', '%9192%');
  console.log('Cells with 9192:', cells1);

  const { data: cells2 } = await supabase
    .from('extracted_cells')
    .select('id, row_id, raw_value, confidence_score')
    .ilike('raw_value', '%624301%');
  console.log('Cells with 624301:', cells2);

  console.log('\n=== TRACING CELLS WITH 919ZTRF242991500 and 919ZTRF242991502 ===');
  const { data: targetCells } = await supabase
    .from('extracted_cells')
    .select('id, row_id, row_index, column_index, raw_value, normalized_value, confidence_score, is_reviewed')
    .in('raw_value', ['919ZTRF242991500', '919ZTRF242991502']);
  
  console.log(`Found ${targetCells?.length || 0} target cells:`);
  for (const c of targetCells || []) {
    // get row
    const { data: row } = await supabase.from('extracted_rows').select('id, table_id, row_index').eq('id', c.row_id).single();
    if (row) {
      const { data: tbl } = await supabase.from('extracted_tables').select('id, document_id, page_number').eq('id', row.table_id).single();
      const { data: doc } = await supabase.from('documents').select('id, original_filename, file_name').eq('id', tbl?.document_id).single();
      console.log(`Cell ${c.id}: "${c.raw_value}" | Conf: ${c.confidence_score} | RowIdx: ${c.row_index} | ColIdx: ${c.column_index} | Doc: ${doc?.id} (${doc?.original_filename}) | Page: ${tbl?.page_number}`);
    }
  }

  // Search all ocr_results for 9192hv6243011321
  console.log('\n=== SEARCHING OCR_RESULTS FOR 9192hv ===');
  const { data: ocrWithHv } = await supabase
    .from('ocr_results')
    .select('id, document_id, page_number')
    .ilike('raw_text', '%9192%');
  console.log('OCR results with 9192:', ocrWithHv);
}

main().catch(console.error);
