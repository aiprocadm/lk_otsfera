import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getDocumentForDownload, listManagerOrderLessDocuments } from '@/lib/services/manager/documents';

let prisma: PrismaClient;
let companyA: string, companyB: string, partnerId: string, orgA: string;
let orderLessDocId: string, mgrA: string, mgrB: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const s = Date.now();
  companyA = (await prisma.company.create({ data: { name: `OLA-${s}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `OLB-${s}` } })).id;
  partnerId = (await prisma.partner.create({ data: { name: `OLP-${s}`, commissionRate: 0 } })).id;
  orgA = (await prisma.organization.create({ data: { name: `OLO-${s}`, companyId: companyA, partnerId } })).id;
  mgrA = (await prisma.user.create({ data: { email: `ola-${s}@x.io`, name: 'Mgr A', role: 'manager', companyId: companyA, isActive: true } })).id;
  mgrB = (await prisma.user.create({ data: { email: `olb-${s}@x.io`, name: 'Mgr B', role: 'manager', companyId: companyB, isActive: true } })).id;
  orderLessDocId = (await prisma.document.create({
    data: { name: 'general.pdf', path: 'fake://ol', mimeType: 'application/pdf', type: 'other',
      counterpartyType: 'partner', counterpartyId: partnerId, companyId: companyA }
  })).id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { id: orderLessDocId } });
  await prisma.user.deleteMany({ where: { id: { in: [mgrA, mgrB] } } });
  await prisma.organization.delete({ where: { id: orgA } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('order-less company isolation (Phase B linchpin)', () => {
  it('manager of company A sees + downloads the order-less doc', async () => {
    const sessionA = { sub: mgrA, role: 'manager', companyId: companyA } as never;
    const { rows } = await listManagerOrderLessDocuments(prisma, sessionA);
    expect(rows.map((r) => r.id)).toContain(orderLessDocId);
    const dl = await getDocumentForDownload(prisma, sessionA, orderLessDocId);
    expect(dl.ok).toBe(true);
  });
  it('manager of company B neither sees nor downloads it', async () => {
    const sessionB = { sub: mgrB, role: 'manager', companyId: companyB } as never;
    const { rows } = await listManagerOrderLessDocuments(prisma, sessionB);
    expect(rows.map((r) => r.id)).not.toContain(orderLessDocId);
    const dl = await getDocumentForDownload(prisma, sessionB, orderLessDocId);
    expect(dl).toEqual({ ok: false, error: 'not_found' });
  });
});
