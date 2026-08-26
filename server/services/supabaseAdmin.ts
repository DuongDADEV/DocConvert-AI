import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment credentials (strictly server-side ONLY)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * ============================================================================
 * SUPABASE ADMIN SERVICE ROLE CLIENT
 * ============================================================================
 * 
 * AUDIT & COMPLIANCE RULES:
 * - SUPABASE_SERVICE_ROLE_KEY has bypassrls = true permissions.
 * - NEVER exposed to frontend bundles or client responses.
 * - MUST NOT be used for regular user CRUD queries where user session is available.
 * 
 * ALLOWED USE CASES:
 * 1. System Plan Seeding & Migration Setup: Bootstrapping static billing plans.
 * 2. Background Processing Worker: Processing queued OCR jobs when no HTTP request session is active.
 * 3. System Health Checks & Infrastructure Monitoring.
 */

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    if (!adminClient) {
      adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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
