import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Склад значений флагов (`У-65`, `У-66`).
 *
 * Главное свойство — **fail-open**: пока снимка нет (первый запрос, edge-среда,
 * упавшая база), читатели остаются на переменных окружения, то есть система
 * ведёт себя ровно как до этапа 8. Проверяем именно это, а не «работает ли
 * Map».
 */
const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn: logWarn, error: vi.fn(), info: vi.fn() } }));

import {
  primeFeatureFlagCache,
  cachedFeatureFlagValue,
  resetFeatureFlagCache,
  featureSettingKey,
} from '@/lib/config/featureFlagStore';

function db(rows: Array<{ key: string; value: string | null }>) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { prisma: { integrationSetting: { findMany } } as never, findMany };
}

beforeEach(() => {
  resetFeatureFlagCache();
  logWarn.mockClear();
});

describe('featureFlagStore', () => {
  it('ключ строки — с префиксом feature.', () => {
    expect(featureSettingKey('staff_chat')).toBe('feature.staff_chat');
  });

  it('до прайма значения нет — читатель уходит на переменную окружения', () => {
    expect(cachedFeatureFlagValue('staff_chat')).toBeNull();
  });

  it('после прайма отдаёт значение из базы; пустые строки не считаются заданными', async () => {
    const { prisma, findMany } = db([
      { key: 'feature.staff_chat', value: '1' },
      { key: 'feature.pwa_installer', value: '' },
      { key: 'feature.global_search', value: null },
    ]);
    await primeFeatureFlagCache(prisma);

    expect(cachedFeatureFlagValue('staff_chat')).toBe('1');
    // Пустое значение = «не задано»: иначе снимок заморозил бы env.
    expect(cachedFeatureFlagValue('pwa_installer')).toBeNull();
    expect(cachedFeatureFlagValue('global_search')).toBeNull();
    expect(findMany.mock.calls[0]![0].where).toEqual({ key: { startsWith: 'feature.' } });
  });

  it('повторный прайм в пределах TTL в базу не ходит', async () => {
    const { prisma, findMany } = db([{ key: 'feature.staff_chat', value: '1' }]);
    await primeFeatureFlagCache(prisma);
    await primeFeatureFlagCache(prisma);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('сброс заставляет перечитать базу — иначе экран показывал бы старое', async () => {
    const { prisma, findMany } = db([{ key: 'feature.staff_chat', value: '1' }]);
    await primeFeatureFlagCache(prisma);
    resetFeatureFlagCache();
    await primeFeatureFlagCache(prisma);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('упавшая база не роняет чтение: значения остаются из окружения', async () => {
    const findMany = vi.fn().mockRejectedValue(new Error('db down'));
    const prisma = { integrationSetting: { findMany } } as never;
    await primeFeatureFlagCache(prisma);

    expect(cachedFeatureFlagValue('staff_chat')).toBeNull();
    expect(logWarn).toHaveBeenCalled();
  });

  it('не-Error отказ базы тоже логируется без падения', async () => {
    const findMany = vi.fn().mockRejectedValue('строковый отказ');
    const prisma = { integrationSetting: { findMany } } as never;
    await expect(primeFeatureFlagCache(prisma)).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalled();
  });
});
