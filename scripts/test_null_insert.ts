import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function testNullInsert() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  // Get an existing row_id to satisfy foreign key
  const { data: existingCell } = await supabase.from('extracted_cells').select('row_id').limit(1).single();
  if (!existingCell) {
    console.log('No cell found');
    return;
  }

  console.log('Testing insert with confidence_score: null...');
  const testId = '00000000-0000-0000-0000-000000000999';
  const { data, error } = await supabase.from('extracted_cells').insert({
    id: testId,
    row_id: existingCell.row_id,
    column_index: 99,
    raw_value: '',
    confidence_score: null,
  }).select();

  if (error) {
    console.error('Insert error with null confidence_score:', error);
  } else {
    console.log('SUCCESS! Null confidence_score is ALLOWED by database schema:', data);
    // Clean up test row
    await supabase.from('extracted_cells').delete().eq('id', testId);
    console.log('Cleaned up test row.');
  }
}

testNullInsert().catch(console.error);
