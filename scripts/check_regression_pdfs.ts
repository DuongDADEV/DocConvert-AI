import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

async function main() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabase = createClient(url, key);

  console.log('=== CHECKING SUPABASE DOCUMENTS TABLE ===');
  const { data: docs, error: docErr } = await supabase.from('documents').select('id, user_id, file_name, original_filename, storage_path, status');
  if (docErr) {
    console.error('Doc query error:', docErr);
  } else {
    for (const d of docs || []) {
      console.log(`Doc ID: ${d.id} | File: ${d.original_filename || d.file_name} | Path: ${d.storage_path} | Status: ${d.status}`);
    }
  }

  console.log('\n=== CHECKING SUPABASE STORAGE: documents bucket ===');
  async function listRecursive(folder = ''): Promise<string[]> {
    const { data: items, error } = await supabase.storage.from('documents').list(folder, { limit: 100 });
    if (error || !items) return [];
    let files: string[] = [];
    for (const item of items) {
      const full = folder ? `${folder}/${item.name}` : item.name;
      if (item.id === null) {
        // directory
        const sub = await listRecursive(full);
        files.push(...sub);
      } else {
        files.push(full);
      }
    }
    return files;
  }

  const allFiles = await listRecursive();
  console.log(`Found ${allFiles.length} files in documents bucket:`);
  for (const f of allFiles) {
    console.log(' - ' + f);
  }

  console.log('\n=== CHECKING LOCAL .data/database.json ===');
  if (fs.existsSync('.data/database.json')) {
    const dbData = JSON.parse(fs.readFileSync('.data/database.json', 'utf-8'));
    console.log('Local DB documents count:', dbData.documents?.length);
    for (const d of (dbData.documents || [])) {
      console.log(`Local doc: ${d.id} | name: ${d.originalFilename || d.fileName} | storagePath: ${d.storagePath}`);
    }
  }
}

main().catch(console.error);
