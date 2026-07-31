import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { pushLeadProcessor, notifyPushLeadFinalFailure } from '@/worker/processors/push-lead';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { PushLeadJobPayload } from '@/lib/jobs/types';

let prisma: PrismaClient;
let partnerId: string;
let authorUserId: string;
let adminUserId: string;
let leadId: string;

function job(id: string): Job<PushLeadJobPayload> {
  return { id: 'test-pushlead-' + Date.now(), data: { leadId: id } } as Job<PushLeadJobPayload>;
}

beforeAll(async () => {
  process.env.ONE_C_ADAPTER = 'fake';
  delete process.env.FAKE_ONEC_FAILURE_RATE;
  resetOneCAdapter();
  prisma = new PrismaClient();

  const stamp = Date.now();
  const partner = await prisma.partner.create({
    data: { name: `PushLeadPartner-${stamp}`, slug: `push-lead-test-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;

  const author = await prisma.user.create({
    data: { email: `author-${stamp}@test.local`, name: 'Lead Author', role: 'partner', partnerId }
  });
  authorUserId = author.id;

  const admin = await prisma.user.create({
    data: { email: `admin-${stamp}@test.local`, name: 'Partner Admin', role: 'partner', partnerId }
  });
  adminUserId = admin.id;
  await prisma.partnerUser.create({
    data: { partnerId, userId: adminUserId, roleInPartner: 'admin', isActive: true, assignedOrgIds: [] }
  });

  const lead = await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: authorUserId,
      clientCompanyName: 'ООО Клиент',
      clientContactName: 'Иван Иванов',
      subject: 'Запрос на обучение',
      productType: ['course'],
      estimatedAmount: 50000
    }
  });
  leadId = lead.id;
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { partnerId } });
  delete process.env.FAKE_ONEC_FAILURE_RATE;
  resetOneCAdapter();
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { partnerId } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.syncLog.deleteMany({ where: { entity: 'lead' } });
  await prisma.user.deleteMany({ where: { id: { in: [authorUserId, adminUserId] } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  resetOneCAdapter();
  await prisma.$disconnect();
});

describe('pushLeadProcessor', () => {
  it('pushes the lead and records the 1C request id', async () => {
    const result = await pushLeadProcessor(job(leadId), prisma);
    expect(result.leadId).toBe(leadId);
    expect(result.externalIdInOneC).toMatch(/^fake-req-/);

    const reread = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { externalIdInOneC: true }
    });
    expect(reread?.externalIdInOneC).toMatch(/^fake-req-/);
  });

  it('throws when the adapter fails (so BullMQ retries)', async () => {
    // The previous test pushed this lead successfully, stamping pushedToOneCAt.
    // Reset it to an un-pushed state so the idempotency guard does not
    // short-circuit before the simulated adapter failure can fire.
    await prisma.lead.update({ where: { id: leadId }, data: { pushedToOneCAt: null, externalIdInOneC: null } });
    process.env.FAKE_ONEC_FAILURE_RATE = '1';
    resetOneCAdapter();
    await expect(pushLeadProcessor(job(leadId), prisma)).rejects.toThrow();
  });
});

describe('notifyPushLeadFinalFailure', () => {
  it('notifies active partner admins with a sync_error notification', async () => {
    await notifyPushLeadFinalFailure(prisma, { leadId, errorMessage: 'boom' });

    const notifs = await prisma.notification.findMany({ where: { partnerId } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(adminUserId);
    expect(notifs[0].type).toBe('sync_error');
    expect(notifs[0].body).toContain('boom');
  });

  it('is a no-op when the lead does not exist', async () => {
    await notifyPushLeadFinalFailure(prisma, { leadId: 'does-not-exist', errorMessage: 'x' });
    const count = await prisma.notification.count({ where: { partnerId } });
    expect(count).toBe(0);
  });

  it('is a no-op when the partner has no active admins (admins.length === 0 branch)', async () => {
    // Create a partner with no admin PartnerUser rows, plus a lead for it.
    const stamp = Date.now() + 1;
    const noAdminPartner = await prisma.partner.create({
      data: { name: `NoAdminPartner-${stamp}`, commissionRate: 0 }
    });
    const noAdminUser = await prisma.user.create({
      data: { email: `noadmin-${stamp}@test.local`, name: 'No Admin', role: 'partner', partnerId: noAdminPartner.id }
    });
    const noAdminLead = await prisma.lead.create({
      data: {
        partnerId: noAdminPartner.id,
        createdByUserId: noAdminUser.id,
        clientCompanyName: 'ООО Без Админа',
        clientContactName: 'Иван',
        subject: 'Тест',
        productType: ['course'],
        estimatedAmount: 1000
      }
    });

    try {
      await notifyPushLeadFinalFailure(prisma, { leadId: noAdminLead.id, errorMessage: 'no-admin-test' });

      // No notifications should have been created — partner has no admin users
      const count = await prisma.notification.count({ where: { partnerId: noAdminPartner.id } });
      expect(count).toBe(0);
    } finally {
      await prisma.lead.delete({ where: { id: noAdminLead.id } });
      await prisma.user.delete({ where: { id: noAdminUser.id } });
      await prisma.partner.delete({ where: { id: noAdminPartner.id } });
    }
  });
});
