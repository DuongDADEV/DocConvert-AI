import 'dotenv/config';
import { db } from '../server/db/db.js';

async function check() {
  const client = db.getClient();
  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';
  const docs = await db.getUserDocuments(userId);
  console.log('=== USER DOCUMENTS FROM DB ===');
  docs.forEach(d => {
    console.log(`Doc: ${d.id} | Name: ${d.file_name} | Status: ${d.status} | Created: ${d.created_at}`);
  });

  const { data: jobs } = await client.from('processing_jobs').select('*').eq('document_id', docId);
  console.log('=== PROCESSING JOBS ===');
  jobs?.forEach(j => {
    console.log({
      id: j.id,
      status: j.status,
      progress: j.progress,
      started_at: j.started_at,
      completed_at: j.completed_at,
      error: j.error
    });
  });

  const { count: ocrCount } = await client.from('ocr_results').select('*', { count: 'exact', head: true }).eq('document_id', docId);
  const { count: tablesCount } = await client.from('extracted_tables').select('*', { count: 'exact', head: true }).eq('document_id', docId);
  const { count: rowsCount } = await client.from('extracted_rows').select('*', { count: 'exact', head: true }).in('table_id', (await client.from('extracted_tables').select('id').eq('document_id', docId)).data?.map(t => t.id) || []);
  const { count: cellsCount } = await client.from('extracted_cells').select('*', { count: 'exact', head: true }).in('table_id', (await client.from('extracted_tables').select('id').eq('document_id', docId)).data?.map(t => t.id) || []);
  
  console.log('=== DB ENTITIES ===');
  console.log({
    ocr_results_count: ocrCount,
    extracted_tables_count: tablesCount,
    extracted_rows_count: rowsCount,
    extracted_cells_count: cellsCount
  });
}

check().catch(console.error);
