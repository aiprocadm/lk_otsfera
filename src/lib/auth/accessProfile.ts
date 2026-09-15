import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader, isStaffManagerSide } from '@/lib/auth/roleModel';

/**
 * Трек G1 — конструктор ролей. Права как данные: матрица охватов по типам
 * объектов + capability-флаги. Этот модуль — единственный источник истины для
 * session-представления профиля (`SessionAccessProfile`), его Zod-валидации,
 * резолвинга order-фильтра по уровню охвата и проверки флагов (`can`).
 *
 * Инвариант «наслоение»: профиль читается из сессии как override; при его
 * отсутствии резолверы в managerPolicy падают в legacy teamMode-путь. Здесь же
 * держится company-floor (C8): профиль не расширяет видимость за пределы компании.
 */

export {
  scopeLevelSchema,
  capabilitySchema,
  sessionAccessProfileSchema,
} from './accessProfileSchema';
export type {
  ScopeLevel,
  Capability,
  AccessObjectType,
  SessionAccessProfile,
} from './accessProfileSchema';
import {
  capabilitySchema,
  type ScopeLevel,
  type Capability,
  type SessionAccessProfile,
} from './accessProfileSchema';

/**
 * Company id-заглушка для сессии без компании: не совпадает ни с одной реальной
 * строкой → company-wide/own/assigned фильтры денаят всё (fail-safe). Единый
 * источник; managerPolicy импортирует эту же константу.
 */
export const NO_COMPANY_SENTINEL = '__no_company__';

function companyFloor(session: SessionPayload): { companyId: string } {
  return { companyId: session.companyId ?? NO_COMPANY_SENTINEL };
}

/**
 * Order-where по уровню охвата профиля, всегда с company-floor (C8):
 *  - all      → только компания;
 *  - own      → компания И managerId == session.sub;
 *  - assigned → компания И organizationId ∈ managedOrgIds.
 */
export function orderWhereForLevel(
  session: SessionPayload,
  level: ScopeLevel
): Prisma.OrderWhereInput {
  const floor = companyFloor(session);
  if (level === 'all') return floor;
  if (level === 'own') return { AND: [floor, { managerId: session.sub }] };
  return { AND: [floor, { organizationId: { in: session.managedOrgIds ?? [] } }] };
}

/**
 * Lead-where по уровню охвата профиля (Трек G2). Лиды — single-tenant team-queue
 * (см. services/manager/leads.ts): у лида нет `companyId`, company-floor не
 * применяется → `all` == team-wide (тождественно legacy-поведению без профиля).
 *  - own      → только назначенные на себя (`assignedManagerId == sub`);
 *  - assigned → свои назначенные ∪ лиды закреплённых орг (`managedOrgIds`);
 *  - all      → без фильтра (вся командная очередь).
 */
export function leadWhereForLevel(
  session: SessionPayload,
  level: ScopeLevel
): Prisma.LeadWhereInput {
  if (level === 'all') return {};
  if (level === 'own') return { assignedManagerId: session.sub };
  return {
    OR: [
      { assignedManagerId: session.sub },
      { organizationId: { in: session.managedOrgIds ?? [] } },
    ],
  };
}

/**
 * In-memory зеркало `leadWhereForLevel` для точечного guard'а (move/detail).
 * Нет профиля или `all` → team-wide (true). Не leak-аем — deny → not_found у caller.
 */
export function canSeeLead(
  session: SessionPayload,
  lead: { assignedManagerId: string | null; organizationId: string | null }
): boolean {
  const level = session.accessProfile?.leads;
  if (!level || level === 'all') return true;
  if (level === 'own') return lead.assignedManagerId === session.sub;
  // assigned
  return (
    lead.assignedManagerId === session.sub ||
    (!!lead.organizationId && (session.managedOrgIds ?? []).includes(lead.organizationId))
  );
}

/**
 * Task-where по уровню охвата профиля (Трек G3). Задачи — company-scoped (в
 * отличие от лидов), поэтому company-floor (C8) применяется как у orders:
 *  - all      → только компания;
 *  - own      → компания И (создатель ∨ исполнитель);
 *  - assigned → компания И (создатель ∨ исполнитель ∨ задача закреплённой орг).
 * Сервис берёт уровень как `session.accessProfile?.tasks ?? 'all'` → нет профиля
 * тождественно company-wide (legacy-командное поведение внутри компании).
 */
export function taskWhereForLevel(
  session: SessionPayload,
  level: ScopeLevel
): Prisma.TaskWhereInput {
  const floor = companyFloor(session);
  if (level === 'all') return floor;
  const mine: Prisma.TaskWhereInput['OR'] = [
    { createdById: session.sub },
    { assignees: { some: { userId: session.sub } } },
  ];
  if (level === 'own') return { AND: [floor, { OR: mine }] };
  // assigned
  return {
    AND: [floor, { OR: [...mine, { linkedOrganizationId: { in: session.managedOrgIds ?? [] } }] }],
  };
}

/**
 * In-memory зеркало `taskWhereForLevel` для точечного guard'а (move/detail/CRUD).
 * Задачи строго внутренние (§4): клиентские роли (partner/organization/student) не
 * видят их НИКОГДА — это отличает `canSeeTask` от `canSeeLead` (лиды авторят
 * партнёры). admin → всё (Model A). Менеджер: company-floor затем уровень охвата.
 * Deny не leak-аем — caller превращает false в not_found.
 */
