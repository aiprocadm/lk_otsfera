import { describe, it, expect, afterEach, vi } from 'vitest';

// We import the module under test after each env manipulation.
// resetOneCAdapter() clears the cached singleton, letting us change env vars
// between tests without stale cache.

// The dynamic `import('@/lib/services/oneCSync/index')` pulls in the adapter
// graph and is heavy on first resolution (~7s), which sporadically exceeds the
// default 5s timeout under machine load. Every case re-imports after
// vi.resetModules(), so bump the timeout file-scoped — the global default in
// vitest.config.ts stays tight so genuinely-hung tests still fail fast.
vi.setConfig({ testTimeout: 30000 });

describe('getOneCAdapter / resetOneCAdapter', () => {
  // Save/restore env mutations
  const savedEnv: Record<string, string | undefined> = {};
  function setEnv(key: string, value: string | undefined) {
    savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // Clear the cache after each test
    vi.resetModules();
  });

  it('defaults to FakeOneCAdapter when ONE_C_ADAPTER is unset', async () => {
    setEnv('ONE_C_ADAPTER', undefined);
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');
    const adapter = getOneCAdapter();
    expect(adapter).toBeDefined();
    // FakeOneCAdapter has pullOrganizations method
    expect(typeof adapter.pullOrganizations).toBe('function');
  });

  it('returns the same instance on repeated calls (singleton cache)', async () => {
    setEnv('ONE_C_ADAPTER', 'fake');
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');
    const a1 = getOneCAdapter();
    const a2 = getOneCAdapter();
    expect(a1).toBe(a2);
  });

  it('resetOneCAdapter clears the cache', async () => {
    setEnv('ONE_C_ADAPTER', 'fake');
    const { getOneCAdapter, resetOneCAdapter } = await import('@/lib/services/oneCSync/index');
    const a1 = getOneCAdapter();
    resetOneCAdapter();
    const a2 = getOneCAdapter();
    // After reset a fresh instance is created — not the same reference
    expect(a1).not.toBe(a2);
  });

  it('returns FakeOneCAdapter when ONE_C_ADAPTER=fake (explicit)', async () => {
    setEnv('ONE_C_ADAPTER', 'fake');
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');
    const adapter = getOneCAdapter();
    expect(adapter).toBeDefined();
  });

  it('throws for ONE_C_ADAPTER=rest without ONE_C_API_URL', async () => {
    setEnv('ONE_C_ADAPTER', 'rest');
    setEnv('ONE_C_API_URL', undefined);
    setEnv('ONE_C_API_TOKEN', undefined);
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');
    expect(() => getOneCAdapter()).toThrow('ONE_C_API_URL');
  });

  it('throws for ONE_C_ADAPTER=rest without ONE_C_API_TOKEN', async () => {
    setEnv('ONE_C_ADAPTER', 'rest');
    setEnv('ONE_C_API_URL', 'https://1c.example.com');
    setEnv('ONE_C_API_TOKEN', undefined);
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');
    expect(() => getOneCAdapter()).toThrow('ONE_C_API_TOKEN');
  });

  it('returns RestOneCAdapter when ONE_C_ADAPTER=rest with valid config', async () => {
    setEnv('ONE_C_ADAPTER', 'rest');
    setEnv('ONE_C_API_URL', 'https://1c.example.com');
    setEnv('ONE_C_API_TOKEN', 'secret');
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');
    const adapter = getOneCAdapter();
    expect(adapter).toBeDefined();
    // RestOneCAdapter has pushLead method
    expect(typeof adapter.pushLead).toBe('function');
  });

  // Ветка 'file' убрана: теперь это обычное неизвестное значение, а не
  // отдельная ловушка с «not implemented».
  it('ONE_C_ADAPTER=file трактуется как неизвестный адаптер', async () => {
    setEnv('ONE_C_ADAPTER', 'file');
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');
    expect(() => getOneCAdapter()).toThrow('Unknown ONE_C_ADAPTER value: file');
  });

  it('throws for unknown ONE_C_ADAPTER value', async () => {
    setEnv('ONE_C_ADAPTER', 'unknown_adapter');
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');
    expect(() => getOneCAdapter()).toThrow('Unknown ONE_C_ADAPTER value: unknown_adapter');
  });
});
