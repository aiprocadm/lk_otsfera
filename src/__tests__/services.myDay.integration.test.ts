/**
 * Этап 11 PR-2 (Модуль 15, ФТ-15.3) integration: «Готово к передаче» на живой БД.
 *
 * Моками этого не докажешь: карточка обязана считать готовность теми же
 * правилами, что и деталка заказа (этап 12), и заказ должен уходить из неё
 * ровно после нажатия «Передать результат».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { getMyDay } from '@/lib/services/manager/myDay';
import { deliverOrderResult } from '@/lib/services/manager/orderDelivery';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const RUN = `myday-${process.pid}`;

let companyId: string;
let orgId: string;
let orgUserId: string;
let managerId: string;
let directionId: string;
let studentId: string;
let readyOrderId: string;
let notReadyOrderId: string;
let cancelledOrderId: string;
let documentId: string;

const manager = (): SessionPayload =>
  ({
    sub: managerId,
    role: 'manager',
    companyId,
    managedOrgIds: [orgId]
  }) as unknown as SessionPayload;

async function makeTrainingOrder(title: string, withScan: boolean, cancelled = false) {
  const order = await prisma.order.create({
    data: {
      title,
      companyId,
      organizationId: orgId,
      managerId,
      serviceType: 'training',
      totalAmount: new Prisma.Decimal('1000.00'),
      paidAmount: new Prisma.Decimal('1000.00'),
      financialStatus: 'paid',
      executionStatus: cancelled ? 'cancelled' : 'completed'
    }
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      studentId,
      directionId,
      trainingStatus: 'certificate_issued'
    }
  });
  await prisma.certificate.create({
    data: {
      number: `${RUN}-${title}`,
      studentId,
      organizationId: orgId,
      directionId,
      orderItemId: item.id,
      issuedAt: new Date('2026-06-01'),
      documentId: withScan ? documentId : null
    }
  });
  return order.id;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  companyId = company.id;
  const org = await prisma.organization.create({ data: { name: `${RUN}-org`, companyId } });
  orgId = org.id;
  const mgr = await prisma.user.create({
    data: { email: `${RUN}-m@t.local`, name: 'M', role: 'manager', passwordHash: 'x', companyId }
  });
  managerId = mgr.id;
  const ou = await prisma.user.create({
    data: { email: `${RUN}-o@t.local`, name: 'O', role: 'organization', passwordHash: 'x' }
  });
  orgUserId = ou.id;
  await prisma.organizationUser.create({
    data: { organizationId: orgId, userId: orgUserId, roleInOrg: 'admin', isActive: true }
  });
  const dir = await prisma.trainingDirection.create({ data: { name: `${RUN}-dir`, isActive: true } });
  directionId = dir.id;
  const student = await prisma.student.create({
    data: { name: `${RUN} Слушатель`, email: `${RUN}-s@t.local`, organizationId: orgId }
  });
  studentId = student.id;

  // Общий «скан» — документ вне заказов, чтобы не мешать выборкам по orderId.
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
      company: { connect: { id: companyId } },
      uploadedBy: { connect: { id: managerId } }
    }
  });
  documentId = doc.id;

  readyOrderId = await makeTrainingOrder('готовый', true);
  notReadyOrderId = await makeTrainingOrder('без-скана', false);
  cancelledOrderId = await makeTrainingOrder('отменённый', true, true);
});

afterAll(async () => {
  const orderIds = [readyOrderId, notReadyOrderId, cancelledOrderId].filter(Boolean);
  await prisma.notification.deleteMany({ where: { userId: { in: [orgUserId, managerId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [managerId, orgUserId] } } });
  await prisma.certificate.deleteMany({ where: { organizationId: orgId } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.document.deleteMany({ where: { id: documentId } });
  await prisma.student.deleteMany({ where: { organizationId: orgId } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [managerId, orgUserId] } } });
  await prisma.trainingDirection.delete({ where: { id: directionId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('«Мой день» — Готово к передаче (ФТ-15.3)', () => {
  it('считает только заказы с закрытым чек-листом; отменённый не в счёт', async () => {
    const data = await getMyDay(prisma, manager());
    expect(data.readyToDeliver).toBe(1);
    expect(data.readyOrders.map((o) => o.id)).toEqual([readyOrderId]);
    expect(data.readyOrders.map((o) => o.id)).not.toContain(notReadyOrderId);
    expect(data.readyOrders.map((o) => o.id)).not.toContain(cancelledOrderId);
  });

  it('после передачи результата заказ уходит из карточки', async () => {
    const res = await deliverOrderResult(prisma, manager(), readyOrderId);
    expect(res.ok).toBe(true);

    const data = await getMyDay(prisma, manager());
    expect(data.readyToDeliver).toBe(0);
    expect(data.readyOrders).toEqual([]);
  });

  it('заражённый скан не делает заказ готовым', async () => {
    await prisma.document.update({
      where: { id: documentId },
      data: { scanStatus: 'infected', scanReason: 'Eicar-Test-Signature' }
    });
    const data = await getMyDay(prisma, manager());
    expect(data.readyToDeliver).toBe(0);

    await prisma.document.update({
      where: { id: documentId },
      data: { scanStatus: 'clean', scanReason: null }
    });
  });

  it('чужой менеджер этих заказов не видит', async () => {
    const alien = {
      sub: 'ghost',
      role: 'manager',
      companyId: 'other-co',
      managedOrgIds: []
    } as unknown as SessionPayload;
    const data = await getMyDay(prisma, alien);
    expect(data.readyOrders).toEqual([]);
  });
});
