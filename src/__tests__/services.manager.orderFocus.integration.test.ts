import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { kpis } from '@/lib/services/manager/dashboard';
import { getMyDay } from '@/lib/services/manager/myDay';
import { listOrders, listOrdersForExport } from '@/lib/services/manager/orders';
import { readyToDeliverOrders } from '@/lib/services/manager/orderFocus';
import { managerOrderScope } from '@/lib/auth/managerPolicy';
import { countIntakeSla } from '@/lib/services/intake/list';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 4 ТЗ 13.10.2026 «Главная менеджера» на живом Postgres (`У-294`,
 * `У-295`, `У-297`, `Р-4-2`, `Р-4-3`).
 *
 * Главный инвариант: **число на карточке главной равно числу строк в «Заказах»
 * после перехода по ней**. Раньше карточки вели в список без фильтра — ПМ видел
 * «3» на карточке и 40 строк в списке. Плюс сроки ответа по очереди «Входящие в
 * работу» — по настройке компании «ответить за N часов».
 */

const prisma = new PrismaClient();
const T = `pm4-focus-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let companyId = '';
let orgId = '';
let managerId = '';
let session: SessionPayload;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `${T}-co`, slaResponseHours: 10 },
  });
  companyId = company.id;
  const org = await prisma.organization.create({ data: { name: `${T}-org`, companyId } });
  orgId = org.id;
  const manager = await prisma.user.create({
    data: { email: `${T}@t.local`, name: 'ПМ4', role: 'manager', companyId },
  });
  managerId = manager.id;
  session = { sub: managerId, role: 'manager', companyId, managedOrgIds: [orgId] };

  const now = Date.now();
  const order = (suffix: string, extra: Record<string, unknown>) =>
    prisma.order.create({
      data: {
        title: `${T}-${suffix}`,
        orderNumber: `${T}-${suffix}`,
        companyId,
        organizationId: orgId,
        managerId,
        ...extra,
      },
    });
  await order('active', { executionStatus: 'in_progress' });
  await order('overdue', { executionStatus: 'pending', deadline: new Date(now - DAY) });
  await order('soon', { executionStatus: 'in_progress', deadline: new Date(now + 2 * DAY) });
  // Завершённый с прошедшим сроком — не просрочка; отменённый с близким сроком — не срочный.
  await order('done', { executionStatus: 'completed', deadline: new Date(now - DAY) });
  await order('cancel', { executionStatus: 'cancelled', deadline: new Date(now + DAY) });
});

afterAll(async () => {
  await prisma.clientRequest.deleteMany({ where: { companyName: { startsWith: T } } });
  await prisma.order.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { id: managerId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('число на карточке = число строк после перехода (`У-295`, `У-297`)', () => {
  it.each([
    // «В работе» — все незавершённые: и просроченный, и срочный.
    ['active', 'activeOrders', 3],
    ['overdue', 'attentionCount', 1],
    ['due_soon', 'urgentDeadlines', 1],
  ] as const)('фокус %s ↔ плитка %s', async (focus, tile, expected) => {
    const k = await kpis(prisma, session, false);
    const { rows } = await listOrders(prisma, { session, focus, take: 100 });
    expect(rows).toHaveLength(k[tile]);
    expect(rows).toHaveLength(expected);
    // Выгрузка — та же выборка, что экран.
    const exported = await listOrdersForExport(prisma, { session, focus });
    expect(exported.total).toBe(expected);
  });

  it('фокус «готово к передаче» ↔ карточка «Мой дня»: те же заказы', async () => {
    const ready = await readyToDeliverOrders(prisma, managerOrderScope(session, false));
    const { rows } = await listOrders(prisma, { session, focus: 'ready', take: 100 });
    const day = await getMyDay(prisma, session, false);
    expect(rows.map((r) => r.id).sort()).toEqual(ready.map((r) => r.id).sort());
    expect(day.readyToDeliver).toBe(rows.length);
  });

  it('без фокуса список прежний — все заказы охвата', async () => {
    const { rows } = await listOrders(prisma, { session, take: 100 });
    expect(rows).toHaveLength(5);
  });
});

describe('сроки ответа по очереди «Входящие в работу» (`У-294`, `Р-4-2`)', () => {
  it('«остался час» и «просрочено» — по настройке компании «ответить за N часов»', async () => {
    const now = new Date();
    const before = await countIntakeSla(prisma, session, now);
    const request = (suffix: string, ageMs: number) =>
      prisma.clientRequest.create({
        data: {
          source: 'organization_cabinet',
          organizationId: orgId,
          companyName: `${T}-${suffix}`,
          contactName: 'Клиент',
          subject: `${T}-${suffix}`,
          createdAt: new Date(now.getTime() - ageMs),
        },
      });
    // Срок у компании — 10 часов.
    await request('fresh', 2 * HOUR); // до срока 8 ч — ни туда, ни сюда
    await request('soon', 9.5 * HOUR); // осталось полчаса
    await request('late', 11 * HOUR); // просрочено на час
    await request('late2', 30 * HOUR);
    const after = await countIntakeSla(prisma, session, now);
    expect(after.dueWithinHour - before.dueWithinHour).toBe(1);
    expect(after.overdue - before.overdue).toBe(2);
  });

  it('без права разбора очереди — нули, без запросов', async () => {
    const org = { sub: 'x', role: 'organization' } as SessionPayload;
    expect(await countIntakeSla(prisma, org, new Date())).toEqual({ dueWithinHour: 0, overdue: 0 });
  });

  it('сотрудник без компании — срок по умолчанию (24 часа)', async () => {
    const now = new Date();
    const noCo = { sub: 'x', role: 'manager' } as SessionPayload;
    const before = await countIntakeSla(prisma, noCo, now);
    // Обращение без организации видно и без компании (`organizationId: null`).
    await prisma.clientRequest.create({
      data: {
        source: 'website',
        companyName: `${T}-noorg`,
        contactName: 'Клиент',
        subject: `${T}-noorg`,
        createdAt: new Date(now.getTime() - 23.5 * HOUR),
      },
    });
    const after = await countIntakeSla(prisma, noCo, now);
    expect(after.dueWithinHour - before.dueWithinHour).toBe(1);
  });
});
