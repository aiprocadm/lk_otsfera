import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';
import type { IconKey } from './icons';
import { SECTIONS, type SectionKey } from './sectionLabels';

/**
 * Пункт меню как он записан в реестре (`У-106`).
 *
 * Названия и значка здесь **нет**: пункт объявляет ключ раздела, а название и
 * значок приходят из словаря [sectionLabels.ts](./sectionLabels.ts). Раньше
 * строка писалась в каждой роли заново — и разъезжалась: «Комиссии» у
 * администратора против «Комиссионных отчётов» в разговоре, «Импорт оплат»
 * против «Выписки (сч. 51)» про один и тот же экран.
 */
export type NavItemSpec = {
  href: string;
  /** Ключ раздела — из него выводятся название и значок (`У-106`). */
  sectionKey: SectionKey;
  disabled?: boolean;
  flag?: FeatureFlag;
  leaderOnly?: boolean;
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

/**
 * Пункт меню, готовый к отрисовке: спецификация плюс выведенные из ключа
 * название и значок. Потребители (сайдбар, крошки, мобильная панель) работают
 * с ним и о словаре не знают.
 */
export type NavItem = NavItemSpec & { label: string; iconKey: IconKey };

function withSection(spec: NavItemSpec): NavItem {
  return { ...spec, ...SECTIONS[spec.sectionKey] };
}

// 'leader' — полноценная JWT-роль (ТЗ 2026-08-17); ключ канона меню совпадает с ней.
const NAV_SPECS: Record<Role | 'leader', NavItemSpec[]> = {
  // /admin/orders намеренно НЕ в меню: это deprecated-redirect на дашборд (реальна только деталь /admin/orders/[id]).
  admin: [
    { href: '/admin/dashboard', sectionKey: 'dashboard', group: 'Платформа' },
    {
      href: '/admin/health',
      sectionKey: 'health',
      group: 'Платформа',
      hiddenWhenFlag: 'settings_hub',
    },
    // ТЗ 2026-08-04: единственный служебный пункт при включённом хабе; закреплён внизу.
    { href: '/admin/settings', sectionKey: 'settings', pinnedBottom: true },
    {
      href: '/admin/integrations',
      sectionKey: 'integrations',
      group: 'Платформа',
      hiddenWhenFlag: 'settings_hub',
    },
    { href: '/admin/documents', sectionKey: 'documents', group: 'Операции' },
    { href: '/admin/messages', sectionKey: 'messages', group: 'Операции' },
    {
      href: '/admin/commission-statements',
      sectionKey: 'commissions',
      group: 'Операции',
    },
    {
      href: '/admin/commission-corrections',
      sectionKey: 'corrections',
      group: 'Операции',
    },
    { href: '/admin/finance', sectionKey: 'finance', group: 'Операции' },
    {
      href: '/admin/enrollments',
      sectionKey: 'enrollments',
      group: 'Операции',
      flag: 'enrollment_requests',
    },
    {
      href: '/admin/requests',
      sectionKey: 'requests',
      group: 'Операции',
      flag: 'client_requests',
    },
    {
      href: '/admin/intake',
      sectionKey: 'intake',
      group: 'Операции',
      flag: 'intake_inbox',
    },
    {
      href: '/admin/audit',
      sectionKey: 'audit',
      group: 'Операции',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      href: '/admin/pii-access',
      sectionKey: 'piiAccess',
      group: 'Операции',
      hiddenWhenFlag: 'settings_hub',
    },
    // `У-46` (этап 7): «вместо трёх пунктов один» выполняется САМИМ хабом —
    // все три пункта скрыты при `settings_hub`, а в хабе им отвечает одна
    // карточка «Обмен с 1С» с четырьмя вкладками. Здесь трио остаётся
    // нетронутым намеренно: это меню ДО хаба, и раскатка обязана быть
    // обратимой (страж `lib.navigation.settings-menu` это проверяет).
    {
      href: '/admin/sync',
      sectionKey: 'sync',
      group: 'Обмен с 1С',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      // У-8: было «Загрузка Excel» — тот же раздел, что «Загрузка из 1С» у
      // менеджера; одно название на два кабинета (решение заказчика 09.08.2026).
      href: '/admin/import',
      sectionKey: 'import',
      group: 'Обмен с 1С',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      href: '/admin/payments-import',
      sectionKey: 'paymentsImport',
      // Один экран — одно название во всех кабинетах (§15, `У-76`). Раньше у
      // админа стояло «Импорт выписки (сч. 51)», у менеджера — «Импорт оплат»,
      // а заголовок самой страницы не совпадал ни с тем ни с другим.
      // Бухгалтерская подробность («Карточка счёта 51») переехала в
      // подзаголовок — там она объясняет, какой файл взять из 1С.
      group: 'Обмен с 1С',
      hiddenWhenFlag: 'settings_hub',
    },
    { href: '/admin/users', sectionKey: 'users', group: 'Справочники' },
    { href: '/admin/partners', sectionKey: 'partners', group: 'Справочники' },
    {
      href: '/admin/organizations',
      sectionKey: 'organizations',
      group: 'Справочники',
    },
    {
      href: '/admin/training-directions',
      sectionKey: 'trainingDirections',
      group: 'Справочники',
    },
    {
      href: '/admin/custom-fields',
      sectionKey: 'customFields',
      group: 'Справочники',
      hiddenWhenFlag: 'settings_hub',
    },
    // §10 ТЗ v0.5: настраиваемый справочник рабочих статусов заявки.
    {
      href: '/admin/order-statuses',
      sectionKey: 'orderStatuses',
      group: 'Справочники',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      href: '/admin/roles',
      sectionKey: 'roles',
      group: 'Справочники',
      flag: 'role_constructor',
      hiddenWhenFlag: 'settings_hub',
    },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  manager: [
    { href: '/manager/dashboard', sectionKey: 'dashboard', flag: 'manager_cabinet' },
    { href: '/manager/search', sectionKey: 'search', flag: 'global_search' },
    {
      href: '/manager/orders',
      sectionKey: 'orders',
      flag: 'manager_cabinet',
      group: 'Работа',
    },
    {
      href: '/manager/leads',
      sectionKey: 'leads',
      flag: 'manager_cabinet',
      group: 'Продажи',
    },
    {
      // У-8: было «Обращения клиентов» — один объект зовётся одинаково во всех
      // кабинетах (У-76). Название «Обращения» освободилось: /manager/inbox
      // переименован во «Входящие письма».
      href: '/manager/requests',
      sectionKey: 'requests',
      flag: 'client_requests',
      badgeKey: 'clientRequestsNew',
      group: 'Продажи',
    },
    {
      href: '/manager/intake',
      sectionKey: 'intake',
      flag: 'intake_inbox',
      badgeKey: 'intake',
      group: 'Работа',
    },
    {
      href: '/manager/funnel',
      sectionKey: 'funnel',
      flag: 'sales_funnel',
      group: 'Продажи',
    },
    {
      href: '/manager/deals',
      sectionKey: 'deals',
      flag: 'deals_pipeline',
      group: 'Продажи',
    },
    {
      href: '/manager/tasks',
      sectionKey: 'tasks',
      flag: 'internal_tasks',
      badgeKey: 'tasksOverdue',
      group: 'Работа',
    },
    {
      href: '/manager/calendar',
      sectionKey: 'calendar',
      flag: 'staff_calendar',
      group: 'Работа',
    },
    {
      href: '/manager/organizations',
      sectionKey: 'organizations',
      flag: 'manager_cabinet',
      group: 'Клиенты',
    },
    {
      href: '/manager/finance',
      sectionKey: 'finance',
      flag: 'manager_cabinet',
      group: 'Финансы',
    },
    {
      // Решение заказчика 11.08.2026: импорт доступен администратору,
      // руководителю И обычному менеджеру — прежнее ограничение `Т-25`
      // (только руководитель) отменено. Границу режет не меню, а скоуп:
      // менеджер работает со своими организациями и не создаёт новые.
      href: '/manager/import',
      sectionKey: 'import',
      flag: 'manager_cabinet',
      group: 'Данные',
    },
    {
      href: '/manager/payments-import',
      sectionKey: 'paymentsImport',
      flag: 'manager_cabinet',
      group: 'Финансы',
    },
    {
      href: '/manager/documents',
      sectionKey: 'documents',
      flag: 'manager_cabinet',
      group: 'Данные',
    },
    {
      href: '/manager/enrollments',
      sectionKey: 'enrollments',
      flag: 'enrollment_requests',
      group: 'Клиенты',
    },
    {
      href: '/manager/messages',
      sectionKey: 'messages',
      flag: 'manager_cabinet',
      badgeKey: 'messagesUnread',
      group: 'Коммуникации',
    },
    {
      // У-8: было «Обращения» — путалось с обращениями клиентов, хотя это
      // совсем другой раздел (входящая почта).
      href: '/manager/inbox',
      sectionKey: 'inbox',
      flag: 'inbound_messaging',
      group: 'Коммуникации',
    },
    {
      href: '/manager/calls',
      sectionKey: 'calls',
      flag: 'telephony_mango',
      group: 'Коммуникации',
    },
    {
      href: '/manager/team',
      sectionKey: 'team',
      flag: 'manager_cabinet',
      leaderOnly: true,
      hiddenWhenFlag: 'leader_cabinet',
      group: 'Настройки',
    },
    {
      href: '/leader/dashboard',
      sectionKey: 'leaderCabinet',
      flag: 'leader_cabinet',
      leaderOnly: true,
      group: 'Настройки',
    },
    {
      href: '/manager/settings',
      sectionKey: 'settings',
      flag: 'manager_cabinet',
      group: 'Настройки',
    },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  // Пункты leader-меню намеренно БЕЗ flag: внутрь пускает middleware+layout;
  // флаг на каждом пункте дал бы пустой сайдбар при выключении.
  // ЗАВИСИМОСТЬ ФЛАГОВ: пункты-мосты в /manager/* (Сообщения, Мои заказы) живут под
  // флагом manager_cabinet — поэтому leader_cabinet включать ТОЛЬКО вместе с manager_cabinet,
  // иначе эти два пункта 404-ят. На практике лидер всегда и менеджер; см. runbook.
  leader: [
    // У-8: было «Сводка» — тот же экран, что «Главная» у остальных ролей.
    { href: '/leader/dashboard', sectionKey: 'dashboard' },
    // global_search — отдельный флаг (как role_constructor): гейтит только пункт.
    { href: '/leader/search', sectionKey: 'search', flag: 'global_search' },
    { href: '/leader/team', sectionKey: 'team', group: 'Настройки' },
    { href: '/leader/finance', sectionKey: 'finance', group: 'Финансы' },
    {
      href: '/leader/commission-corrections',
      sectionKey: 'corrections',
      group: 'Финансы',
    },
    { href: '/leader/orders', sectionKey: 'orders', group: 'Работа' },
    {
      href: '/leader/organizations',
      sectionKey: 'organizations',
      group: 'Клиенты',
    },
    // role_constructor — отдельный feature-флаг (НЕ leader_cabinet): гейтит только
    // этот пункт, не опустошает сайдбар при выключении.
    {
      href: '/leader/roles',
      sectionKey: 'roles',
      flag: 'role_constructor',
      group: 'Настройки',
      hiddenWhenFlag: 'settings_hub',
    },
    {
      href: '/leader/funnel',
      sectionKey: 'funnel',
      flag: 'sales_funnel',
      group: 'Продажи',
    },
    // deals_pipeline — свой opt-in флаг (НЕ путать с /partner/deals — «Заказы» партнёра).
    {
      href: '/leader/deals',
      sectionKey: 'deals',
      flag: 'deals_pipeline',
      group: 'Продажи',
    },
    {
      href: '/leader/analytics',
      sectionKey: 'analytics',
      flag: 'leader_analytics',
      group: 'Аналитика',
    },
    {
      href: '/leader/tasks',
      sectionKey: 'tasks',
      flag: 'internal_tasks',
      badgeKey: 'tasksOverdue',
      group: 'Работа',
    },
    {
      href: '/leader/calendar',
      sectionKey: 'calendar',
      flag: 'staff_calendar',
      group: 'Работа',
    },
    {
      href: '/leader/enrollments',
      sectionKey: 'enrollments',
      flag: 'enrollment_requests',
      group: 'Клиенты',
    },
    {
      // У-8: было «Обращения клиентов» (см. менеджера).
      href: '/leader/requests',
      sectionKey: 'requests',
      flag: 'client_requests',
      badgeKey: 'clientRequestsNew',
      group: 'Продажи',
    },
    {
      href: '/leader/intake',
      sectionKey: 'intake',
      flag: 'intake_inbox',
      badgeKey: 'intake',
      group: 'Работа',
    },
    // Личный inbox (комментарии+чат) живёт в кабинете менеджера — см. план, «Отклонение от спеки».
    { href: '/manager/messages', sectionKey: 'messages' },
    // Переключатель «играющего тренера» в личный кабинет менеджера.
    { href: '/manager/dashboard', sectionKey: 'myOrders' },
    { href: '/leader/settings', sectionKey: 'settings', pinnedBottom: true },
    // §11 ТЗ v0.5: настройку полей ведёт и руководитель — зеркало админского
    // экрана в его кабинете (в /admin/* руководителя не пускаем, Model A).
    {
      href: '/leader/settings/custom-fields',
      sectionKey: 'customFields',
      group: 'Настройки',
      hiddenWhenFlag: 'settings_hub',
    },
    // §10 ТЗ v0.5: зеркало справочника статусов — руководителя в /admin/* не пускаем.
    {
      href: '/leader/settings/order-statuses',
      sectionKey: 'orderStatuses',
      group: 'Настройки',
      hiddenWhenFlag: 'settings_hub',
    },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  // У-7: до этапа 2 у партнёра не было НИ ОДНОГО значка — ровно потому, что
  // поле было необязательным. Теперь `iconKey` обязателен на уровне типа.
  partner: [
    { href: '/partner/dashboard', sectionKey: 'dashboard' },
    { href: '/partner/portfolio', sectionKey: 'portfolio' },
    { href: '/partner/deals', sectionKey: 'orders' },
    // Было «Мои заявки» (решение §5-1 этапа 11 прошлой программы). У-8/У-76
    // требуют одного имени на объект во всех кабинетах, поэтому здесь и в
    // кабинете организации теперь «Обращения» (решение заказчика 09.08.2026).
    { href: '/partner/requests', sectionKey: 'requests', flag: 'client_requests' },
    {
      href: '/partner/enrollments',
      sectionKey: 'enrollments',
      flag: 'enrollment_requests',
    },
    {
      href: '/partner/certificates',
      sectionKey: 'certificates',
      flag: 'certificates_registry',
    },
    { href: '/partner/documents', sectionKey: 'documents' },
    { href: '/partner/finance', sectionKey: 'finance' },
    // У-60 (этап 4): «Команда» уехала из главного меню на вкладку настроек —
    // это служебный раздел, ему не место рядом с «Заказами». Адрес
    // /partner/team остался редиректом.
    { href: '/partner/messages', sectionKey: 'messages', flag: 'chat' },
    { href: '/partner/settings', sectionKey: 'settings' },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  // Этап 11 PR-3 (ФТ-15.4): состав и ПОРЯДОК заданы ТЗ дословно — Главная ·
  // Заказы · Обращения · Заявки на обучение · Удостоверения · Документы ·
  // Финансы · Сотрудники · Команда · Сообщения · Кабинет слушателя ·
  // Настройки. Не переставляй без правки ТЗ: порядок проверяется тестом.
  organization: [
    {
      href: '/organization/dashboard',
      sectionKey: 'dashboard',
      flag: 'organization_cabinet',
    },
    {
      href: '/organization/orders',
      sectionKey: 'orders',
      flag: 'organization_cabinet',
    },
    // Было «Мои заявки» — см. комментарий у партнёра.
    {
      href: '/organization/requests',
      sectionKey: 'requests',
      flag: 'client_requests',
    },
    {
      href: '/organization/enrollments',
      sectionKey: 'enrollments',
      flag: 'enrollment_requests',
    },
    {
      href: '/organization/certificates',
      sectionKey: 'certificates',
      flag: 'certificates_registry',
    },
    {
      href: '/organization/documents',
      sectionKey: 'documents',
      flag: 'organization_cabinet',
    },
    {
      href: '/organization/finance',
      sectionKey: 'finance',
      flag: 'organization_cabinet',
    },
    // `У-100`: сотрудники и доступ в кабинет — это части ОДНОГО объекта, своей
    // организации, а были двумя отдельными пунктами меню. Теперь это один
    // раздел с вкладками, как карточка организации у сотрудников ЦО и
    // партнёра (§0.2, правило зеркала). Старые адреса остались шлюзами.
    {
      href: '/organization/company',
      sectionKey: 'myOrganization',
      flag: 'organization_cabinet',
    },
    // «Сообщения» намеренно под более узким флагом chat (см. CLAUDE.md §5);
    // /student — отдельный shared-entry домен, не часть organization_cabinet.
    { href: '/organization/messages', sectionKey: 'messages', flag: 'chat' },
    { href: '/student', sectionKey: 'studentCabinet' },
    {
      href: '/organization/settings',
      sectionKey: 'settings',
      flag: 'organization_cabinet',
    },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  student: [
    { href: '/student', sectionKey: 'learning' },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
};

/**
 * Реестр меню, готовый к отрисовке: названия и значки подставлены из словаря
 * разделов. Экспортируется под прежним именем — потребителей и тестов у него
 * много, и менять их ради переименования не за что.
 */
export const navByRole: Record<Role | 'leader', NavItem[]> = Object.fromEntries(
  Object.entries(NAV_SPECS).map(([role, items]) => [role, items.map(withSection)])
) as Record<Role | 'leader', NavItem[]>;

/**
 * Меню роли минус пункты с выключенным флагом и минус `leaderOnly`-пункты,
 * когда зовущий не руководитель (`isManagerLeader` по умолчанию false — то
 * есть повышенные пункты по умолчанию скрыты, это безопасное поведение).
 *
 * Признака `partnerAdminOnly` больше нет: с этапа 4 его не носил ни один
 * пункт («Команда» партнёра уехала во вкладку настроек), и фильтр стал
 * недостижимой веткой — мёртвый код удалён этапом 9.
 *
 * `navByRole` stays exported for tests and any caller that wants the raw
 * shape; `navItemsFor` is what the app shell renders.
 */
export function navItemsFor(
  role: Role | 'leader',
  opts?: { isManagerLeader?: boolean }
): NavItem[] {
  return navByRole[role].filter((item) => {
    if (item.flag && !isFeatureEnabled(item.flag)) return false;
    if (item.leaderOnly && !opts?.isManagerLeader) return false;
    if (item.hiddenWhenFlag && isFeatureEnabled(item.hiddenWhenFlag)) return false;
    return true;
  });
}
