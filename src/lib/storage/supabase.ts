/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function buildSupabaseAdmin(): SupabaseClient<any> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is not configured');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

let _admin: SupabaseClient<any> | null = null;

export function getServerClient(): SupabaseClient<any> {
  if (!_admin) _admin = buildSupabaseAdmin();
  return _admin;
}

/**
 * Anon-key + per-user JWT client for Storage RLS-aware reads.
 *
 * Placeholder: server-side flows currently use service-role uploads via
 * getServerClient() + sign URLs. This factory is reserved for the future
 * direct-from-browser flow that will rely on Supabase Storage RLS policies
 * (see docs/integrations/supabase-storage-rls.md).
 */
export function getUserClient(userJwt: string): SupabaseClient<any> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('SUPABASE_URL is not configured');
  if (!key) throw new Error('SUPABASE_ANON_KEY is not configured');
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } }
  });
}

export const supabaseAdmin = new Proxy({} as SupabaseClient<any>, {
  get(_, prop: string | symbol) {
    return (getServerClient() as any)[prop];
  }
});

export const documentBucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'documents';
