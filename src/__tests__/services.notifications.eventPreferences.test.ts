import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { listRoutingRules } = vi.hoisted(() => ({ listRoutingRules: vi.fn() }));
vi.mock('@/lib/notifications/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/routing')>()),
  listRoutingRules,
}));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({
  primeIntegrationSettingsCache: vi.fn(),
}));
const { isTelegramEnabled, isMaxEnabled, isWhatsAppEnabled } = vi.hoisted(() => ({
  isTelegramEnabled: vi.fn(),
  isMaxEnabled: vi.fn(),
  isWhatsAppEnabled: vi.fn(),
}));
vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled }));
vi.mock('@/lib/max/client', () => ({ isMaxEnabled }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ isWhatsAppEnabled }));

import {
  getNotificationPreferenceMatrix,
  saveNotificationPreference,
} from '@/lib/services/notifications/eventPreferences';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Матрица личных настроек (`У-229`): колонки — только каналы, куда есть куда
 * доставлять; потолок — правило компании; своя строка перекрывает умолчание.
 */

const userFindUnique = vi.fn();
const orgFindUnique = vi.fn();
const prefFindUnique = vi.fn();
const upsert = vi.fn();
const prisma = {
  user: { findUnique: userFindUnique },
  organization: { findUnique: orgFindUnique },
  userNotificationPreference: { findUnique: prefFindUnique, upsert },
} as unknown as PrismaClient;

const partner = { sub: 'p1', role: 'partner', partnerId: 'pt' } as SessionPayload;
const orgUser = { sub: 'o1', role: 'organization', organizationId: 'org-1' } as SessionPayload;
const student = { sub: 's1', role: 'student' } as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  isTelegramEnabled.mockReturnValue(true);
  isMaxEnabled.mockReturnValue(true);
  isWhatsAppEnabled.mockReturnValue(true);
  listRoutingRules.mockResolvedValue([]);
  userFindUnique.mockResolvedValue({
    telegramChatId: 'tg',
    maxChatId: null,
    whatsappPhone: null,
    notificationPreferences: [],
  });
  orgFindUnique.mockResolvedValue({ companyId: 'co-org' });
  prefFindUnique.mockResolvedValue(null);
  upsert.mockResolvedValue({});
});

describe('getNotificationPreferenceMatrix', () => {
  it('колонки — почта всегда и только привязанные каналы', async () => {
    const { matrix } = await getNotificationPreferenceMatrix(prisma, partner);
    expect(matrix.columns).toEqual(['email', 'telegram']);
  });

  it('привязка есть, но канал выключен на платформе — колонки нет', async () => {
    isTelegramEnabled.mockReturnValue(false);
    const { matrix } = await getNotificationPreferenceMatrix(prisma, partner);
    expect(matrix.columns).toEqual(['email']);
  });

  it('строки — только события роли, с подписью и значком из реестра', async () => {
    const { matrix } = await getNotificationPreferenceMatrix(prisma, partner);
    const keys = matrix.rows.map((r) => r.eventType);
    expect(keys).toContain('commission_statement_ready');
    expect(keys).not.toContain('sla_escalation');
    const row = matrix.rows.find((r) => r.eventType === 'commission_statement_ready')!;
    expect(row.label).toBe('Готов отчёт по комиссии');
    expect(row.icon.length).toBeGreaterThan(0);
  });

  it('без правил и без своей строки — всё включено (умолчание компании)', async () => {
    const { matrix } = await getNotificationPreferenceMatrix(prisma, partner);
    for (const cell of matrix.rows[0]!.channels) {
      expect(cell).toMatchObject({ allowedByCompany: true, enabled: true });
    }
  });

  it('правило компании выключило канал — ячейка запрещена и выключена', async () => {
    listRoutingRules.mockResolvedValue([
      {
        eventType: 'commission_statement_ready',
        eventLabel: 'x',
        audience: 'partner',
        channel: 'telegram',
        enabled: false,
        source: 'platform',
      },
    ]);
    const { matrix } = await getNotificationPreferenceMatrix(prisma, partner);
    const row = matrix.rows.find((r) => r.eventType === 'commission_statement_ready')!;
    expect(row.channels.find((c) => c.key === 'telegram')).toEqual({
      key: 'telegram',
      allowedByCompany: false,
      enabled: false,
    });
    expect(row.channels.find((c) => c.key === 'email')?.enabled).toBe(true);
  });

  it('своя строка перекрывает умолчание: выключенное человеком — выключено', async () => {
    userFindUnique.mockResolvedValue({
      telegramChatId: 'tg',
      maxChatId: null,
      whatsappPhone: null,
      notificationPreferences: [{ eventType: 'commission_statement_ready', channels: ['email'] }],
    });
    const { matrix } = await getNotificationPreferenceMatrix(prisma, partner);
    const row = matrix.rows.find((r) => r.eventType === 'commission_statement_ready')!;
    expect(row.channels.find((c) => c.key === 'telegram')?.enabled).toBe(false);
    expect(row.channels.find((c) => c.key === 'email')?.enabled).toBe(true);
  });

  it('заказчик: потолок — правила компании ЕГО организации', async () => {
    await getNotificationPreferenceMatrix(prisma, orgUser);
    expect(orgFindUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { companyId: true },
    });
    expect(listRoutingRules).toHaveBeenCalledWith(prisma, 'co-org');
  });

  it('партнёр: своей компании нет — только правила платформы', async () => {
    await getNotificationPreferenceMatrix(prisma, partner);
    expect(listRoutingRules).toHaveBeenCalledWith(prisma, null);
  });

  it('слушатель: только его три типа об обучении (`У-286`)', async () => {
    const { matrix } = await getNotificationPreferenceMatrix(prisma, student);
    expect(matrix.rows.map((r) => r.eventType)).toEqual([
      'certificate_expiring',
      'training_assigned',
      'training_ending_soon',
    ]);
  });

  it('пользователь не найден — только почта в колонках, экран не падает', async () => {
    userFindUnique.mockResolvedValue(null);
    const { matrix } = await getNotificationPreferenceMatrix(prisma, partner);
    expect(matrix.columns).toEqual(['email']);
  });
});

