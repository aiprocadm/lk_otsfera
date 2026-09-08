import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// S3 и почта — моки: проверяем цепочку данных, а не доставку файла и письма.
const uploadMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload: uploadMock }) }));
// Почта — мок: письмо считается доставленным, если транспорт вернул
// `status: 'sent'` (по этому признаку сервис решает, что документ отправлен).
vi.mock('@/lib/email/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/send')>()),
  sendNotificationEmail: vi.fn().mockResolvedValue({ status: 'sent' }),
  sendOrgDocumentSentEmail: vi.fn().mockResolvedValue({ status: 'sent' }),
}));

import { generateOrderDocument } from '@/lib/services/documents/generate';
import { sendDocumentToCustomer } from '@/lib/services/documents/send';
import { acceptProposal } from '@/lib/services/documents/acceptProposal';

/**
 * Сценарная приёмка §7 п.3 действующего ТЗ — на живом Postgres.
 *
 * ТЗ описывает приёмку словами заказчика: «менеджер готовит КП из сделки для
 * организации БЕЗ реквизитов, отправляет, заказчик принимает — появляется
 * заказ». Каждый шаг по отдельности покрыт (`services.documents.acceptProposal`
 * — четыре сценария на моках, `documents.generate.*` — выпуск), но всю цепочку
 * до сих пор проходил только человек руками. Мок этого не заменяет: он не
 * проверит ни ограничения схемы (`Document_order_xor_company`, связь
 * `Deal.orderId`), ни то, что состав заказа собрался из строк предложения с
 * теми же суммами (сопровождение, 08.09.2026 — по поручению заказчика живая
 * приёмка заменена воспроизводимой).
 *
 * Проверяется ровно то, что видит человек: КП выпускается организации без
 * ИНН и банковских реквизитов; черновик клиенту не показывается; после
 * отправки документ «отправлен»; принятие создаёт заказ, привязывает его к
 * сделке и переносит строки с суммой; повторное принятие второй заказ не
 * плодит.
 */
let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string, orgId: string, managerId: string, dealId: string, orgUserId: string;

const manager = (): SessionPayload =>
  ({
    sub: managerId,
    role: 'manager',
    companyId,
    managedOrgIds: [orgId],
  }) as unknown as SessionPayload;

/** Реквизиты ИСПОЛНИТЕЛЯ — они обязательны всегда, даже для КП. */
const COMPANY_REQUISITES = {
  legalName: `acc-ООО-${STAMP}`,
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

const LINES = [
  {
    title: 'Обучение по охране труда',
    quantity: '3',
    unit: 'person' as const,
    unitPrice: '4000',
    discountPercent: null,
    vatRate: '0.0000',
    vatIncluded: true,
  },
];

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (
    await prisma.company.create({ data: { name: `acc-co-${STAMP}`, ...COMPANY_REQUISITES } })
  ).id;
  // Организация БЕЗ реквизитов — именно этот случай назван в приёмке.
  orgId = (await prisma.organization.create({ data: { name: `acc-org-${STAMP}`, companyId } })).id;
  managerId = (
    await prisma.user.create({
      data: { email: `acc-m-${STAMP}@t.local`, name: 'Менеджер', role: 'manager', companyId },
    })
  ).id;
  orgUserId = (
    await prisma.user.create({
      data: {
        email: `acc-org-${STAMP}@t.local`,
        name: 'Заказчик',
        role: 'organization',
        organizationId: orgId,
      },
    })
  ).id;
  // Письмо о документе уходит УЧАСТНИКАМ организации: получатели берутся из
  // членств (`OrganizationUser`), а не из поля `User.organizationId`.
  await prisma.organizationUser.create({
    data: { organizationId: orgId, userId: orgUserId, roleInOrg: 'admin', isActive: true },
  });
  dealId = (
    await prisma.deal.create({
      data: { title: `acc-deal-${STAMP}`, companyId, organizationId: orgId, managerId },
    })
  ).id;
});

