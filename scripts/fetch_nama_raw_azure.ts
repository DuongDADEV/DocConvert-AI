import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function main() {
  if (fs.existsSync('scratch/nama_raw_azure.json')) {
    console.log('scratch/nama_raw_azure.json already exists!');
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const endpoint = (process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '').trim();

  if (!endpoint || !apiKey) {
    console.error('Azure credentials not set');
    return;
  }

  const path = '27a10269-da23-4bfd-aa19-5ed66b974eff/fa982b65-94e8-4a21-9c74-e28ace4bad85/original/sao-k__-NAM-__-CH___-LAN.pdf';
  console.log('Downloading Nam A PDF from Supabase storage...');
  const { data: fileData, error: err } = await supabase.storage.from('documents').download(path);
  if (err || !fileData) {
    console.error('Download error:', err);
    return;
  }

  const pdfBuffer = Buffer.from(await fileData.arrayBuffer());
  console.log(`Downloaded Nam A PDF (${pdfBuffer.length} bytes). Calling Azure Document Intelligence...`);

  const apiVersion = '2024-11-30';
  const modelId = 'prebuilt-layout';
  // Send pages=1-2 to keep it fast and focused on the table with the problematic cells!
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${modelId}:analyze?api-version=${apiVersion}&features=keyValuePairs&pages=1-2`;

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
  fs.writeFileSync('scratch/nama_raw_azure.json', JSON.stringify(analyzeResult, null, 2));
  console.log('Saved raw Azure response to scratch/nama_raw_azure.json');
  console.log('Pages count:', analyzeResult.pages?.length);
  console.log('Tables count:', analyzeResult.tables?.length);
}

main().catch(console.error);
