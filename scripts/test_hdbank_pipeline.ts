import fs from 'fs';
import { azureOcrProvider } from '../server/services/ocr/AzureDocumentIntelligenceProvider.js';
import { MetadataFilterEngine } from '../server/services/ocr/metadataFilterEngine.js';

async function testHDBank() {
  console.log('Testing HDBank through production pipeline...');
  const rawData = JSON.parse(fs.readFileSync('scratch/hdbank_raw_azure.json', 'utf-8'));

  // Use parseAzureAnalyzeResult to run the full production parsing & metadata pipeline
  const result = (azureOcrProvider as any).parseAzureAnalyzeResult(rawData, 'prebuilt-layout');

  console.log('\n--- HDBANK METRICS ---');
  console.log('Pages:', result.pages.length);
  console.log('Tables:', result.tables.length);
  console.log('Metrics:', result.metadataPipelineMetrics);

  console.log('\n--- HDBANK CANONICAL METADATA ---');
  console.table(
    (result.documentMetadata || []).map((m: any) => ({
      'Semantic Type': m.semanticType,
      'Raw Label': m.rawLabel,
      'Sanitized Value': m.value,
      'Confidence': `${(m.confidence * 100).toFixed(1)}%`,
      'Quality': `${(m.qualityScore * 100).toFixed(1)}%`,
      'Occurrences': m.occurrenceCount,
      'Visibility': m.visibilityClass,
      'Status': m.status,
    }))
  );

  const coreItems = (result.documentMetadata || []).filter((m: any) => m.visibilityClass === 'CORE');
  console.log(`\nCORE items count: ${coreItems.length}`);
  coreItems.forEach((m: any) => {
    console.log(`  [${m.semanticType}] "${m.rawLabel}" => "${m.value}" (conf=${m.confidence}, quality=${m.qualityScore})`);
  });

  // Verify HDBank Targets
  const fromItem = coreItems.find((m: any) => m.semanticType === 'STATEMENT_FROM');
  const toItem = coreItems.find((m: any) => m.semanticType === 'STATEMENT_TO');
  const holderItem = coreItems.find((m: any) => m.semanticType === 'ACCOUNT_HOLDER');
  const accItem = coreItems.find((m: any) => m.semanticType === 'ACCOUNT_NUMBER');
  const ccyItem = coreItems.find((m: any) => m.semanticType === 'CURRENCY');
  const typeItem = coreItems.find((m: any) => m.semanticType === 'ACCOUNT_TYPE');

  console.log('\n--- HDBANK ACCEPTANCE TARGET VERIFICATION ---');
  console.log('STATEMENT_FROM = 01/05/2024:', fromItem?.value === '01/05/2024' ? '✅ PASS' : `❌ FAIL (${fromItem?.value})`);
  console.log('STATEMENT_TO = 31/10/2024:', toItem?.value === '31/10/2024' ? '✅ PASS' : `❌ FAIL (${toItem?.value})`);
  console.log('ACCOUNT_HOLDER = NGUYEN THI TUYET LAN:', holderItem?.value === 'NGUYEN THI TUYET LAN' ? '✅ PASS' : `❌ FAIL (${holderItem?.value})`);
  console.log('ACCOUNT_NUMBER = 051704070011450:', accItem?.value === '051704070011450' ? '✅ PASS' : `❌ FAIL (${accItem?.value})`);
  console.log('CURRENCY = VND:', ccyItem?.value === 'VND' ? '✅ PASS' : `❌ FAIL (${ccyItem?.value})`);
  console.log('ACCOUNT_TYPE contains TGTT TRONG NUOC:', typeItem?.value?.includes('TGTT TRONG NUOC') ? '✅ PASS' : `❌ FAIL (${typeItem?.value})`);

  const falseCore = coreItems.filter((m: any) => m.rawLabel?.includes('NGÂN HÀNG') || m.rawLabel?.includes('MINH PHỤNG'));
  console.log('False core fragments (NGÂN HÀNG, MINH PHỤNG) == 0:', falseCore.length === 0 ? '✅ PASS (0 false core)' : '❌ FAIL');
}

testHDBank().catch(console.error);
