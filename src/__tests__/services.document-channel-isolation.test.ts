import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrgDocuments, getOrgDocumentForDownload } from '@/lib/services/organization/documents';
import { getOrgDocuments } from '@/lib/services/partner/orgDocuments';
import { getOrgOrder } from '@/lib/services/organization/orders';

let prisma: PrismaClient;
let partnerId: string, companyId: string, orgId: string, orderId: string;
let orgDocId: string, partnerDocId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();
  const partner = await prisma.partner.create({
    data: { name: `IsoP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `IsoC-${stamp}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: `IsoO-${stamp}`, partnerId, companyId },
  });
  orgId = org.id;
  const order = await prisma.order.create({
    data: {
      title: 'Iso order',
      companyId,
      partnerId,
      organizationId: orgId,
      executionStatus: 'in_progress',
    },
  });
  orderId = order.id;

  const od = await prisma.document.create({
    data: {
      name: 'act.pdf',
      path: 'fake://iso-act',
      mimeType: 'application/pdf',
      type: 'act',
      orderId,
      counterpartyType: 'organization',
      counterpartyId: orgId,
    },
  });
  orgDocId = od.id;
  const pd = await prisma.document.create({
    data: {
      name: 'commission.pdf',
      path: 'fake://iso-commission',
      mimeType: 'application/pdf',
      type: 'commission_statement',
      orderId,
      counterpartyType: 'partner',
      counterpartyId: partnerId,
    },
  });
  partnerDocId = pd.id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { orderId } });
  await prisma.order.delete({ where: { id: orderId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('channel isolation invariant (org ⟂ partner on a shared order)', () => {
  it('organization sees only its channel', async () => {
    const { rows } = await listOrgDocuments(prisma, { organizationId: orgId });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orgDocId);
    expect(ids).not.toContain(partnerDocId);
  });

  it('organization cannot download the partner-channel doc (silent not_found)', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgId, partnerDocId);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('партнёр видит свой канал И документы организации своего портфеля (`У-155`)', async () => {
    // Изоляция осталась, но проходит по ДРУГОЙ границе: не «канал», а
    // «портфель» (решение `Р-18`, этап 6). Партнёр ведёт этого клиента —
    // прятать от него счёт клиента значило показывать пустую вкладку.
    // Что изоляция всё ещё работает, проверяет соседний тест: организация
    // партнёрский документ не видит и не скачивает.
    const { rows } = await getOrgDocuments(prisma, { orgId, partnerId });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(partnerDocId);
    expect(ids).toContain(orgDocId);
  });

  it('order-detail embed isolates channels too', async () => {
    const order = await getOrgOrder(prisma, orgId, orderId);
    const ids = (order?.documents ?? []).map((d: { id: string }) => d.id);
    expect(ids).toContain(orgDocId);
    expect(ids).not.toContain(partnerDocId);
  });
});
