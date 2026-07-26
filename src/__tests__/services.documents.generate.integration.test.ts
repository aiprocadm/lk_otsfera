import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// S3 — мок: генерация пишет файл «в хранилище», Postgres — живой.
const uploadMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload: uploadMock }) }));

import { generateOrderDocument } from '@/lib/services/documents/generate';

/**
 * Этап 8 PR-2 — генерация на живом Postgres: счёт «С-{год}-1» → акт наследует
 * номер, повтор счёта → v2+replaces, конкурентные генерации → номера без
 * дублей (атомарный upsert+increment DocumentCounter).
 */

let prisma: PrismaClient;
const STAMP = Date.now();
const YEAR = 2026;
let companyA: string, orgA: string, manager: string, orgUser: string;
let order1: string, order2: string;

const sManager = (): SessionPayload =>
  ({ sub: manager, role: 'manager', companyId: companyA, managedOrgIds: [orgA] } as unknown as SessionPayload);

const FULL = {
  legalName: `s8p2-ООО-${STAMP}`,
  inn: '7707083893',
  kpp: '770701001',
  legalAddress: 'Москва',
  bankName: 'Т-Банк',
  bankAccount: '40702810400000000001',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  signerName: 'Иванов И.И.',
  signerPosition: 'Директор'
};

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `s8p2-${STAMP}`, ...FULL, inn: '7708123456' } })).id;
  orgA = (await prisma.organization.create({ data: { name: `s8p2-org-${STAMP}`, companyId: companyA, ...FULL } })).id;
  manager = (await prisma.user.create({ data: { email: `s8p2-m-${STAMP}@t.local`, name: 'М', role: 'manager', companyId: companyA } })).id;
  orgUser = (await prisma.user.create({ data: { email: `s8p2-ou-${STAMP}@t.local`, name: 'ОП', role: 'organization' } })).id;
  await prisma.organizationUser.create({ data: { organizationId: orgA, userId: orgUser, roleInOrg: 'admin' } });
  order1 = (
    await prisma.order.create({
      data: { title: `s8p2-o1-${STAMP}`, orderNumber: `s8p2-1-${STAMP}`, companyId: companyA, organizationId: orgA, managerId: manager, totalAmount: 15000 }
    })
  ).id;
  order2 = (
    await prisma.order.create({
      data: { title: `s8p2-o2-${STAMP}`, companyId: companyA, organizationId: orgA, managerId: manager, totalAmount: 5000 }
    })
  ).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [manager, orgUser] } } });
  await prisma.auditLog.deleteMany({ where: { userId: manager } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: orgA } });
  await prisma.document.deleteMany({ where: { orderId: { in: [order1, order2] } } });
  await prisma.documentCounter.deleteMany({ where: { companyId: companyA } });
  await prisma.order.deleteMany({ where: { id: { in: [order1, order2] } } });
  await prisma.organization.deleteMany({ where: { id: orgA } });
  await prisma.user.deleteMany({ where: { id: { in: [manager, orgUser] } } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  await prisma.$disconnect();
});

