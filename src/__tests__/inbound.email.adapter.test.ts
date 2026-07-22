import { describe, expect, it, afterEach } from 'vitest';
import { getInboundEmailAdapter, __resetInboundEmailAdapter } from '@/lib/inbound/email';
import { FakeInboundEmailAdapter } from '@/lib/inbound/email/adapter-fake';
import { ImapInboundEmailAdapter, readImapConfig } from '@/lib/inbound/email/adapter-imap';

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

  it('rebuilds the singleton when the effective adapter kind changes (settings edited in UI)', () => {
    process.env.INBOUND_EMAIL_ADAPTER = 'fake';
    const a1 = getInboundEmailAdapter();
    process.env.INBOUND_EMAIL_ADAPTER = 'imap';
    const a2 = getInboundEmailAdapter();
    expect(a1).toBeInstanceOf(FakeInboundEmailAdapter);
    expect(a2).toBeInstanceOf(ImapInboundEmailAdapter);
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

  it('returns [] on malformed FAKE_INBOUND_EMAIL JSON (defensive catch)', async () => {
    process.env.FAKE_INBOUND_EMAIL = 'not-a-json';
    const adapter = new FakeInboundEmailAdapter();
    const result = await adapter.fetchNewMessages(null);
    expect(result).toEqual({ messages: [], cursor: '0' });
  });

  it('returns [] when FAKE_INBOUND_EMAIL is valid JSON but not an array', async () => {
    process.env.FAKE_INBOUND_EMAIL = '{"nope":1}';
    const adapter = new FakeInboundEmailAdapter();
    const result = await adapter.fetchNewMessages(null);
    expect(result).toEqual({ messages: [], cursor: '0' });
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

  it('accepts an explicit config override without performing network I/O', async () => {
    const adapter = new ImapInboundEmailAdapter({ host: 'h', port: 993, user: 'u', password: 'p', tls: true });
    await expect(adapter.fetchNewMessages(null)).rejects.toThrow('IMAP inbound adapter not wired');
  });
});

describe('readImapConfig', () => {
  const KEYS = ['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_PASSWORD', 'IMAP_TLS'];
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it('reads the full effective config (env fallback of the settings cache)', () => {
    process.env.IMAP_HOST = 'imap.example.com';
    process.env.IMAP_PORT = '993';
    process.env.IMAP_USER = 'bot@example.com';
    process.env.IMAP_PASSWORD = 'secret';
    process.env.IMAP_TLS = '1';
    expect(readImapConfig()).toEqual({
      host: 'imap.example.com',
      port: 993,
      user: 'bot@example.com',
      password: 'secret',
      tls: true
    });
  });

  it('unset values → undefined fields; tls defaults to true', () => {
    expect(readImapConfig()).toEqual({
      host: undefined,
      port: undefined,
      user: undefined,
      password: undefined,
      tls: true
    });
  });

  it('non-numeric port → undefined; tls "0"/"false"/"off" → false', () => {
    process.env.IMAP_PORT = 'abc';
    process.env.IMAP_TLS = '0';
    expect(readImapConfig().port).toBeUndefined();
    expect(readImapConfig().tls).toBe(false);
    process.env.IMAP_TLS = 'false';
    expect(readImapConfig().tls).toBe(false);
    process.env.IMAP_TLS = 'off';
    expect(readImapConfig().tls).toBe(false);
    process.env.IMAP_TLS = 'yes';
    expect(readImapConfig().tls).toBe(true);
  });
});
