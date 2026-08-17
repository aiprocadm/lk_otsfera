import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { orderWhereForLevel, NO_COMPANY_SENTINEL } from '@/lib/auth/accessProfile';

/**
 * Manager RBAC primitives — three-way visibility OR:
 *   1. Per-order: `Order.managerId == session.sub`
 *   2. Per-org:   `Order.organizationId` ∈ session.managedOrgIds
 *   3. Historical: this user ever commented on the order
 *
 * `managedOrgIds` is populated by the session loader (Task 4 of the
 * manager-cabinet plan) from the `OrganizationManager` table.
 */

export function managedOrgIds(session: SessionPayload): string[] {
  return session.managedOrgIds ?? [];
}

export function managerOrderScopeFilter(session: SessionPayload): Prisma.OrderWhereInput {
  return {
    OR: [
      { managerId: session.sub },
      { organizationId: { in: managedOrgIds(session) } },
      { comments: { some: { authorId: session.sub } } },
    ],
  };
}

export function managerDocumentScopeFilter(session: SessionPayload): Prisma.DocumentWhereInput {
  return {
    order: managerOrderScopeFilter(session),
    scanStatus: { not: 'infected' },
  };
}

export function managerOrgScopeFilter(session: SessionPayload): Prisma.OrganizationWhereInput {
  return { id: { in: managedOrgIds(session) } };
}

export function canSeeOrder(
  session: SessionPayload,
  order: {
    managerId: string | null;
    organizationId: string | null;
    companyId?: string | null;
    commentsCountByMe?: number;
  },
  /**
   * Режим видимости команды (C8). **Аргумент обязателен намеренно.** Раньше у
   * него было значение по умолчанию `false`, и забытый аргумент молча сужал
   * выборку до «свои заказы» — ошибка проходила и типы, и ревью (CLAUDE.md §4
   * предупреждал об этом словами). Теперь пропуск ловит компилятор.
   *
   * Ролям, у которых команды нет (заказчик, партнёр), передавайте `false`
   * явно — это видно в коде и не выглядит забывчивостью.
   */
  teamMode: boolean
): boolean {
  // G1: профиль имеет приоритет над teamMode. Company-floor (C8) — первым:
  // профиль не пускает за пределы своей компании (companyId отсутствует/чужой → deny).
  const level = session.accessProfile?.orders;
  if (level) {
    if (!session.companyId || order.companyId !== session.companyId) return false;
    if (level === 'all') return true;
    if (level === 'own') return order.managerId === session.sub;
    // assigned
    return !!order.organizationId && managedOrgIds(session).includes(order.organizationId);
  }
  // Legacy (нет профиля) — без изменений.
  if (teamMode) return !!session.companyId && order.companyId === session.companyId;
  if (order.managerId === session.sub) return true;
  if (order.organizationId && managedOrgIds(session).includes(order.organizationId)) return true;
  if ((order.commentsCountByMe ?? 0) > 0) return true;
  return false;
}

export function canSeeDocument(
  session: SessionPayload,
  doc: {
    order: { managerId: string | null; organizationId: string | null; companyId?: string | null };
  },
  /** Обязателен по той же причине, что у `canSeeOrder`. */
  teamMode: boolean
): boolean {
  return canSeeOrder(session, doc.order, teamMode);
}

export function canSeeOrganization(session: SessionPayload, orgId: string): boolean {
  return managedOrgIds(session).includes(orgId);
}

export const isOrgInScope = canSeeOrganization;

// ----- C8: company-wide mode + G1: profile-first ----------------------------
// NO_COMPANY_SENTINEL импортируется из accessProfile.ts (единый источник).

/** Company-wide order filter: every order in the manager's own company. */
export function companyWideOrderFilter(session: SessionPayload): Prisma.OrderWhereInput {
  // Order.companyId is required, so an impossible value denies all (fail-safe).
  return { companyId: session.companyId ?? NO_COMPANY_SENTINEL };
}

/**
 * Resolver: профиль-первым, teamMode-fallback. Сигнатура не меняется — все
 * существующие call-site'ы работают без правок; сессия без профиля даёт
 * legacy-поведение байт-в-байт (регресс C/F зелёный).
 */
export function managerOrderScope(
  session: SessionPayload,
  teamMode: boolean
): Prisma.OrderWhereInput {
  const level = session.accessProfile?.orders;
  if (level) return orderWhereForLevel(session, level);
  return teamMode ? companyWideOrderFilter(session) : managerOrderScopeFilter(session);
}

export function managerDocumentScope(
  session: SessionPayload,
  teamMode: boolean
): Prisma.DocumentWhereInput {
  const level = session.accessProfile?.documents;
  const orderWhere = level
    ? orderWhereForLevel(session, level)
    : managerOrderScope(session, teamMode);
  return { order: orderWhere, scanStatus: { not: 'infected' } };
}

