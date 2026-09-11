import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function checkNullability() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  // 1. Query information_schema.columns
  const { data, error } = await supabase
    .from('extracted_cells')
    .select('id, confidence_score, raw_value')
    .limit(5);

  console.log('Sample cells from extracted_cells:', data);

  // 2. Test updating or inserting with null confidence_score on a dummy or test row, or query schema
  // Let's query information_schema if available or check via RPC
  const { data: cols, error: colErr } = await supabase.rpc('test_rpc');
  console.log('RPC result:', cols, colErr);
}

checkNullability().catch(console.error);
