import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function checkNullable() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // Query column info from information_schema
  const { data, error } = await supabase.rpc('get_column_info', { table_name: 'extracted_cells' });
  if (error) {
    // If RPC not present, query a single cell or test insert/select
    const { data: cell } = await supabase.from('extracted_cells').select('confidence_score').limit(1);
    console.log('Sample cell confidence_score:', cell);
  } else {
    console.log('Column info:', data);
  }
}

checkNullable().catch(console.error);
