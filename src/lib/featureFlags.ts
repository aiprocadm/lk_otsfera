import { cachedFeatureFlagValue } from './config/featureFlagStore';

/**
 * Feature-флаги. Источник значения — база (если задано в интерфейсе), иначе
 * переменная окружения, иначе умолчание (`У-66`). Read points:
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
  // Телефония Mango. `У-124` (решение `Р-24`): ПОВЕДЕНЧЕСКИЙ флаг, не route —
  // снят с `FEATURE_PREFIXES`, чтобы его можно было включить из интерфейса
  // (edge-middleware базы не видит). Точки чтения: страница
  // `/manager/calls` (`notFoundIfDisabled`), пункт меню, гарды роутов
  // `/api/manager/calls*` и вебхука Mango, вкладка «Звонки» карточки
  // организации, деталки заказов и `deal-activity`.
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
  // Этап 5 (Модуль 1): заявки клиентов (ClientRequest). Route-флаг: middleware
  // (/partner/requests, /organization/requests, /manager/requests, /leader/requests,
  // /admin/requests), nav-пункты, page/route-гейты; под ним же живёт redirect
  // Этап 10: домен лидов удалён из клиентских кабинетов (ТЗ §3.2).
  // Спека 2026-07-24-stage5-client-requests-design.
  'client_requests',
  // Этап 6 (Модуль 4): канбан сделок менеджера/руководителя. Route-флаг: middleware
  // (/manager/deals, /leader/deals), nav «Сделки» (manager, leader), page-гейты
  // (notFound). ВНИМАНИЕ: заказы партнёра (/partner/orders, до `У-109` —
  // /partner/deals) — другой домен и под этим флагом НЕ живут.
  // Спека 2026-07-25-stage6-deals-kanban.
  'deals_pipeline',
  // Этап 7 (ФТ-8.1): экран «Входящие в работу» (route-флаг: middleware + nav + page).
  'intake_inbox',
  // Этап 8 (ФТ-9.4): выпуск документов по заказу. Поведенческий флаг (не route):
  // точки чтения — деталка заказа во ВСЕХ ТРЁХ кабинетах сотрудников (панель
  // «Документы по заказу»), server-action выпуска и запроса реквизитов, роут
  // предпросмотра. `У-144` этапа 6: флаг переведён в **opt-out** (включён по
  // умолчанию) — выпуск документов давно не эксперимент, а основная работа, и
  // держать его выключенным значило бы прятать половину кабинета.
  'document_generation',
  // Этап 9 (ФТ-11.1): кнопка «Задать вопрос» в кабинетах. Поведенческий флаг
  // (не route): точки чтения — шеллы partner/organization и POST /api/support/question.
  'cabinet_questions',
  // ТЗ 2026-08-04: хаб «Настройки» в кабинетах сотрудников. Поведенческий
  // opt-in флаг (НЕ route): точки чтения — состав сайдбара (admin/leader) и
  // тонкие шлюзы на старых маршрутах (флаг ON → redirect в хаб, OFF → прежняя
  // страница на месте). В FEATURE_PREFIXES middleware намеренно НЕ добавлен:
  // новые пути обязаны отвечать всегда, иначе редирект уводил бы на 404.
  // Снимается после приёмки. Спека 2026-08-04-settings-hub-design.
  'settings_hub',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/**
 * Пути, которые middleware закрывает флагом. **Единственный источник правды**
 * и для гейта, и для экрана управления флагами (`У-65`): флаг из этого списка
 * читается в edge-среде, где базы нет, поэтому переключать его из интерфейса
 * нельзя — см. `isRouteGatedFlag`.
 */
