import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const azureEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '';
const azureKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '';

async function testAzurePagesParam() {
  const supabase = createClient(url, key);
  const userId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';
  const docId = 'b55bb467-20ae-4939-b1c8-c28e0895854b';

  const { data: downloadData } = await supabase.storage
    .from('documents')
    .download(`${userId}/${docId}/original/sao-k__-acb-Medihub-2023.pdf`);

  const buffer = Buffer.from(await downloadData!.arrayBuffer());
  const cleanEndpoint = azureEndpoint.replace(/\/+$/, '');
  const apiVersion = '2024-11-30';

  // Test 1: pages=1-8
  const analyzeUrlPages = `${cleanEndpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${apiVersion}&pages=1-8`;
  console.log('Testing URL with pages=1-8:', analyzeUrlPages);

  const submitRes = await fetch(analyzeUrlPages, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': azureKey,
      'Content-Type': 'application/pdf',
    },
    body: new Uint8Array(buffer),
  });

  console.log('Submit HTTP Status:', submitRes.status);
  const opLoc = submitRes.headers.get('operation-location');
  console.log('Operation Location:', opLoc);

  if (opLoc) {
    let attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;
      const pollRes = await fetch(opLoc, {
        headers: { 'Ocp-Apim-Subscription-Key': azureKey },
      });
      const pollData: any = await pollRes.json();
      console.log(`Poll attempt ${attempts} status:`, pollData.status);
      if (pollData.status === 'succeeded') {
        const analyzeResult = pollData.analyzeResult;
        console.log('AnalyzeResult pages returned count:', analyzeResult.pages?.length);
        console.log('AnalyzeResult pages numbers:', analyzeResult.pages?.map((p: any) => p.pageNumber));
        console.log('AnalyzeResult tables count:', analyzeResult.tables?.length);
        console.log('Error detail if any:', pollData.error);
        break;
      } else if (pollData.status === 'failed') {
        console.log('Poll Failed Error:', JSON.stringify(pollData.error));
        break;
      }
    }
  }
}

testAzurePagesParam().catch(console.error);
