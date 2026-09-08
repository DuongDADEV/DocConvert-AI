import 'dotenv/config';
import { getSupabaseAdminClient } from '../server/services/supabaseClient.js';

async function testPermissions() {
  const client = getSupabaseAdminClient();
  console.log('Testing client table access...');

  const tables = ['profiles', 'documents', 'processing_jobs', 'ocr_results', 'extracted_tables', 'extracted_rows', 'extracted_cells', 'review_actions', 'export_files', 'audit_logs'];

  for (const t of tables) {
    const { data, error } = await client.from(t).select('id').limit(1);
    if (error) {
      console.error(`Table [${t}] Error:`, error.message, error.code, error.hint);
    } else {
      console.log(`Table [${t}] OK (Count: ${data?.length})`);
    }
  }
}

testPermissions();
