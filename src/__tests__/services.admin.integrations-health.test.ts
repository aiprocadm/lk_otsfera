import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Светофор интеграций (`У-70`) и переключатели каналов (`У-69`).
 *
 * Проверяем именно перевод «сырых» данных пробы в состояние, которое видит
 * человек: у него на экране три слова, а под ними — три поля `SyncState`.
 */
const { getIntegrationsStatus, listIntegrationSyncStates } = vi.hoisted(() => ({
  getIntegrationsStatus: vi.fn(),
  listIntegrationSyncStates: vi.fn(),
}));
vi.mock('@/lib/services/admin/integrations', () => ({
  getIntegrationsStatus,
  listIntegrationSyncStates,
}));

const { primeIntegrationSettingsCache } = vi.hoisted(() => ({
  primeIntegrationSettingsCache: vi.fn(async () => undefined),
}));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ primeIntegrationSettingsCache }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => true) }));
vi.mock('@/lib/featureFlags', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isFeatureEnabled,
}));

import { getIntegrationsHealth } from '@/lib/services/admin/integrationsHealth';

const admin = { sub: 'u1', role: 'admin' } as never;
const RUN = new Date('2026-08-12T10:00:00.000Z');

function status(key: string, enabled: boolean, label = key) {
  return { key, label, enabled, description: `описание ${key}`, envHint: 'подсказка' };
}

beforeEach(() => {
  isFeatureEnabled.mockReturnValue(true);
  getIntegrationsStatus.mockReset().mockReturnValue([]);
  listIntegrationSyncStates.mockReset().mockResolvedValue([]);
});

describe('getIntegrationsHealth (У-70)', () => {
  it('успешная проба — «работает» с датой; провалившаяся — «ошибка» с текстом', async () => {
    getIntegrationsStatus.mockReturnValue([status('telegram', true), status('email', true)]);
    listIntegrationSyncStates.mockResolvedValue([
      { entity: 'integration.telegram', lastRunAt: RUN, lastSuccessAt: RUN, lastError: null },
      {
        entity: 'integration.email',
        lastRunAt: RUN,
        lastSuccessAt: null,
        lastError: 'SMTP timeout',
      },
    ]);

    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');

    expect(res.rows[0]).toMatchObject({
      key: 'telegram',
      status: 'ok',
      lastCheckedAt: RUN.toISOString(),
    });
    expect(res.rows[1]).toMatchObject({
      key: 'email',
      status: 'error',
      lastError: 'SMTP timeout',
    });
  });

  it('нет ключей — «не настроено», даже если проба когда-то была успешной', async () => {
    getIntegrationsStatus.mockReturnValue([status('max', false)]);
    listIntegrationSyncStates.mockResolvedValue([
      { entity: 'integration.max', lastRunAt: RUN, lastSuccessAt: RUN, lastError: null },
    ]);
    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0]?.status).toBe('not_configured');
  });

  it('ключи есть, а проверку не запускали — отдельное состояние, а не «работает»', async () => {
    // Обещать работоспособность, которую никто не проверял, нельзя.
    getIntegrationsStatus.mockReturnValue([status('whatsapp', true)]);
    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0]).toMatchObject({ status: 'unchecked', lastCheckedAt: null });
  });

  it('У-69: у каналов есть переключатель, у Mango — нет (флаг раздела)', async () => {
    getIntegrationsStatus.mockReturnValue([
      status('max', true),
      status('whatsapp', true),
      status('mango', true),
      status('telegram', true),
    ]);
    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');

    expect(res.rows[0]).toMatchObject({ flag: 'max_channel', flagEditable: true });
    expect(res.rows[1]).toMatchObject({ flag: 'whatsapp_channel', flagEditable: true });
    // Телефония читается в middleware — переключать её из интерфейса нельзя.
    expect(res.rows[2]).toMatchObject({ flag: 'telephony_mango', flagEditable: false });
    // У Telegram флага канала нет вовсе: он включается наличием токена.
    expect(res.rows[3]).toMatchObject({ flag: null, flagEnabled: false, flagEditable: false });
  });

  it('состояние флага берётся из общей проверки, а не выдумывается', async () => {
    getIntegrationsStatus.mockReturnValue([status('max', true)]);
    isFeatureEnabled.mockReturnValue(false);
    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0]?.flagEnabled).toBe(false);
  });

  it('не-админ состояния не видит и базу не трогает', async () => {
    const res = await getIntegrationsHealth({} as never, { sub: 'u2', role: 'manager' } as never);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(listIntegrationSyncStates).not.toHaveBeenCalled();
  });
});
