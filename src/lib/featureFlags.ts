/**
 * Env-driven feature flags. Read points:
 *   - src/middleware.ts: returns 404 for protected feature prefixes
 *   - src/lib/navigation/cabinet.ts: hides menu items
 *   - route handlers: requireFeature() to hard-block API access
 *
 * Convention: `FEATURE_<UPPER_SNAKE>` env, defaulting to **enabled** when
 * unset. Disable by setting the env to `0` / `false` / `off`.
 *
 * Default-true matters for safety: if an operator forgets to set the env
 * during rollout, the feature stays on rather than silently disappearing.
 * Opt-out > opt-in for production environments.
 */

export const FEATURE_FLAGS = [
  'partner_leads',
  'commission_pdf',
  'commission_xlsx',
  'pwa_installer',
  'organization_cabinet',
  'manager_cabinet',
  'leader_cabinet',
  'chat',
  'enrollment_requests',
  // Трек D: каналы уведомлений. Не route-флаги — точки чтения: транспорт
  // (isMaxEnabled/isWhatsAppEnabled → канал+диспетчер), settings-UI (карточка),
  // webhook/binding-роуты (notFoundIfDisabled). Middleware/nav неприменимы.
  'max_channel',
  'whatsapp_channel',
  // Трек D5: доставка уведомлений через воркер (BullMQ) вместо inline.
  // Точка чтения одна — диспетчер (dispatchToRecipient). Требует REDIS_URL.
  'notif_queue',
  // Трек G1: конструктор ролей (UI). Гейтит /leader/roles + /admin/roles.
  'role_constructor',
  // Трек G2: воронка продаж / канбан. Гейтит /leader/funnel + /manager/funnel.
  'sales_funnel',
  // M3: аналитика руководителя (план/факт продаж). Гейтит /leader/analytics
  // (middleware FEATURE_PREFIXES + nav-пункт + page notFound-гейт).
  'leader_analytics',
  // Трек G3: внутренние задачи / канбан. Гейтит /manager/tasks + /leader/tasks.
  'internal_tasks',
  // PR-A: омниканальный инбокс. Гейтит /manager/inbox (экран построен: src/app/manager/inbox).
  'inbound_messaging',
  // PR-B: телефония Mango. Гейтит /manager/calls (экран построен: src/app/manager/calls).
  'telephony_mango',
  // 2FA сотрудников (email-код). Поведенческий флаг (не route): точки чтения —
  // login/verify/resend-роуты + секция настроек. Спека 2026-07-11-staff-2fa.
  'staff_2fa',
  // §25.7: журнал доступа сотрудников к ПДн. Поведенческий opt-out флаг —
  // комплаенс-механизм не может быть opt-in (забытый env = журнал молча не
  // ведётся). Точки чтения: recordPiiAccess (no-op при off) + баннер на
  // /admin/pii-access. Выключение = пауза журнала, только на время инцидента.
  'pii_access_log',
  // M2: справочник контактов + карточки. Route-флаг: три точки (middleware/nav/route)
  // добавляются в PR-B вместе с /manager/contacts. В PR-A гейтит триаж-действия.
  'contacts',
  // M4: внутренний чат сотрудников. Поведенческий флаг (не route): точки чтения —
  // секции «Чат команды» на /manager/messages и /admin/messages (isFeatureEnabled),
  // все /api/staff-chat/* хендлеры (notFoundIfDisabled), staff-бейдж непрочитанного.
  // Спека 2026-07-17-m4-staff-chat.
  'staff_chat',
  // M5: календарь сотрудников. Route-флаг: nav (`flag:`), page-гейты
  // /manager/calendar + /leader/calendar (notFound), server-actions calendar
  // (isFeatureEnabled → forbidden). Middleware-точки нет — прецедент internal_tasks.
  // Спека 2026-07-17-m5-calendar-design.
  'staff_calendar',
  // M6: глобальный поиск (staff). Route-флаг: nav («Поиск» manager/leader),
  // page-гейты /manager/search + /leader/search (notFound), сервис-гейт
  // globalSearch (forbidden). Middleware-точки нет — прецедент internal_tasks.
  // Спека 2026-07-18-m6-global-search-design.
  'global_search',
  // Этап 3 (Модуль 6): реестры удостоверений клиентов. Route-флаг: middleware
  // (/organization/certificates, /partner/certificates), nav «Удостоверения»,
  // page-гейты реестров и карточки сотрудника, KPI-карточки дашбордов.
  // Спека 2026-07-24-stage3-certificates-registry-design.
  'certificates_registry',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/**
 * Opt-in flags default to **disabled** — they must be explicitly enabled with
 * env=1 / true / on. The rest of FEATURE_FLAGS keep the opt-out (default-true)
 * convention. Use sparingly: only for dark-launch / staged-rollout features.
 */
const OPT_IN_FLAGS = new Set<FeatureFlag>([
  'organization_cabinet',
  'manager_cabinet',
  'leader_cabinet',
  'chat',
  'enrollment_requests',
  'max_channel',
  'whatsapp_channel',
  'notif_queue',
  'role_constructor',
  'sales_funnel',
  'leader_analytics',
  'internal_tasks',
  'inbound_messaging',
  'telephony_mango',
  'staff_2fa',
  'contacts',
  'staff_chat',
  'staff_calendar',
  'global_search',
  'certificates_registry',
]);

/**
 * Тип флага для read-only матрицы на /admin/settings (ФТ-14.6): opt-in флаги
 * включаются явно (env=1), остальные включены по умолчанию (opt-out).
 */
export function isOptInFlag(flag: FeatureFlag): boolean {
  return OPT_IN_FLAGS.has(flag);
}

/** Имя env-переменной флага — для отображения в матрице (значения не показываются). */
export function featureFlagEnvVar(flag: FeatureFlag): string {
  return envKey(flag);
}

export class FeatureDisabledError extends Error {
  constructor(public flag: FeatureFlag) {
    super(`Feature disabled: ${flag}`);
    this.name = 'FeatureDisabledError';
  }
}

function envKey(flag: FeatureFlag): string {
  return `FEATURE_${flag.toUpperCase()}`;
}

const FALSY_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);
const TRUTHY_VALUES = new Set(['1', 'true', 'on', 'yes', 'enabled']);

/**
 * Returns true unless the corresponding env explicitly disables the flag.
 * Reads `process.env` on every call so tests can flip values without
 * restarting the module — see src/__tests__/featureFlags.test.ts.
 *
 * Opt-in flags (see OPT_IN_FLAGS) invert the logic: unset/empty env means
 * disabled, and only an explicit truthy value enables them.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[envKey(flag)];
  const isOptIn = OPT_IN_FLAGS.has(flag);
  if (raw === undefined || raw === '') return !isOptIn;
  const normalized = raw.trim().toLowerCase();
  if (isOptIn) return TRUTHY_VALUES.has(normalized);
  return !FALSY_VALUES.has(normalized);
}

/**
 * Hard gate for route handlers. Throws `FeatureDisabledError` when the
 * flag is off; callers either let it surface (becomes 500) or catch it
 * and return a 404.
 */
export function requireFeature(flag: FeatureFlag): void {
  if (!isFeatureEnabled(flag)) {
    throw new FeatureDisabledError(flag);
  }
}

/**
 * Cheap helper for callers that want to translate a flag check into a
 * Next response. Returns null when the flag is enabled (caller continues).
 */
export function notFoundIfDisabled(flag: FeatureFlag): Response | null {
  if (isFeatureEnabled(flag)) return null;
  return new Response('Not Found', { status: 404 });
}
