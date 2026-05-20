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

function getAdmin(): SupabaseClient<any> {
  if (!_admin) _admin = buildSupabaseAdmin();
  return _admin;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient<any>, {
  get(_, prop: string | symbol) {
    return (getAdmin() as any)[prop];
  }
});

export const documentBucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'documents';
