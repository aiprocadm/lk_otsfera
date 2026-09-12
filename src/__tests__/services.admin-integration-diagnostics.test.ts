import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { listIntegrationSyncStates, getAppBaseUrl } = vi.hoisted(() => ({
  listIntegrationSyncStates: vi.fn(),
  getAppBaseUrl: vi.fn(() => 'https://app.test'),
}));
vi.mock('@/lib/services/admin/integrations', () => ({ listIntegrationSyncStates }));
vi.mock('@/lib/notifications/shared', () => ({ getAppBaseUrl }));

import { loadIntegrationDiagnostics } from '@/lib/services/admin/integrationDiagnostics';
import { INTEGRATION_TEST_KEYS } from '@/lib/services/admin/testIntegration';

/**
 * Диагностика подключений (ФТ-14.3/14.4), вынесенная из обзорной страницы
 * ради раздела «Подключение мессенджеров» (спека 2026-09-12, Р-М-6).
 */
const prisma = {} as unknown as PrismaClient;
const ranAt = new Date('2026-07-23T10:00:00Z');
const eventAt = new Date('2026-07-23T09:30:00Z');

describe('loadIntegrationDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIntegrationSyncStates.mockResolvedValue([
      { entity: 'integration.telegram', lastRunAt: ranAt, lastSuccessAt: ranAt, lastError: null },
      {
        entity: 'integration.onec',
        lastRunAt: ranAt,
        lastSuccessAt: null,
        lastError: 'Сервер ответил HTTP 500',
      },
      {
        entity: 'integration.max',
        lastRunAt: ranAt,
        lastSuccessAt: new Date('2026-07-01T00:00:00Z'),
        lastError: 'таймаут',
      },
      { entity: 'integration.dadata', lastRunAt: null, lastSuccessAt: null, lastError: null },
      { entity: 'webhook.telegram', lastRunAt: null, lastSuccessAt: eventAt, lastError: null },
    ]);
  });

  it('спрашивает SyncState один раз: все пробы + вебхуки этой страницы', async () => {
    await loadIntegrationDiagnostics(prisma, ['telegram', 'mango']);
    expect(listIntegrationSyncStates).toHaveBeenCalledWith(prisma, [
      ...INTEGRATION_TEST_KEYS.map((k) => `integration.${k}`),
      'webhook.telegram',
      'webhook.mango',
    ]);
  });

  it('checkOf: успешная, провальная и не запускавшаяся проба', async () => {
    const diag = await loadIntegrationDiagnostics(prisma, []);
    expect(diag.checkOf('telegram')).toEqual({
      lastAt: expect.any(String),
      lastOk: true,
      lastError: null,
    });
    expect(diag.checkOf('onec')).toMatchObject({
      lastOk: false,
      lastError: 'Сервер ответил HTTP 500',
    });
    // Успех был, но раньше последнего запуска — последняя проба провалилась.
    expect(diag.checkOf('max')).toMatchObject({ lastOk: false, lastError: 'таймаут' });
    expect(diag.checkOf('dadata')).toBeNull();
    expect(diag.checkOf('whatsapp')).toBeNull();
  });

  it('webhookOf: адрес, заголовок, последнее входящее; кнопки секрета только у наших провайдеров', async () => {
    const diag = await loadIntegrationDiagnostics(prisma, ['telegram', 'whatsapp', 'mango']);
    expect(diag.webhookOf('telegram', 'x-telegram-bot-api-secret-token', true)).toEqual({
      url: 'https://app.test/api/integrations/telegram/webhook',
      headerName: 'x-telegram-bot-api-secret-token',
      secretSet: true,
      lastEventAt: expect.any(String),
      note: undefined,
      provider: 'telegram',
      canRegister: true,
    });
    expect(diag.webhookOf('whatsapp', 'x-wazzup-secret', false)).toMatchObject({
      lastEventAt: null,
      provider: 'whatsapp',
      canRegister: false,
    });
    const mango = diag.webhookOf('mango', null, true, 'подпись по ключам');
    expect(mango).toMatchObject({ headerName: null, note: 'подпись по ключам' });
    expect(mango).not.toHaveProperty('provider');
  });
});
