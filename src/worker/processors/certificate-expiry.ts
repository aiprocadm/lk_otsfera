import type { PrismaClient } from '@prisma/client';
import { selectDueReminders, REMINDER_THRESHOLDS } from '@/lib/services/training/expiry';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';

/**
 * Получатели напоминания: пользователи организации → партнёр (если есть) →
 * ответственные менеджеры заказов организации → руководители компании. Уникальные userId.
 */
async function recipientsForOrg(prisma: PrismaClient, organizationId: string): Promise<string[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      partnerId: true,
      companyId: true,
      users: { where: { isActive: true }, select: { id: true } },
      partner: { select: { users: { where: { isActive: true }, select: { id: true } } } },
    },
  });
  if (!org) return [];

  const ids = new Set<string>();
  org.users.forEach((u) => ids.add(u.id));
  org.partner?.users.forEach((u) => ids.add(u.id));

  const orders = await prisma.order.findMany({
    where: { organizationId, managerId: { not: null } },
    select: { managerId: true },
  });
  orders.forEach((o) => o.managerId && ids.add(o.managerId));

  if (org.companyId) {
    const leaders = await prisma.user.findMany({
      where: {
        companyId: org.companyId,
        OR: [{ role: 'leader' }, { role: 'manager', managerRole: 'leader' }],
        isActive: true,
      },
      select: { id: true },
    });
    leaders.forEach((l) => ids.add(l.id));
  }

  return [...ids];
}

export async function runCertificateExpiry(
  prisma: PrismaClient,
  today: Date
): Promise<{ remindersSent: number }> {
  const maxThreshold = Math.max(...REMINDER_THRESHOLDS);
  const horizon = new Date(today.getTime() + maxThreshold * 24 * 60 * 60 * 1000);

  const certs = await prisma.certificate.findMany({
    where: { validUntil: { not: null, gte: today, lte: horizon } },
    select: {
      id: true,
      organizationId: true,
      validUntil: true,
      number: true,
      student: { select: { name: true } },
      reminders: { select: { thresholdDays: true } },
    },
  });

  const due = selectDueReminders(
    certs.map((c) => ({
      id: c.id,
      validUntil: c.validUntil,
      sentThresholds: c.reminders.map((r) => r.thresholdDays),
    })),
    today
  );

  let remindersSent = 0;
  for (const d of due) {
    const cert = certs.find((c) => c.id === d.certificateId);
    /* v8 ignore next -- defensive: certs are fetched by these certificateIds, so always found */
    if (!cert) continue;

    try {
      await prisma.certificateReminder.create({
        data: { certificateId: cert.id, thresholdDays: d.thresholdDays },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue;
      throw e;
    }

    const recipients = await recipientsForOrg(prisma, cert.organizationId);
    const title = 'Истекает срок удостоверения';
    const body = `Удостоверение № ${cert.number} (${cert.student.name}) истекает через ${d.thresholdDays} дн.`;

    for (const userId of recipients) {
      const row = await createNotification({
        userId,
        type: 'certificate_expiring',
        title,
        body,
        meta: { certificateId: cert.id, thresholdDays: d.thresholdDays },
      });
      await deliverNotificationToUser({
        userId,
        title,
        body,
        type: 'certificate_expiring',
        dedupKey: row.id,
      });
    }

    remindersSent += 1;
  }

  return { remindersSent };
}

/** BullMQ wrapper, вызывается воркером по расписанию. */
export async function certificateExpiryProcessor(): Promise<{ remindersSent: number }> {
  const { prisma } = await import('@/lib/db/prisma');
  return runCertificateExpiry(prisma, new Date());
}
