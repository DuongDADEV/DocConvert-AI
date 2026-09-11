import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function checkPdf() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const path = '27a10269-da23-4bfd-aa19-5ed66b974eff/fa982b65-94e8-4a21-9c74-e28ace4bad85/original/sao-k__-NAM-__-CH___-LAN.pdf';
  console.log('Checking storage for Nam A file at:', path);
  const { data, error } = await supabase.storage.from('documents').download(path);
  if (error) {
    console.error('Error downloading:', error);
  } else {
    console.log('Successfully downloaded Nam A PDF! Size bytes:', (await data.arrayBuffer()).byteLength);
  }
}

checkPdf().catch(console.error);
