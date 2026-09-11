import fs from 'fs';
import { AzureDocumentIntelligenceProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { UnifiedTableService } from '../server/services/unifiedTableService.js';

async function test() {
  const provider = new AzureDocumentIntelligenceProvider();
  const rawHd = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));
  const hdOcr = (provider as any).parseAzureAnalyzeResult(rawHd, 'prebuilt-layout');
  console.log('HD tables count:', hdOcr.tables?.length);
  for (let i = 0; i < hdOcr.tables.length; i++) {
    const t = hdOcr.tables[i];
    console.log(`Table ${i}: rows=${t.rows?.length}, headers=${JSON.stringify(t.headers)}`);
  }
  const hdUnified = UnifiedTableService.projectDocumentTables('hdbank-raw-fresh', hdOcr.tables);
  console.log('HD Unified is null?:', hdUnified === null);
}

test().catch(console.error);
