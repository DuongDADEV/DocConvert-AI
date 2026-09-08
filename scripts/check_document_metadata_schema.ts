import 'dotenv/config';
import { getSupabaseAdminClient } from '../server/services/supabaseClient.js';

async function check() {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.from('document_metadata').select('*').limit(1);
  if (error) {
    console.error('Error selecting from document_metadata:', error);
  } else if (data && data.length > 0) {
    console.log('Columns in document_metadata:', Object.keys(data[0]));
  } else {
    console.log('Table exists but is empty. Trying dummy insert to check columns...');
    const dummy = {
      id: crypto.randomUUID(),
      document_id: 'b55bb467-20ae-4939-b1c8-c28e0895854b',
      label: 'Test',
      raw_label: 'Test',
      value: '123',
      raw_value: '123',
      normalized_label: 'test',
      normalized_value_for_match: '123',
    };
    const { error: insErr } = await client.from('document_metadata').insert(dummy);
    console.log('Insert dummy result:', insErr ? insErr.message : 'SUCCESS');
    const { data: d2 } = await client.from('document_metadata').select('*').limit(1);
    if (d2 && d2.length > 0) {
      console.log('Columns:', Object.keys(d2[0]));
      await client.from('document_metadata').delete().eq('id', dummy.id);
    }
  }
}

check().catch(console.error);
