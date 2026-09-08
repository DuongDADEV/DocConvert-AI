import 'dotenv/config';
import { getSupabaseAdminClient } from '../server/services/supabaseClient.js';

async function testRpc() {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc('exec_sql', { sql: 'GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;' });
  console.log('RPC result:', data, error);
}

testRpc();