afterAll(async () => {
  await prisma.orderStatusChange.deleteMany({ where: { order: { organizationId: orgId } } });
  await prisma.orderLine.deleteMany({ where: { order: { organizationId: orgId } } });
  await prisma.documentLine.deleteMany({ where: { document: { counterpartyId: orgId } } });
  await prisma.document.deleteMany({ where: { counterpartyId: orgId } });
  await prisma.deal.deleteMany({ where: { id: dealId } });
  await prisma.order.deleteMany({ where: { organizationId: orgId } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
  // Выпуск, отправка и принятие пишут аудит — на пользователей есть ссылки,
  // и без этой уборки удаление упало бы внешним ключом.
  await prisma.auditLog.deleteMany({ where: { userId: { in: [managerId, orgUserId] } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [managerId, orgUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [managerId, orgUserId] } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.documentCounter.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('приёмка §7 п.3: КП из сделки → отправка → принятие → заказ', () => {
  it('весь путь проходит на живой базе и даёт заказ со строками предложения', async () => {
    // 1. Менеджер готовит КП организации БЕЗ реквизитов — отсутствие ИНН и
    //    банка не должно мешать (`У-161`).
    const issued = await generateOrderDocument(prisma, manager(), {
      organizationId: orgId,
      dealId,
      docType: 'commercial_proposal',
      lines: LINES,
      now: new Date(),
    });
    expect(issued.ok, 'КП организации без реквизитов не выпустилось').toBe(true);
    if (!issued.ok) return;
    expect(issued.number, 'номер КП идёт своей последовательностью').toMatch(/^КП-\d{4}-\d+$/);

    // 2. КП рождается ЧЕРНОВИКОМ: клиенту его ещё не показывают (`У-164`).
    const draft = await prisma.document.findUniqueOrThrow({
      where: { id: issued.documentId },
      select: { status: true, dealId: true, counterpartyId: true, orderId: true },
    });
    expect(draft.status).toBe('draft');
    expect(draft.dealId, 'КП не связано со сделкой — блок предложений будет пуст').toBe(dealId);
    expect(draft.orderId, 'у КП не бывает заказа: он появится только при принятии').toBeNull();
    expect(draft.counterpartyId).toBe(orgId);

    // 3. Менеджер отправляет — документ становится видимым заказчику.
    const sent = await sendDocumentToCustomer(prisma, manager(), issued.documentId);
    expect(sent.ok, 'отправка КП заказчику не прошла').toBe(true);
    const afterSend = await prisma.document.findUniqueOrThrow({
      where: { id: issued.documentId },
      select: { status: true, sentAt: true },
    });
    expect(afterSend.status).toBe('sent');
    expect(afterSend.sentAt).not.toBeNull();

    // 4. Заказчик принимает — появляется заказ со строками предложения.
    const accepted = await acceptProposal(prisma, manager(), { documentId: issued.documentId });
    expect(accepted.ok, 'принятие КП не создало заказ').toBe(true);
    if (!accepted.ok) return;
    expect(accepted.orderCreated).toBe(true);
    expect(accepted.linesTransferred).toBe(LINES.length);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: accepted.orderId },
      select: {
        organizationId: true,
        companyId: true,
        totalAmount: true,
        lines: { select: { title: true, quantity: true, unitPrice: true, amount: true } },
      },
    });
    expect(order.organizationId).toBe(orgId);
    expect(order.companyId).toBe(companyId);
    // 3 × 4000 — та же сумма, что стояла в предложении.
    expect(order.totalAmount.toFixed(2)).toBe('12000.00');
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]?.title).toBe(LINES[0]?.title);
    expect(order.lines[0]?.amount.toFixed(2)).toBe('12000.00');

    // 5. Сделка получила свой заказ — воронка руководителя увидит выигрыш.
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      select: { orderId: true },
    });
    expect(deal.orderId, 'заказ не привязан к сделке').toBe(accepted.orderId);

    // 6. Документ помечен принятым — повторное нажатие второй заказ не плодит.
    const finalDoc = await prisma.document.findUniqueOrThrow({
      where: { id: issued.documentId },
      select: { status: true },
    });
    expect(finalDoc.status).toBe('accepted');

    const again = await acceptProposal(prisma, manager(), { documentId: issued.documentId });
    expect(again.ok, 'повторное принятие обязано отказать, а не создать второй заказ').toBe(false);
    const orders = await prisma.order.count({ where: { organizationId: orgId } });
    expect(orders, 'у организации появился лишний заказ').toBe(1);
  });
});
