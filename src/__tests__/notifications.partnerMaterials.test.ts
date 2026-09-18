import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { dispatchToRecipient, allowedChannels, recordNotification, logWarn } = vi.hoisted(() => ({
  dispatchToRecipient: vi.fn(),
  allowedChannels: vi.fn(),
  recordNotification: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock('@/lib/notifications/channels/dispatch', () => ({ dispatchToRecipient }));
vi.mock('@/lib/notifications/routing', () => ({ allowedChannels }));
vi.mock('@/lib/notifications/core', () => ({ recordNotification }));
vi.mock('@/lib/notifications/shared', () => ({ getAppBaseUrl: () => 'https://lk.test' }));
vi.mock('@/lib/logging', () => ({ log: { warn: logWarn, error: vi.fn(), info: vi.fn() } }));

import { notifyPartnerMaterialPublished } from '@/lib/notifications/partnerMaterials';

/** `partner_material_published` (`У-237`): адресация = видимость, правила компании-издателя, дедуп по материалу. */

function user(id: string) {
  return {
    id,
    name: `Имя ${id}`,
    email: `${id}@x`,
    role: 'partner',
    telegramChatId: null,
    maxChatId: null,
    whatsappPhone: null,
    notificationChannels: null,
    notificationPreferences: [],
  };
}

function db(over: Record<string, unknown> = {}) {
  const prisma = {
    partnerMaterial: {
      findUnique: vi.fn(async () => ({
        id: 'm1',
        title: 'Прайс',
        companyId: 'c1',
        company: { name: 'УЦ' },
      })),
    },
    organization: {
      findMany: vi.fn(async () => [
        { id: 'o1', partnerId: 'p1' },
        { id: 'o2', partnerId: 'p1' },
        { id: 'o3', partnerId: 'p2' },
      ]),
    },
    partnerUser: {
      findMany: vi.fn(async () => [
        { partnerId: 'p1', assignedOrgIds: [], user: user('admin1') },
        { partnerId: 'p1', assignedOrgIds: ['o2'], user: user('mgrIn') },
        { partnerId: 'p1', assignedOrgIds: ['oX'], user: user('mgrOut') },
        { partnerId: 'p2', assignedOrgIds: [], user: user('admin2') },
        // Тот же человек в двух партнёрах — одно уведомление.
        { partnerId: 'p2', assignedOrgIds: [], user: user('admin1') },
      ]),
    },
    ...over,
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma as any };
}

beforeEach(() => {
  vi.clearAllMocks();
  allowedChannels.mockResolvedValue(['email']);
  recordNotification.mockImplementation(async (_db: unknown, a: { userId: string }) => ({
    row: { id: `n-${a.userId}` },
    deduped: false,
  }));
  dispatchToRecipient.mockResolvedValue({ mode: 'inline', results: {} });
});

describe('notifyPartnerMaterialPublished', () => {
  it('нет материала или партнёров у компании — никому', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findUnique.mockResolvedValueOnce(null);
    expect(await notifyPartnerMaterialPublished(prisma, 'zz')).toEqual({ recipientsNotified: 0 });
    raw.organization.findMany.mockResolvedValueOnce([]);
    expect(await notifyPartnerMaterialPublished(prisma, 'm1')).toEqual({ recipientsNotified: 0 });
    expect(raw.partnerUser.findMany).not.toHaveBeenCalled();
  });

  it('адресация = видимость: админы партнёров и менеджер с организацией компании; чужой менеджер и повтор человека — нет', async () => {
    const { prisma, raw } = db();
    const r = await notifyPartnerMaterialPublished(prisma, 'm1');
    expect(r).toEqual({ recipientsNotified: 3 });
    expect(raw.organization.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'c1',
      partnerId: { not: null },
    });
    expect(raw.partnerUser.findMany.mock.calls[0][0].where).toEqual({
      partnerId: { in: ['p1', 'p2'] },
      isActive: true,
      user: { isActive: true },
    });
    const notified = recordNotification.mock.calls.map((c) => c[1].userId);
    expect(notified).toEqual(['admin1', 'mgrIn', 'admin2']);
    expect(recordNotification.mock.calls[0][1]).toMatchObject({
      partnerId: 'p1',
      type: 'partner_material_published',
      title: 'Новый материал для партнёров',
      body: 'УЦ: «Прайс».',
      meta: { materialId: 'm1', companyName: 'УЦ' },
      entityId: 'm1',
    });
    // Правила компании-издателя — один раз на рассылку, результат доходит до доставки.
    expect(allowedChannels).toHaveBeenCalledTimes(1);
    expect(allowedChannels).toHaveBeenCalledWith(prisma, {
      eventType: 'partner_material_published',
      audience: 'partner',
      companyId: 'c1',
    });
    expect(dispatchToRecipient).toHaveBeenCalledTimes(3);
    expect(dispatchToRecipient.mock.calls[0][1]).toMatchObject({
      type: 'partner_material_published',
      url: 'https://lk.test/partner/materials',
      email: {
        template: 'notification',
        props: expect.objectContaining({ recipientName: 'Имя admin1' }),
      },
      companyId: 'c1',
    });
    expect(dispatchToRecipient.mock.calls[0][2]).toEqual({
      dedupKey: 'n-admin1',
      channels: ['email'],
    });
  });

  it('дедуп по материалу: повтор в окне — строка помечена, письмо не шлётся; без правил — каналы не сужаются', async () => {
    const { prisma } = db();
    allowedChannels.mockResolvedValue(undefined);
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: true });
    expect(await notifyPartnerMaterialPublished(prisma, 'm1')).toEqual({ recipientsNotified: 3 });
    expect(dispatchToRecipient).not.toHaveBeenCalled();
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: false });
    await notifyPartnerMaterialPublished(prisma, 'm1');
    expect(dispatchToRecipient.mock.calls[0][2]).toEqual({ dedupKey: 'n1' });
  });

  it('сбой базы — предупреждение в лог, ноль получателей, без исключения', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findUnique.mockRejectedValueOnce(new Error('db down'));
    expect(await notifyPartnerMaterialPublished(prisma, 'm1')).toEqual({ recipientsNotified: 0 });
    expect(logWarn).toHaveBeenCalledWith(
      '[notifications/partnerMaterials] publish notify failed',
      expect.objectContaining({ materialId: 'm1', error: 'db down' })
    );
  });

  it('сбой не-ошибкой тоже не роняет рассылку — в лог уходит строка', async () => {
    // База может «бросить» не Error, а строку: тогда `err.message` не
    // существует и запись в лог сама уронила бы рассылку.
    const { prisma, raw } = db();
    raw.partnerMaterial.findUnique.mockRejectedValueOnce('соединение оборвалось');
    expect(await notifyPartnerMaterialPublished(prisma, 'm1')).toEqual({ recipientsNotified: 0 });
    expect(logWarn).toHaveBeenCalledWith(
      '[notifications/partnerMaterials] publish notify failed',
      expect.objectContaining({ error: 'соединение оборвалось' })
    );
  });

  it('у получателя нет имени — в письме нейтральное обращение, а не пустота', async () => {
    const nameless = { ...user('admin1'), name: '' };
    const { prisma } = db({
      partnerUser: {
        findMany: vi.fn(async () => [{ partnerId: 'p1', assignedOrgIds: [], user: nameless }]),
      },
    });
    await notifyPartnerMaterialPublished(prisma, 'm1');
    expect(dispatchToRecipient.mock.calls[0][1]).toMatchObject({
      email: { props: expect.objectContaining({ recipientName: 'партнёр' }) },
    });
  });
});
