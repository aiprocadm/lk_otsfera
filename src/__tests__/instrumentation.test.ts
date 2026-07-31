/**
 * src/instrumentation.ts — Next 15 hook (PR-2): Sentry init по NEXT_RUNTIME,
 * контракт no-op без SENTRY_DSN (SDK даже не импортируется), onRequestError
 * делегирует в captureRequestError только при заданном DSN.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestError, register } from '@/instrumentation';
import { REDACTED } from '@/lib/logging/scrub';

const { init, captureRequestError, assertEnvOnBoot } = vi.hoisted(() => ({
  init: vi.fn(),
  captureRequestError: vi.fn(),
  assertEnvOnBoot: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({ init, captureRequestError }));
vi.mock('@/lib/env', () => ({ assertEnvOnBoot }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('register', () => {
  it('без SENTRY_DSN — no-op (init не вызывается)', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    expect(init).not.toHaveBeenCalled();
  });

  it('DSN + nodejs → init c beforeSend-скраббером и sendDefaultPii:false', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@sentry.example.ru/1');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('SENTRY_ENVIRONMENT', 'staging');
    await register();
    expect(init).toHaveBeenCalledTimes(1);
    const opts = init.mock.calls[0][0];
    expect(opts).toMatchObject({
      dsn: 'https://k@sentry.example.ru/1',
      environment: 'staging',
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
    // beforeSend вычищает ПДн из события
    const scrubbed = opts.beforeSend({ message: 'to a@b.ru', user: { id: 1 } });
    expect(scrubbed.message).toBe(`to ${REDACTED}`);
    expect(scrubbed).not.toHaveProperty('user');
  });

  it('DSN + edge → init; environment падает обратно в NODE_ENV без SENTRY_ENVIRONMENT', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@sentry.example.ru/1');
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('SENTRY_ENVIRONMENT', '');
    vi.stubEnv('NODE_ENV', 'test');
    await register();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0].environment).toBe('test');
  });

  it('DSN + неизвестный runtime (клиентский бандл) — init не вызывается', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@sentry.example.ru/1');
    vi.stubEnv('NEXT_RUNTIME', '');
    await register();
    expect(init).not.toHaveBeenCalled();
  });

  it('nodejs runtime зовёт assertEnvOnBoot (R0.2 fail-fast) даже без DSN', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    expect(assertEnvOnBoot).toHaveBeenCalledTimes(1);
  });

  it('edge runtime НЕ зовёт assertEnvOnBoot (нет полного серверного окружения)', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@sentry.example.ru/1');
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(assertEnvOnBoot).not.toHaveBeenCalled();
  });

  it('throw из assertEnvOnBoot пробрасывается (сервер не стартует)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    assertEnvOnBoot.mockImplementationOnce(() => {
      throw new Error('Некорректное production-окружение');
    });
    await expect(register()).rejects.toThrow('production-окружение');
    expect(init).not.toHaveBeenCalled();
  });
});

describe('onRequestError', () => {
  const args = [
    new Error('boom'),
    { path: '/api/x' },
    { routerKind: 'App Router' },
  ] as unknown as Parameters<typeof onRequestError>;

  it('без DSN — no-op', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    await onRequestError(...args);
    expect(captureRequestError).not.toHaveBeenCalled();
  });

  it('с DSN — делегирует в captureRequestError c теми же аргументами', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@sentry.example.ru/1');
    await onRequestError(...args);
    expect(captureRequestError).toHaveBeenCalledWith(...args);
  });
});
