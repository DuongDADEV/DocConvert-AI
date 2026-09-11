import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('=== 1. SEARCH FOR 919 IN EXTRACTED_CELLS ===');
  const { data: cells, error: cellErr } = await supabase
    .from('extracted_cells')
    .select('id, row_id, raw_value, confidence_score, is_reviewed')
    .ilike('raw_value', '%919%');
  
  if (cellErr) console.error('Cell err:', cellErr);
  else {
    console.log(`Found ${cells?.length || 0} cells containing 919:`);
    for (const c of cells || []) {
      console.log(`Cell: ${c.id} | Row: ${c.row_id} | Raw: "${c.raw_value}" | Conf: ${c.confidence_score} | Reviewed: ${c.is_reviewed}`);
    }
  }

  console.log('\n=== 2. SEARCH FOR 24299 IN EXTRACTED_CELLS ===');
  const { data: cells2 } = await supabase
    .from('extracted_cells')
    .select('id, row_id, raw_value, confidence_score, is_reviewed')
    .ilike('raw_value', '%24299%');
  console.log(`Found ${cells2?.length || 0} cells containing 24299:`);
  for (const c of cells2 || []) {
    console.log(`Cell: ${c.id} | Row: ${c.row_id} | Raw: "${c.raw_value}" | Conf: ${c.confidence_score}`);
  }

  console.log('\n=== 3. SEARCH FOR hv624 IN EXTRACTED_CELLS ===');
  const { data: cells3 } = await supabase
    .from('extracted_cells')
    .select('id, row_id, raw_value, confidence_score, is_reviewed')
    .ilike('raw_value', '%hv624%');
  console.log(`Found ${cells3?.length || 0} cells containing hv624:`);
  for (const c of cells3 || []) {
    console.log(`Cell: ${c.id} | Row: ${c.row_id} | Raw: "${c.raw_value}" | Conf: ${c.confidence_score}`);
  }

  console.log('\n=== 4. SEARCH FOR TRF IN EXTRACTED_CELLS ===');
  const { data: cells4 } = await supabase
    .from('extracted_cells')
    .select('id, row_id, raw_value, confidence_score, is_reviewed')
    .ilike('raw_value', '%TRF%');
  console.log(`Found ${cells4?.length || 0} cells containing TRF:`);
  for (const c of cells4 || []) {
    console.log(`Cell: ${c.id} | Row: ${c.row_id} | Raw: "${c.raw_value}" | Conf: ${c.confidence_score}`);
  }
}

main().catch(console.error);
