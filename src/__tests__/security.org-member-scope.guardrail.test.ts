import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { readSource } from './helpers/source';

vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));

import { canSeeOrder, memberOrderScope } from '@/lib/auth/organizationPolicy';
import { listOrgOrders, getOrgOrder } from '@/lib/services/organization/orders';
import { attention, kpis, recentEvents } from '@/lib/services/organization/dashboard';
import { postOrderComment } from '@/lib/services/comments/post';
import {
  getOrgFinanceKpis,
  listOrgPayments,
  listOrgPaymentsForExport,
} from '@/lib/services/organization/finance';
import { listOrgInvoices } from '@/lib/services/organization/invoices';

/**
 * СТРАЖ `У-236` (решение `Р-Э6-2`): при включённой настройке участник
 * организации не видит чужой заказ ни списком, ни карточкой, ни счётчиками
 * главной; администратор и руководитель видят всё; при выключенной настройке
 * всё как раньше.
 *
 * Скоуп обязан жить в ВЫБОРКЕ, а не в разметке: скрытая строка списка — это
 * внешний вид, а не защита (§4). Поэтому страж проверяет и поведение сервисов,
 * и то, что счётчики главной вообще получают границу.
 *
 * Мутации (проверено): снять проверку границы в `comments/post.ts` → «комментарий
 * к чужому заказу»; убрать `scope.where` из `listOrgOrders` → «список сужен»;
 * вернуть `findUnique` без скоупа в `getOrgOrder` → «карточка сужена»; снять
 * третий аргумент `canSeeOrder` (сделать его необязательным) → падает сборка;
 * убрать `scope` из счётчиков главной → «главная спрашивает границу»; снять фильтр
 * в `listOrgPayments` → «деньги показывают только свои заказы».
 */
const SRC = join(process.cwd(), 'src');
const DASHBOARD = readSource(join(SRC, 'lib/services/organization/dashboard.ts'));
const ORDERS_PAGE = readSource(join(SRC, 'app/organization/orders/page.tsx'));
const DASHBOARD_PAGE = readSource(join(SRC, 'app/organization/dashboard/page.tsx'));
const FINANCE_PAGE = readSource(join(SRC, 'app/organization/finance/page.tsx'));
const FINANCE_EXPORT = readSource(join(SRC, 'app/api/organization/finance/export/route.ts'));

const member = {
  sub: 'u1',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'o1', roleInOrg: 'member', isActive: true }],
} as unknown as SessionPayload;

