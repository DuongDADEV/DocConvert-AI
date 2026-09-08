import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function inspectDbOcr() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabase = createClient(url, key);

  console.log('--- Checking document_metadata table for HDBank ---');
  const { data: metaList, error: metaErr } = await supabase
    .from('document_metadata')
    .select('*')
    .limit(50);

  if (metaErr) {
    console.error('Metadata query error:', metaErr);
  } else {
    console.log(`Found ${metaList?.length || 0} rows in document_metadata.`);
    const docs = new Set(metaList?.map(m => m.document_id));
    console.log('Document IDs in document_metadata:', Array.from(docs));
    for (const m of metaList || []) {
      console.log(`[${m.document_id}] label="${m.label}" value="${m.value}" status=${m.status} conf=${m.confidence} page=${m.source_page}`);
    }
  }

  console.log('\n--- Checking ocr_results table for documents ---');
  const { data: ocrList, error: ocrErr } = await supabase
    .from('ocr_results')
    .select('id, document_id, model_id, overall_confidence, created_at')
    .limit(20);

  if (ocrErr) {
    console.error('OCR query error:', ocrErr);
  } else {
    for (const o of ocrList || []) {
      console.log(`OCR Result ID=${o.id} doc=${o.document_id} conf=${o.overall_confidence} date=${o.created_at}`);
    }
  }
}

inspectDbOcr().catch(console.error);
