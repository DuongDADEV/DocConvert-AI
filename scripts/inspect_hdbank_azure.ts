import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function main() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabase = createClient(url, key);

  const endpoint = (process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '').trim();

  if (!endpoint || !apiKey) {
    console.error('Azure credentials not set');
    return;
  }

  const hdbPath = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c/80636c44-d41c-4a62-a502-a198d9d4fde3/original/sao-k__-HD-CH___-LAN.pdf';
  console.log('Downloading HDBank PDF from Supabase storage...');
  const { data: fileData, error: err } = await supabase.storage.from('documents').download(hdbPath);
  if (err || !fileData) {
    console.error('Download error:', err);
    return;
  }

  const pdfBuffer = Buffer.from(await fileData.arrayBuffer());
  console.log(`Downloaded HDBank PDF (${pdfBuffer.length} bytes). Calling Azure...`);

  const apiVersion = '2024-11-30';
  const modelId = 'prebuilt-layout';
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${modelId}:analyze?api-version=${apiVersion}&features=keyValuePairs`;

  const postRes = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/pdf',
    },
    body: new Uint8Array(pdfBuffer),
  });

  if (!postRes.ok) {
    console.error(`Azure POST failed: HTTP ${postRes.status}`, await postRes.text());
    return;
  }

  const opLocation = postRes.headers.get('Operation-Location');
  console.log('Azure Operation-Location received. Polling...');

  let analyzeResult: any = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(opLocation!, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    });
    if (!pollRes.ok) {
      console.log(`Poll HTTP ${pollRes.status}`);
      continue;
    }
    const data: any = await pollRes.json();
    console.log(`Poll attempt ${attempt + 1}: status=${data.status}`);
    if (data.status === 'succeeded') {
      analyzeResult = data.analyzeResult;
      break;
    } else if (data.status === 'failed') {
      console.error('Azure analysis failed:', data.error);
      return;
    }
  }

  if (!analyzeResult) {
    console.error('Timed out polling Azure');
    return;
  }

  fs.mkdirSync('scratch', { recursive: true });
  fs.writeFileSync('scratch/hdbank_raw_azure.json', JSON.stringify(analyzeResult, null, 2));
  console.log('Saved raw Azure response to scratch/hdbank_raw_azure.json');
  console.log('Pages count:', analyzeResult.pages?.length);
  console.log('Tables count:', analyzeResult.tables?.length);
  console.log('KeyValuePairs count:', analyzeResult.keyValuePairs?.length);
}

main().catch(console.error);
