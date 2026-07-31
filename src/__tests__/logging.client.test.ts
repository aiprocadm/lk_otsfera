/**
 * @/lib/logging/client — браузерная verbatim-обёртка ('use client'-компоненты):
 * console — единственный sink на клиенте, скраббинг не применяется.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { clientLog } from '@/lib/logging/client';

afterEach(() => vi.restoreAllMocks());

it.each([
  ['debug', 'debug'],
  ['info', 'log'],
  ['warn', 'warn'],
  ['error', 'error'],
] as const)('%s → console.%s verbatim', (method, sink) => {
  const spy = vi.spyOn(console, sink).mockImplementation(() => {});
  const err = new Error('ui');
  clientLog[method]('[order-thread-inbox] failed', err);
  expect(spy).toHaveBeenCalledWith('[order-thread-inbox] failed', err);
});
