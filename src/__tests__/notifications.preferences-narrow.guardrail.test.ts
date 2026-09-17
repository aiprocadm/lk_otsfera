import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { sendA, sendB } = vi.hoisted(() => ({ sendA: vi.fn(), sendB: vi.fn() }));
vi.mock('@/lib/notifications/channels/registry', () => ({
  getChannels: () => [
    { key: 'email', isEnabledFor: () => true, send: sendA },
    { key: 'telegram', isEnabledFor: () => true, send: sendB },
  ],
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({
  primeIntegrationSettingsCache: vi.fn(),
}));
const { listRoutingRules } = vi.hoisted(() => ({ listRoutingRules: vi.fn() }));
vi.mock('@/lib/notifications/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/routing')>()),
  listRoutingRules,
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled: () => true }));
vi.mock('@/lib/max/client', () => ({ isMaxEnabled: () => true }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ isWhatsAppEnabled: () => true }));

import { narrowByEventPreference } from '@/lib/notifications/channels/preferences';
import { deliverToRecipient } from '@/lib/notifications/channels/deliver';
import { saveNotificationPreference } from '@/lib/services/notifications/eventPreferences';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * СТРАЖ `У-229` (решение `Р-Э5-4`): личная настройка ТОЛЬКО СУЖАЕТ правило
 * компании и никогда не расширяет его.
 *
 * Три слоя одного правила: чистый помощник (пересечение, а не объединение),
 * доставка (помощник реально применён — иначе он просто существует) и сервис
 * (сервер отвергает канал, запрещённый компанией, даже если форма его не
 * показывала — гард живёт не в галочке, §4).
 *
 * Мутация (проверено 17.09.2026): заменить пересечение на объединение в
 * `narrowByEventPreference` → падают «не расширяет» и «доставка применяет»;
 * убрать проверку потолка в `saveNotificationPreference` → падает «сервер
 * отвергает запрещённый компанией канал».
 */

const prefs = [{ eventType: 'payment_received', channels: ['email'] }];

describe('страж: помощник — пересечение, а не объединение', () => {
  it('нет строки настройки — веер компании не меняется', () => {
    expect(narrowByEventPreference([], 'payment_received', ['email', 'telegram'])).toEqual([
      'email',
      'telegram',
    ]);
    expect(narrowByEventPreference(undefined, 'payment_received', undefined)).toBeUndefined();
  });

  it('строка есть — остаются только включённые в ней каналы', () => {
    expect(narrowByEventPreference(prefs, 'payment_received', ['email', 'telegram'])).toEqual([
      'email',
    ]);
  });

  it('НЕ РАСШИРЯЕТ: канал, запрещённый компанией, не вернётся, даже если человек его включил', () => {
    const wide = [{ eventType: 'payment_received', channels: ['email', 'telegram', 'whatsapp'] }];
    expect(narrowByEventPreference(wide, 'payment_received', ['email'])).toEqual(['email']);
  });

  it('без правила компании (undefined) настройка сужает от полного набора', () => {
    expect(narrowByEventPreference(prefs, 'payment_received', undefined)).toEqual(['email']);
  });

  it('настройка другого события не трогает это', () => {
    expect(narrowByEventPreference(prefs, 'order_status_changed', ['email', 'telegram'])).toEqual([
      'email',
      'telegram',
    ]);
  });
});

describe('страж: доставка применяет настройку', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendA.mockResolvedValue({ status: 'sent' });
    sendB.mockResolvedValue({ status: 'sent' });
  });

  const user = {
    id: 'u1',
    email: 'u@x.ru',
    name: 'Иван',
    telegramChatId: '1',
    maxChatId: null,
    whatsappPhone: null,
    notificationChannels: null,
    notificationPreferences: prefs,
  };
  const payload = { type: 'payment_received', title: 'Т', body: 'Б' };

  it('выключенный в настройке канал не получает отправку', async () => {
    const res = await deliverToRecipient(user, payload, { channels: ['email', 'telegram'] });
    expect(sendA).toHaveBeenCalledTimes(1);
    expect(sendB).not.toHaveBeenCalled();
    expect(Object.keys(res)).toEqual(['email']);
  });

  it('получатель без настроек — как раньше, оба канала', async () => {
    await deliverToRecipient({ ...user, notificationPreferences: [] }, payload, {
      channels: ['email', 'telegram'],
    });
    expect(sendA).toHaveBeenCalledTimes(1);
    expect(sendB).toHaveBeenCalledTimes(1);
  });
});

describe('страж: сервер отвергает запрещённый компанией канал', () => {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const prisma = {
    user: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    userNotificationPreference: { findUnique, upsert },
  } as unknown as PrismaClient;
  const leader = { sub: 'boss', role: 'leader', companyId: 'co-1' } as SessionPayload;

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({});
    // Компания выключила Telegram для «оплата поступила» у менеджерского контура.
    listRoutingRules.mockResolvedValue([
      {
        eventType: 'invoice_paid',
        eventLabel: 'Счёт оплачен',
        audience: 'manager',
        channel: 'telegram',
        enabled: false,
        source: 'company',
      },
    ]);
  });

  it('включить запрещённый канал нельзя — код `channel_disabled_by_company`', async () => {
    const res = await saveNotificationPreference(prisma, leader, {
      eventType: 'invoice_paid',
      channels: ['email', 'telegram'],
    });
    expect(res).toEqual({ ok: false, error: 'channel_disabled_by_company' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('сузить — можно: только почта сохраняется', async () => {
    const res = await saveNotificationPreference(prisma, leader, {
      eventType: 'invoice_paid',
      channels: ['email'],
    });
    expect(res).toEqual({ ok: true, channels: ['email'] });
    expect(upsert.mock.calls[0][0].create).toEqual({
      userId: 'boss',
      eventType: 'invoice_paid',
      channels: ['email'],
    });
  });

  it('чужое для роли событие отвергается', async () => {
    const res = await saveNotificationPreference(prisma, leader, {
      eventType: 'commission_statement_ready',
      channels: ['email'],
    });
    expect(res).toEqual({ ok: false, error: 'unknown_event' });
  });

  it('выдуманный канал отвергается', async () => {
    const res = await saveNotificationPreference(prisma, leader, {
      eventType: 'invoice_paid',
      channels: ['голубь'],
    });
    expect(res).toEqual({ ok: false, error: 'invalid_channel' });
  });
});
