import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getSupabaseAdminClient } from '../server/services/supabaseClient.js';

async function migrateJsonToSupabase() {
  console.log('==================================================');
  console.log('MIGRATING .data/database.json TO SUPABASE POSTGRESQL');
  console.log('==================================================\n');

  const dbPath = path.join(process.cwd(), '.data', 'database.json');
  if (!fs.existsSync(dbPath)) {
    console.log('No .data/database.json file found. Skipping migration.');
    return;
  }

  const raw = fs.readFileSync(dbPath, 'utf-8');
  const data = JSON.parse(raw);
  const client = getSupabaseAdminClient();

  if (!client) {
    console.error('Supabase Admin Client unavailable! Check SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY.');
    return;
  }

  // 1. Migrate Profiles
  if (Array.isArray(data.profiles) && data.profiles.length > 0) {
    console.log(`Migrating ${data.profiles.length} profiles...`);
    for (const p of data.profiles) {
      // Ensure user exists in auth.users or insert profile
      const { error } = await client.from('profiles').upsert({
        id: p.id,
        email: p.email,
        full_name: p.full_name || p.fullName || 'User',
        avatar_url: p.avatar_url || null,
        current_plan_id: p.current_plan_id || 'FREE',
        used_documents: p.used_documents || 0,
        created_at: p.created_at || new Date().toISOString(),
        updated_at: p.updated_at || new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) console.warn('Profile upsert warning:', error.message);
    }
  }

  // 2. Migrate Documents
  if (Array.isArray(data.documents) && data.documents.length > 0) {
    console.log(`Migrating ${data.documents.length} documents...`);
    for (const d of data.documents) {
      const { error } = await client.from('documents').upsert({
        id: d.id,
        user_id: d.user_id,
        original_filename: d.original_filename,
        file_name: d.file_name,
        file_type: d.file_type,
        mime_type: d.mime_type,
        file_size: d.file_size,
        page_count: d.page_count || 1,
        storage_bucket: d.storage_bucket || 'documents',
        storage_path: d.storage_path,
        document_type: d.document_type || 'BANK_STATEMENT',
        status: d.status,
        created_at: d.created_at,
        updated_at: d.updated_at,
        deleted_at: d.deleted_at || null,
      }, { onConflict: 'id' });
      if (error) console.warn('Document upsert warning:', error.message);
    }
  }

  // 3. Migrate Processing Jobs
  if (Array.isArray(data.processing_jobs) && data.processing_jobs.length > 0) {
    console.log(`Migrating ${data.processing_jobs.length} processing jobs...`);
    for (const j of data.processing_jobs) {
      const { error } = await client.from('processing_jobs').upsert({
        id: j.id,
        document_id: j.document_id,
        user_id: j.user_id,
        status: j.status,
        current_step: j.current_step,
        progress: j.progress,
        attempt_count: j.attempt_count || 1,
        error_code: j.error_code || null,
        error_message: j.error_message || null,
        started_at: j.started_at || null,
        completed_at: j.completed_at || null,
        created_at: j.created_at,
        updated_at: j.updated_at,
      }, { onConflict: 'id' });
      if (error) console.warn('Job upsert warning:', error.message);
    }
  }

  // 4. Migrate OCR Results
  if (Array.isArray(data.ocr_results) && data.ocr_results.length > 0) {
    console.log(`Migrating ${data.ocr_results.length} OCR result records...`);
    const batchSize = 100;
    for (let i = 0; i < data.ocr_results.length; i += batchSize) {
      const chunk = data.ocr_results.slice(i, i + batchSize).map((r: any) => ({
        id: r.id,
        document_id: r.document_id,
        page_number: r.page_number,
        raw_text: r.raw_text,
        confidence_score: r.confidence_score,
        azure_model_id: r.azure_model_id || 'prebuilt-layout',
        metadata: r.metadata || {},
        created_at: r.created_at,
      }));
      const { error } = await client.from('ocr_results').upsert(chunk, { onConflict: 'id' });
      if (error) console.warn('OCR results upsert warning:', error.message);
    }
  }

  // 5. Migrate Extracted Tables
  if (Array.isArray(data.extracted_tables) && data.extracted_tables.length > 0) {
    console.log(`Migrating ${data.extracted_tables.length} extracted tables...`);
    const batchSize = 100;
    for (let i = 0; i < data.extracted_tables.length; i += batchSize) {
      const chunk = data.extracted_tables.slice(i, i + batchSize).map((t: any) => ({
        id: t.id,
        document_id: t.document_id,
        page_number: t.page_number,
        table_index: t.table_index,
        row_count: t.row_count,
        column_count: t.column_count,
        confidence_score: t.confidence_score,
        created_at: t.created_at,
      }));
      const { error } = await client.from('extracted_tables').upsert(chunk, { onConflict: 'id' });
      if (error) console.warn('Extracted tables upsert warning:', error.message);
    }
  }

  // 6. Migrate Extracted Rows
  if (Array.isArray(data.extracted_rows) && data.extracted_rows.length > 0) {
    console.log(`Migrating ${data.extracted_rows.length} extracted rows...`);
    const batchSize = 200;
    for (let i = 0; i < data.extracted_rows.length; i += batchSize) {
      const chunk = data.extracted_rows.slice(i, i + batchSize).map((r: any) => ({
        id: r.id,
        table_id: r.table_id,
        row_index: r.row_index,
        created_at: r.created_at,
      }));
      const { error } = await client.from('extracted_rows').upsert(chunk, { onConflict: 'id' });
      if (error) console.warn('Extracted rows upsert warning:', error.message);
    }
  }

  // 7. Migrate Extracted Cells (Batch insert size 200)
  if (Array.isArray(data.extracted_cells) && data.extracted_cells.length > 0) {
    console.log(`Migrating ${data.extracted_cells.length} extracted cells...`);
    const batchSize = 200;
    for (let i = 0; i < data.extracted_cells.length; i += batchSize) {
      const chunk = data.extracted_cells.slice(i, i + batchSize).map((c: any) => ({
        id: c.id,
        row_id: c.row_id,
        column_index: c.column_index,
        raw_value: c.raw_value,
        normalized_value: c.normalized_value,
        cell_type: c.cell_type || 'TEXT',
        confidence_score: c.confidence_score,
        is_reviewed: c.is_reviewed || false,
        bounding_box: c.bounding_box || null,
        created_at: c.created_at,
        updated_at: c.updated_at,
      }));
      const { error } = await client.from('extracted_cells').upsert(chunk, { onConflict: 'id' });
      if (error) console.warn('Extracted cells upsert warning:', error.message);
    }
  }

  console.log('\n==================================================');
  console.log('MIGRATION TO SUPABASE POSTGRESQL COMPLETE! ✅');
  console.log('==================================================');
}

migrateJsonToSupabase().catch((err) => {
  console.error('Migration error:', err);
});
