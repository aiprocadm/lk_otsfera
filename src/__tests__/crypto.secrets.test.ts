import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 32 байта в hex.
const HEX_KEY = 'a'.repeat(64);

async function load() {
  return await import('@/lib/crypto/secrets');
}

describe('secrets encryption', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips plaintext through encrypt/decrypt', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', HEX_KEY);
    const { encryptSecret, decryptSecret } = await load();
    const plain = 're_live_secret_ЮНИКОД_123';
    const enc = encryptSecret(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('ciphertext is versioned, base64, and never equals the plaintext', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', HEX_KEY);
    const { encryptSecret } = await load();
    const enc = encryptSecret('hunter2');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('hunter2');
  });

  it('uses a fresh IV each call (same plaintext → different ciphertext)', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', HEX_KEY);
    const { encryptSecret, decryptSecret } = await load();
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('tampered ciphertext fails authentication (GCM tag)', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', HEX_KEY);
    const { encryptSecret, decryptSecret } = await load();
    const enc = encryptSecret('trustme');
    const [, payload] = enc.split(':', 2);
    const buf = Buffer.from(payload, 'base64');
    buf[buf.length - 1] ^= 0xff; // переворачиваем последний байт шифротекста
    const broken = `v1:${buf.toString('base64')}`;
    expect(() => decryptSecret(broken)).toThrow();
  });

  it('derives a key from a passphrase (non-hex ≥16 chars)', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', 'a-long-enough-passphrase-string');
    const { encryptSecret, decryptSecret } = await load();
    expect(decryptSecret(encryptSecret('x'))).toBe('x');
  });

  it('isSecretsKeyConfigured reflects presence/validity of the key', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', '');
    let mod = await load();
    expect(mod.isSecretsKeyConfigured()).toBe(false);
    expect(() => mod.encryptSecret('x')).toThrow();

    vi.resetModules();
    vi.stubEnv('APP_ENCRYPTION_KEY', 'short'); // <16 → невалиден
    mod = await load();
    expect(mod.isSecretsKeyConfigured()).toBe(false);

    vi.resetModules();
    vi.stubEnv('APP_ENCRYPTION_KEY', HEX_KEY);
    mod = await load();
    expect(mod.isSecretsKeyConfigured()).toBe(true);
  });

  it('rejects an unsupported stored format', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', HEX_KEY);
    const { decryptSecret } = await load();
    expect(() => decryptSecret('v2:whatever')).toThrow();
    expect(() => decryptSecret('garbage')).toThrow();
  });
});