describe('полный путь генерации', () => {
  it('счёт С-{год}-1 → акт наследует номер → повтор счёта v2 с replaces', async () => {
    const now = new Date(`${YEAR}-07-26T12:00:00Z`);

    // Акт до счёта — отказ.
    expect(await generateOrderDocument(prisma, sManager(), { orderId: order1, docType: 'act', now })).toEqual({
      ok: false,
      error: 'invoice_required'
    });

    const invoice = await generateOrderDocument(prisma, sManager(), { orderId: order1, docType: 'invoice', now });
    expect(invoice.ok).toBe(true);
    if (!invoice.ok) return;
    expect(invoice.number).toBe(`С-${YEAR}-1`);

    const act = await generateOrderDocument(prisma, sManager(), { orderId: order1, docType: 'act', now });
    expect(act.ok && act.number).toBe(`А-${YEAR}-1`);

    const invoice2 = await generateOrderDocument(prisma, sManager(), { orderId: order1, docType: 'invoice', now });
    expect(invoice2.ok && invoice2.number).toBe(`С-${YEAR}-2`);

    const docs = await prisma.document.findMany({
      where: { orderId: order1, type: 'invoice' },
      orderBy: { version: 'asc' },
      select: { id: true, version: true, replacesDocumentId: true, number: true, generatedBy: true, scanStatus: true, direction: true }
    });
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ version: 1, replacesDocumentId: null, generatedBy: 'system', scanStatus: 'clean', direction: 'outgoing' });
    expect(docs[1]).toMatchObject({ version: 2, replacesDocumentId: docs[0]!.id, number: `С-${YEAR}-2` });
    expect(uploadMock).toHaveBeenCalled();

    // Клиенту ушло document_published.
    const notif = await prisma.notification.findFirst({ where: { organizationId: orgA, type: 'document_published' } });
    expect(notif).not.toBeNull();
  });

  it('конкурентные генерации счетов → номера без дублей', async () => {
    const now = new Date(`${YEAR}-07-26T13:00:00Z`);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => generateOrderDocument(prisma, sManager(), { orderId: order2, docType: 'invoice', now }))
    );
    const numbers = results.map((r) => (r.ok ? r.number : 'FAIL'));
    expect(new Set(numbers).size).toBe(5);
    for (const n of numbers) expect(n).toMatch(new RegExp(`^С-${YEAR}-\\d+$`));
  });

  it('неполные реквизиты → список недостающего', async () => {
    const bareOrg = await prisma.organization.create({ data: { name: `s8p2-bare-${STAMP}`, companyId: companyA } });
    const bareOrder = await prisma.order.create({
      data: { title: `s8p2-bare-o-${STAMP}`, companyId: companyA, organizationId: bareOrg.id, managerId: manager, totalAmount: 100 }
    });
    try {
      const r = await generateOrderDocument(prisma, sManager(), { orderId: bareOrder.id, docType: 'invoice' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('missing_requisites');
        expect(r.missing!.some((m) => m.label === 'ИНН заказчика')).toBe(true);
      }
    } finally {
      await prisma.order.delete({ where: { id: bareOrder.id } });
      await prisma.organization.delete({ where: { id: bareOrg.id } });
    }
  });
});

describe('договор и доп. соглашение (PR-3)', () => {
  it('договор нумеруется независимо от счёта; ДС наследует номер договора', async () => {
    const now = new Date(`${YEAR}-07-26T14:00:00Z`);
    const orderC = await prisma.order.create({
      data: { title: `s8p3-o-${STAMP}`, companyId: companyA, organizationId: orgA, managerId: manager, totalAmount: 9000 }
    });
    try {
      // ДС до договора — отказ.
      expect(await generateOrderDocument(prisma, sManager(), { orderId: orderC.id, docType: 'extra_agreement', now })).toEqual({
        ok: false,
        error: 'contract_required'
      });

      const contract = await generateOrderDocument(prisma, sManager(), { orderId: orderC.id, docType: 'contract', now });
      expect(contract.ok && contract.number).toBe(`Д-${YEAR}-1`);

      const extra = await generateOrderDocument(prisma, sManager(), { orderId: orderC.id, docType: 'extra_agreement', now });
      expect(extra.ok && extra.number).toBe(`ДС-${YEAR}-1`);

      // Счёт по тому же заказу берёт номер из СВОЕЙ последовательности (не «2»).
      const invoice = await generateOrderDocument(prisma, sManager(), { orderId: orderC.id, docType: 'invoice', now });
      expect(invoice.ok && invoice.number).toMatch(new RegExp(`^С-${YEAR}-\\d+$`));

      const counters = await prisma.documentCounter.findMany({
        where: { companyId: companyA, year: YEAR },
        select: { kind: true, lastNumber: true },
        orderBy: { kind: 'asc' }
      });
      expect(counters.find((c) => c.kind === 'contract')!.lastNumber).toBe(1);
      expect(counters.find((c) => c.kind === 'invoice')!.lastNumber).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.document.deleteMany({ where: { orderId: orderC.id } });
      await prisma.order.delete({ where: { id: orderC.id } });
    }
  });
});
