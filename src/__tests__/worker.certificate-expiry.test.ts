import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const { recordNotification } = vi.hoisted(() => ({
  recordNotification: vi.fn().mockResolvedValue({ row: { id: 'n1' }, deduped: false }),
}));
const { deliverNotificationToUser } = vi.hoisted(() => ({
  deliverNotificationToUser: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/notifications', () => ({ recordNotification, deliverNotificationToUser }));

import { runCertificateExpiry } from '@/worker/processors/certificate-expiry';

const prisma = new PrismaClient();
const ids: Record<string, string> = {};

beforeAll(async () => {
  const dir = await prisma.trainingDirection.create({ data: { name: 'exp-dir' } });
  const company = await prisma.company.create({ data: { name: 'exp-co' } });
  const org = await prisma.organization.create({
    data: { name: 'exp-org', companyId: company.id },
  });
  const orgUser = await prisma.user.create({
    data: { email: 'orguser@exp.ru', name: 'OrgU', role: 'organization', organizationId: org.id },
  });
  const student = await prisma.student.create({
    data: { name: 'S', email: 's@exp.ru', organizationId: org.id },
  });
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const cert = await prisma.certificate.create({
    data: {
      studentId: student.id,
      organizationId: org.id,
      directionId: dir.id,
      number: 'EXP-1',
      issuedAt: new Date(),
      validUntil,
    },
  });
  Object.assign(ids, {
    dir: dir.id,
    company: company.id,
    org: org.id,
    orgUser: orgUser.id,
    student: student.id,
    cert: cert.id,
  });
});

afterAll(async () => {
  await prisma.certificateReminder.deleteMany({ where: { certificateId: ids.cert } });
  await prisma.certificate.delete({ where: { id: ids.cert } });
  await prisma.student.delete({ where: { id: ids.student } });
  await prisma.user.delete({ where: { id: ids.orgUser } });
  await prisma.organization.delete({ where: { id: ids.org } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.trainingDirection.delete({ where: { id: ids.dir } });
  await prisma.$disconnect();
});

describe('certificate-expiry processor', () => {
  it('создаёт напоминание и не дублирует на повторном прогоне', async () => {
    const first = await runCertificateExpiry(prisma, new Date());
    expect(first.remindersSent).toBeGreaterThanOrEqual(1);
    // Ключ дедупа — удостоверение; клиент базы уходит первым аргументом
    // (сравниваем по ссылке: глубокое сравнение живого PrismaClient зацикливается).
    expect(recordNotification.mock.calls[0]![0]).toBe(prisma);
    expect(recordNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'certificate_expiring',
        meta: { certificateId: ids.cert, thresholdDays: 7 },
        entityId: ids.cert,
      })
    );
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'certificate_expiring',
        meta: { certificateId: ids.cert, thresholdDays: 7 },
        dedupKey: 'n1',
      })
    );

    const reminders = await prisma.certificateReminder.findMany({
      where: { certificateId: ids.cert },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].thresholdDays).toBe(7);

    recordNotification.mockClear();
    const second = await runCertificateExpiry(prisma, new Date());
    expect(second.remindersSent).toBe(0);
    expect(recordNotification).not.toHaveBeenCalled();
  });
});
