import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const docId = '70ec6614-ccdd-4326-b566-971a629e239c';
  const { data: doc, error } = await supabase.from('documents').select('*').eq('id', docId).single();
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Doc keys:', Object.keys(doc));
    console.log('Doc details:', JSON.stringify(doc, null, 2));
  }
}

main().catch(console.error);
