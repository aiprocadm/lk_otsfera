import { describe, it, expect, afterEach, vi } from 'vitest';

// Конфиг адаптера 1С теперь читается из настроек интеграций (кэш: БД после
// prime, env — fallback). Проверяем, что значение из БД побеждает env и что
// смена конфига пересобирает синглтон. Секретный токен здесь идёт через
// env-fallback (в снапшот попадают только расшифрованные секреты).

vi.setConfig({ testTimeout: 30000 });

function mockPrisma(rows: { key: string; value: string; isSecret: boolean }[]) {
  return { integrationSetting: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
}

describe('getOneCAdapter — конфиг из настроек интеграций', () => {
  const saved: Record<string, string | undefined> = {};
  function setEnv(key: string, value: string | undefined) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const k of Object.keys(saved)) delete saved[k];
    vi.resetModules();
  });

  it('DB adapter=rest побеждает env=fake; смена apiUrl пересобирает адаптер', async () => {
    // env говорит fake — если бы читался env, был бы Fake-адаптер.
    setEnv('ONE_C_ADAPTER', 'fake');
    setEnv('ONE_C_API_URL', undefined);
    setEnv('ONE_C_API_TOKEN', 'env-token'); // токен-секрет через env-fallback

    const cache = await import('@/lib/config/integrationSettingsCache');
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');

    await cache.primeIntegrationSettingsCache(
      mockPrisma([
        { key: 'onec.adapter', value: 'rest', isSecret: false },
        { key: 'onec.apiUrl', value: 'https://db-1c/', isSecret: false }
      ])
    );

    const a1 = getOneCAdapter();
    // rest-адаптер имеет pushLead — значит выиграл DB-конфиг, а не env=fake.
    expect(typeof a1.pushLead).toBe('function');
    // повторный вызов при неизменном конфиге — тот же инстанс.
    expect(getOneCAdapter()).toBe(a1);

    // Меняем адрес в «БД» → пересборка синглтона по новому ключу конфига.
    cache.resetIntegrationSettingsCache();
    await cache.primeIntegrationSettingsCache(
      mockPrisma([
        { key: 'onec.adapter', value: 'rest', isSecret: false },
        { key: 'onec.apiUrl', value: 'https://db-1c-v2/', isSecret: false }
      ])
    );
    const a2 = getOneCAdapter();
    expect(a2).not.toBe(a1);
    expect(typeof a2.pushLead).toBe('function');
  });

  it('rest из БД без apiUrl → бросает (fail-loud)', async () => {
    setEnv('ONE_C_ADAPTER', 'fake');
    setEnv('ONE_C_API_URL', undefined);
    setEnv('ONE_C_API_TOKEN', undefined);

    const cache = await import('@/lib/config/integrationSettingsCache');
    const { getOneCAdapter } = await import('@/lib/services/oneCSync/index');

    await cache.primeIntegrationSettingsCache(
      mockPrisma([{ key: 'onec.adapter', value: 'rest', isSecret: false }])
    );
    expect(() => getOneCAdapter()).toThrow('ONE_C_API_URL');
  });
});