export function managerOrgScope(
  session: SessionPayload,
  teamMode: boolean
): Prisma.OrganizationWhereInput {
  const level = session.accessProfile?.organizations;
  if (level) {
    const companyOnly = { companyId: session.companyId ?? NO_COMPANY_SENTINEL };
    if (level === 'all') return companyOnly;
    // assigned/own → закреплённые орги, всё равно ограниченные компанией (C8-пол).
    return { AND: [companyOnly, managerOrgScopeFilter(session)] };
  }
  return teamMode
    ? { companyId: session.companyId ?? NO_COMPANY_SENTINEL }
    : managerOrgScopeFilter(session);
}

/**
 * «Это руководитель?» — понимает ОБЕ модели (программа «роль Руководитель»,
 * ТЗ 2026-08-17, Р-Л-2): новую top-level роль `leader` и старую пару
 * `manager + managerRole='leader'` (токены живут 7 дней после миграции
 * данных в PR-3). Старая половина условия снимается PR-4 вместе с колонкой
 * `managerRole`. Имя оставлено прежним — у предиката ~36 вызовов.
 */
export function isManagerLeader(session: SessionPayload): boolean {
  return (
    session.role === 'leader' ||
    (session.role === 'manager' && session.managerRole === 'leader')
  );
}

/**
 * «Сотрудник менеджерского контура?» (Р-Л-4, шаблон 1): рядовой менеджер ИЛИ
 * руководитель — в любой из двух моделей. Единая точка для мест вида
 * `role === 'manager'`, где смысл — контур, а не именно рядовой: без хелпера
 * ~99 таких мест при выделении роли разбирались бы по одному и часть — неверно.
 */
export function isStaffManagerSide(session: SessionPayload): boolean {
  return session.role === 'manager' || session.role === 'leader';
}

/**
 * Право на импорт из 1С — Excel-файл и банковская выписка.
 *
 * **Решение заказчика 11.08.2026: импорт доступен администратору,
 * руководителю И обычному менеджеру.** Прежнее правило (Т-25/Т-26, решение
 * владельца №2) пускало только первых двух — оно отменено; тесты-стражи под
 * него переписаны, а не «починены» откатом кода.
 *
 * Разрешение НЕ означает одинаковых возможностей: границу режет
 * `importScope` и писатели.
 *  - admin — вся система;
 *  - руководитель — своя компания;
 *  - обычный менеджер — только закреплённые за ним организации, и **создать
 *    новую организацию он не может** (это молча расширило бы его скоуп) —
 *    такие строки уходят в очередь ручного разбора.
 *
 * Единственная точка правды: раньше предикат был продублирован `isStaff()` по
 * сервисам и разошёлся со скоупом.
 */
export function mayImportOneC(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

/**
 * Лидер открывает любой заказ СВОЕЙ компании (инвариант C8: граница — компания).
 * companyId=null у лидера → false (деградирует в обычный scoped-путь, не deny-all).
 * Расширяет деталь заказа и держит scope-gate самозабора (claimOrder в
 * distribution.ts зеркалит getOrder этой же границей), НЕ списки.
 */
export function isLeaderSameCompany(
  session: SessionPayload,
  orderCompanyId: string | null | undefined
): boolean {
  return isManagerLeader(session) && !!session.companyId && orderCompanyId === session.companyId;
}

/**
 * The single DB read of the live toggle. Returns false when companyId is absent
 * — so a null-company manager can never reach the company-wide branch and simply
 * keeps the scoped model (NOT denied-all). The lookup is an indexed single-column read; callers MAY memoize per request,
 * but none currently do (the cost is negligible).
 */
export async function getCompanyTeamVisibility(
  prisma: PrismaClient,
  companyId: string | null | undefined
): Promise<boolean> {
  if (!companyId) return false;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { managerTeamVisibility: true },
  });
  return company?.managerTeamVisibility ?? false;
}

/**
 * Mode-aware предикат «менеджер имеет доступ к организации» (C8): при
 * `managerTeamVisibility=ON` граница — компания, при OFF — персональный скоуп
 * `managedOrgIds`. Тот же вывод, что у страничного гарда `requireManagerForOrg`,
 * но без redirect — для API-роутов (этап 9 PR-3: выгрузки из карточки).
 *
 * **Лидер-инвариант C8 (решение заказчика 29.07.2026).** Руководитель
 * открывает карточку ЛЮБОЙ организации своей компании независимо от
 * закрепления — так же, как он уже открывает любой её заказ
 * (`requireManagerForOrder`). До этого правило применялось только к заказам, и
 * руководитель без закреплённых организаций не мог ни открыть карточку, ни
 * заполнить настраиваемые поля §11, хотя §4 ТЗ даёт ему настройку полей.
 *
 * Граница компании держится в обоих режимах: `companyId=null` в сессии или
 * чужая компания у организации → отказ.
 */
export async function canManagerAccessOrg(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<boolean> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const companyWide = teamMode || isManagerLeader(session);
  if (!companyWide) return isOrgInScope(session, orgId);
  if (!session.companyId) return false;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { companyId: true },
  });
  return !!org && org.companyId === session.companyId;
}
