import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  primeIntegrationSettingsCache,
  cachedIntegrationSetting,
  resetIntegrationSettingsCache,
} from '@/lib/config/integrationSettingsCache';
import { encryptSecret } from '@/lib/crypto/secrets';

type Row = { key: string; value: string | null; isSecret: boolean };

/**
 * Этап 8: `primeIntegrationSettingsCache` заодно праймит значения
 * feature-флагов — они лежат в этой же таблице. Поэтому в TTL-проверках
 * считаем только «свои» вызовы: у настроек фильтр `key.in`, у флагов —
 * `key.startsWith`.
 */
function settingsCalls(findMany: ReturnType<typeof vi.fn>): number {
  return findMany.mock.calls.filter(
    (c) => (c[0] as { where?: { key?: { in?: unknown } } })?.where?.key?.in !== undefined
  ).length;
}

function prismaWith(rows: Row[]): { db: PrismaClient; findMany: ReturnType<typeof vi.fn> } {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { db: { integrationSetting: { findMany } } as unknown as PrismaClient, findMany };
}

const KEY_64_HEX = 'a'.repeat(64);

describe('integrationSettingsCache', () => {
  beforeEach(() => {
    resetIntegrationSettingsCache();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
    process.env.APP_ENCRYPTION_KEY = KEY_64_HEX;
  });

  afterEach(() => {
    resetIntegrationSettingsCache();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
    delete process.env.APP_ENCRYPTION_KEY;
    vi.useRealTimers();
  });

  it('до prime читает env вживую; пустая строка = не задано', () => {
    expect(cachedIntegrationSetting('telegram.botToken')).toBeNull();
    process.env.TELEGRAM_BOT_TOKEN = '  env-token  ';
    expect(cachedIntegrationSetting('telegram.botToken')).toBe('env-token');
    process.env.TELEGRAM_BOT_TOKEN = '';
    expect(cachedIntegrationSetting('telegram.botToken')).toBeNull();
  });

  it('после prime БД-значение побеждает env; незаданные в БД ключи остаются на живом env', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    const { db } = prismaWith([{ key: 'telegram.botToken', value: 'db-token', isSecret: false }]);
    await primeIntegrationSettingsCache(db);

    expect(cachedIntegrationSetting('telegram.botToken')).toBe('db-token');
    // ключа нет в БД → live env, в том числе выставленный ПОСЛЕ prime
    process.env.TELEGRAM_BOT_USERNAME = 'late_env_bot';
    expect(cachedIntegrationSetting('telegram.botUsername')).toBe('late_env_bot');
  });

  it('пустое/NULL значение строки БД не попадает в снапшот (env-fallback)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    const { db } = prismaWith([
      { key: 'telegram.botToken', value: '', isSecret: false },
      { key: 'telegram.botUsername', value: null, isSecret: false },
    ]);
    await primeIntegrationSettingsCache(db);
    expect(cachedIntegrationSetting('telegram.botToken')).toBe('env-token');
    expect(cachedIntegrationSetting('telegram.botUsername')).toBeNull();
  });

  it('секрет из БД расшифровывается; порченый секрет уходит в env-fallback', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    const { db } = prismaWith([
      { key: 'telegram.botToken', value: encryptSecret('db-secret'), isSecret: true },
      { key: 'max.botToken', value: 'v1:not-really-encrypted', isSecret: true },
    ]);
    await primeIntegrationSettingsCache(db);
    expect(cachedIntegrationSetting('telegram.botToken')).toBe('db-secret');
    expect(cachedIntegrationSetting('max.botToken')).toBeNull();
  });

  it('TTL: повторный prime внутри окна не ходит в БД, после reset — ходит', async () => {
    const { db, findMany } = prismaWith([]);
    await primeIntegrationSettingsCache(db);
    await primeIntegrationSettingsCache(db);
    expect(settingsCalls(findMany)).toBe(1);

    resetIntegrationSettingsCache();
    await primeIntegrationSettingsCache(db);
    expect(settingsCalls(findMany)).toBe(2);
  });

  it('TTL: по истечении окна prime перечитывает БД', async () => {
    vi.useFakeTimers();
    const { db, findMany } = prismaWith([]);
    await primeIntegrationSettingsCache(db);
    vi.advanceTimersByTime(31_000);
    await primeIntegrationSettingsCache(db);
    expect(settingsCalls(findMany)).toBe(2);
  });

  it('fail-open: ошибка БД не бросается, читатели остаются на env, backoff действует', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    const findMany = vi.fn().mockRejectedValue(new Error('db down'));
    const db = { integrationSetting: { findMany } } as unknown as PrismaClient;

    await expect(primeIntegrationSettingsCache(db)).resolves.toBeUndefined();
    expect(cachedIntegrationSetting('telegram.botToken')).toBe('env-token');

    // backoff: немедленный повторный prime не долбит БД
    await primeIntegrationSettingsCache(db);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('fail-open: не-Error rejection (строка) тоже проглатывается', async () => {
    const findMany = vi.fn().mockRejectedValue('boom');
    const db = { integrationSetting: { findMany } } as unknown as PrismaClient;
    await expect(primeIntegrationSettingsCache(db)).resolves.toBeUndefined();
  });

  it('reset возвращает читателей на env даже после успешного prime', async () => {
    const { db } = prismaWith([{ key: 'telegram.botToken', value: 'db-token', isSecret: false }]);
    await primeIntegrationSettingsCache(db);
    expect(cachedIntegrationSetting('telegram.botToken')).toBe('db-token');

    resetIntegrationSettingsCache();
    expect(cachedIntegrationSetting('telegram.botToken')).toBeNull();
  });
});
