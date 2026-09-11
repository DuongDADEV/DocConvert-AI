import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function traceCells() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Trace one of the cells
  const cellId = '3070a225-a99a-43b6-a2b1-1085489b0a70';
  const { data: cell } = await supabase.from('extracted_cells').select('*, extracted_rows(*)').eq('id', cellId).single();
  console.log('Cell info:', cell);
  if (cell && cell.extracted_rows) {
    const tableId = cell.extracted_rows.table_id;
    const { data: table } = await supabase.from('extracted_tables').select('*, documents(*)').eq('id', tableId).single();
    console.log('Table info:', table);
    console.log('Document info:', table?.documents);
  }

  // Also query all cells in that table/document with "50,000" or similar
  const { data: allCellsInDoc } = await supabase
    .from('extracted_cells')
    .select('id, raw_value, confidence_score, column_index, row_id, bounding_box')
    .ilike('raw_value', '%50%000%');
  console.log('All cells matching 50%000:', allCellsInDoc);

  const { data: ichCells } = await supabase
    .from('extracted_cells')
    .select('id, raw_value, confidence_score, column_index, row_id, bounding_box')
    .ilike('raw_value', '%ICH 50%');
  console.log('Cells matching ICH 50%:', ichCells);
}

traceCells().catch(console.error);
