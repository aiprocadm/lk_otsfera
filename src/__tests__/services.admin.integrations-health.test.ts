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

// `У-174`: счёт невыгруженных документов и порог — свои модули, здесь важна
// только сборка светофора из их ответов.
const { countFailedDocumentPushes, getThresholds } = vi.hoisted(() => ({
  countFailedDocumentPushes: vi.fn(async () => 0),
  getThresholds: vi.fn(() => ({ oneCPushFailedMax: 0 })),
}));
vi.mock('@/lib/services/oneCSync/pushFailures', () => ({ countFailedDocumentPushes }));
vi.mock('@/lib/monitoring/thresholds', () => ({ getThresholds }));

import { getIntegrationsHealth } from '@/lib/services/admin/integrationsHealth';

const admin = { sub: 'u1', role: 'admin' } as never;
const leader = { sub: 'u3', role: 'leader', companyId: 'co-1' } as never;
const RUN = new Date('2026-08-12T10:00:00.000Z');
const ONEC_OK = { entity: 'integration.onec', lastRunAt: RUN, lastSuccessAt: RUN, lastError: null };

function status(key: string, enabled: boolean, label = key) {
  return { key, label, enabled, description: `описание ${key}`, envHint: 'подсказка' };
}

beforeEach(() => {
  isFeatureEnabled.mockReturnValue(true);
  getIntegrationsStatus.mockReset().mockReturnValue([]);
  listIntegrationSyncStates.mockReset().mockResolvedValue([]);
  countFailedDocumentPushes.mockReset().mockResolvedValue(0);
  getThresholds.mockReset().mockReturnValue({ oneCPushFailedMax: 0 });
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
    // `У-124`: телефония СНЯТА с edge-гейта и теперь переключается из
    // интерфейса. Раньше здесь стояло `flagEditable: false` — переключатель
    // был виден, но включить телефонию не мог (дефект `Д-38`).
    expect(res.rows[2]).toMatchObject({ flag: 'telephony_mango', flagEditable: true });
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
    expect(countFailedDocumentPushes).not.toHaveBeenCalled();
  });
});

describe('У-174: «документов не выгружено» на карточке 1С', () => {
  it('число и порог видны у 1С всегда — даже при нуле; у других карточек их нет', async () => {
    getIntegrationsStatus.mockReturnValue([status('onec', true), status('telegram', true)]);
    listIntegrationSyncStates.mockResolvedValue([ONEC_OK]);
    getThresholds.mockReturnValue({ oneCPushFailedMax: 5 });
    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0]).toMatchObject({
      key: 'onec',
      status: 'ok',
      documentsNotPushed: { count: 0, threshold: 5 },
    });
    expect(res.rows[1]?.documentsNotPushed).toBeNull();
  });

  it('выше порога — «работает с ошибками»: зелёный при невыгруженных счетах врал бы', async () => {
    getIntegrationsStatus.mockReturnValue([status('onec', true)]);
    listIntegrationSyncStates.mockResolvedValue([ONEC_OK]);
    countFailedDocumentPushes.mockResolvedValue(3);
    getThresholds.mockReturnValue({ oneCPushFailedMax: 2 });
    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0]).toMatchObject({
      status: 'degraded',
      documentsNotPushed: { count: 3, threshold: 2 },
    });
  });

  it('ровно на пороге — ещё «работает»: порог значит «столько терпим»', async () => {
    getIntegrationsStatus.mockReturnValue([status('onec', true)]);
    listIntegrationSyncStates.mockResolvedValue([ONEC_OK]);
    countFailedDocumentPushes.mockResolvedValue(2);
    getThresholds.mockReturnValue({ oneCPushFailedMax: 2 });
    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0]?.status).toBe('ok');
  });

  it('«ошибка» и «не настроено» сильнее: они и так объясняют, почему документы не уезжают', async () => {
    getIntegrationsStatus.mockReturnValue([status('onec', true)]);
    listIntegrationSyncStates.mockResolvedValue([
      { ...ONEC_OK, lastSuccessAt: null, lastError: 'нет связи' },
    ]);
    countFailedDocumentPushes.mockResolvedValue(10);
    const res = await getIntegrationsHealth({} as never, admin);
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0]).toMatchObject({ status: 'error', documentsNotPushed: { count: 10 } });

    getIntegrationsStatus.mockReturnValue([status('onec', false)]);
    const off = await getIntegrationsHealth({} as never, admin);
    if (!off.ok) throw new Error('expected ok');
    expect(off.rows[0]?.status).toBe('not_configured');
  });

  it('админ считает по всей платформе, руководитель — по своей компании', async () => {
    getIntegrationsStatus.mockReturnValue([status('onec', true)]);
    const prisma = {} as never;
    await getIntegrationsHealth(prisma, admin);
    expect(countFailedDocumentPushes).toHaveBeenLastCalledWith(prisma);
    await getIntegrationsHealth(prisma, leader);
    expect(countFailedDocumentPushes).toHaveBeenLastCalledWith(prisma, { companyId: 'co-1' });
  });

  it('руководитель без компании видит ноль, а не всю платформу (C8: null → deny-all)', async () => {
    getIntegrationsStatus.mockReturnValue([status('onec', true)]);
    listIntegrationSyncStates.mockResolvedValue([ONEC_OK]);
    countFailedDocumentPushes.mockResolvedValue(7);
    const res = await getIntegrationsHealth(
      {} as never,
      { sub: 'u4', role: 'leader', companyId: null } as never
    );
    if (!res.ok) throw new Error('expected ok');
    expect(countFailedDocumentPushes).not.toHaveBeenCalled();
    expect(res.rows[0]).toMatchObject({ status: 'ok', documentsNotPushed: { count: 0 } });
  });
});
