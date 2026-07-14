import { describe, expect, it, afterEach } from 'vitest';
import { getMangoAdapter, __resetMangoAdapter } from '@/lib/telephony/mango';
import { FakeMangoAdapter } from '@/lib/telephony/mango/adapter-fake';
import { RestMangoAdapter } from '@/lib/telephony/mango/adapter-rest';

describe('MangoAdapter factory', () => {
  afterEach(() => {
    delete process.env.MANGO_ADAPTER;
    delete process.env.FAKE_MANGO_RECORDING;
    delete process.env.FAKE_MANGO_STATS;
    __resetMangoAdapter();
  });

  it('returns FakeMangoAdapter when MANGO_ADAPTER=fake', () => {
    process.env.MANGO_ADAPTER = 'fake';
    const adapter = getMangoAdapter();
    expect(adapter).toBeInstanceOf(FakeMangoAdapter);
  });

  it('returns FakeMangoAdapter by default when env unset', () => {
    delete process.env.MANGO_ADAPTER;
    const adapter = getMangoAdapter();
    expect(adapter).toBeInstanceOf(FakeMangoAdapter);
  });

  it('returns RestMangoAdapter when MANGO_ADAPTER=rest', () => {
    process.env.MANGO_ADAPTER = 'rest';
    const adapter = getMangoAdapter();
    expect(adapter).toBeInstanceOf(RestMangoAdapter);
  });

  it('throws for an unknown MANGO_ADAPTER value', () => {
    process.env.MANGO_ADAPTER = 'bogus';
    expect(() => getMangoAdapter()).toThrow('Unknown MANGO_ADAPTER value: bogus');
  });

  it('caches the adapter instance until reset', () => {
    process.env.MANGO_ADAPTER = 'fake';
    const a1 = getMangoAdapter();
    const a2 = getMangoAdapter();
    expect(a1).toBe(a2);
    __resetMangoAdapter();
    const a3 = getMangoAdapter();
    expect(a1).not.toBe(a3);
  });
});

describe('FakeMangoAdapter', () => {
  afterEach(() => {
    delete process.env.FAKE_MANGO_RECORDING;
    delete process.env.FAKE_MANGO_STATS;
  });

  it('fetchRecording returns null when FAKE_MANGO_RECORDING is unset', async () => {
    delete process.env.FAKE_MANGO_RECORDING;
    const adapter = new FakeMangoAdapter();
    const result = await adapter.fetchRecording('rec-1');
    expect(result).toBeNull();
  });

  it('fetchRecording decodes FAKE_MANGO_RECORDING (base64) into a buffer + contentType', async () => {
    const original = Buffer.from('hello mango audio');
    process.env.FAKE_MANGO_RECORDING = original.toString('base64');
    const adapter = new FakeMangoAdapter();
    const result = await adapter.fetchRecording('rec-1');
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe('audio/mpeg');
    expect(result?.buffer.equals(original)).toBe(true);
  });

  it('requestStats returns a key', async () => {
    const adapter = new FakeMangoAdapter();
    const result = await adapter.requestStats({ from: '2026-07-01', to: '2026-07-05' });
    expect(result.key).toBeTruthy();
    expect(typeof result.key).toBe('string');
  });

  it('fetchStatsResult returns [] when FAKE_MANGO_STATS is unset', async () => {
    delete process.env.FAKE_MANGO_STATS;
    const adapter = new FakeMangoAdapter();
    const result = await adapter.fetchStatsResult('some-key');
    expect(result).toEqual({ ready: true, rows: [] });
  });

  it('fetchStatsResult returns [] on malformed FAKE_MANGO_STATS JSON (defensive catch)', async () => {
    process.env.FAKE_MANGO_STATS = '{broken';
    const adapter = new FakeMangoAdapter();
    const result = await adapter.fetchStatsResult('some-key');
    expect(result).toEqual({ ready: true, rows: [] });
  });

  it('fetchStatsResult returns [] when FAKE_MANGO_STATS is valid JSON but not an array', async () => {
    process.env.FAKE_MANGO_STATS = '{"rows":1}';
    const adapter = new FakeMangoAdapter();
    const result = await adapter.fetchStatsResult('some-key');
    expect(result).toEqual({ ready: true, rows: [] });
  });

  it('fetchStatsResult returns rows parsed from FAKE_MANGO_STATS', async () => {
    const rows = [{ ext: '101', calls: 5 }, { ext: '102', calls: 3 }];
    process.env.FAKE_MANGO_STATS = JSON.stringify(rows);
    const adapter = new FakeMangoAdapter();
    const result = await adapter.fetchStatsResult('some-key');
    expect(result).toEqual({ ready: true, rows });
  });

  it('initiateCallback resolves to an object with a string commandId', async () => {
    const adapter = new FakeMangoAdapter();
    const result = await adapter.initiateCallback({ fromInternal: '101', toNumber: '+70000000000' });
    expect(typeof result.commandId).toBe('string');
    expect(result.commandId).toBeTruthy();
  });

  it('initiateCallback returns a different commandId on each call for the same toNumber (no collision)', async () => {
    const adapter = new FakeMangoAdapter();
    const first = await adapter.initiateCallback({ fromInternal: '101', toNumber: '+70000000000' });
    const second = await adapter.initiateCallback({ fromInternal: '101', toNumber: '+70000000000' });
    expect(first.commandId).not.toBe(second.commandId);
  });
});

describe('RestMangoAdapter', () => {
  it('fetchRecording rejects with the "not wired" error', async () => {
    const adapter = new RestMangoAdapter();
    await expect(adapter.fetchRecording('rec-1')).rejects.toThrow(
      'Mango REST adapter not wired (set MANGO_ADAPTER=fake for tests)'
    );
  });

  it('requestStats rejects with the "not wired" error', async () => {
    const adapter = new RestMangoAdapter();
    await expect(adapter.requestStats({ from: '2026-07-01', to: '2026-07-05' })).rejects.toThrow(
      'Mango REST adapter not wired (set MANGO_ADAPTER=fake for tests)'
    );
  });

  it('fetchStatsResult rejects with the "not wired" error', async () => {
    const adapter = new RestMangoAdapter();
    await expect(adapter.fetchStatsResult('some-key')).rejects.toThrow(
      'Mango REST adapter not wired (set MANGO_ADAPTER=fake for tests)'
    );
  });

  it('reads config from env at construction without performing network I/O', () => {
    process.env.MANGO_API_KEY = 'key-123';
    process.env.MANGO_API_SALT = 'salt-456';
    process.env.MANGO_VPBX_BASE_URL = 'https://example.test/vpbx/';
    expect(() => new RestMangoAdapter()).not.toThrow();
    delete process.env.MANGO_API_KEY;
    delete process.env.MANGO_API_SALT;
    delete process.env.MANGO_VPBX_BASE_URL;
  });

  it('initiateCallback rejects with the "not wired yet" error (deliberate stub)', async () => {
    const adapter = new RestMangoAdapter();
    await expect(adapter.initiateCallback({ fromInternal: '101', toNumber: '+70000000000' })).rejects.toThrow(
      'RestMangoAdapter.initiateCallback not wired yet (owner enables live callback)'
    );
  });
});
