import { z } from 'zod';

/**
 * Session-представление профиля доступа (трек G1): схема и типы.
 * Вынесено из accessProfile.ts, чтобы jwt.ts (которому нужна только схема
 * для валидации claims) не тянул модуль, импортирующий SessionPayload из
 * jwt.ts — это был цикл (правило no-circular, фаза 3). Публичный API прежний:
 * accessProfile.ts реэкспортирует всё отсюда.
 */

// Уровни охвата и capability — единый источник (схема → тип).
export const scopeLevelSchema = z.enum(['own', 'assigned', 'all']);
export type ScopeLevel = z.infer<typeof scopeLevelSchema>;

/**
 * Права на служебные разделы хаба «Настройки» (ТЗ 2026-08-04 §5.2). Отдельный
 * подсписок внутри общего набора capability: по нему `settingsAccess.ts`
 * отличает профиль, ничего не знающий о хабе (legacy — доступ прежний), от
 * профиля, где разделы настроек уже размечены (default-deny на остальное).
 */
export const SETTINGS_CAPABILITIES = [
  'settings.integrations.view',
  'settings.integrations.manage',
  'settings.catalogs.manage',
  'settings.access.manage',
  'settings.audit.view',
  'settings.personal_data.view',
  'settings.system.view',
] as const;
export type SettingsCapability = (typeof SETTINGS_CAPABILITIES)[number];

export const capabilitySchema = z.enum([
  'see_commission',
  'import_1c',
  'export',
  'manage_catalog',
  'manage_users',
  'assign_orders',
  ...SETTINGS_CAPABILITIES,
]);
export type Capability = z.infer<typeof capabilitySchema>;

/** Типы объектов, по которым профиль задаёт охват. */
export type AccessObjectType =
  'orders' | 'organizations' | 'threads' | 'documents' | 'finance' | 'leads' | 'tasks';

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
  tasks: ScopeLevel;
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
  tasks: scopeLevelSchema,
  capabilities: z.array(capabilitySchema),
});
