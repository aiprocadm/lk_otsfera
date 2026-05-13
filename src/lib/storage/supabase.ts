import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL is not configured');
}

if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
}

export const supabaseAdmin = createClient(SUPABASE_URL, supabaseServiceRoleKey, {
  auth: { persistSession: false }
});

export const documentBucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'documents';
