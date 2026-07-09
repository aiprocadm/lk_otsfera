/**
 * @/lib/logging/edge — edge-safe логгер middleware (PR-2):
 * dev/test → verbatim passthrough; production → одна JSON-строка через console
 * (pino в edge runtime не работает), ctx через scrub().
 */
import { afterEach, expect, it, vi } from 'vitest';
import { edgeLog } from '@/lib/logging/edge';
import { REDACTED } from '@/lib/logging/scrub';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  ['debug', 'debug'],
  ['info', 'log'],
  ['warn', 'warn'],
  ['error', 'error']
] as const)('dev/test: %s → console.%s verbatim', (method, sink) => {
  const spy = vi.spyOn(console, sink).mockImplementation(() => {});
  edgeLog[method]('[auth] msg', 32, 'chars');
  expect(spy).toHaveBeenCalledWith('[auth] msg', 32, 'chars');
});

it('production: JSON-строка c level/msg/ctx (один аргумент — как есть, со скрабом)', () => {
  vi.stubEnv('NODE_ENV', 'production');
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  edgeLog.error('[auth] fail', { email: 'a@b.ru' });
  const rec = JSON.parse(String(spy.mock.calls[0][0]));
  expect(rec).toMatchObject({ level: 'error', msg: '[auth] fail', ctx: { email: REDACTED } });
  expect(typeof rec.time).toBe('number');
});

it('production: несколько аргументов → ctx-массив; без аргументов — без ctx', () => {
  vi.stubEnv('NODE_ENV', 'production');
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  edgeLog.warn('multi', 1, 2);
  edgeLog.warn('solo');
  expect(JSON.parse(String(spy.mock.calls[0][0])).ctx).toEqual([1, 2]);
  expect(JSON.parse(String(spy.mock.calls[1][0]))).not.toHaveProperty('ctx');
});
