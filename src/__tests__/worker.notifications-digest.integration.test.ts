import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const { sendDailyDigestEmail } = vi.hoisted(() => ({ sendDailyDigestEmail: vi.fn() }));
vi.mock('@/lib/email/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/send')>()),
  sendDailyDigestEmail,
}));
vi.mock('@/lib/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/featureFlags')>()),
  isFeatureEnabled: () => true,
}));

import { recordNotification } from '@/lib/notifications/core';
import { notificationsDigestProcessor } from '@/worker/processors/notifications-digest';
import { moscowHour, runNotificationDigest } from '@/lib/services/notifications/digest';

/**
 * Процессор `notifications.digest` на живой базе (`У-230`): выборка по часу,
 * атомарный захват через `digestLastSentAt`, срочное не попадает, второй прогон
 * не шлёт. Письмо — мок; всё остальное настоящее.
 */

const prisma = new PrismaClient();
const STAMP = Date.now();
let userId = '';

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: {
        email: `digest-${STAMP}@t.local`,
        name: 'Дайджест',
        role: 'partner',
        digestEnabled: true,
        digestHourMsk: moscowHour(new Date()),
      },
    })
  ).id;
  await recordNotification(prisma, {
    userId,
    type: 'task_assigned',
    title: 'Обычное',
    body: 'в дайджест',
    entityId: `t-${STAMP}`,
  });
  await recordNotification(prisma, {
    userId,
    type: 'document_published',
    title: 'Срочное',
    body: 'ушло сразу',
    entityId: `d-${STAMP}`,
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('notificationsDigestProcessor — живая база', () => {
  it('шлёт одно письмо с несрочными событиями и ставит отметку', async () => {
    sendDailyDigestEmail.mockResolvedValue({ status: 'sent', id: 'e1' });
    const r = await notificationsDigestProcessor();
    expect(r.disabled).toBe(false);
    expect(r.sent).toBeGreaterThanOrEqual(1);

    const mine = sendDailyDigestEmail.mock.calls.find((c) => c[0].to === `digest-${STAMP}@t.local`);
    expect(mine).toBeDefined();
    const titles = mine![0].items.map((i: { title: string }) => i.title);
    expect(titles).toContain('Обычное');
    expect(titles).not.toContain('Срочное');
    expect(mine![0].cabinetUrl).toMatch(/\/partner\/notifications$/);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { digestLastSentAt: true },
    });
    expect(user?.digestLastSentAt).not.toBeNull();
  });

  it('второй прогон в тот же час — этот пользователь уже не кандидат', async () => {
    sendDailyDigestEmail.mockClear();
    await runNotificationDigest(prisma, new Date());
    expect(
      sendDailyDigestEmail.mock.calls.find((c) => c[0].to === `digest-${STAMP}@t.local`)
    ).toBeUndefined();
  });
});
