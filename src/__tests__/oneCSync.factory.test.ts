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

  it('throws when ONE_C_ADAPTER=rest until rest adapter exists', () => {
    process.env.ONE_C_ADAPTER = 'rest';
    expect(() => getOneCAdapter()).toThrow(/not implemented/i);
  });
});
