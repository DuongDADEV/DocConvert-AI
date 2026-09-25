import 'dotenv/config';
import fs from 'fs';
import { getSupabaseAdminClient } from '../server/services/supabaseClient.js';

async function runMigration() {
  const client = getSupabaseAdminClient();
  const sql = fs.readFileSync('supabase/migrations/20260924000000_create_document_pages_and_preflight.sql', 'utf-8');

  console.log('Running migration: 20260924000000_create_document_pages_and_preflight.sql');
  const { data, error } = await client.rpc('exec_sql', { sql });
  if (error) {
    console.error('Migration error via exec_sql:', error);
  } else {
    console.log('Migration executed successfully via exec_sql:', data);
  }

  // Verify document_pages table presence
  const { data: sample, error: queryErr } = await client
    .from('document_pages')
    .select('*')
    .limit(1);

  if (queryErr) {
    console.error('Verification query error on document_pages:', queryErr.message);
  } else {
    console.log('Verification success! Table document_pages is accessible. Sample count:', sample?.length);
  }

  // Verify columns on documents table
  const { data: docSample, error: docErr } = await client
    .from('documents')
    .select('id, preflight_summary, output_type')
    .limit(1);

  if (docErr) {
    console.error('Verification query error on documents new columns:', docErr.message);
  } else {
    console.log('Verification success! Columns preflight_summary, output_type exist. Doc Sample:', docSample);
  }
}

runMigration().catch(console.error);
