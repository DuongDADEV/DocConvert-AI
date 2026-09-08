import 'dotenv/config';
import fs from 'fs';
import { getSupabaseAdminClient } from '../server/services/supabaseClient.js';

async function runMigration() {
  const client = getSupabaseAdminClient();
  const sql = fs.readFileSync('supabase/migrations/20260908000000_add_metadata_quality_and_semantics.sql', 'utf-8');

  console.log('Running migration: 20260908000000_add_metadata_quality_and_semantics.sql');
  const { data, error } = await client.rpc('exec_sql', { sql });
  if (error) {
    console.error('Migration error:', error);
  } else {
    console.log('Migration executed successfully:', data);
  }

  // Verify column presence
  const { data: sample, error: queryErr } = await client
    .from('document_metadata')
    .select('id, semantic_type, quality_score, visibility_class')
    .limit(1);

  if (queryErr) {
    console.error('Verification query error:', queryErr);
  } else {
    console.log('Verification success! New columns are accessible. Sample:', sample);
  }
}

runMigration().catch(console.error);
