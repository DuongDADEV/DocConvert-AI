import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('=== INSPECTING SPECIFIC CELLS ===');
  const ids = [
    '90ffb954-ed33-4190-8f7d-e0ff3642e7db',
    'db166907-fdf1-4d14-a77e-282c47811858',
    '700bf1eb-dc14-49e9-9adb-e824be0321ea',
    '1bef3a8e-8e5d-45be-8ac7-36222b62692f',
    '1753c08a-c415-4965-95ca-7aa147e21b14'
  ];

  for (const id of ids) {
    const { data: cell } = await supabase.from('extracted_cells').select('*').eq('id', id).single();
    if (!cell) {
      console.log(`Cell ${id} not found`);
      continue;
    }
    const { data: row } = await supabase.from('extracted_rows').select('*').eq('id', cell.row_id).single();
    const { data: table } = await supabase.from('extracted_tables').select('*').eq('id', row?.table_id).single();
    const { data: doc } = await supabase.from('documents').select('*').eq('id', table?.document_id).single();

    console.log(`\n--- Cell ${cell.id} ---`);
    console.log(`Raw value: "${cell.raw_value}" (length: ${cell.raw_value?.length})`);
    console.log(`Raw value JSON: ${JSON.stringify(cell.raw_value)}`);
    console.log(`Confidence score: ${cell.confidence_score}`);
    console.log(`Row index: ${cell.row_index}, Col index: ${cell.column_index}`);
    console.log(`Table page: ${table?.page_number}, Table index: ${table?.table_index}`);
    console.log(`Document: ${doc?.id} | Name: ${doc?.original_filename || doc?.file_name}`);
    console.log(`Document created_at: ${doc?.created_at}`);
  }
}

main().catch(console.error);
