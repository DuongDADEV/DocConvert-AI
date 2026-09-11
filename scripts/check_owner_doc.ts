import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function check() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: cell } = await supabase.from('extracted_cells').select('id, raw_value, row_id').eq('id', 'cadfe41e-fe4b-4796-a8e0-96e239544868').single();
  const { data: row } = await supabase.from('extracted_rows').select('id, table_id, row_index').eq('id', cell?.row_id).single();
  const { data: table } = await supabase.from('extracted_tables').select('*').eq('id', row?.table_id).single();
  console.log('table:', table);
  const { data: doc } = await supabase.from('documents').select('*').eq('id', table?.document_id);
  console.log('doc query:', doc);
}
check().catch(console.error);
