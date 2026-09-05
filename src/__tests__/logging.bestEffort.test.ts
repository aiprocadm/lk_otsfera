/**
 * `bestEffort(label)` — обработчик для best-effort операций (аудит, «последний
 * вход», журнал синхронизации): пишет `log.warn(label, err)` и не роняет
 * промис (`В-1` → `Р-25`, сопровождение 05.09.2026).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestEffort } from '@/lib/logging';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bestEffort', () => {
  it('пишет warn с меткой и той же ошибкой', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('audit down');
    bestEffort('[x] audit failed')(err);
    expect(warn).toHaveBeenCalledWith('[x] audit failed', err);
  });

  it('в .catch() гасит отказ: промис разрешается undefined, а не бросает', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      Promise.reject(new Error('db down')).catch(bestEffort('[x] failed'))
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('не-Error отказ (строка) тоже попадает в warn как есть', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bestEffort('[x] failed')('smtp string down');
    expect(warn).toHaveBeenCalledWith('[x] failed', 'smtp string down');
  });
});