export const FEATURE_PREFIXES: Array<{ prefix: string; flag: FeatureFlag }> = [
  { prefix: '/partner/messages', flag: 'chat' },
  { prefix: '/organization/messages', flag: 'chat' },
  // T5: every enrollment surface dark-launches together under one flag (the
  // cabinet-level flags below still apply additively via their own prefixes).
  { prefix: '/partner/enrollments', flag: 'enrollment_requests' },
  { prefix: '/organization/enrollments', flag: 'enrollment_requests' },
  { prefix: '/manager/enrollments', flag: 'enrollment_requests' },
  { prefix: '/leader/enrollments', flag: 'enrollment_requests' },
  { prefix: '/admin/enrollments', flag: 'enrollment_requests' },
  // Этап 5 (Модуль 1): заявки клиентов — единый тёмный запуск всех поверхностей.
  { prefix: '/partner/requests', flag: 'client_requests' },
  { prefix: '/organization/requests', flag: 'client_requests' },
  { prefix: '/manager/requests', flag: 'client_requests' },
  { prefix: '/leader/requests', flag: 'client_requests' },
  { prefix: '/admin/requests', flag: 'client_requests' },
  { prefix: '/organization', flag: 'organization_cabinet' },
  { prefix: '/manager', flag: 'manager_cabinet' },
  { prefix: '/leader', flag: 'leader_cabinet' },
  // G1: конструктор ролей — отдельный флаг поверх кабинетных префиксов (additive).
  { prefix: '/leader/roles', flag: 'role_constructor' },
  { prefix: '/admin/roles', flag: 'role_constructor' },
  // ТЗ 2026-08-04: конструктор ролей переехал в хаб «Настройки» — гейтим и
  // новые адреса (старые остаются: под выключенным settings_hub они живые).
  { prefix: '/leader/settings/access/roles', flag: 'role_constructor' },
  { prefix: '/admin/settings/access/roles', flag: 'role_constructor' },
  // G2: воронка продаж / канбан.
  { prefix: '/leader/funnel', flag: 'sales_funnel' },
  { prefix: '/manager/funnel', flag: 'sales_funnel' },
  // M3: аналитика руководителя (план/факт продаж) — additive sub-prefix поверх /leader.
  { prefix: '/leader/analytics', flag: 'leader_analytics' },
  // G3: внутренние задачи / канбан.
  { prefix: '/manager/tasks', flag: 'internal_tasks' },
  { prefix: '/leader/tasks', flag: 'internal_tasks' },
  // PR-A: омниканальный инбокс (экран придёт отдельной задачей).
  { prefix: '/manager/inbox', flag: 'inbound_messaging' },
  // `У-124` (решение `Р-24`, дефект `Д-38`): телефония Mango СНЯТА с
  // edge-гейта и стала поведенческим флагом. Причина — edge-middleware не
  // видит базу: выключить флаг из интерфейса получалось, а включить нет, и
  // переключатель создавал иллюзию управления. Взамен раздел закрывают три
  // серверные точки: страница (`notFoundIfDisabled`), пункт меню и гарды
  // роутов `/api/manager/calls*`. Осознанное отступление от «трёх точек»
  // §5 CLAUDE.md ровно для одного флага — остальные route-флаги не трогаем.
  // Этап 3 (Модуль 6): клиентские реестры удостоверений. Карточка сотрудника
  // /organization/students/[id] гейтится на странице (список живёт без флага).
  { prefix: '/organization/certificates', flag: 'certificates_registry' },
  { prefix: '/partner/certificates', flag: 'certificates_registry' },
  // Этап 6 (Модуль 4): канбан сделок. Заказы партнёра (/partner/orders, до
  // `У-109` — /partner/deals) под этот флаг НЕ попадают.
  { prefix: '/manager/deals', flag: 'deals_pipeline' },
  { prefix: '/leader/deals', flag: 'deals_pipeline' },
  // Этап 7 (Модуль 8): «Входящие в работу» — единый тёмный запуск всех поверхностей.
  { prefix: '/manager/intake', flag: 'intake_inbox' },
  { prefix: '/leader/intake', flag: 'intake_inbox' },
  { prefix: '/admin/intake', flag: 'intake_inbox' },
];

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
  'client_requests',
  'deals_pipeline',
  'intake_inbox',
  // `У-144`: выпуск документов включён по умолчанию — из opt-in снят.
  'cabinet_questions',
  'settings_hub',
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

/**
 * Закрывает ли флаг целый раздел (читается в middleware).
 *
 * Такие флаги остаются за переменными окружения (`У-65`, решение варианта А
 * спеки этапа 8): middleware выполняется в edge-среде, где базы нет.
 * Выключить флаг из базы получилось бы (сработали бы меню и гейт страницы), а
 * **включить — нет**: middleware отдал бы 404 раньше, чем страница заглянула
 * бы в базу. Переключатель в интерфейсе создавал бы иллюзию управления.
 *
 * `У-124` (решение `Р-24`): именно поэтому телефония Mango **ушла отсюда** —
 * её флаг снят с `FEATURE_PREFIXES` и закрывается серверными гардами. Это
 * образец перевода route-флага в поведенческий; остальные переводятся своими
 * требованиями, а не «заодно».
 */
export function isRouteGatedFlag(flag: FeatureFlag): boolean {
  return FEATURE_PREFIXES.some((p) => p.flag === flag);
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
  // `У-66`: база → env → умолчание. Значение из базы приходит снапшотом,
  // который праймят async-швы; в edge-среде снапшота нет — там как раньше,
  // из env (потому route-флаги и остаются за сервером, см. `isRouteGatedFlag`).
  const raw = cachedFeatureFlagValue(flag) ?? process.env[envKey(flag)];
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
