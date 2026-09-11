import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function checkMetadata() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rows } = await supabase.from('ocr_results').select('id, page_number, metadata').eq('document_id', 'fa982b65-94e8-4a21-9c74-e28ace4bad85');
  console.log('Metadata sample for Nam A:', rows);
}
checkMetadata().catch(console.error);
