import { AzureDocumentIntelligenceProvider } from '../services/ocr/AzureDocumentIntelligenceProvider.js';

function checkEnv() {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  const hasEndpoint = Boolean(endpoint && endpoint.trim().length > 0);
  const hasKey = Boolean(key && key.trim().length > 0);
  
  console.log('--- AZURE CREDENTIALS ENVIRONMENT AUDIT ---');
  console.log('Has Endpoint:', hasEndpoint, hasEndpoint ? `(${endpoint?.substring(0, 15)}...)` : '(Not configured)');
  console.log('Has Key:', hasKey, hasKey ? `(Key length: ${key?.length} chars)` : '(Not configured)');
}

checkEnv();
