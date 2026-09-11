import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function check() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ocrRows } = await supabase.from('ocr_results').select('*').limit(2);
  console.log('ocr_results cols:', ocrRows ? Object.keys(ocrRows[0]) : null);
  if (ocrRows && ocrRows[0]) {
    console.log('ocr_results sample:', {
      id: ocrRows[0].id,
      document_id: ocrRows[0].document_id,
      model_id: ocrRows[0].model_id,
      raw_response: ocrRows[0].raw_response ? 'EXISTS (length: ' + JSON.stringify(ocrRows[0].raw_response).length + ')' : 'NULL',
    });
  }

  // Check if raw_response exists for the Nam A problematic document
  const { data: namARow } = await supabase.from('ocr_results').select('*').eq('document_id', 'fa982b65-94e8-4a21-9c74-e28ace4bad85');
  console.log('Nam A ocr_results count:', namARow?.length);
  if (namARow && namARow[0]) {
    console.log('Nam A ocr_results has raw_response:', Boolean(namARow[0].raw_response));
    console.log('Keys in namARow[0]:', Object.keys(namARow[0]));
  }
}

check().catch(console.error);
