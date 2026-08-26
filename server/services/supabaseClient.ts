import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db/db.js';

// Environment credentials (strictly server-side or client public config)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  currentPlanId: string;
  usedDocuments: number;
}

/**
 * 1. Base Supabase Client (Anonymous public client)
 */
let baseClient: SupabaseClient | null = null;

export function getBaseSupabaseClient(): SupabaseClient | null {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    if (!baseClient) {
      baseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }
    return baseClient;
  }
  return null;
}

/**
 * 2. User-Scoped Supabase Client (For RLS queries)
 * Injects user's access token so Supabase Database evaluates auth.uid() = user.id
 */
export function createSupabaseUserClient(accessToken: string): SupabaseClient | null {
  if (SUPABASE_URL && SUPABASE_ANON_KEY && accessToken) {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return null;
}

/**
 * 3. Verify Supabase Session / Access Token
 * Calls Supabase Auth API to authenticate user.
 * In local/test mode without cloud credentials, validates against local auth state.
 */
export async function verifySupabaseToken(accessToken: string): Promise<AuthenticatedUser | null> {
  if (!accessToken || typeof accessToken !== 'string') {
    return null;
  }

  // 1. Local session token pattern
  if (accessToken.startsWith('sbp_')) {
    return db.verifyLocalSupabaseToken(accessToken);
  }

  // 2. Live Supabase Auth JWT verification
  const liveClient = getBaseSupabaseClient();
  if (liveClient) {
    try {
      const { data, error } = await liveClient.auth.getUser(accessToken);
      if (!error && data?.user) {
        const profile = db.findProfileById(data.user.id);
        return {
          id: data.user.id,
          email: data.user.email || '',
          fullName: profile?.full_name || (data.user.user_metadata?.full_name as string) || 'User',
          currentPlanId: profile?.current_plan_id || 'FREE',
          usedDocuments: profile?.used_documents || 0,
        };
      }
    } catch (err) {
      // Continue to local fallback
    }
  }

  return db.verifyLocalSupabaseToken(accessToken);
}
