import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function searchAll() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  // List all documents
  const { data: docs } = await supabase.from('documents').select('id, filename, user_id, status, created_at');
  console.log(`Total docs in DB: ${docs?.length}`);
  docs?.forEach(d => console.log(`  ${d.id} | ${d.filename} | ${d.status}`));

  // Check extracted_cells directly with ilike on raw_value
  const queries = ['%95%909%', '%94%709%', '%50%000%', '%50%039%', '%ICH%'];
  for (const q of queries) {
    const { data: cells, error } = await supabase
      .from('extracted_cells')
      .select('id, raw_value, confidence_score, row_id')
      .ilike('raw_value', q)
      .limit(10);
    if (error) console.error('Query error:', error);
    console.log(`Query "${q}" found ${cells?.length} cells:`);
    cells?.forEach(c => console.log(`   cell ${c.id}: "${c.raw_value}" (conf: ${c.confidence_score})`));
  }
}

searchAll().catch(console.error);
