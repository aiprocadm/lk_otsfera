/**
 * Unit tests for src/lib/storage/supabase.ts
 *
 * The module uses a process-level singleton (_admin). We use vi.resetModules()
 * + dynamic import() with vi.stubEnv() so each "env scenario" gets a fresh
 * module instance, avoiding singleton bleed between tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @supabase/supabase-js before any import of the module under test.
const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn()
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock
}));

beforeEach(() => {
  createClientMock.mockReset();
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// getServerClient
// ---------------------------------------------------------------------------
describe('getServerClient', () => {
  it('throws when SUPABASE_URL is missing', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'key123');
    const { getServerClient } = await import('@/lib/storage/supabase');
    expect(() => getServerClient()).toThrow('SUPABASE_URL is not configured');
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { getServerClient } = await import('@/lib/storage/supabase');
    expect(() => getServerClient()).toThrow('SUPABASE_SERVICE_ROLE_KEY is not configured');
  });

  it('calls createClient with persistSession:false and returns result', async () => {
    const fakeClient = { storage: {}, from: vi.fn() };
    createClientMock.mockReturnValue(fakeClient);
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    const { getServerClient } = await import('@/lib/storage/supabase');
    const client = getServerClient();
    expect(createClientMock).toHaveBeenCalledWith(
      'https://proj.supabase.co',
      'service-key',
      { auth: { persistSession: false } }
    );
    expect(client).toBe(fakeClient);
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    const fakeClient = { storage: {}, from: vi.fn() };
    createClientMock.mockReturnValue(fakeClient);
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    const { getServerClient } = await import('@/lib/storage/supabase');
    const a = getServerClient();
    const b = getServerClient();
    expect(a).toBe(b);
    expect(createClientMock).toHaveBeenCalledTimes(1); // only once
  });
});

// ---------------------------------------------------------------------------
// getUserClient
// ---------------------------------------------------------------------------
describe('getUserClient', () => {
  it('throws when SUPABASE_URL is missing', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
    const { getUserClient } = await import('@/lib/storage/supabase');
    expect(() => getUserClient('jwt-token')).toThrow('SUPABASE_URL is not configured');
  });

  it('throws when SUPABASE_ANON_KEY is missing', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    const { getUserClient } = await import('@/lib/storage/supabase');
    expect(() => getUserClient('jwt-token')).toThrow('SUPABASE_ANON_KEY is not configured');
  });

  it('calls createClient with the user JWT in Authorization header', async () => {
    const fakeClient = { storage: {}, from: vi.fn() };
    createClientMock.mockReturnValue(fakeClient);
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
    const { getUserClient } = await import('@/lib/storage/supabase');
    const client = getUserClient('my-jwt');
    expect(createClientMock).toHaveBeenCalledWith(
      'https://proj.supabase.co',
      'anon-key',
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: 'Bearer my-jwt' } }
      }
    );
    expect(client).toBe(fakeClient);
  });
});

// ---------------------------------------------------------------------------
// supabaseAdmin proxy
// ---------------------------------------------------------------------------
describe('supabaseAdmin proxy', () => {
  it('proxies property access to the underlying getServerClient() result', async () => {
    const fakeStorage = { from: vi.fn() };
    const fakeClient = { storage: fakeStorage, auth: {} };
    createClientMock.mockReturnValue(fakeClient);
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    const { supabaseAdmin } = await import('@/lib/storage/supabase');
    // Accessing .storage on the proxy should call through to fakeClient.storage
    expect((supabaseAdmin as unknown as Record<string, unknown>).storage).toBe(fakeStorage);
  });
});

// ---------------------------------------------------------------------------
// documentBucket
// ---------------------------------------------------------------------------
describe('documentBucket', () => {
  it('defaults to "documents" when SUPABASE_STORAGE_BUCKET is not set', async () => {
    // Delete the var entirely so the ?? fallback triggers (stubEnv('','') still
    // sets an empty string which doesn't trigger ??)
    const saved = process.env.SUPABASE_STORAGE_BUCKET;
    delete process.env.SUPABASE_STORAGE_BUCKET;
    vi.resetModules();
    const { documentBucket } = await import('@/lib/storage/supabase');
    expect(documentBucket).toBe('documents');
    // restore
    if (saved !== undefined) process.env.SUPABASE_STORAGE_BUCKET = saved;
  });

  it('uses SUPABASE_STORAGE_BUCKET env when set', async () => {
    vi.stubEnv('SUPABASE_STORAGE_BUCKET', 'my-bucket');
    vi.resetModules();
    const { documentBucket } = await import('@/lib/storage/supabase');
    expect(documentBucket).toBe('my-bucket');
  });
});
