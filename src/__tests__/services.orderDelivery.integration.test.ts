/**
 * Этап 12 (Модуль 5, ФТ-5.1/5.2/5.4) integration: полный путь «заказ готов →
 * передача → клиент видит результат» против реальной БД.
 *
 * Проверяем то, что моками не докажешь: реальную запись `resultDeliveredAt`,
 * аудит, доставку уведомления в `Notification` и идемпотентность повторного
 * нажатия (решение заказчика §6-3).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { deliverOrderResult, getOrderReadiness } from '@/lib/services/manager/orderDelivery';
import { orderStage } from '@/lib/orders/humanStage';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const RUN = `deliv-${process.pid}`;

let companyId: string;
let orgId: string;
let managerId: string;
let orgUserId: string;
let directionId: string;
let studentId: string;
let orderId: string;
let certificateId: string;
let documentId: string;

const manager = (): SessionPayload =>
  ({
    sub: managerId,
    role: 'manager',
    companyId,
    managedOrgIds: [orgId],
  }) as unknown as SessionPayload;

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  companyId = company.id;
  const org = await prisma.organization.create({ data: { name: `${RUN}-org`, companyId } });
  orgId = org.id;

  const mgr = await prisma.user.create({
    data: { email: `${RUN}-m@t.local`, name: 'M', role: 'manager', passwordHash: 'x', companyId },
  });
  managerId = mgr.id;
  const ou = await prisma.user.create({
    data: { email: `${RUN}-o@t.local`, name: 'O', role: 'organization', passwordHash: 'x' },
  });
  orgUserId = ou.id;
  await prisma.organizationUser.create({
    data: { organizationId: orgId, userId: orgUserId, roleInOrg: 'admin', isActive: true },
  });

  const dir = await prisma.trainingDirection.create({
    data: { name: `${RUN}-dir`, isActive: true },
  });
  directionId = dir.id;
  const student = await prisma.student.create({
    data: { name: `${RUN} Слушатель`, email: `${RUN}-s@t.local`, organizationId: orgId },
  });
  studentId = student.id;

  const order = await prisma.order.create({
    data: {
      title: `${RUN}-order`,
      companyId,
      organizationId: orgId,
      managerId,
      serviceType: 'training',
      totalAmount: new Prisma.Decimal('1000.00'),
      paidAmount: new Prisma.Decimal('1000.00'),
      financialStatus: 'paid',
      executionStatus: 'completed',
    },
  });
  orderId = order.id;

  // Позиция: обучение завершено, удостоверение выдано, скан ещё НЕ загружен.
  const item = await prisma.orderItem.create({
    data: { orderId, studentId, directionId, trainingStatus: 'certificate_issued' },
  });
  const cert = await prisma.certificate.create({
    data: {
      number: `${RUN}-cert`,
      studentId,
      organizationId: orgId,
      directionId,
      orderItemId: item.id,
      issuedAt: new Date('2026-06-01'),
    },
  });
  certificateId = cert.id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [orgUserId, managerId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [managerId, orgUserId] } } });
  await prisma.certificate.deleteMany({ where: { organizationId: orgId } });
  await prisma.orderItem.deleteMany({ where: { orderId } });
  if (documentId) await prisma.document.deleteMany({ where: { id: documentId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.student.deleteMany({ where: { organizationId: orgId } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [managerId, orgUserId] } } });
  await prisma.trainingDirection.delete({ where: { id: directionId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('полный путь передачи результата', () => {
  it('без скана удостоверения заказ не готов — передача отклоняется', async () => {
    const readiness = await getOrderReadiness(prisma, manager(), orderId);
    expect(readiness.ok).toBe(true);
    if (readiness.ok) {
      expect(readiness.readiness.ready).toBe(false);
      expect(readiness.readiness.items[0]?.gaps).toEqual(['certificate_scan_missing']);
    }

    const res = await deliverOrderResult(prisma, manager(), orderId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('not_ready');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.resultDeliveredAt).toBeNull();
  });

  it('после загрузки скана заказ готов, передача проходит и уведомляет клиента', async () => {
    // «Загружаем» скан: документ + привязка к удостоверению.
    const doc = await prisma.document.create({
      data: {
        name: `${RUN}-scan.pdf`,
        type: 'certificate',
        direction: 'outgoing',
        scanStatus: 'clean',
        path: `${RUN}/scan.pdf`,
        mimeType: 'application/pdf',
        counterpartyType: 'organization',
        counterpartyId: orgId,
        size: 1024,
        order: { connect: { id: orderId } },
        company: { connect: { id: companyId } },
        uploadedBy: { connect: { id: managerId } },
      },
    });
    documentId = doc.id;
    await prisma.certificate.update({
      where: { id: certificateId },
      data: { documentId: doc.id },
    });

    const readiness = await getOrderReadiness(prisma, manager(), orderId);
    expect(readiness.ok && readiness.readiness.ready).toBe(true);

    const res = await deliverOrderResult(prisma, manager(), orderId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.alreadyDelivered).toBe(false);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.resultDeliveredAt).not.toBeNull();
    expect(order?.resultDeliveredById).toBe(managerId);

    // Аудит записан.
    const audit = await prisma.auditLog.findMany({
      where: { entityId: orderId, action: 'order_result_delivered' },
    });
    expect(audit).toHaveLength(1);

    // Клиент получил уведомление в ЛК.
    const notes = await prisma.notification.findMany({ where: { userId: orgUserId } });
    expect(notes.map((n) => n.type)).toContain('order_result_delivered');
  });

  it('клиентский статус заказа становится «Результат передан» (ФТ-5.4)', async () => {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const stage = orderStage({
      executionStatus: order!.executionStatus,
      financialStatus: order!.financialStatus,
      amount: order!.totalAmount.toString(),
      paidTotal: order!.paidAmount.toString(),
      resultDeliveredAt: order!.resultDeliveredAt,
    });
    expect(stage.label).toBe('Результат передан');
  });

  it('повторная передача — no-op: дата та же, второго уведомления нет (§6-3)', async () => {
    const before = await prisma.order.findUnique({ where: { id: orderId } });
    const notesBefore = await prisma.notification.count({ where: { userId: orgUserId } });

    const res = await deliverOrderResult(prisma, manager(), orderId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.alreadyDelivered).toBe(true);

    const after = await prisma.order.findUnique({ where: { id: orderId } });
    expect(after?.resultDeliveredAt?.toISOString()).toBe(before?.resultDeliveredAt?.toISOString());
    expect(await prisma.notification.count({ where: { userId: orgUserId } })).toBe(notesBefore);
  });
});
