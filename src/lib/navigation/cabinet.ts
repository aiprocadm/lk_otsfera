import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';
import type { IconKey } from './icons';

export type NavItem = {
  href: string;
  label: string;
  disabled?: boolean;
  flag?: FeatureFlag;
  leaderOnly?: boolean;
  partnerAdminOnly?: boolean;
  /**
   * Значок раздела — семантический ключ из реестра `navigation/icons.ts`
   * (`У-6`). Поле **обязательное**: до этапа 2 значок был свободной строкой и
   * необязательным, из-за чего у партнёра и слушателя не было ни одного.
   */
  iconKey: IconKey;
  /** Виден только org-admin и org-leader (фильтруется в OrgSidebar по viewerRole, НЕ в navItemsFor). */
  orgAdminOrLeaderOnly?: boolean;
  /** Секция админского сайдбара («Платформа» / «Операции» / «Справочники»). Прочие шеллы игнорируют. */
  group?: string;
  /** Скрыть пункт, когда флаг ВКЛЮЧЁН (обратный гейт: «Команда» менеджера уезжает в /leader). */
  hiddenWhenFlag?: FeatureFlag;
  /**
   * Закрепить внизу сайдбара, отдельно от операционных пунктов (ТЗ 2026-08-04 §4.1).
   * Сайдбар рисует такие пункты последним блоком с отчерком.
   */
  pinnedBottom?: boolean;
  /** Этап 7 (ФТ-8.4): ключ живого счётчика из GET /api/staff/badges (рендерит NavBadge). */
  badgeKey?: 'intake' | 'tasksOverdue' | 'clientRequestsNew' | 'messagesUnread';
};

