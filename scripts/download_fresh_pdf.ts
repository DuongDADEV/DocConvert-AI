import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const bucket = 'documents';
  const path = '27a10269-da23-4bfd-aa19-5ed66b974eff/70ec6614-ccdd-4326-b566-971a629e239c/original/sao-k__-NAM-__-CH___-LAN.pdf';
  console.log('Downloading from Supabase storage:', bucket, path);
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) {
    console.error('Download error:', error);
    process.exit(1);
  }
  const buf = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync('scratch/nam_a_fresh.pdf', buf);
  console.log('Downloaded and saved scratch/nam_a_fresh.pdf, byte length:', buf.length);
}

main().catch(console.error);
