import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { isFeatureEnabled, sendDailyDigestEmail, sendNotificationEmail, getTemplateOverride } =
  vi.hoisted(() => ({
    isFeatureEnabled: vi.fn(),
    sendDailyDigestEmail: vi.fn(),
    sendNotificationEmail: vi.fn(),
    getTemplateOverride: vi.fn(),
  }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/email/send', () => ({ sendDailyDigestEmail, sendNotificationEmail }));
vi.mock('@/lib/email/templateOverrides', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/templateOverrides')>()),
  getTemplateOverride,
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import {
  runNotificationDigest,
  moscowHour,
  DIGEST_MAX_ITEMS,
  DIGEST_MIN_GAP_MS,
} from '@/lib/services/notifications/digest';
import { effectiveChannels } from '@/lib/notifications/channels/preferences';
import { urgentNotificationTypes } from '@/lib/notifications/registry';

/**
 * СТРАЖ `У-230` (решение `Р-Э5-6`): дайджест — «вычесть канал и собрать».
 *
 * - у пользователя с дайджестом почта вычитается из веера НЕсрочного типа,
 *   срочный уходит письмом сразу и в дайджест не попадает;
 * - без событий письмо не уходит, но отметка сдвигается;
 * - повторный прогон в тот же час не шлёт второе письмо (атомарный захват);
 * - в письмо входит не больше 50 строк, остальное — «и ещё N».
 *
 * Мутация (проверено 17.09.2026): снять проверку пустоты → «пусто — письмо не
 * уходит»; снять `notIn` срочных → «срочные не попадают»; снять `count === 0`
 * → «второй прогон не шлёт»; убрать вычитание почты → «почта вычитается».
 */

const NOW = new Date('2026-09-17T06:30:00.000Z'); // 09:30 по Москве
const USER = {
  id: 'u1',
  email: 'org@x.ru',
  name: 'Ольга',
  role: 'organization',
  organizationId: 'org1',
  digestLastSentAt: null,
};

function fakePrisma(over: {
  users?: unknown[];
  claimCount?: number;
  rows?: unknown[];
  total?: number;
}) {
  const userFindMany = vi.fn().mockResolvedValue(over.users ?? [USER]);
  const userUpdateMany = vi.fn().mockResolvedValue({ count: over.claimCount ?? 1 });
  const notifFindMany = vi.fn().mockResolvedValue(over.rows ?? []);
  const notifCount = vi.fn().mockResolvedValue(over.total ?? over.rows?.length ?? 0);
  const orgFindUnique = vi.fn().mockResolvedValue({ companyId: 'co1' });
  return {
    prisma: {
      user: { findMany: userFindMany, updateMany: userUpdateMany },
      notification: { findMany: notifFindMany, count: notifCount },
      organization: { findUnique: orgFindUnique },
    } as unknown as PrismaClient,
    userFindMany,
    userUpdateMany,
    notifFindMany,
    notifCount,
  };
}

const row = (i: number, type = 'task_assigned') => ({
  type,
  title: `Событие ${i}`,
  body: 'текст',
  meta: { taskId: `t${i}` },
  dedupCount: 1,
  createdAt: new Date('2026-09-17T05:00:00.000Z'),
  lastOccurredAt: new Date('2026-09-17T05:00:00.000Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  sendDailyDigestEmail.mockResolvedValue({ status: 'sent', id: 'e1' });
  sendNotificationEmail.mockResolvedValue({ status: 'sent', id: 'e2' });
  getTemplateOverride.mockResolvedValue(null);
});

describe('страж: веер каналов при дайджесте', () => {
  it('почта вычитается у несрочного типа, остальные каналы остаются', () => {
    expect(
      effectiveChannels({ digestEnabled: true }, 'task_assigned', ['email', 'telegram'])
    ).toEqual(['telegram']);
    // Без правила компании — от полного набора, тоже без почты.
    expect(effectiveChannels({ digestEnabled: true }, 'task_assigned', undefined)).not.toContain(
      'email'
    );
  });

  it('срочный тип уходит письмом сразу — почта остаётся', () => {
    for (const type of urgentNotificationTypes()) {
      expect(effectiveChannels({ digestEnabled: true }, type, ['email', 'telegram'])).toEqual([
        'email',
        'telegram',
      ]);
    }
    expect(urgentNotificationTypes().sort()).toEqual(
      [
        'client_request_status_changed',
        'document_published',
        'invoice_paid',
        'messenger_message',
      ].sort()
    );
  });

  it('без дайджеста веер прежний; личная настройка и дайджест складываются', () => {
    expect(
      effectiveChannels({ digestEnabled: false }, 'task_assigned', ['email', 'telegram'])
    ).toEqual(['email', 'telegram']);
    expect(
      effectiveChannels(
        {
          digestEnabled: true,
          notificationPreferences: [{ eventType: 'task_assigned', channels: ['email'] }],
        },
        'task_assigned',
        ['email', 'telegram']
      )
    ).toEqual([]);
  });
});

describe('страж: прогон дайджеста', () => {
  it('час считается по Москве', () => {
    expect(moscowHour(NOW)).toBe(9);
    expect(moscowHour(new Date('2026-09-17T21:30:00.000Z'))).toBe(0);
  });

  it('флаг выключен — прогон пропущен целиком, база не трогается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const { prisma, userFindMany } = fakePrisma({});
    const r = await runNotificationDigest(prisma, NOW);
    expect(r.disabled).toBe(true);
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('кандидаты — только заказчик/партнёр с включённым дайджестом в ЭТОТ час и зазором ≥ 20 ч', async () => {
    const { prisma, userFindMany } = fakePrisma({ users: [] });
    await runNotificationDigest(prisma, NOW);
    const where = userFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      isActive: true,
      digestEnabled: true,
      digestHourMsk: 9,
      role: { in: ['organization', 'partner'] },
    });
    const threshold = where.OR[1].digestLastSentAt.lt as Date;
    expect(NOW.getTime() - threshold.getTime()).toBe(DIGEST_MIN_GAP_MS);
  });

  it('пусто — письмо не уходит, но отметка сдвинута (захват выполнен)', async () => {
    const { prisma, userUpdateMany } = fakePrisma({ rows: [] });
    const r = await runNotificationDigest(prisma, NOW);
    expect(r).toMatchObject({ candidates: 1, empty: 1, sent: 0 });
    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'u1' }),
        data: { digestLastSentAt: NOW },
      })
    );
    expect(sendDailyDigestEmail).not.toHaveBeenCalled();
  });

  it('второй прогон в тот же час: захват вернул 0 → письма нет', async () => {
    const { prisma } = fakePrisma({ claimCount: 0, rows: [row(1)] });
    const r = await runNotificationDigest(prisma, NOW);
    expect(r).toMatchObject({ skipped: 1, sent: 0 });
    expect(sendDailyDigestEmail).not.toHaveBeenCalled();
  });

  it('срочные типы не попадают в выборку дайджеста', async () => {
    const { prisma, notifFindMany } = fakePrisma({ rows: [row(1)] });
    await runNotificationDigest(prisma, NOW);
    const where = notifFindMany.mock.calls[0][0].where;
    expect(where.type.notIn).toEqual(expect.arrayContaining(urgentNotificationTypes()));
    expect(where.userId).toBe('u1');
  });

  it('окно — с прошлой отправки; первый раз — сутки назад', async () => {
    const { prisma, notifFindMany } = fakePrisma({ rows: [row(1)] });
    await runNotificationDigest(prisma, NOW);
    const since = notifFindMany.mock.calls[0][0].where.OR[0].lastOccurredAt.gt as Date;
    expect(NOW.getTime() - since.getTime()).toBe(24 * 60 * 60 * 1000);

    const last = new Date('2026-09-16T06:00:00.000Z');
    const p2 = fakePrisma({ users: [{ ...USER, digestLastSentAt: last }], rows: [row(1)] });
    await runNotificationDigest(p2.prisma, NOW);
    expect(p2.notifFindMany.mock.calls[0][0].where.OR[0].lastOccurredAt.gt).toEqual(last);
  });

  it('одно письмо: число событий, строки со ссылкой по роли, «×N», ссылка на страницу уведомлений', async () => {
    const { prisma } = fakePrisma({ rows: [{ ...row(1), dedupCount: 3 }, row(2)], total: 2 });
    const r = await runNotificationDigest(prisma, NOW);
    expect(r).toMatchObject({ sent: 1, empty: 0, skipped: 0 });
    expect(sendDailyDigestEmail).toHaveBeenCalledOnce();
    const args = sendDailyDigestEmail.mock.calls[0][0];
    expect(args.to).toBe('org@x.ru');
    expect(args.count).toBe(2);
    expect(args.moreCount).toBe(0);
    expect(args.items[0]).toMatchObject({ title: 'Событие 1', times: 3 });
    // У заказчика задач нет — ссылки на строку нет, а на страницу уведомлений есть.
    expect(args.items[0].url).toBeNull();
    expect(args.cabinetUrl).toMatch(/\/organization\/notifications$/);
    expect(args.itemsText).toContain('Событие 1 ×3');
  });

  it('больше 50 строк — в письме 50 и «ещё N»', async () => {
    const rows = Array.from({ length: DIGEST_MAX_ITEMS }, (_, i) => row(i));
    const { prisma, notifFindMany } = fakePrisma({ rows, total: 57 });
    await runNotificationDigest(prisma, NOW);
    expect(notifFindMany.mock.calls[0][0].take).toBe(DIGEST_MAX_ITEMS);
    expect(sendDailyDigestEmail.mock.calls[0][0].moreCount).toBe(7);
  });

  it('свой текст письма (У-128): подстановки применены, ушло общим письмом', async () => {
    getTemplateOverride.mockResolvedValue({
      subject: 'Сводка для {{recipient.name}}: {{count}}',
      body: '{{items}}\n\n{{cabinet.url}}',
    });
    const { prisma } = fakePrisma({ rows: [row(1)], total: 1 });
    await runNotificationDigest(prisma, NOW);
    expect(sendDailyDigestEmail).not.toHaveBeenCalled();
    expect(sendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'org@x.ru', title: 'Сводка для Ольга: 1' })
    );
    expect(sendNotificationEmail.mock.calls[0][0].body).toContain('Событие 1');
    expect(getTemplateOverride).toHaveBeenCalledWith(prisma, 'dailyDigest', 'co1');
  });

  it('сбой у одного получателя не останавливает остальных', async () => {
    const { prisma } = fakePrisma({
      users: [USER, { ...USER, id: 'u2', email: 'p@x.ru', role: 'partner', organizationId: null }],
      rows: [row(1)],
      total: 1,
    });
    sendDailyDigestEmail.mockRejectedValueOnce(new Error('smtp down'));
    const r = await runNotificationDigest(prisma, NOW);
    expect(r).toMatchObject({ candidates: 2, sent: 1, skipped: 1 });
  });

  it('письмо не отправлено (канал выключен) — считается пропуском', async () => {
    sendDailyDigestEmail.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { prisma } = fakePrisma({ rows: [row(1)], total: 1 });
    const r = await runNotificationDigest(prisma, NOW);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
  });
});