// 'leader' — НЕ новая JWT-роль (это manager + managerRole='leader'); ключ существует только в каноне меню.
export const navByRole: Record<Role | 'leader', NavItem[]> = {
  // /admin/orders намеренно НЕ в меню: это deprecated-redirect на дашборд (реальна только деталь /admin/orders/[id]).
  admin: [
    { href: '/admin/dashboard', label: 'Главная', iconKey: 'dashboard', group: 'Платформа' },
    {
      href: '/admin/health',
      label: 'Здоровье',
      iconKey: 'health',
      group: 'Платформа',
      hiddenWhenFlag: 'settings_hub',
    },
    // ТЗ 2026-08-04: единственный служебный пункт при включённом хабе; закреплён внизу.
    { href: '/admin/settings', label: 'Настройки', iconKey: 'settings', pinnedBottom: true },
    {
      href: '/admin/integrations',
      label: 'Интеграции',
      iconKey: 'integrations',
      group: 'Платформа',
      hiddenWhenFlag: 'settings_hub',
    },
    { href: '/admin/documents', label: 'Документы', iconKey: 'documents', group: 'Операции' },
    { href: '/admin/messages', label: 'Сообщения', iconKey: 'messages', group: 'Операции' },
    {
      href: '/admin/commission-statements',
      label: 'Комиссии',
      iconKey: 'commissions',
      group: 'Операции',
    },
    {
      href: '/admin/commission-corrections',
      label: 'Корректировки',
      iconKey: 'corrections',
      group: 'Операции',
    },
    { href: '/admin/finance', label: 'Финансы', iconKey: 'finance', group: 'Операции' },
    {
      href: '/admin/enrollments',
      label: 'Заявки на обучение',
      iconKey: 'enrollments',
      group: 'Операции',
      flag: 'enrollment_requests',
    },
    {
      href: '/admin/requests',
      label: 'Обращения',
      iconKey: 'requests',
      group: 'Операции',
      flag: 'client_requests',
    },
    {
      href: '/admin/intake',
      label: 'Входящие в работу',
      iconKey: 'intake',
      group: 'Операции',
      flag: 'intake_inbox',
    },
    {
      href: '/admin/audit',
      label: 'Аудит',
      iconKey: 'audit',
      group: 'Операции',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      href: '/admin/pii-access',
      label: 'Доступ к ПДн',
      iconKey: 'security',
      group: 'Операции',
      hiddenWhenFlag: 'settings_hub',
    },
    // Все три канала обмена с 1С — в одной группе, чтобы не путались (были
    // разбросаны: sync в «Платформе», два импорта в «Операциях»). Порядок:
    // авто-обмен по сети → два ручных файловых импорта.
    {
      href: '/admin/sync',
      label: 'Синхронизация (авто)',
      iconKey: 'sync',
      group: 'Обмен с 1С',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      // У-8: было «Загрузка Excel» — тот же раздел, что «Загрузка из 1С» у
      // менеджера; одно название на два кабинета (решение заказчика 09.08.2026).
      href: '/admin/import',
      label: 'Загрузка из 1С',
      iconKey: 'import',
      group: 'Обмен с 1С',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      href: '/admin/payments-import',
      label: 'Импорт выписки (сч. 51)',
      iconKey: 'bankStatement',
      group: 'Обмен с 1С',
      hiddenWhenFlag: 'settings_hub',
    },
    { href: '/admin/users', label: 'Пользователи', iconKey: 'users', group: 'Справочники' },
    { href: '/admin/partners', label: 'Партнёры', iconKey: 'partners', group: 'Справочники' },
    {
      href: '/admin/organizations',
      label: 'Организации',
      iconKey: 'organizations',
      group: 'Справочники',
    },
    {
      href: '/admin/training-directions',
      label: 'Направления обучения',
      iconKey: 'trainingDirections',
      group: 'Справочники',
    },
    {
      href: '/admin/custom-fields',
      label: 'Доп-поля',
      iconKey: 'customFields',
      group: 'Справочники',
      hiddenWhenFlag: 'settings_hub',
    },
    // §10 ТЗ v0.5: настраиваемый справочник рабочих статусов заявки.
    {
      href: '/admin/order-statuses',
      label: 'Статусы заявок',
      iconKey: 'orderStatuses',
      group: 'Справочники',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      href: '/admin/roles',
      label: 'Роли',
      iconKey: 'roles',
      group: 'Справочники',
      flag: 'role_constructor',
      hiddenWhenFlag: 'settings_hub',
    },
  ],
  manager: [
    { href: '/manager/dashboard', label: 'Главная', iconKey: 'dashboard', flag: 'manager_cabinet' },
    { href: '/manager/search', label: 'Поиск', iconKey: 'search', flag: 'global_search' },
    {
      href: '/manager/orders',
      label: 'Заказы',
      iconKey: 'orders',
      flag: 'manager_cabinet',
      group: 'Работа',
    },
    {
      href: '/manager/leads',
      label: 'Лиды',
      iconKey: 'leads',
      flag: 'manager_cabinet',
      group: 'Продажи',
    },
    {
      // У-8: было «Обращения клиентов» — один объект зовётся одинаково во всех
      // кабинетах (У-76). Название «Обращения» освободилось: /manager/inbox
      // переименован во «Входящие письма».
      href: '/manager/requests',
      label: 'Обращения',
      iconKey: 'requests',
      flag: 'client_requests',
      badgeKey: 'clientRequestsNew',
      group: 'Продажи',
    },
    {
      href: '/manager/intake',
      label: 'Входящие в работу',
      iconKey: 'intake',
      flag: 'intake_inbox',
      badgeKey: 'intake',
      group: 'Работа',
    },
    {
      href: '/manager/funnel',
      label: 'Воронка',
      iconKey: 'funnel',
      flag: 'sales_funnel',
      group: 'Продажи',
    },
    {
      href: '/manager/deals',
      label: 'Сделки',
      iconKey: 'deals',
      flag: 'deals_pipeline',
      group: 'Продажи',
    },
    {
      href: '/manager/tasks',
      label: 'Задачи',
      iconKey: 'tasks',
      flag: 'internal_tasks',
      badgeKey: 'tasksOverdue',
      group: 'Работа',
    },
    {
      href: '/manager/calendar',
      label: 'Календарь',
      iconKey: 'calendar',
      flag: 'staff_calendar',
      group: 'Работа',
    },
    {
      href: '/manager/organizations',
      label: 'Организации',
      iconKey: 'organizations',
      flag: 'manager_cabinet',
      group: 'Клиенты',
    },
    {
      href: '/manager/finance',
      label: 'Финансы',
      iconKey: 'finance',
      flag: 'manager_cabinet',
      group: 'Финансы',
    },
    {
      // Решение заказчика 11.08.2026: импорт доступен администратору,
      // руководителю И обычному менеджеру — прежнее ограничение `Т-25`
      // (только руководитель) отменено. Границу режет не меню, а скоуп:
      // менеджер работает со своими организациями и не создаёт новые.
      href: '/manager/import',
      label: 'Загрузка из 1С',
      iconKey: 'import',
      flag: 'manager_cabinet',
      group: 'Данные',
    },
    {
      href: '/manager/payments-import',
      label: 'Импорт оплат',
      iconKey: 'paymentsImport',
      flag: 'manager_cabinet',
      group: 'Финансы',
    },
    {
      href: '/manager/documents',
      label: 'Документы',
      iconKey: 'documents',
      flag: 'manager_cabinet',
      group: 'Данные',
    },
    {
      href: '/manager/students',
      label: 'Сотрудники',
      iconKey: 'employees',
      flag: 'manager_cabinet',
      group: 'Клиенты',
    },
    {
      href: '/manager/enrollments',
      label: 'Заявки на обучение',
      iconKey: 'enrollments',
      flag: 'enrollment_requests',
      group: 'Клиенты',
    },
    {
      href: '/manager/messages',
      label: 'Сообщения',
      iconKey: 'messages',
      flag: 'manager_cabinet',
      badgeKey: 'messagesUnread',
      group: 'Коммуникации',
    },
    {
      // У-8: было «Обращения» — путалось с обращениями клиентов, хотя это
      // совсем другой раздел (входящая почта).
      href: '/manager/inbox',
      label: 'Входящие письма',
      iconKey: 'inbox',
      flag: 'inbound_messaging',
      group: 'Коммуникации',
    },
    {
      href: '/manager/calls',
      label: 'Звонки',
      iconKey: 'calls',
      flag: 'telephony_mango',
      group: 'Коммуникации',
    },
    {
      href: '/manager/team',
      label: 'Команда',
      iconKey: 'team',
      flag: 'manager_cabinet',
      leaderOnly: true,
      hiddenWhenFlag: 'leader_cabinet',
      group: 'Настройки',
    },
    {
      href: '/leader/dashboard',
      label: 'Кабинет руководителя',
      iconKey: 'leaderCabinet',
      flag: 'leader_cabinet',
      leaderOnly: true,
      group: 'Настройки',
    },
    {
      href: '/manager/settings',
      label: 'Настройки',
      iconKey: 'settings',
      flag: 'manager_cabinet',
      group: 'Настройки',
    },
  ],
  // Пункты leader-меню намеренно БЕЗ flag: внутрь пускает middleware+layout;
  // флаг на каждом пункте дал бы пустой сайдбар при выключении.
  // ЗАВИСИМОСТЬ ФЛАГОВ: пункты-мосты в /manager/* (Сообщения, Мои заказы) живут под
  // флагом manager_cabinet — поэтому leader_cabinet включать ТОЛЬКО вместе с manager_cabinet,
  // иначе эти два пункта 404-ят. На практике лидер всегда и менеджер; см. runbook.
  leader: [
    // У-8: было «Сводка» — тот же экран, что «Главная» у остальных ролей.
    { href: '/leader/dashboard', label: 'Главная', iconKey: 'dashboard' },
    // global_search — отдельный флаг (как role_constructor): гейтит только пункт.
    { href: '/leader/search', label: 'Поиск', iconKey: 'search', flag: 'global_search' },
    { href: '/leader/team', label: 'Команда', iconKey: 'team', group: 'Настройки' },
    { href: '/leader/finance', label: 'Финансы', iconKey: 'finance', group: 'Финансы' },
    {
      href: '/leader/commission-corrections',
      label: 'Корректировки',
      iconKey: 'corrections',
      group: 'Финансы',
    },
    { href: '/leader/orders', label: 'Заказы', iconKey: 'orders', group: 'Работа' },
    {
      href: '/leader/organizations',
      label: 'Организации',
      iconKey: 'organizations',
      group: 'Клиенты',
    },
    // role_constructor — отдельный feature-флаг (НЕ leader_cabinet): гейтит только
    // этот пункт, не опустошает сайдбар при выключении.
    {
      href: '/leader/roles',
      label: 'Роли',
      iconKey: 'roles',
      flag: 'role_constructor',
      group: 'Настройки',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      href: '/leader/funnel',
      label: 'Воронка',
      iconKey: 'funnel',
      flag: 'sales_funnel',
      group: 'Продажи',
    },
    // deals_pipeline — свой opt-in флаг (НЕ путать с /partner/deals — «Заказы» партнёра).
    {
      href: '/leader/deals',
      label: 'Сделки',
      iconKey: 'deals',
      flag: 'deals_pipeline',
      group: 'Продажи',
    },
    {
      href: '/leader/analytics',
      label: 'Аналитика',
      iconKey: 'analytics',
      flag: 'leader_analytics',
      group: 'Аналитика',
    },
    {
      href: '/leader/tasks',
      label: 'Задачи',
      iconKey: 'tasks',
      flag: 'internal_tasks',
      badgeKey: 'tasksOverdue',
      group: 'Работа',
    },
    {
      href: '/leader/calendar',
      label: 'Календарь',
      iconKey: 'calendar',
      flag: 'staff_calendar',
      group: 'Работа',
    },
    {
      href: '/leader/enrollments',
      label: 'Заявки на обучение',
      iconKey: 'enrollments',
      flag: 'enrollment_requests',
      group: 'Клиенты',
    },
    {
      // У-8: было «Обращения клиентов» (см. менеджера).
      href: '/leader/requests',
      label: 'Обращения',
      iconKey: 'requests',
      flag: 'client_requests',
      badgeKey: 'clientRequestsNew',
      group: 'Продажи',
    },
    {
      href: '/leader/intake',
      label: 'Входящие в работу',
      iconKey: 'intake',
      flag: 'intake_inbox',
      badgeKey: 'intake',
      group: 'Работа',
    },
    // Личный inbox (комментарии+чат) живёт в кабинете менеджера — см. план, «Отклонение от спеки».
    { href: '/manager/messages', label: 'Сообщения', iconKey: 'messages' },
    // Переключатель «играющего тренера» в личный кабинет менеджера.
    { href: '/manager/dashboard', label: 'Мои заказы', iconKey: 'myOrders' },
    { href: '/leader/settings', label: 'Настройки', iconKey: 'settings', pinnedBottom: true },
    // §11 ТЗ v0.5: настройку полей ведёт и руководитель — зеркало админского
    // экрана в его кабинете (в /admin/* руководителя не пускаем, Model A).
    {
      href: '/leader/settings/custom-fields',
      label: 'Доп-поля',
      iconKey: 'customFields',
      group: 'Настройки',
      hiddenWhenFlag: 'settings_hub',
    },
    // §10 ТЗ v0.5: зеркало справочника статусов — руководителя в /admin/* не пускаем.
    {
      href: '/leader/settings/order-statuses',
      label: 'Статусы заявок',
      iconKey: 'orderStatuses',
      group: 'Настройки',
      hiddenWhenFlag: 'settings_hub',
    },
  ],
  // У-7: до этапа 2 у партнёра не было НИ ОДНОГО значка — ровно потому, что
  // поле было необязательным. Теперь `iconKey` обязателен на уровне типа.
  partner: [
    { href: '/partner/dashboard', label: 'Главная', iconKey: 'dashboard' },
    { href: '/partner/portfolio', label: 'Портфель', iconKey: 'portfolio' },
    { href: '/partner/deals', label: 'Заказы', iconKey: 'orders' },
    // Было «Мои заявки» (решение §5-1 этапа 11 прошлой программы). У-8/У-76
    // требуют одного имени на объект во всех кабинетах, поэтому здесь и в
    // кабинете организации теперь «Обращения» (решение заказчика 09.08.2026).
    { href: '/partner/requests', label: 'Обращения', iconKey: 'requests', flag: 'client_requests' },
    {
      href: '/partner/enrollments',
      label: 'Заявки на обучение',
      iconKey: 'enrollments',
      flag: 'enrollment_requests',
    },
    {
      href: '/partner/certificates',
      label: 'Удостоверения',
      iconKey: 'certificates',
      flag: 'certificates_registry',
    },
    { href: '/partner/documents', label: 'Документы', iconKey: 'documents' },
    { href: '/partner/finance', label: 'Финансы', iconKey: 'finance' },
    // У-60 (этап 4): «Команда» уехала из главного меню на вкладку настроек —
    // это служебный раздел, ему не место рядом с «Заказами». Адрес
    // /partner/team остался редиректом.
    { href: '/partner/messages', label: 'Сообщения', iconKey: 'messages', flag: 'chat' },
    { href: '/partner/settings', label: 'Настройки', iconKey: 'settings' },
  ],
  // Этап 11 PR-3 (ФТ-15.4): состав и ПОРЯДОК заданы ТЗ дословно — Главная ·
  // Заказы · Обращения · Заявки на обучение · Удостоверения · Документы ·
  // Финансы · Сотрудники · Команда · Сообщения · Кабинет слушателя ·
  // Настройки. Не переставляй без правки ТЗ: порядок проверяется тестом.
  organization: [
    {
      href: '/organization/dashboard',
      label: 'Главная',
      iconKey: 'dashboard',
      flag: 'organization_cabinet',
    },
    {
      href: '/organization/orders',
      label: 'Заказы',
      iconKey: 'orders',
      flag: 'organization_cabinet',
    },
    // Было «Мои заявки» — см. комментарий у партнёра.
    {
      href: '/organization/requests',
      label: 'Обращения',
      iconKey: 'requests',
      flag: 'client_requests',
    },
    {
      href: '/organization/enrollments',
      label: 'Заявки на обучение',
      iconKey: 'enrollments',
      flag: 'enrollment_requests',
    },
    {
      href: '/organization/certificates',
      label: 'Удостоверения',
      iconKey: 'certificates',
      flag: 'certificates_registry',
    },
    {
      href: '/organization/documents',
      label: 'Документы',
      iconKey: 'documents',
      flag: 'organization_cabinet',
    },
    {
      href: '/organization/finance',
      label: 'Финансы',
      iconKey: 'finance',
      flag: 'organization_cabinet',
    },
    {
      href: '/organization/students',
      label: 'Сотрудники',
      iconKey: 'employees',
      flag: 'organization_cabinet',
    },
    {
      href: '/organization/team',
      label: 'Команда',
      iconKey: 'team',
      orgAdminOrLeaderOnly: true,
      flag: 'organization_cabinet',
    },
    // «Сообщения» намеренно под более узким флагом chat (см. CLAUDE.md §5);
    // /student — отдельный shared-entry домен, не часть organization_cabinet.
    { href: '/organization/messages', label: 'Сообщения', iconKey: 'messages', flag: 'chat' },
    { href: '/student', label: 'Кабинет слушателя', iconKey: 'studentCabinet' },
    {
      href: '/organization/settings',
      label: 'Настройки',
      iconKey: 'settings',
      flag: 'organization_cabinet',
    },
  ],
  student: [{ href: '/student', label: 'Обучение', iconKey: 'learning' }],
};

/**
 * Returns the static menu for a role minus items whose feature flag is off,
 * items marked `leaderOnly` when the caller is not a manager-leader, and items
 * marked `partnerAdminOnly` when the caller is not a partner-admin. Both
 * `isManagerLeader` and `isPartnerAdmin` default to false, so callers that
 * don't pass them simply hide the elevated items — that's the safe default.
 *
 * `navByRole` stays exported for tests and any caller that wants the raw
 * shape; `navItemsFor` is what the app shell renders.
 */
export function navItemsFor(
  role: Role | 'leader',
  opts?: { isManagerLeader?: boolean; isPartnerAdmin?: boolean }
): NavItem[] {
  return navByRole[role].filter((item) => {
    if (item.flag && !isFeatureEnabled(item.flag)) return false;
    if (item.leaderOnly && !opts?.isManagerLeader) return false;
    if (item.partnerAdminOnly && !opts?.isPartnerAdmin) return false;
    if (item.hiddenWhenFlag && isFeatureEnabled(item.hiddenWhenFlag)) return false;
    return true;
  });
}
