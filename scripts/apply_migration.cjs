require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sql = fs.readFileSync('supabase/migrations/20260906000000_create_document_metadata.sql', 'utf-8');

async function applyMigration() {
  console.log('Checking Supabase connection and metadata table status...');
  const supabase = createClient(url, key);

  // Try creating table via RPC or direct SQL query endpoint
  try {
    const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    console.log('Exec SQL HTTP Response Status:', res.status);
    const txt = await res.text();
    console.log('Response body:', txt);
  } catch (err) {
    console.error('Fetch error:', err);
  }

  // Check table status again
  const { data, error } = await supabase.from('document_metadata').select('*').limit(1);
  if (error) {
    console.log('Supabase document_metadata query status:', error.message);
  } else {
    console.log('SUCCESS: Table document_metadata is ready in Supabase database!');
  }
}

applyMigration();
