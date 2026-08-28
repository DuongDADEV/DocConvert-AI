import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getAdminConfig() {
  const rawUrl = process.env.SUPABASE_URL || '';
  const url = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { url, serviceRoleKey };
}

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient | null {
  const { url, serviceRoleKey } = getAdminConfig();
  if (url && serviceRoleKey) {
    if (!adminClient) {
      adminClient = createClient(url, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }
    return adminClient;
  }
  return null;
}

/**
 * Service Role Usage Registry for Security Auditing
 */
export const SERVICE_ROLE_USAGE_REGISTRY = [
  {
    file: 'server/services/supabaseAdmin.ts',
    function: 'getSupabaseAdminClient()',
    reason: 'Initializes elevated client with SUPABASE_SERVICE_ROLE_KEY for server-only background processes.',
  },
  {
    file: 'server/services/ocrService.ts',
    function: 'processBackgroundJob()',
    reason: 'Background asynchronous pipeline updating job status after external AI processing when no active HTTP request context is present.',
  },
];
