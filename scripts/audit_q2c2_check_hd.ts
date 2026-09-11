import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { db } from '../server/db/db.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function check() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: d } = await supabase.from('documents').select('*').eq('id', 'd79873be-7dd7-4441-8c63-68c6077adfd0').single();
  console.log('d798 doc:', d?.id, d?.user_id);

  const { data: d2 } = await supabase.from('documents').select('*').eq('id', '93c5f47f-659f-4e5f-be03-fd0ad073ab88').single();
  console.log('93c5 doc:', d2?.id, d2?.user_id);

  const ocr1 = await db.getDocumentOcrResult(d?.user_id, d?.id);
  console.log('ocr1 tables:', ocr1?.tables?.length);
  const u1 = UnifiedTableService.projectDocumentTables(d?.id, ocr1?.tables || []);
  console.log('u1:', u1 ? `rows=${u1.rows.length}, cols=${u1.columns.length}` : 'NULL');

  const ocr2 = await db.getDocumentOcrResult(d2?.user_id, d2?.id);
  console.log('ocr2 tables:', ocr2?.tables?.length);
  const u2 = UnifiedTableService.projectDocumentTables(d2?.id, ocr2?.tables || []);
  console.log('u2:', u2 ? `rows=${u2.rows.length}, cols=${u2.columns.length}` : 'NULL');
}

check().catch(console.error);
