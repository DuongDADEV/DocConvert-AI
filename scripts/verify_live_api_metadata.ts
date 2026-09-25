import 'dotenv/config';
import { getSupabaseAdminClient, getBaseSupabaseClient } from '../server/services/supabaseClient.js';

async function getRealUserJwt(email: string): Promise<string> {
  const admin = getSupabaseAdminClient();
  const base = getBaseSupabaseClient();
  if (!admin || !base) throw new Error('Supabase clients not initialized');

  const linkRes = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  const hashedToken = linkRes.data?.properties?.hashed_token;
  if (!hashedToken) throw new Error('Failed to generate magic link token');

  const sessionRes = await base.auth.verifyOtp({
    token_hash: hashedToken,
    type: 'magiclink',
  });

  const token = sessionRes.data?.session?.access_token;
  if (!token) throw new Error('Failed to obtain Supabase session JWT');
  return token;
}

async function verifyLiveApi() {
  console.log('=== VERIFYING LIVE HTTP API FOR BAN VIET WITH REAL SUPABASE JWT ===');
  const token = await getRealUserJwt('diduc.germany@gmail.com');

  const res = await fetch('http://localhost:3000/api/documents/ffec64e8-f5d8-4e2d-929b-124882b3e099/ocr-result', {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  console.log(`HTTP Status: ${res.status}, Success: ${data.success}`);

  console.log('\n--- EXACT RETURNED METADATA OBJECTS ---');
  data.documentMetadata.forEach((m: any, i: number) => {
    console.log(`[${i}] [${m.visibilityClass}] [${m.semanticType}] "${m.label}" = "${m.value}" | status=${m.status} | conf=${m.confidence} | p${m.sourcePage}`);
    if (m.alternatives && m.alternatives.length > 0) {
      console.log(`     Alternatives:`, JSON.stringify(m.alternatives));
    }
  });

  console.log('\n--- FOCUSED FIELDS AUDIT ---');
  const period = data.documentMetadata.filter((m: any) => m.semanticType === 'STATEMENT_PERIOD');
  console.log(`STATEMENT_PERIOD count: ${period.length}`);
  period.forEach((p: any) => console.log('  ->', JSON.stringify(p)));

  const addr = data.documentMetadata.find((m: any) => m.semanticType === 'ADDRESS');
  console.log(`ADDRESS:`, JSON.stringify(addr));

  const openDate = data.documentMetadata.find((m: any) => m.semanticType === 'OPENING_DATE');
  console.log(`OPENING_DATE:`, JSON.stringify(openDate));

  console.log(`\nTransaction rows count: ${data.unifiedTransactionTable?.rows?.length}`);
}

verifyLiveApi().catch(console.error);
