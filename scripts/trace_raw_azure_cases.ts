import fs from 'fs';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const rawData = JSON.parse(fs.readFileSync('scratch/nama_raw_azure.json', 'utf-8'));
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const targets = ['919ZTRF242991500', '919ZTRF242991502', '9192hv6243011321'];

  console.log('=== 1. AZURE RAW WORDS AUDIT ===');
  for (const page of rawData.pages || []) {
    for (const w of page.words || []) {
      for (const t of targets) {
        if (w.content.includes(t) || t.includes(w.content)) {
          console.log(`Target: ${t} | Found in Word: "${w.content}" (page ${page.pageNumber}, conf: ${w.confidence}, span: ${JSON.stringify(w.span)}, polygon: ${JSON.stringify(w.polygon)})`);
        }
      }
    }
  }

  console.log('\n=== 2. AZURE RAW TABLES & CELLS AUDIT ===');
  for (let tIdx = 0; tIdx < (rawData.tables || []).length; tIdx++) {
    const table = rawData.tables[tIdx];
    for (const c of table.cells || []) {
      for (const t of targets) {
        if (c.content && c.content.includes(t)) {
          console.log(`Target: ${t} | Table #${tIdx} Cell [${c.rowIndex}, ${c.columnIndex}] content: "${c.content}" | spans: ${JSON.stringify(c.spans)} | polygon: ${JSON.stringify(c.boundingRegions?.[0]?.polygon)} | kind: ${c.kind}`);
        }
      }
    }
  }

  console.log('\n=== 3. DATABASE extracted_cells AUDIT ===');
  const { data: dbCells, error: dbErr } = await supabase
    .from('extracted_cells')
    .select('*')
    .eq('document_id', '70ec6614-ccdd-4326-b566-971a629e239c')
    .in('raw_value', targets);

  if (dbErr) {
    console.error('DB Error:', dbErr);
  } else {
    for (const dbc of dbCells || []) {
      console.log(`DB Cell: id=${dbc.id}, raw_value="${dbc.raw_value}", norm="${dbc.normalized_value}", conf=${dbc.confidence}, conf_source=${dbc.confidence_source}, page=${dbc.source_page}, is_reviewed=${dbc.is_reviewed}`);
    }
  }
}

main().catch(console.error);