export function canSeeTask(
  session: SessionPayload,
  task: {
    companyId: string;
    createdById: string;
    assigneeUserIds: string[];
    linkedOrganizationId: string | null;
  }
): boolean {
  if (session.role === 'admin') return true;
  if (!isStaffManagerSide(session)) return false;
  // company-floor (C8): чужая компания или сессия без компании — deny.
  if (!session.companyId || task.companyId !== session.companyId) return false;
  const level = session.accessProfile?.tasks;
  if (!level || level === 'all') return true;
  const mine = task.createdById === session.sub || task.assigneeUserIds.includes(session.sub);
  if (level === 'own') return mine;
  // assigned
  return (
    mine ||
    (!!task.linkedOrganizationId &&
      (session.managedOrgIds ?? []).includes(task.linkedOrganizationId))
  );
}

/**
 * Диалоги по уровню охвата профиля (`У-214`).
 *
 * Переписка — company-scoped, как задачи, но с одной своей особенностью: рядом
 * с диалогами компании всегда живёт **общая очередь ничейных** (`companyId
 * IS NULL`). Это сообщения от людей, которых система ещё не узнала; их разбирают
 * все. Поэтому очередь видна на ЛЮБОМ уровне охвата — сузить её значило бы
 * сделать так, что новое обращение не видит никто.
 *
 *  - `all`      → компания + ничейные (прежнее поведение);
 *  - `assigned` → свои (ответственный) + диалоги закреплённых организаций + ничейные;
 *  - `own`      → только свои + ничейные (`Р-3-7`).
 *
 * Уровень берётся как `session.accessProfile?.dialogs ?? 'all'`: нет профиля —
 * прежнее поведение (CLAUDE.md §2b).
 *
 * ВАЖНО: эта функция и `canSeeDialog` обязаны означать одно и то же и меняются
 * вместе — тот же инвариант, что у `dialogScopeWhere`/`isDialogInScope`.
 */
export function dialogWhereForLevel(
  session: SessionPayload,
  level: ScopeLevel
): Prisma.MessengerDialogWhereInput {
  // Ничейные — всегда: общая очередь разбора (`Р-М-3`).
  const unbound: Prisma.MessengerDialogWhereInput = { companyId: null };
  const company: Prisma.MessengerDialogWhereInput = {
    companyId: session.companyId ?? NO_COMPANY_SENTINEL,
  };
  if (level === 'all') return { OR: [company, unbound] };

  const mine: Prisma.MessengerDialogWhereInput = {
    AND: [company, { assigneeId: session.sub }],
  };
  if (level === 'own') return { OR: [mine, unbound] };

  // assigned: свои плюс переписка закреплённых организаций.
  const managed: Prisma.MessengerDialogWhereInput = {
    AND: [company, { organizationId: { in: session.managedOrgIds ?? [] } }],
  };
  return { OR: [mine, managed, unbound] };
}

/**
 * In-memory зеркало `dialogWhereForLevel` — точечная проверка уже загруженного
 * диалога (карточка, назначение, отправка). Deny не раскрывается: вызывающий
 * превращает `false` в `not_found`.
 */
export function canSeeDialog(
  session: SessionPayload,
  dialog: {
    companyId: string | null;
    assigneeId: string | null;
    organizationId: string | null;
  }
): boolean {
  if (session.role === 'admin') return true;
  if (!isStaffManagerSide(session)) return false;
  // Ничейный диалог видят все сотрудники — это общая очередь.
  if (dialog.companyId === null) return true;
  // company-floor (C8): чужая компания или сессия без компании — deny.
  if (!session.companyId || dialog.companyId !== session.companyId) return false;
  const level = session.accessProfile?.dialogs;
  if (!level || level === 'all') return true;
  const mine = dialog.assigneeId === session.sub;
  if (level === 'own') return mine;
  // assigned
  return (
    mine ||
    (!!dialog.organizationId && (session.managedOrgIds ?? []).includes(dialog.organizationId))
  );
}

/**
 * Проверка capability-флага.
 *  - admin       → всегда true (Model A);
 *  - есть профиль → default-deny: флаг должен присутствовать явно;
 *  - нет профиля → legacy backward-compat: сегодня комиссию видит только leader
 *    (admin — выше), прочие флаги без профиля ни к кому не привязаны → deny.
 * Тождество для no-profile: `can(session,'see_commission')` == `unscoped || isManagerLeader`.
 */
export function can(session: SessionPayload, capability: Capability): boolean {
  if (session.role === 'admin') return true;
  if (session.accessProfile) return session.accessProfile.capabilities.includes(capability);
  if (capability === 'see_commission') {
    return isManagerLeader(session);
  }
  return false;
}

/** Структурная форма строки AccessProfile, денормализуемой в сессию при логине. */
export type AccessProfileRow = {
  id: string;
  name: string;
  ordersScope: ScopeLevel;
  organizationsScope: ScopeLevel;
  threadsScope: ScopeLevel;
  documentsScope: ScopeLevel;
  financeScope: ScopeLevel;
  leadsScope: ScopeLevel;
  tasksScope: ScopeLevel;
  dialogsScope: ScopeLevel;
  capabilities: string[];
};

/**
 * Маппит строку БД в session-представление: `*Scope` → короткие ключи, и
 * фильтрует `capabilities` через схему (мусор/устаревшие флаги отбрасываются —
 * default-deny на входе в сессию).
 */
export function toSessionAccessProfile(row: AccessProfileRow): SessionAccessProfile {
  const capabilities = row.capabilities.filter(
    (c): c is Capability => capabilitySchema.safeParse(c).success
  );
  return {
    id: row.id,
    name: row.name,
    orders: row.ordersScope,
    organizations: row.organizationsScope,
    threads: row.threadsScope,
    documents: row.documentsScope,
    finance: row.financeScope,
    leads: row.leadsScope,
    tasks: row.tasksScope,
    dialogs: row.dialogsScope,
    capabilities,
  };
}
