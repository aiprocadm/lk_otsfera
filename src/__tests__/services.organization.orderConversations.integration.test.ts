import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrgOrderConversations } from '@/lib/services/organization/orderConversations';

/**
 * `У-332` (`Д-66`, ТЗ 28.10.2026): «Сообщения → По заказам» у заказчика.
 * На стенде комментарий заказчика к заказу и ответ менеджера были, а вкладка
 * пустовала — показывала только чаты. Проверяем на живой базе: своя
 * организация, заказы только с перепиской, свежие сверху, граница участника.
 */

let prisma: PrismaClient;
const S = `ocv-${Date.now()}`;
let companyId: string;
let orgId: string;
let otherOrgId: string;
let clientId: string;
let managerId: string;
const orders: Record<string, string> = {};

async function comment(orderId: string, authorId: string, body: string, at: string) {
  await prisma.comment.create({ data: { orderId, authorId, body, createdAt: new Date(at) } });
}

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `${S}-co` } })).id;
  orgId = (await prisma.organization.create({ data: { name: `${S}-org`, companyId } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `${S}-other`, companyId } })).id;
  clientId = (
    await prisma.user.create({
      data: {
        email: `${S}-client@x.local`,
        name: 'Ольга',
        role: 'organization',
        passwordHash: 'x',
      },
    })
  ).id;
  managerId = (
    await prisma.user.create({
      data: {
        email: `${S}-mgr@x.local`,
        name: 'Пётр',
        role: 'manager',
        passwordHash: 'x',
        companyId,
      },
    })
  ).id;
  for (const [key, org] of [
    ['a', orgId],
    ['b', orgId],
    ['silent', orgId],
    ['foreign', otherOrgId],
  ] as const) {
    orders[key] = (
      await prisma.order.create({
        data: { title: `${S}-${key}`, organizationId: org, companyId, orderNumber: `${S}-${key}` },
      })
    ).id;
  }
  await comment(orders.a!, clientId, 'Когда начало?', '2026-10-25T09:00:00Z');
  await comment(orders.a!, managerId, 'В понедельник', '2026-10-26T09:00:00Z');
  await comment(orders.b!, clientId, 'Пришлите счёт', '2026-10-27T09:00:00Z');
  await comment(orders.foreign!, clientId, 'Чужой заказ', '2026-10-28T09:00:00Z');
});

afterAll(async () => {
  await prisma.comment.deleteMany({ where: { order: { title: { startsWith: S } } } });
  await prisma.order.deleteMany({ where: { title: { startsWith: S } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: S } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: S } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: S } } });
  await prisma.$disconnect();
});

describe('listOrgOrderConversations (У-332)', () => {
  it('заказы своей организации с перепиской, свежие сверху; последнее слово и счётчик', async () => {
    const rows = await listOrgOrderConversations(prisma, orgId, null);
    expect(rows.map((r) => r.orderId)).toEqual([orders.b, orders.a]);
    const [b, a] = rows;
    expect(b).toMatchObject({
      orderLabel: `${S}-b`,
      lastBody: 'Пришлите счёт',
      lastFromStaff: false,
      lastAuthorName: 'Ольга',
      count: 1,
    });
    // Ответ менеджера подписан ролью, а не именем сотрудника.
    expect(a).toMatchObject({
      lastBody: 'В понедельник',
      lastFromStaff: true,
      lastAuthorName: 'Менеджер',
      count: 2,
    });
  });

  it('граница участника (`У-236`) сужает список до его заказов', async () => {
    const rows = await listOrgOrderConversations(prisma, orgId, {
      where: { id: orders.a! },
      viewerUserId: clientId,
    });
    expect(rows.map((r) => r.orderId)).toEqual([orders.a]);
  });

  it('заказ без номера подписан названием в кавычках', async () => {
    await prisma.order.update({ where: { id: orders.b! }, data: { orderNumber: null } });
    const rows = await listOrgOrderConversations(prisma, orgId, null);
    expect(rows.find((r) => r.orderId === orders.b)?.orderLabel).toBe(`«${S}-b»`);
  });
});
