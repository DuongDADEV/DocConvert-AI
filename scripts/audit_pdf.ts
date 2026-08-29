import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('SUPABASE_URL:', url);

async function test() {
  const supabase = createClient(url, key);
  const userId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';
  const docId = 'b55bb467-20ae-4939-b1c8-c28e0895854b';

  const { data: list, error: listErr } = await supabase.storage
    .from('documents')
    .list(`${userId}/${docId}/original`);

  console.log('Storage files list:', list, listErr);

  if (list && list.length > 0) {
    const fileName = list[0].name;
    const { data: downloadData, error: downloadErr } = await supabase.storage
      .from('documents')
      .download(`${userId}/${docId}/original/${fileName}`);

    if (downloadData) {
      const arrayBuf = await downloadData.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      console.log('Downloaded file size:', buffer.length, 'bytes');

      const pdfDoc = await PDFDocument.load(buffer);
      console.log('Actual PDF Page Count in Storage:', pdfDoc.getPageCount());
    } else {
      console.log('Download error:', downloadErr);
    }
  }
}

test().catch(console.error);