describe('saveNotificationPreference', () => {
  it('пишет строку и аудит с before/after', async () => {
    prefFindUnique.mockResolvedValue({ channels: ['email', 'telegram'] });
    const res = await saveNotificationPreference(prisma, partner, {
      eventType: 'commission_statement_ready',
      channels: ['email', 'email'],
    });
    expect(res).toEqual({ ok: true, channels: ['email'] });
    expect(upsert.mock.calls[0][0].where).toEqual({
      userId_eventType: { userId: 'p1', eventType: 'commission_statement_ready' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'notification_preferences_changed',
        before: { eventType: 'commission_statement_ready', channels: ['email', 'telegram'] },
        after: { eventType: 'commission_statement_ready', channels: ['email'] },
      })
    );
  });

  it('пустой список = «только в кабинете» — допустимо', async () => {
    const res = await saveNotificationPreference(prisma, partner, {
      eventType: 'commission_statement_ready',
      channels: [],
    });
    expect(res).toEqual({ ok: true, channels: [] });
  });
});

describe('getNotificationPreferenceMatrix — краевые ветки потолка и каналов', () => {
  it('заказчик без организации в сессии — правила платформы', async () => {
    await getNotificationPreferenceMatrix(prisma, {
      sub: 'o2',
      role: 'organization',
    } as SessionPayload);
    expect(orgFindUnique).not.toHaveBeenCalled();
    expect(listRoutingRules).toHaveBeenCalledWith(prisma, null);
  });

  it('организация не найдена — правила платформы', async () => {
    orgFindUnique.mockResolvedValue(null);
    await getNotificationPreferenceMatrix(prisma, orgUser);
    expect(listRoutingRules).toHaveBeenCalledWith(prisma, null);
  });

  it('сотрудник без компании в сессии — правила платформы', async () => {
    await getNotificationPreferenceMatrix(prisma, { sub: 'm9', role: 'manager' } as SessionPayload);
    expect(listRoutingRules).toHaveBeenCalledWith(prisma, null);
  });

  it('MAX и WhatsApp привязаны и включены — колонки есть; выключены на платформе — нет', async () => {
    userFindUnique.mockResolvedValue({
      telegramChatId: null,
      maxChatId: 'mx',
      whatsappPhone: '+79990000000',
      notificationPreferences: [],
    });
    const on = await getNotificationPreferenceMatrix(prisma, partner);
    expect(on.matrix.columns).toEqual(['email', 'max', 'whatsapp']);
    isMaxEnabled.mockReturnValue(false);
    isWhatsAppEnabled.mockReturnValue(false);
    const off = await getNotificationPreferenceMatrix(prisma, partner);
    expect(off.matrix.columns).toEqual(['email']);
  });
});