function db(rows: unknown[] = []) {
  const prisma = {
    order: {
      count: vi.fn(async () => rows.length),
      findMany: vi.fn(async () => rows),
      findFirst: vi.fn(async () => null),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma as any };
}

describe('страж: участник видит только свои заказы (У-236)', () => {
  it('список сужен границей участника, а поиск её не затирает', async () => {
    const scope = memberOrderScope(member, 'o1', true);
    const { prisma, raw } = db();
    await listOrgOrders(prisma, { organizationId: 'o1', scope, search: 'ремонт' });
    const where = raw.order.findMany.mock.calls[0][0].where;
    // Обе половины стоят рядом в `AND`: одним объектом второй `OR` затёр бы первый.
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual(scope!.where);
    expect(where.organizationId).toBe('o1');
  });

  it('без ограничения список остаётся прежним', async () => {
    const { prisma, raw } = db();
    await listOrgOrders(prisma, { organizationId: 'o1', scope: null });
    expect(raw.order.findMany.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it('карточка ищется В ГРАНИЦЕ: чужой заказ не читается вовсе', async () => {
    const scope = memberOrderScope(member, 'o1', true);
    const { prisma, raw } = db();
    expect(await getOrgOrder(prisma, 'o1', 'ord-1', scope)).toBeNull();
    expect(raw.order.findFirst.mock.calls[0][0].where).toEqual({
      AND: [{ id: 'ord-1' }, scope!.where],
    });
    expect(raw.order.findUnique).toBeUndefined();
  });

  it('право проверяется третьим аргументом, а не «по умолчанию»', () => {
    // Сигнатура обязана требовать `restricted`: значение по умолчанию молча
    // открыло бы участнику чужие заказы (урок `teamMode`, §4).
    expect(canSeeOrder.length).toBe(3);
    expect(canSeeOrder(member, { organizationId: 'o1', ownedByViewer: false }, true)).toBe(false);
  });

  it('счётчики и «Требует внимания» кладут границу в КАЖДЫЙ запрос заказов', async () => {
    // Подпись с `scope` ничего не доказывает: аргумент можно принять и не
    // использовать. Поэтому проверяется то, что реально уходит в базу.
    const scope = memberOrderScope(member, 'o1', true)!;
    const orderCount = vi.fn(async () => 0);
    const orderAggregate = vi.fn(async () => ({ _sum: {} }));
    const orderFindMany = vi.fn(async () => []);
    const documentFindMany = vi.fn(async () => []);
    const prisma = {
      order: { count: orderCount, aggregate: orderAggregate, findMany: orderFindMany },
      student: { count: vi.fn(async () => 0) },
      document: { count: vi.fn(async () => 0), findMany: documentFindMany },
    } as unknown as PrismaClient;

    await kpis(prisma, 'o1', scope);
    for (const call of [orderCount.mock.calls[0], orderAggregate.mock.calls[0]] as unknown as Array<
      [{ where: { OR?: unknown } }]
    >) {
      expect(call[0].where.OR).toEqual(scope.where.OR);
    }

    await attention(prisma, 'o1', scope);
    const orderWheres = (
      orderFindMany.mock.calls as unknown as Array<[{ where: { OR?: unknown } }]>
    ).map((c) => c[0].where.OR);
    expect(orderWheres.length, 'запросы заказов пропали — страж охранял бы пустоту').toBe(2);
    for (const or of orderWheres) expect(or).toEqual(scope.where.OR);
    // Акты чужих заказов — та же утечка: в них видны номер и название.
    const docWhere = (
      documentFindMany.mock.calls as unknown as Array<[{ where: { order?: unknown } }]>
    )[0]![0].where.order;
    expect(docWhere).toEqual(scope.where);
  });

  it('лента событий сужается по всем четырём источникам', async () => {
    const scope = memberOrderScope(member, 'o1', true)!;
    const documentFindMany = vi.fn(async () => []);
    const paymentFindMany = vi.fn(async () => []);
    const commentFindMany = vi.fn(async () => []);
    const queryRaw = vi.fn(async () => []);
    const prisma = {
      document: { findMany: documentFindMany },
      payment: { findMany: paymentFindMany },
      comment: { findMany: commentFindMany },
      $queryRaw: queryRaw,
    } as unknown as PrismaClient;

    await recentEvents(prisma, 'o1', 5, scope);
    const where = (m: typeof documentFindMany) =>
      (m.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>)[0]![0].where;
    expect(where(documentFindMany).order).toEqual(scope.where);
    expect(where(paymentFindMany).order).toEqual(scope.where);
    expect(where(commentFindMany).order).toMatchObject({
      organizationId: 'o1',
      OR: scope.where.OR,
    });
    // Смены статуса — raw-запрос: сужается идентификатором зрителя, а не
    // пост-фильтром (иначе события коллег вытеснили бы свои из окна).
    const rawArgs = queryRaw.mock.calls[0] as unknown as unknown[];
    // Окно выборки — не меньше 20 строк (`fetchLimit` сервиса), важна не цифра,
    // а то, что зритель попал в оба места условия.
    expect(rawArgs.slice(1)).toEqual(['o1', scope.viewerUserId, scope.viewerUserId, 20]);
    expect(String(rawArgs[0])).toContain('LEFT JOIN "Contact"');
  });

  it('комментарий к чужому заказу отклоняется, а не пишется', async () => {
    // Второй путь к заказу: лента комментариев. Проверка членства тут была, а
    // границы участника не было — участник писал в чужой заказ по прямой
    // ссылке. Гард живёт в сервисе, потому что роут только мапит код в статус.
    const commentCreate = vi.fn();
    const prisma = {
      order: {
        findUnique: vi.fn(async () => ({
          id: 'ord-1',
          organizationId: 'o1',
          organization: { name: 'Ромашка', membersSeeOwnOrdersOnly: true },
          primaryContact: { userId: 'u-другой' },
          promotedFromLead: null,
        })),
      },
      comment: { create: commentCreate },
    } as unknown as PrismaClient;

    const res = await postOrderComment(prisma, member, { orderId: 'ord-1', body: 'привет' });
    expect(res).toEqual({ ok: false, error: 'access_denied' });
    expect(commentCreate, 'комментарий всё-таки записан в чужой заказ').not.toHaveBeenCalled();
  });

  it('деньги показывают только свои заказы: платежи, счета, показатели, выгрузка', async () => {
    // Платёж и счёт называют номер и сумму заказа. Оставить «Финансы» общими —
    // значит отдать участнику ровно то, что спрятано в списке заказов.
    const scope = memberOrderScope(member, 'o1', true)!;
    const paymentFindMany = vi.fn(async () => []);
    const paymentCount = vi.fn(async () => 0);
    const documentFindMany = vi.fn(async () => []);
    const orderFindMany = vi.fn(async () => []);
    const prisma = {
      payment: { findMany: paymentFindMany, count: paymentCount },
      document: { findMany: documentFindMany },
      order: { findMany: orderFindMany },
    } as unknown as PrismaClient;
    const where = (m: { mock: { calls: unknown[] } }) =>
      (m.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>)[0]![0].where;

    await listOrgPayments(prisma, { organizationId: 'o1', scope });
    expect(where(paymentFindMany).order, 'платежи чужих заказов видны').toEqual(scope.where);

    await listOrgPaymentsForExport(prisma, { organizationId: 'o1', limit: 10, scope });
    expect(where(paymentCount).order, 'хвост «N из M» считает чужие').toEqual(scope.where);

    await listOrgInvoices(prisma, { organizationId: 'o1', scope });
    expect(where(documentFindMany).order, 'счета чужих заказов видны').toEqual(scope.where);

    await getOrgFinanceKpis(prisma, 'o1', scope);
    expect((where(orderFindMany) as { OR?: unknown }).OR, 'итоги считают всё').toEqual(
      scope.where.OR
    );
  });

  it('счётчики и ленты главной получают границу (страж по исходнику)', () => {
    for (const fn of ['export async function kpis', 'export async function attention']) {
      const at = DASHBOARD.indexOf(fn);
      expect(at, `${fn}: функция пропала`).toBeGreaterThan(-1);
      expect(DASHBOARD.slice(at, at + 400)).toContain('scope: OrgOrderScope');
    }
    expect(DASHBOARD).toContain('orderStatusEvents(prisma, organizationId, scope?.viewerUserId');
    // Страницы обязаны эту границу посчитать и передать.
    expect(ORDERS_PAGE).toContain('orgOrderScope(');
    expect(DASHBOARD_PAGE).toContain('orgOrderScope(');
    // Выгрузка обязана показывать то же, что экран: иначе граница обходится
    // одной кнопкой «Скачать». Мало посчитать границу — её надо ПЕРЕДАТЬ:
    // проверяем сам вызов, иначе подмена на `null` прошла бы мимо стража.
    expect(FINANCE_PAGE).toContain('orgOrderScope(');
    expect(FINANCE_PAGE).toContain('getOrgFinanceKpis(prisma, ctx.activeOrgId, scope)');
    expect(FINANCE_EXPORT).toContain('orgOrderScope(');
    expect(FINANCE_EXPORT).toContain('getPaymentsExportData(prisma, organizationId, scope)');
    expect(DASHBOARD_PAGE).toContain('kpis(prisma, ctx.activeOrgId, scope)');
  });
});
