import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Phase 0 schema integration', () => {
  it('can create a Partner with commissionRate and PartnerUser', async () => {
    const partner = await prisma.partner.create({
      data: {
        name: 'TestPartner-' + Date.now(),
        commissionRate: 0.1,
        legalName: 'ООО ТестПартнёр',
      },
    });

    expect(partner.commissionRate.toString()).toBe('0.1');

    const user = await prisma.user.create({
      data: {
        email: `user-${Date.now()}@test.local`,
        passwordHash: 'fake',
        name: 'Test',
        role: 'partner',
      },
    });

    const pu = await prisma.partnerUser.create({
      data: {
        partnerId: partner.id,
        userId: user.id,
        roleInPartner: 'admin',
        assignedOrgIds: [],
      },
    });

    expect(pu.roleInPartner).toBe('admin');
    expect(pu.isActive).toBe(true);

    await prisma.partnerUser.delete({ where: { id: pu.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.partner.delete({ where: { id: partner.id } });
  });

  it('can create Lead with attachments and read them back', async () => {
    const partner = await prisma.partner.create({
      data: { name: 'P-' + Date.now() },
    });
    const user = await prisma.user.create({
      data: {
        email: `lead-${Date.now()}@test.local`,
        passwordHash: 'x',
        name: 'L',
        role: 'partner',
      },
    });

    const lead = await prisma.lead.create({
      data: {
        partnerId: partner.id,
        createdByUserId: user.id,
        clientCompanyName: 'ООО Новый',
        clientContactName: 'Иванов',
        subject: 'Курс ОТ',
        productType: ['training'],
        status: 'new',
        attachments: {
          create: [
            { name: 'tz.pdf', path: 'leads/x/tz.pdf', mimeType: 'application/pdf', size: 1024 },
          ],
        },
      },
      include: { attachments: true },
    });

    expect(lead.attachments).toHaveLength(1);
    expect(lead.status).toBe('new');
    expect(lead.productType).toEqual(['training']);

    await prisma.leadAttachment.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.partner.delete({ where: { id: partner.id } });
  });

  it('can write SyncLog entries with Json payload', async () => {
    const log = await prisma.syncLog.create({
      data: {
        entity: 'Order',
        externalId: 'order-guid-' + Date.now(),
        direction: 'pull',
        operation: 'create',
        status: 'success',
        payload: { totalAmount: '10000.00', externalUpdatedAt: new Date().toISOString() },
        durationMs: 42,
      },
    });

    expect(log.status).toBe('success');
    expect((log.payload as { totalAmount: string }).totalAmount).toBe('10000.00');

    await prisma.syncLog.delete({ where: { id: log.id } });
  });
});
