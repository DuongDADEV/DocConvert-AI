import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';

async function testAccess() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabase = createClient(url, key);

  console.log('Testing access to real PDFs...');

  // 1. HDBank
  const hdbPath = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c/80636c44-d41c-4a62-a502-a198d9d4fde3/original/sao-k__-HD-CH___-LAN.pdf';
  const { data: hdbData, error: hdbErr } = await supabase.storage.from('documents').download(hdbPath);
  if (hdbErr || !hdbData) {
    console.error('HDBank download failed:', hdbErr);
  } else {
    const buf = Buffer.from(await hdbData.arrayBuffer());
    const doc = await PDFDocument.load(buf);
    console.log(`[PASS] HDBank: ${buf.length} bytes, ${doc.getPageCount()} pages`);
  }

  // 2. ACB Medihub
  const acbPath = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c/b55bb467-20ae-4939-b1c8-c28e0895854b/original/sao-k__-acb-Medihub-2023.pdf';
  const { data: acbData, error: acbErr } = await supabase.storage.from('documents').download(acbPath);
  if (acbErr || !acbData) {
    console.error('ACB Medihub download failed:', acbErr);
  } else {
    const buf = Buffer.from(await acbData.arrayBuffer());
    const doc = await PDFDocument.load(buf);
    console.log(`[PASS] ACB Medihub: ${buf.length} bytes, ${doc.getPageCount()} pages`);
  }

  // 3. Nam A (AMABANK)
  const namaPath = '27a10269-da23-4bfd-aa19-5ed66b974eff/82537093-4f56-4328-962d-de5237e7a9eb/original/sao-k__-NAM-__-CH___-LAN.pdf';
  const { data: namaData, error: namaErr } = await supabase.storage.from('documents').download(namaPath);
  if (namaErr || !namaData) {
    console.error('Nam A download failed:', namaErr);
  } else {
    const buf = Buffer.from(await namaData.arrayBuffer());
    const doc = await PDFDocument.load(buf);
    console.log(`[PASS] Nam A Bank: ${buf.length} bytes, ${doc.getPageCount()} pages`);
  }

  // 4. Techcombank (local)
  const tcbPath = '.data/storage/users/043af828-5d8b-438e-af94-c8cee1084647/documents/9619bb14-01c5-4441-be2a-e06ee99edeea/original/sao-ke-tcb-userb.pdf';
  if (!fs.existsSync(tcbPath)) {
    console.error('Techcombank file not found locally:', tcbPath);
  } else {
    const buf = fs.readFileSync(tcbPath);
    try {
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
      console.log(`[PASS] Techcombank: ${buf.length} bytes, ${doc.getPageCount()} pages`);
    } catch (e: any) {
      console.log(`[WARN] Techcombank: ${buf.length} bytes, PDFDocument error: ${e.message}, Header: ${buf.subarray(0, 16).toString()}`);
    }
  }

  // 5. Ban Viet (Supabase)
  const bvPath = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c/ffec64e8-f5d8-4e2d-929b-124882b3e099/original/sao-k__-B___N-VI___T-CH___-LAN.pdf';
  const { data: bvData, error: bvErr } = await supabase.storage.from('documents').download(bvPath);
  if (bvErr || !bvData) {
    console.error('Ban Viet download failed:', bvErr);
  } else {
    const buf = Buffer.from(await bvData.arrayBuffer());
    try {
      const doc = await PDFDocument.load(buf);
      console.log(`[PASS] Ban Viet Bank: ${buf.length} bytes, ${doc.getPageCount()} pages`);
    } catch (e: any) {
      console.log(`[WARN] Ban Viet: ${buf.length} bytes, PDFDocument error: ${e.message}`);
    }
  }
}

testAccess().catch(console.error);
