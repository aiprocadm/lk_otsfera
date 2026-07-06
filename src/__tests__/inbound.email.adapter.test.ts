import { describe, expect, it, afterEach } from 'vitest';
import { getInboundEmailAdapter, __resetInboundEmailAdapter } from '@/lib/inbound/email';
import { FakeInboundEmailAdapter } from '@/lib/inbound/email/adapter-fake';
import { ImapInboundEmailAdapter } from '@/lib/inbound/email/adapter-imap';

describe('InboundEmailAdapter factory', () => {
  afterEach(() => {
    delete process.env.INBOUND_EMAIL_ADAPTER;
    delete process.env.FAKE_INBOUND_EMAIL;
    __resetInboundEmailAdapter();
  });

  it('returns FakeInboundEmailAdapter when INBOUND_EMAIL_ADAPTER=fake', () => {
    process.env.INBOUND_EMAIL_ADAPTER = 'fake';
    const adapter = getInboundEmailAdapter();
    expect(adapter).toBeInstanceOf(FakeInboundEmailAdapter);
  });

  it('returns FakeInboundEmailAdapter by default when env unset', () => {
    delete process.env.INBOUND_EMAIL_ADAPTER;
    const adapter = getInboundEmailAdapter();
    expect(adapter).toBeInstanceOf(FakeInboundEmailAdapter);
  });

  it('returns ImapInboundEmailAdapter when INBOUND_EMAIL_ADAPTER=imap', () => {
    process.env.INBOUND_EMAIL_ADAPTER = 'imap';
    const adapter = getInboundEmailAdapter();
    expect(adapter).toBeInstanceOf(ImapInboundEmailAdapter);
  });

  it('throws for an unknown INBOUND_EMAIL_ADAPTER value', () => {
    process.env.INBOUND_EMAIL_ADAPTER = 'bogus';
    expect(() => getInboundEmailAdapter()).toThrow('Unknown INBOUND_EMAIL_ADAPTER value: bogus');
  });

  it('caches the adapter instance until reset', () => {
    process.env.INBOUND_EMAIL_ADAPTER = 'fake';
    const a1 = getInboundEmailAdapter();
    const a2 = getInboundEmailAdapter();
    expect(a1).toBe(a2);
    __resetInboundEmailAdapter();
    const a3 = getInboundEmailAdapter();
    expect(a1).not.toBe(a3);
  });
});

describe('FakeInboundEmailAdapter', () => {
  afterEach(() => {
    delete process.env.FAKE_INBOUND_EMAIL;
  });

  it('returns [] and cursor "0" when FAKE_INBOUND_EMAIL is unset', async () => {
    delete process.env.FAKE_INBOUND_EMAIL;
    const adapter = new FakeInboundEmailAdapter();
    const result = await adapter.fetchNewMessages(null);
    expect(result).toEqual({ messages: [], cursor: '0' });
  });

  it('returns messages from FAKE_INBOUND_EMAIL and advances the cursor', async () => {
    const fixture = [
      { externalId: 'm1', from: 'a@example.com', subject: 'hi', text: 'body1' },
      { externalId: 'm2', from: 'b@example.com', text: 'body2' }
    ];
    process.env.FAKE_INBOUND_EMAIL = JSON.stringify(fixture);
    const adapter = new FakeInboundEmailAdapter();

    const first = await adapter.fetchNewMessages(null);
    expect(first.messages).toEqual(fixture);
    expect(first.cursor).toBe('2');

    // Calling again with the returned cursor yields no new messages (same fixture).
    const second = await adapter.fetchNewMessages(first.cursor);
    expect(second.messages).toEqual([]);
    expect(second.cursor).toBe('2');
  });

  it('only returns messages past the given cursor offset', async () => {
    const fixture = [
      { externalId: 'm1', from: 'a@example.com', text: 'body1' },
      { externalId: 'm2', from: 'b@example.com', text: 'body2' },
      { externalId: 'm3', from: 'c@example.com', text: 'body3' }
    ];
    process.env.FAKE_INBOUND_EMAIL = JSON.stringify(fixture);
    const adapter = new FakeInboundEmailAdapter();

    const result = await adapter.fetchNewMessages('1');
    expect(result.messages).toEqual([fixture[1], fixture[2]]);
    expect(result.cursor).toBe('3');
  });
});

describe('ImapInboundEmailAdapter', () => {
  it('rejects with the "not wired" error message', async () => {
    const adapter = new ImapInboundEmailAdapter();
    await expect(adapter.fetchNewMessages(null)).rejects.toThrow(
      'IMAP inbound adapter not wired (set INBOUND_EMAIL_ADAPTER=fake for tests)'
    );
  });

  it('reads config from env at construction without performing network I/O', () => {
    process.env.IMAP_HOST = 'imap.example.com';
    process.env.IMAP_PORT = '993';
    process.env.IMAP_USER = 'bot@example.com';
    process.env.IMAP_PASSWORD = 'secret';
    process.env.IMAP_TLS = '1';
    expect(() => new ImapInboundEmailAdapter()).not.toThrow();
    delete process.env.IMAP_HOST;
    delete process.env.IMAP_PORT;
    delete process.env.IMAP_USER;
    delete process.env.IMAP_PASSWORD;
    delete process.env.IMAP_TLS;
  });
});
