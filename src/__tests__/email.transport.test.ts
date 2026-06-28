/**
 * Unit tests for src/lib/email/transport.ts
 *
 * Covers: getResend (API key missing / present / cached),
 *         getEmailFrom (default / env override),
 *         isEmailEnabled,
 *         defaultTransport (null when no key, send path, Resend error path).
 *
 * Uses vi.resetModules() + vi.stubEnv() to exercise the module-level lazy
 * singleton (cachedClient) from a clean state in each scenario.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We mock the 'resend' package to avoid real HTTP.
const { ResendConstructorMock, sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const ResendConstructorMock = vi.fn().mockImplementation(() => ({
    emails: { send: sendMock }
  }));
  return { ResendConstructorMock, sendMock };
});

vi.mock('resend', () => ({
  Resend: ResendConstructorMock
}));

beforeEach(() => {
  ResendConstructorMock.mockClear();
  sendMock.mockClear();
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// getEmailFrom
// ---------------------------------------------------------------------------
describe('getEmailFrom', () => {
  it('returns the default address when EMAIL_FROM is not set', async () => {
    vi.stubEnv('EMAIL_FROM', '');
    const { getEmailFrom } = await import('@/lib/email/transport');
    expect(getEmailFrom()).toBe('no-reply@otsfera.ru');
  });

  it('returns the custom address from EMAIL_FROM env', async () => {
    vi.stubEnv('EMAIL_FROM', 'custom@company.ru');
    const { getEmailFrom } = await import('@/lib/email/transport');
    expect(getEmailFrom()).toBe('custom@company.ru');
  });

  it('trims whitespace from EMAIL_FROM', async () => {
    vi.stubEnv('EMAIL_FROM', '  trimmed@company.ru  ');
    const { getEmailFrom } = await import('@/lib/email/transport');
    expect(getEmailFrom()).toBe('trimmed@company.ru');
  });
});

// ---------------------------------------------------------------------------
// isEmailEnabled
// ---------------------------------------------------------------------------
describe('isEmailEnabled', () => {
  it('returns true when EMAIL_ENABLED="true"', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    const { isEmailEnabled } = await import('@/lib/email/transport');
    expect(isEmailEnabled()).toBe(true);
  });

  it('returns false when EMAIL_ENABLED is not set', async () => {
    vi.stubEnv('EMAIL_ENABLED', '');
    const { isEmailEnabled } = await import('@/lib/email/transport');
    expect(isEmailEnabled()).toBe(false);
  });

  it('returns false when EMAIL_ENABLED="false"', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    const { isEmailEnabled } = await import('@/lib/email/transport');
    expect(isEmailEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// defaultTransport — no API key
// ---------------------------------------------------------------------------
describe('defaultTransport — no RESEND_API_KEY', () => {
  it('returns null when RESEND_API_KEY is not set', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const { defaultTransport } = await import('@/lib/email/transport');
    const transport = await defaultTransport();
    expect(transport).toBeNull();
    expect(ResendConstructorMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// defaultTransport — with API key: send success
// ---------------------------------------------------------------------------
describe('defaultTransport — with RESEND_API_KEY (success path)', () => {
  it('constructs Resend client and returns transport with correct id', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    sendMock.mockResolvedValue({ data: { id: 'email_123' }, error: null });

    const { defaultTransport } = await import('@/lib/email/transport');
    const transport = await defaultTransport();
    expect(transport).not.toBeNull();
    expect(ResendConstructorMock).toHaveBeenCalledWith('test-api-key');

    const result = await transport!.send({
      from: 'a@b.com',
      to: 'c@d.com',
      subject: 'Hello',
      html: '<p>Hi</p>'
    });
    expect(result).toEqual({ id: 'email_123' });
    expect(sendMock).toHaveBeenCalledWith({
      from: 'a@b.com',
      to: 'c@d.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: undefined
    });
  });

  it('returns null id when data.id is absent', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    sendMock.mockResolvedValue({ data: null, error: null });

    const { defaultTransport } = await import('@/lib/email/transport');
    const transport = await defaultTransport();
    const result = await transport!.send({
      from: 'a@b.com',
      to: 'c@d.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi'
    });
    expect(result).toEqual({ id: null });
  });

  it('logs a console.error and still returns the id when Resend reports an error', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    sendMock.mockResolvedValue({
      data: { id: 'err_id' },
      error: { message: 'rate limited' }
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { defaultTransport } = await import('@/lib/email/transport');
    const transport = await defaultTransport();
    const result = await transport!.send({
      from: 'a@b.com',
      to: 'bad@b.com',
      subject: 'Hi',
      html: '<p>Hi</p>'
    });
    expect(result).toEqual({ id: 'err_id' });
    expect(errorSpy).toHaveBeenCalledWith(
      '[email] Resend API error',
      expect.objectContaining({ to: 'bad@b.com' })
    );
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// defaultTransport — cached client (singleton path)
// ---------------------------------------------------------------------------
describe('defaultTransport — cached client', () => {
  it('reuses the same Resend instance across multiple calls', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });

    const { defaultTransport } = await import('@/lib/email/transport');
    await defaultTransport();
    await defaultTransport(); // second call — should NOT create a new Resend
    expect(ResendConstructorMock).toHaveBeenCalledTimes(1);
  });

  it('resetEmailTransportCache() clears the cached client', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });

    const { defaultTransport, resetEmailTransportCache } = await import('@/lib/email/transport');
    await defaultTransport(); // creates client
    resetEmailTransportCache();
    await defaultTransport(); // should create a new client after reset
    expect(ResendConstructorMock).toHaveBeenCalledTimes(2);
  });
});
