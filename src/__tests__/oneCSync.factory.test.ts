import { describe, expect, it, afterEach } from 'vitest';
import { getOneCAdapter, resetOneCAdapter } from '@/lib/services/oneCSync';
import { FakeOneCAdapter } from '@/lib/services/oneCSync/adapter-fake';

describe('OneCAdapter factory', () => {
  afterEach(() => resetOneCAdapter());

  it('returns FakeOneCAdapter when ONE_C_ADAPTER=fake', () => {
    process.env.ONE_C_ADAPTER = 'fake';
    const adapter = getOneCAdapter();
    expect(adapter).toBeInstanceOf(FakeOneCAdapter);
  });

  it('returns FakeOneCAdapter by default when env unset', () => {
    delete process.env.ONE_C_ADAPTER;
    const adapter = getOneCAdapter();
    expect(adapter).toBeInstanceOf(FakeOneCAdapter);
  });

  it('throws a config error when ONE_C_ADAPTER=rest without ONE_C_API_URL', () => {
    process.env.ONE_C_ADAPTER = 'rest';
    delete process.env.ONE_C_API_URL;
    delete process.env.ONE_C_API_TOKEN;
    expect(() => getOneCAdapter()).toThrow(/ONE_C_API_URL/);
  });

  it('returns RestOneCAdapter when ONE_C_ADAPTER=rest with URL + token', async () => {
    process.env.ONE_C_ADAPTER = 'rest';
    process.env.ONE_C_API_URL = 'https://1c.example.com';
    process.env.ONE_C_API_TOKEN = 'tok';
    const { RestOneCAdapter } = await import('@/lib/services/oneCSync/adapter-rest');
    expect(getOneCAdapter()).toBeInstanceOf(RestOneCAdapter);
    delete process.env.ONE_C_API_URL;
    delete process.env.ONE_C_API_TOKEN;
  });
});
