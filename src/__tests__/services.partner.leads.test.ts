import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listLeads, getLead, createLead, withdrawLead } from '@/lib/services/partner/leads';

let prisma: PrismaClient;
let partnerId: string;
let userId: string;
let orgIds: string[];

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'LeadsP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'LeadsC-' + Date.now() } });
  const orgA = await prisma.organization.create({ data: { name: 'LA', partnerId, companyId: c.id } });
  const orgB = await prisma.organization.create({ data: { name: 'LB', partnerId, companyId: c.id } });
  orgIds = [orgA.id, orgB.id];
  const u = await prisma.user.create({
    data: { email: 'leads-' + Date.now() + '@x.local', passwordHash: 'h', name: 'U', role: 'partner', partnerId }
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'LeadsC-' } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.lead.deleteMany({ where: { partnerId } });
});

describe('leads.createLead', () => {
  it('creates a Lead with status=new', async () => {
    const lead = await createLead(prisma, {
      partnerId,
      createdByUserId: userId,
      clientCompanyName: 'ООО Ромашка',
      clientContactName: 'Иван',
      subject: 'Обучение'
    });
    expect(lead.status).toBe('new');
    expect(lead.clientCompanyName).toBe('ООО Ромашка');
  });

  it('rejects organizationId outside partner', async () => {
    const otherPartner = await prisma.partner.create({ data: { name: 'OthP-' + Date.now() } });
    const c = await prisma.company.create({ data: { name: 'OthC-' + Date.now() } });
    const foreign = await prisma.organization.create({
      data: { name: 'F', partnerId: otherPartner.id, companyId: c.id }
    });

    await expect(
      createLead(prisma, {
        partnerId, createdByUserId: userId,
        organizationId: foreign.id,
        clientCompanyName: 'X', clientContactName: 'Y', subject: 'Z'
      })
    ).rejects.toThrow(/ORG_OUT_OF_SCOPE/);

    await prisma.organization.delete({ where: { id: foreign.id } });
    await prisma.company.deleteMany({ where: { name: { startsWith: 'OthC-' } } });
    await prisma.partner.delete({ where: { id: otherPartner.id } });
  });

  it('trims whitespace and treats empty strings as null', async () => {
    const lead = await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: '  ООО Чистый  ',
      clientContactName: 'Анна',
      clientContactPhone: '   ',
      clientContactEmail: '',
      subject: 'Запрос',
      notes: ''
    });
    expect(lead.clientCompanyName).toBe('ООО Чистый');
    expect(lead.clientContactPhone).toBeNull();
    expect(lead.clientContactEmail).toBeNull();
    expect(lead.notes).toBeNull();
  });
});

describe('leads.listLeads', () => {
  it('returns countsByStatus with zeros for empty statuses', async () => {
    const r = await listLeads(prisma, { partnerId, take: 10, skip: 0 });
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.countsByStatus).toMatchObject({
      new: 0, in_review: 0, qualified: 0, promoted_to_order: 0, rejected: 0
    });
  });

  it('filters by status', async () => {
    await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: 'A', clientContactName: 'a', subject: 's'
    });
    const lead2 = await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: 'B', clientContactName: 'b', subject: 's'
    });
    await withdrawLead(prisma, { leadId: lead2.id, partnerId, reason: 'нет' });

    const all = await listLeads(prisma, { partnerId, take: 10, skip: 0 });
    expect(all.total).toBe(2);
    expect(all.countsByStatus.new).toBe(1);
    expect(all.countsByStatus.rejected).toBe(1);

    const onlyNew = await listLeads(prisma, { partnerId, status: 'new', take: 10, skip: 0 });
    expect(onlyNew.total).toBe(1);
    expect(onlyNew.rows[0].clientCompanyName).toBe('A');
  });

  it('filters by scopeOrgIds when manager has scope', async () => {
    await createLead(prisma, {
      partnerId, createdByUserId: userId,
      organizationId: orgIds[0],
      clientCompanyName: 'InScope',
      clientContactName: 'c', subject: 's'
    });
    await createLead(prisma, {
      partnerId, createdByUserId: userId,
      organizationId: orgIds[1],
      clientCompanyName: 'OutOfScope',
      clientContactName: 'c', subject: 's'
    });

    const scoped = await listLeads(prisma, {
      partnerId, scopeOrgIds: [orgIds[0]], take: 10, skip: 0
    });
    expect(scoped.total).toBe(1);
    expect(scoped.rows[0].clientCompanyName).toBe('InScope');
  });

  it('search matches clientCompanyName/contact/subject/inn', async () => {
    await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: 'ООО Ромашка', clientInn: '7707083893',
      clientContactName: 'Иван', subject: 'Аттестация'
    });
    await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: 'ИП Лютик',
      clientContactName: 'Пётр', subject: 'Сертификация'
    });

    const byName = await listLeads(prisma, { partnerId, search: 'Ромашка', take: 10, skip: 0 });
    expect(byName.total).toBe(1);

    const byInn = await listLeads(prisma, { partnerId, search: '7707', take: 10, skip: 0 });
    expect(byInn.total).toBe(1);

    const bySubject = await listLeads(prisma, { partnerId, search: 'Серт', take: 10, skip: 0 });
    expect(bySubject.total).toBe(1);
  });
});

describe('leads.getLead', () => {
  it('returns null for foreign partner', async () => {
    const lead = await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: 'X', clientContactName: 'y', subject: 'z'
    });
    const other = await getLead(prisma, { leadId: lead.id, partnerId: 'fake-id' });
    expect(other).toBeNull();
  });

  it('returns lead with author and organization names', async () => {
    const lead = await createLead(prisma, {
      partnerId, createdByUserId: userId,
      organizationId: orgIds[0],
      clientCompanyName: 'X', clientContactName: 'y', subject: 'z'
    });
    const got = await getLead(prisma, { leadId: lead.id, partnerId });
    expect(got?.id).toBe(lead.id);
    expect(got?.createdByUserName).toBe('U');
    expect(got?.organizationId).toBe(orgIds[0]);
  });
});

describe('leads.withdrawLead', () => {
  it('flips status → rejected with provided reason', async () => {
    const lead = await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: 'X', clientContactName: 'y', subject: 'z'
    });
    const r = await withdrawLead(prisma, { leadId: lead.id, partnerId, reason: 'Клиент передумал' });
    expect(r.status).toBe('rejected');
    expect(r.rejectedReason).toBe('Клиент передумал');
  });

  it('default reason when empty', async () => {
    const lead = await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: 'X', clientContactName: 'y', subject: 'z'
    });
    const r = await withdrawLead(prisma, { leadId: lead.id, partnerId, reason: '' });
    expect(r.rejectedReason).toBe('Отозван партнёром');
  });

  it('refuses NOT_FOUND for foreign id', async () => {
    await expect(
      withdrawLead(prisma, { leadId: 'no-such-id', partnerId, reason: 'x' })
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('refuses ALREADY_REJECTED', async () => {
    const lead = await createLead(prisma, {
      partnerId, createdByUserId: userId,
      clientCompanyName: 'X', clientContactName: 'y', subject: 'z'
    });
    await withdrawLead(prisma, { leadId: lead.id, partnerId, reason: 'r' });
    await expect(
      withdrawLead(prisma, { leadId: lead.id, partnerId, reason: 'r2' })
    ).rejects.toThrow(/ALREADY_REJECTED/);
  });
});
