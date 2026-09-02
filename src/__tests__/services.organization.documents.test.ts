import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrgDocuments, getOrgDocumentForDownload } from '@/lib/services/organization/documents';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgAId: string;
let orgBId: string;
let orderA1Id: string;
let orderA2Id: string;
let orderB1Id: string;
let docA1ContractId: string;
let docA1ActId: string;
let docA1InfectedId: string;
let docA2InvoiceId: string;
let docB1ContractId: string;
let docA1CommissionId: string;
let docOrderLessId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();
  const partner = await prisma.partner.create({
    data: { name: `OrgDocsP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `OrgDocsC-${stamp}` } });
  companyId = company.id;

  const orgA = await prisma.organization.create({
    data: { name: `OrgDocsA-${stamp}`, partnerId, companyId },
  });
  const orgB = await prisma.organization.create({
    data: { name: `OrgDocsB-${stamp}`, partnerId, companyId },
  });
  orgAId = orgA.id;
  orgBId = orgB.id;

  const a1 = await prisma.order.create({
    data: {
      title: 'A1 order',
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'in_progress',
    },
  });
  const a2 = await prisma.order.create({
    data: {
      title: 'A2 order',
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'completed',
    },
  });
  const b1 = await prisma.order.create({
    data: {
      title: 'B1 order',
      companyId,
      partnerId,
      organizationId: orgBId,
      executionStatus: 'pending',
    },
  });
  // Note: with Order.organizationId NOT NULL since migration
  // 20260526132950_order_organization_id_required, the legacy "orphan" scenario
  // is unreachable. canSeeDocument retains the null-check as runtime safety net.
  orderA1Id = a1.id;
  orderA2Id = a2.id;
  orderB1Id = b1.id;

  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
  const dContract = await prisma.document.create({
    data: {
      name: 'contract-A1.pdf',
      path: 'fake://contract-a1',
      mimeType: 'application/pdf',
      type: 'contract',
      orderId: orderA1Id,
      companyId,
      createdAt: tenDaysAgo,
      counterpartyType: 'organization',
      counterpartyId: orgAId,
    },
  });
  docA1ContractId = dContract.id;

  const dAct = await prisma.document.create({
    data: {
      name: 'act-A1.pdf',
      path: 'fake://act-a1',
      mimeType: 'application/pdf',
      type: 'act',
      orderId: orderA1Id,
      companyId,
      counterpartyType: 'organization',
      counterpartyId: orgAId,
    },
  });
  docA1ActId = dAct.id;

  const dInfected = await prisma.document.create({
    data: {
      name: 'malware-A1.pdf',
      path: 'fake://infected-a1',
      mimeType: 'application/pdf',
      type: 'other',
      orderId: orderA1Id,
      companyId,
      scanStatus: 'infected',
      scanReason: 'EICAR test',
      counterpartyType: 'organization',
      counterpartyId: orgAId,
    },
  });
  docA1InfectedId = dInfected.id;

  const dInvoice = await prisma.document.create({
    data: {
      name: 'invoice-A2.pdf',
      path: 'fake://invoice-a2',
      mimeType: 'application/pdf',
      type: 'invoice',
      orderId: orderA2Id,
      companyId,
      counterpartyType: 'organization',
      counterpartyId: orgAId,
    },
  });
  docA2InvoiceId = dInvoice.id;

  const dB = await prisma.document.create({
    data: {
      name: 'contract-B1.pdf',
      path: 'fake://contract-b1',
      mimeType: 'application/pdf',
      type: 'contract',
      orderId: orderB1Id,
      companyId,
      counterpartyType: 'organization',
      counterpartyId: orgBId,
    },
  });
  docB1ContractId = dB.id;

  // Partner-channel doc on orderA1 — must NOT be visible to the org
  const dCommission = await prisma.document.create({
    data: {
      name: 'commission-A1.pdf',
      path: 'fake://commission-a1',
      mimeType: 'application/pdf',
      type: 'commission_statement',
      orderId: orderA1Id,
      companyId,
      counterpartyType: 'partner',
      counterpartyId: partnerId,
    },
  });
  docA1CommissionId = dCommission.id;

  // Order-less org doc (no orderId) — should appear only when orderLess=true
  const dOrderLess = await prisma.document.create({
    data: {
      name: 'gen.pdf',
      path: 'fake://gen',
      mimeType: 'application/pdf',
      type: 'other',
      counterpartyType: 'organization',
      counterpartyId: orgAId,
      companyId,
    },
  });
  docOrderLessId = dOrderLess.id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { order: { partnerId } } });
  // Delete order-less org doc (no orderId — not caught by the order-scoped filter above)
  await prisma.document.deleteMany({
    where: { orderId: null, counterpartyId: orgAId, counterpartyType: 'organization' },
  });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('services/organization/documents — listOrgDocuments', () => {
  it('returns only documents whose order belongs to the org (no leak)', async () => {
    const { rows, total } = await listOrgDocuments(prisma, { organizationId: orgAId });
    const ids = rows.map((r) => r.id);
    // contract + act for A1 + invoice for A2 = 3 visible (infected hidden)
    expect(total).toBe(3);
    expect(ids).toContain(docA1ContractId);
    expect(ids).toContain(docA1ActId);
    expect(ids).toContain(docA2InvoiceId);
    expect(ids).not.toContain(docB1ContractId);
  });

  it('hides infected documents from the list', async () => {
    const { rows } = await listOrgDocuments(prisma, { organizationId: orgAId });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(docA1InfectedId);
  });

  it('returns documents for the other org separately', async () => {
    const { rows, total } = await listOrgDocuments(prisma, { organizationId: orgBId });
    expect(total).toBe(1);
    expect(rows[0]!.id).toBe(docB1ContractId);
  });

  it('filters by type', async () => {
    const { rows, total } = await listOrgDocuments(prisma, {
      organizationId: orgAId,
      type: 'contract',
    });
    expect(total).toBe(1);
    expect(rows[0]!.id).toBe(docA1ContractId);
  });

  it('filters by orderId', async () => {
    const { rows, total } = await listOrgDocuments(prisma, {
      organizationId: orgAId,
      orderId: orderA2Id,
    });
    expect(total).toBe(1);
    expect(rows[0]!.id).toBe(docA2InvoiceId);
  });

  it('returns 0 when filtering by orderId from another org (silent)', async () => {
    const { rows, total } = await listOrgDocuments(prisma, {
      organizationId: orgAId,
      orderId: orderB1Id,
    });
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });

  it('filters by from date', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const { rows } = await listOrgDocuments(prisma, {
      organizationId: orgAId,
      from: yesterday,
    });
    // act + invoice (created now), but not contract (10 days old)
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(docA1ContractId);
    expect(ids).toContain(docA1ActId);
    expect(ids).toContain(docA2InvoiceId);
  });

  it('searches by document name (case-insensitive)', async () => {
    const { rows } = await listOrgDocuments(prisma, {
      organizationId: orgAId,
      search: 'INVOICE',
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(docA2InvoiceId);
  });

  it('returns countsByType including all visible docs of the org', async () => {
    const { countsByType } = await listOrgDocuments(prisma, { organizationId: orgAId });
    expect(countsByType.contract).toBe(1);
    expect(countsByType.act).toBe(1);
    expect(countsByType.invoice).toBe(1);
    expect(countsByType.other).toBeUndefined();
  });

  it('countsByType is not affected by type filter (shows full picture)', async () => {
    const { countsByType, rows } = await listOrgDocuments(prisma, {
      organizationId: orgAId,
      type: 'contract',
    });
    expect(rows.length).toBe(1);
    expect(countsByType.contract).toBe(1);
    expect(countsByType.act).toBe(1);
    expect(countsByType.invoice).toBe(1);
  });

  it('does NOT leak partner-channel documents to the organization', async () => {
    const { rows, total } = await listOrgDocuments(prisma, { organizationId: orgAId });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(docA1CommissionId);
    expect(total).toBe(3); // contract + act + invoice; commission is partner-channel
  });

  it('orderLess=true returns only order-less docs; default returns only order-bound', async () => {
    const bound = await listOrgDocuments(prisma, { organizationId: orgAId });
    const less = await listOrgDocuments(prisma, { organizationId: orgAId, orderLess: true });
    expect(bound.rows.every((r) => r.orderId !== null)).toBe(true);
    expect(less.rows.every((r) => r.orderId === null)).toBe(true);
    expect(less.rows.map((r) => r.id)).toContain(docOrderLessId);
  });
});

describe('services/organization/documents — getOrgDocumentForDownload', () => {
  it('`У-164`: черновик КП не скачивается даже по прямой ссылке', async () => {
    // Эта дверь сверяет только КАНАЛ — ни состояния, ни гейта чтения она не
    // спрашивает. Значит клиент, знающий идентификатор документа, скачал бы
    // неотправленное предложение со своей же ценой: списки его прячут, а
    // ссылка отдавала бы файл.
    const draft = await prisma.document.create({
      data: {
        name: 'kp-draft.pdf',
        path: `p/${Date.now()}/kp`,
        mimeType: 'application/pdf',
        type: 'commercial_proposal',
        status: 'draft',
        direction: 'outgoing',
        generatedBy: 'system',
        companyId,
        counterpartyType: 'organization',
        counterpartyId: orgAId,
      },
      select: { id: true },
    });

    expect(await getOrgDocumentForDownload(prisma, orgAId, draft.id)).toEqual({
      ok: false,
      error: 'not_found',
    });

    // Отправленное — отдаём: оно клиенту и адресовано.
    await prisma.document.update({ where: { id: draft.id }, data: { status: 'sent' } });
    const sent = await getOrgDocumentForDownload(prisma, orgAId, draft.id);
    expect(sent.ok).toBe(true);

    await prisma.document.delete({ where: { id: draft.id } });
  });

  it('returns ok with path/mimeType/name for own clean document', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgAId, docA1ContractId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe('fake://contract-a1');
      expect(r.mimeType).toBe('application/pdf');
      expect(r.name).toBe('contract-A1.pdf');
    }
  });

  it('returns not_found for non-existent id', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgAId, 'cuid-fake');
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found (silent) for foreign-org document', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgAId, docB1ContractId);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns infected with scanReason for quarantined document', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgAId, docA1InfectedId);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === 'infected') {
      expect(r.scanReason).toBe('EICAR test');
    } else {
      throw new Error('expected infected discriminator');
    }
  });

  it('download of a partner-channel doc returns not_found for the org', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgAId, docA1CommissionId);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('org downloads its own order-less doc successfully', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgAId, docOrderLessId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe('fake://gen');
      expect(r.mimeType).toBe('application/pdf');
      expect(r.name).toBe('gen.pdf');
    }
  });

  it('org gets not_found for another orgs order-less doc', async () => {
    // orgB does not own docOrderLessId (counterpartyId = orgAId)
    const r = await getOrgDocumentForDownload(prisma, orgBId, docOrderLessId);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });
});
