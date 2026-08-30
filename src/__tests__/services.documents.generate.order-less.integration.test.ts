import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// S3 — мок: документ «кладётся в хранилище», Postgres — живой.
const uploadMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload: uploadMock }) }));

import { generateOrderDocument } from '@/lib/services/documents/generate';

/**
 * Этап 6, PR-6 (`У-145`) — выпуск БЕЗ заказа на живом Postgres.
 *
 * Почему этого мало проверить моками: якорь документа без заказа держит
 * **ограничение схемы** `Document_order_xor_company` — «либо заказ, либо
 * компания, никогда оба и никогда ни одного». Фейковая prisma такое
 * ограничение не проверяет: она примет любую комбинацию полей. Здесь же
 * неверный якорь уронил бы вставку.
 *
 * Второе, что видно только на живой базе: счётчик номеров — общий для
 * документов заказа и документов без заказа (одна компания, один год, один
 * вид). Разъедься они, у компании появились бы два счёта «С-2026-1».
 */

let prisma: PrismaClient;
const STAMP = Date.now();
const YEAR = 2026;
let companyA: string, orgA: string, orgB: string, manager: string, order1: string;

const sManager = (): SessionPayload =>
  ({
    sub: manager,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [orgA, orgB],
  }) as unknown as SessionPayload;

const FULL = {
  legalName: `s6p6-ООО-${STAMP}`,
  inn: '7707083893',
  kpp: '770701001',
  legalAddress: 'Москва',
  bankName: 'Т-Банк',
  bankAccount: '40702810400000000005',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  signerName: 'Иванов И.И.',
  signerPosition: 'Директор',
  signerBasis: 'Устава',
};

/** Строка состава в том виде, в каком её присылает форма выпуска. */
const LINE = {
  title: 'Консультация',
  quantity: '2',
  unit: 'service' as const,
  unitPrice: '5000',
  discountPercent: null,
  vatRate: '0.2000',
  vatIncluded: true,
};

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (
    await prisma.company.create({ data: { name: `s6p6-${STAMP}`, ...FULL, inn: '7708123450' } })
  ).id;
  orgA = (
    await prisma.organization.create({
      data: { name: `s6p6-orgA-${STAMP}`, companyId: companyA, ...FULL },
    })
  ).id;
  orgB = (
    await prisma.organization.create({
      data: { name: `s6p6-orgB-${STAMP}`, companyId: companyA, ...FULL, inn: '7710140679' },
    })
  ).id;
  manager = (
    await prisma.user.create({
      data: { email: `s6p6-m-${STAMP}@t.local`, name: 'М', role: 'manager', companyId: companyA },
    })
  ).id;
  order1 = (
    await prisma.order.create({
      data: {
        title: `s6p6-o1-${STAMP}`,
        orderNumber: `s6p6-1-${STAMP}`,
        companyId: companyA,
        organizationId: orgA,
        managerId: manager,
        totalAmount: 10000,
      },
    })
  ).id;
});

afterAll(async () => {
  const orgs = [orgA, orgB];
  const docs = await prisma.document.findMany({
    where: { OR: [{ orderId: order1 }, { companyId: companyA }] },
    select: { id: true },
  });
  const ids = docs.map((d) => d.id);
  await prisma.documentLine.deleteMany({ where: { documentId: { in: ids } } });
  // Ссылки документов друг на друга (версии и основания) не дают удалить их
  // одним махом — сначала снимаем связи.
  await prisma.document.updateMany({
    where: { id: { in: ids } },
    data: { parentDocumentId: null, replacesDocumentId: null },
  });
  await prisma.document.deleteMany({ where: { id: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: manager } });
  await prisma.auditLog.deleteMany({ where: { userId: manager } });
  await prisma.documentCounter.deleteMany({ where: { companyId: companyA } });
  await prisma.order.deleteMany({ where: { id: order1 } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: manager } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  await prisma.$disconnect();
});

describe('выпуск без заказа на живой базе (`У-145`)', () => {
  it('счёт без заказа ложится в базу: заказа нет, компания есть, строки-снимок на месте', async () => {
    const now = new Date(`${YEAR}-07-26T12:00:00Z`);
    const res = await generateOrderDocument(prisma, sManager(), {
      organizationId: orgB,
      docType: 'invoice',
      lines: [LINE],
      now,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.number).toBe(`С-${YEAR}-1`);

    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: res.documentId },
      select: {
        orderId: true,
        companyId: true,
        counterpartyType: true,
        counterpartyId: true,
        status: true,
        amountGross: true,
        path: true,
        lines: { select: { title: true, amount: true } },
      },
    });
    // Ограничение `Document_order_xor_company` пропустило запись только потому,
    // что якорь ровно один.
    expect(doc.orderId).toBeNull();
    expect(doc.companyId).toBe(companyA);
    expect(doc.counterpartyType).toBe('organization');
    expect(doc.counterpartyId).toBe(orgB);
    expect(doc.status).toBe('issued');
    expect(doc.amountGross?.toFixed(2)).toBe('10000.00');
    expect(doc.path.startsWith(`organizations/${orgB}/generated/`)).toBe(true);
    expect(doc.lines).toEqual([{ title: 'Консультация', amount: expect.anything() }]);
  });

  it('счётчик номеров общий с заказами: следующий документ компании берёт номер 2', async () => {
    const now = new Date(`${YEAR}-07-26T12:00:00Z`);
    const byOrder = await generateOrderDocument(prisma, sManager(), {
      orderId: order1,
      docType: 'invoice',
      now,
    });
    expect(byOrder.ok).toBe(true);
    if (!byOrder.ok) return;
    // Первый номер уехал документу без заказа — второй достаётся заказу.
    expect(byOrder.number).toBe(`С-${YEAR}-2`);
  });

  it('ДС без заказа наследует номер договора ТОЙ ЖЕ организации без заказа', async () => {
    const now = new Date(`${YEAR}-07-26T12:00:00Z`);
    const contract = await generateOrderDocument(prisma, sManager(), {
      organizationId: orgB,
      docType: 'contract',
      lines: [LINE],
      now,
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    expect(contract.number).toBe(`Д-${YEAR}-1`);

    const extra = await generateOrderDocument(prisma, sManager(), {
      organizationId: orgB,
      docType: 'extra_agreement',
      lines: [LINE],
      now,
    });
    expect(extra.ok).toBe(true);
    if (!extra.ok) return;
    expect(extra.number).toBe(`ДС-${YEAR}-1`);

    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: extra.documentId },
      select: { parentDocumentId: true },
    });
    expect(doc.parentDocumentId).toBe(contract.documentId);

    // У СОСЕДНЕЙ организации своих договоров нет — чужой в основания не берётся.
    expect(
      await generateOrderDocument(prisma, sManager(), {
        organizationId: orgA,
        docType: 'extra_agreement',
        lines: [LINE],
        now,
      })
    ).toEqual({ ok: false, error: 'contract_required' });
  });

  it('повторный выпуск без заказа даёт версию 2 и ссылку на прежнюю', async () => {
    const now = new Date(`${YEAR}-07-26T12:00:00Z`);
    const again = await generateOrderDocument(prisma, sManager(), {
      organizationId: orgB,
      docType: 'invoice',
      lines: [LINE],
      now,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: again.documentId },
      select: { version: true, replacesDocumentId: true },
    });
    expect(doc.version).toBe(2);
    expect(doc.replacesDocumentId).not.toBeNull();
  });
});
