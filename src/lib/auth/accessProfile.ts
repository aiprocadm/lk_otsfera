import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

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

// Уровни охвата и capability — единый источник (схема → тип → список значений).
export const scopeLevelSchema = z.enum(['own', 'assigned', 'all']);
export type ScopeLevel = z.infer<typeof scopeLevelSchema>;
export const SCOPE_LEVELS = scopeLevelSchema.options;

export const capabilitySchema = z.enum([
  'see_commission',
  'import_1c',
  'export',
  'manage_catalog',
  'manage_users',
  'assign_orders'
]);
export type Capability = z.infer<typeof capabilitySchema>;
export const CAPABILITIES = capabilitySchema.options;

/** Типы объектов, по которым профиль задаёт охват. */
export type AccessObjectType =
  | 'orders'
  | 'organizations'
  | 'threads'
  | 'documents'
  | 'finance'
  | 'leads';

/** Денормализованное в JWT представление профиля (short enums + флаги). */
export type SessionAccessProfile = {
  id: string;
  name: string;
  orders: ScopeLevel;
  organizations: ScopeLevel;
  threads: ScopeLevel;
  documents: ScopeLevel;
  finance: ScopeLevel;
  leads: ScopeLevel;
  capabilities: Capability[];
};

export const sessionAccessProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  orders: scopeLevelSchema,
  organizations: scopeLevelSchema,
  threads: scopeLevelSchema,
  documents: scopeLevelSchema,
  finance: scopeLevelSchema,
  leads: scopeLevelSchema,
  capabilities: z.array(capabilitySchema)
});

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
export function orderWhereForLevel(session: SessionPayload, level: ScopeLevel): Prisma.OrderWhereInput {
  const floor = companyFloor(session);
  if (level === 'all') return floor;
  if (level === 'own') return { AND: [floor, { managerId: session.sub }] };
  return { AND: [floor, { organizationId: { in: session.managedOrgIds ?? [] } }] };
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
    return session.role === 'manager' && session.managerRole === 'leader';
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
    capabilities
  };
}
