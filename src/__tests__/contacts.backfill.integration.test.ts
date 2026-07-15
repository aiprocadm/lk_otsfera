import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { backfillContacts } from '@/lib/services/contacts/backfill';

const prisma = new PrismaClient();
const STAMP = `m2bf${Date.now()}`;
afterAll(async () => {
  await prisma.contactChannel.deleteMany({ where: { value: { startsWith: STAMP } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.lead.deleteMany({ where: { clientCompanyName: { startsWith: STAMP } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: STAMP } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
});

describe('backfillContacts', () => {
  it('seeds contacts from org-role Users and Leads; dedups by channel; is idempotent', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId: co.id } });
    await prisma.user.create({ data: { email: `${STAMP}-u@t.local`, name: `${STAMP}-User`, role: 'organization', organizationId: org.id, whatsappPhone: '+79990007777' } });
    const partner = await prisma.partner.create({ data: { name: `${STAMP}-p` } });
    const creator = await prisma.user.create({ data: { email: `${STAMP}-c@t.local`, name: 'C', role: 'partner', partnerId: partner.id } });
    await prisma.lead.create({ data: { partnerId: partner.id, createdByUserId: creator.id, organizationId: org.id, clientCompanyName: `${STAMP}-Lead`, clientContactName: `${STAMP}-Контакт`, clientContactPhone: '+79990007777', subject: 's' } });

    const first = await backfillContacts(prisma);
    expect(first.contactsCreated).toBeGreaterThanOrEqual(1);
    const chans = await prisma.contactChannel.findMany({ where: { companyId: co.id, normalizedValue: '+79990007777' } });
    expect(chans).toHaveLength(1);

    const second = await backfillContacts(prisma);
    expect(second.contactsCreated).toBe(0);
  });
});
