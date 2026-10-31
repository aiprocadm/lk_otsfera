import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';
import type { IconKey } from './icons';
import { SECTIONS, type SectionKey } from './sectionLabels';
import type { MenuGroup } from './menuGroups';
import { messagesTabsFor } from './messagesTabs';

/**
 * Пункт меню как он записан в реестре (`У-106`).
 *
 * Названия и значка здесь **нет**: пункт объявляет ключ раздела, а название и
 * значок приходят из словаря [sectionLabels.ts](./sectionLabels.ts). Раньше
 * строка писалась в каждой роли заново — и разъезжалась: «Комиссии» у
 * администратора против «Комиссионных отчётов» в разговоре, «Импорт оплат»
 * против «Выписки (сч. 51)» про один и тот же экран.
 */
type NavItemSpec = {
  href: string;
  /** Ключ раздела — из него выводятся название и значок (`У-106`). */
  sectionKey: SectionKey;
  disabled?: boolean;
  flag?: FeatureFlag;
  /**
   * Пункт живёт, если включён ХОТЯ БЫ ОДИН из флагов (`У-234`): «Сообщения»
   * несут два домена — переписку с менеджером и чат по заказам, и выключение
   * одного не должно прятать другой.
   */
  anyFlags?: FeatureFlag[];
  /**
   * Группа меню (`У-113`). Порядок групп — общий для всех кабинетов
   * сотрудников и задан реестром [menuGroups.ts](./menuGroups.ts), а не
   * порядком пунктов здесь.
   */
  group?: MenuGroup;
  /** Скрыть пункт, когда флаг ВКЛЮЧЁН (обратный гейт: «Команда» менеджера уезжает в /leader). */
  /**
   * Закрепить внизу сайдбара, отдельно от операционных пунктов (ТЗ 2026-08-04 §4.1).
   * Сайдбар рисует такие пункты последним блоком с отчерком.
   */
  pinnedBottom?: boolean;
  /**
   * Подпункты под пунктом (этап 7 ТЗ 13.10.2026, `У-313`, `Р-7-1`). Функция,
   * а не список: флаги подпунктов читаются в момент сборки меню — так же
   * свежо, как флаги самих пунктов. `navItemsFor` превращает её в готовый
   * `children`: меню уходит в браузер, а функцию туда не передать.
   */
  childrenOf?: () => NavChild[];
  /** Этап 7 (ФТ-8.4): ключ живого счётчика из GET /api/staff/badges (рендерит NavBadge). */
  badgeKey?: 'intake' | 'tasksOverdue' | 'clientRequestsNew' | 'messagesUnread' | 'dialogsWaiting';
};

/**
 * Пункт меню, готовый к отрисовке: спецификация плюс выведенные из ключа
 * название и значок. Потребители (сайдбар, крошки, мобильная панель) работают
 * с ним и о словаре не знают.
 */
/** Подпункт меню: свой адрес и подпись, значка нет. */
type NavChild = { href: string; label: string };

export type NavItem = NavItemSpec & {
  label: string;
  iconKey: IconKey;
  /** Подпункты, уже отфильтрованные по флагам (`У-313`). */
  children?: NavChild[];
};

function withSection(spec: NavItemSpec): NavItem {
  return { ...spec, ...SECTIONS[spec.sectionKey] };
}

// 'leader' — полноценная JWT-роль (ТЗ 2026-08-17); ключ канона меню совпадает с ней.
const NAV_SPECS: Record<Role | 'leader', NavItemSpec[]> = {
  // /admin/orders намеренно НЕ в меню: это deprecated-redirect на дашборд (реальна только деталь /admin/orders/[id]).
  admin: [
    { href: '/admin/dashboard', sectionKey: 'dashboard' },
    // `У-112`: раздел «Заказы» у админа был пунктом-обманкой — адрес уводил на
    // дашборд. Теперь это список заказов всех компаний.
    { href: '/admin/orders', group: 'Работа', sectionKey: 'orders' },
    // `У-112`: поиск отдан и админу — сознательное расширение решения `У-75`
    // («поиск по данным — менеджеру и руководителю»), а не дрейф.
    { href: '/admin/search', sectionKey: 'search', flag: 'global_search' },
    // ТЗ 2026-08-04: единственный служебный пункт при включённом хабе; закреплён внизу.
    // Этап 5 (`У-228`): лента уведомлений — над «Настройками», под флагом
    // `notification_center` до приёмки (`Р-Э5-8`).
    {
      href: '/admin/notifications',
      sectionKey: 'notifications',
      flag: 'notification_center',
      pinnedBottom: true,
    },
    { href: '/admin/settings', sectionKey: 'settings', pinnedBottom: true },
    { href: '/admin/documents', group: 'Документы', sectionKey: 'documents' },
    { href: '/admin/messages', group: 'Коммуникации', sectionKey: 'messages' },
    {
      href: '/admin/commission-statements',
      group: 'Финансы',
      sectionKey: 'commissions',
    },
    {
      href: '/admin/commission-corrections',
      group: 'Финансы',
      sectionKey: 'corrections',
    },
    { href: '/admin/finance', group: 'Финансы', sectionKey: 'finance' },
    {
      href: '/admin/requests',
      group: 'Продажи',
      sectionKey: 'requests',
    },
    {
      href: '/admin/intake',
      group: 'Работа',
      sectionKey: 'intake',
    },
    { href: '/admin/users', group: 'Справочники', sectionKey: 'users' },
    { href: '/admin/partners', group: 'Клиенты', sectionKey: 'partners' },
    {
      href: '/admin/organizations',
      group: 'Клиенты',
      sectionKey: 'organizations',
    },
    { href: '/admin/contacts', group: 'Клиенты', sectionKey: 'contacts', flag: 'contacts' },
    // `У-121`: «Заявки на обучение» идут ПОСЛЕ «Организаций» — как у менеджера
    // и руководителя. Порядок внутри группы у админа был свой, и страж
    // зеркальности это увидел.
    {
      href: '/admin/enrollments',
      group: 'Клиенты',
      sectionKey: 'enrollments',
    },
    {
      href: '/admin/training-directions',
      group: 'Справочники',
      sectionKey: 'trainingDirections',
    },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  manager: [
    { href: '/manager/dashboard', sectionKey: 'dashboard' },
    { href: '/manager/search', sectionKey: 'search', flag: 'global_search' },
    {
      href: '/manager/orders',
      group: 'Работа',
      sectionKey: 'orders',
    },
    {
      href: '/manager/leads',
      group: 'Продажи',
      sectionKey: 'leads',
    },
    {
      // У-8: было «Обращения клиентов» — один объект зовётся одинаково во всех
      // кабинетах (У-76). Название «Обращения» освободилось: /manager/inbox
      // переименован во «Входящие письма».
      href: '/manager/requests',
      group: 'Продажи',
      sectionKey: 'requests',
      badgeKey: 'clientRequestsNew',
    },
    {
      href: '/manager/intake',
      group: 'Работа',
      sectionKey: 'intake',
      badgeKey: 'intake',
    },
    // Этап 6 ТЗ 13.10.2026 (`У-312`): «Воронка продаж» менеджера — вид внутри
    // «Лидов» (`/manager/leads?view=funnel`); старый адрес говорит «раздел переехал».
    {
      href: '/manager/deals',
      group: 'Продажи',
      sectionKey: 'deals',
    },
    {
      href: '/manager/tasks',
      group: 'Работа',
      sectionKey: 'tasks',
      flag: 'internal_tasks',
      badgeKey: 'tasksOverdue',
    },
    {
      href: '/manager/calendar',
      group: 'Работа',
      sectionKey: 'calendar',
      flag: 'staff_calendar',
    },
    {
      href: '/manager/organizations',
      group: 'Клиенты',
      sectionKey: 'organizations',
    },
    // Этап 1 ТЗ 12.09.2026 (`У-178`): справочник контактов — поведенческий
    // флаг `contacts` (включается из интерфейса), одинаково в трёх кабинетах ЦО.
    {
      href: '/manager/contacts',
      group: 'Клиенты',
      sectionKey: 'contacts',
      flag: 'contacts',
    },
    {
      href: '/manager/finance',
      group: 'Финансы',
      sectionKey: 'finance',
    },
    {
      // `У-113`: раньше обмен с 1С был двумя пунктами меню — «Загрузка Excel из
      // 1С» и «Выписка по счёту 51». Человеку приходилось помнить, что это одна
      // задача, разложенная по двум местам. Теперь один пункт с вкладками, как
      // в хабе настроек; старые адреса остались рабочими шлюзами.
      //
      // Решение заказчика 11.08.2026: обмен доступен администратору,
      // руководителю И обычному менеджеру — прежнее ограничение `Т-25`
      // (только руководитель) отменено. Границу режет не меню, а скоуп:
      // менеджер работает со своими организациями и не создаёт новые.
      href: '/manager/exchange',
      group: 'Финансы',
      sectionKey: 'exchange',
    },
    {
      href: '/manager/documents',
      group: 'Документы',
      sectionKey: 'documents',
    },
    {
      href: '/manager/enrollments',
      group: 'Клиенты',
      sectionKey: 'enrollments',
    },
    {
      href: '/manager/messages',
      group: 'Коммуникации',
      sectionKey: 'messages',
      badgeKey: 'messagesUnread',
      childrenOf: () => messagesTabsFor('/manager/messages'),
    },
    {
      // У-8: было «Обращения» — путалось с обращениями клиентов, хотя это
      // совсем другой раздел (входящая почта).
      href: '/manager/inbox',
      group: 'Коммуникации',
      sectionKey: 'inbox',
      flag: 'inbound_messaging',
    },
    {
      // Спека 2026-09-12 (Р-М-5): переписка с клиентами в мессенджерах. Тот же
      // флаг, что у «Входящих писем», — это одна функция «приём сообщений».
      href: '/manager/messengers',
      group: 'Коммуникации',
      sectionKey: 'messengers',
      flag: 'inbound_messaging',
      badgeKey: 'dialogsWaiting',
    },
    {
      href: '/manager/calls',
      group: 'Коммуникации',
      sectionKey: 'calls',
      flag: 'telephony_mango',
    },
    // Пункта «Команда» здесь больше нет (`У-262`). Он был `leaderOnly` и при
    // этом прятался флагом `leader_cabinet` — то есть при включённом кабинете
    // руководителя (а он включён везде) не показывался вообще никому:
    // рядовому менеджеру не полагался, а руководитель видел «Команду» уже в
    // своём кабинете. Флаг снят, и без него пункт всплыл бы дублем, ведущим на
    // страницу-шлюз. Сам адрес `/manager/team` удалён вместе с остальными
    // шлюзами (`У-263`, прогон сопровождения №37).
    //
    // Этап 5 (`У-228`): лента уведомлений — над «Настройками», под флагом
    // `notification_center` до приёмки (`Р-Э5-8`).
    {
      href: '/manager/notifications',
      sectionKey: 'notifications',
      flag: 'notification_center',
      pinnedBottom: true,
    },
    {
      href: '/manager/settings',
      sectionKey: 'settings',
      pinnedBottom: true,
    },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  // Пункты leader-меню намеренно БЕЗ flag: внутрь пускает middleware+layout;
  // флаг на каждом пункте дал бы пустой сайдбар при выключении.
  // `У-110`/`У-111`: пунктов-мостов в /manager/* больше нет — «Сообщения» и
  // «Документы» у руководителя свои, а кабинет переключается в шапке. Прежняя
  // связка флагов (leader_cabinet только вместе с manager_cabinet) отпала.
  leader: [
    // У-8: было «Сводка» — тот же экран, что «Главная» у остальных ролей.
    { href: '/leader/dashboard', sectionKey: 'dashboard' },
    // global_search — отдельный флаг (как role_constructor): гейтит только пункт.
    { href: '/leader/search', sectionKey: 'search', flag: 'global_search' },
    // `У-347`: «Команда» и «Аналитика» — в «Продажах»: следить за динамикой
    // отдела — главная работа руководителя, а не справочная.
    { href: '/leader/team', group: 'Продажи', sectionKey: 'team' },
    { href: '/leader/finance', group: 'Финансы', sectionKey: 'finance' },
    {
      href: '/leader/commission-corrections',
      group: 'Финансы',
      sectionKey: 'corrections',
    },
    { href: '/leader/orders', group: 'Работа', sectionKey: 'orders' },
    {
      href: '/leader/organizations',
      group: 'Клиенты',
      sectionKey: 'organizations',
    },
    { href: '/leader/contacts', group: 'Клиенты', sectionKey: 'contacts', flag: 'contacts' },
    // Этап 4 ТЗ 28.10.2026 (`У-349`): «Лиды» — как у менеджера, воронка — вид
    // внутри них (`/leader/leads?view=funnel`); старый `/leader/funnel` говорит
    // «раздел переехал».
    { href: '/leader/leads', group: 'Продажи', sectionKey: 'leads' },
    // deals_pipeline — свой opt-in флаг (НЕ путать с /partner/orders — «Заказы» партнёра).
    {
      href: '/leader/deals',
      group: 'Продажи',
      sectionKey: 'deals',
    },
    {
      href: '/leader/analytics',
      group: 'Продажи',
      sectionKey: 'analytics',
      flag: 'leader_analytics',
    },
    {
      href: '/leader/tasks',
      group: 'Работа',
      sectionKey: 'tasks',
      flag: 'internal_tasks',
      badgeKey: 'tasksOverdue',
    },
    {
      href: '/leader/calendar',
      group: 'Работа',
      sectionKey: 'calendar',
      flag: 'staff_calendar',
    },
    {
      href: '/leader/enrollments',
      group: 'Клиенты',
      sectionKey: 'enrollments',
    },
    {
      // У-8: было «Обращения клиентов» (см. менеджера).
      href: '/leader/requests',
      group: 'Продажи',
      sectionKey: 'requests',
      badgeKey: 'clientRequestsNew',
    },
    {
      href: '/leader/intake',
      group: 'Работа',
      sectionKey: 'intake',
      badgeKey: 'intake',
    },
    // `У-110`: раздел свой, а не мост в кабинет менеджера — раньше человек
    // нажимал пункт своего меню и оказывался в чужом кабинете.
    {
      href: '/leader/messages',
      group: 'Коммуникации',
      sectionKey: 'messages',
      // `У-337`: счётчик непрочитанного, как у менеджера (страж зеркала сверяет).
      badgeKey: 'messagesUnread',
      // `У-313`: те же подпункты, что у менеджера (правило зеркала).
      childrenOf: () => messagesTabsFor('/leader/messages'),
    },
    { href: '/leader/documents', group: 'Документы', sectionKey: 'documents' },
    // `У-111`: пункта «Мои заказы» больше нет — кабинет переключается одним
    // переключателем в шапке, а не пунктом меню, спрятанным среди разделов.
    // Этап 5 (`У-228`): лента уведомлений — над «Настройками», под флагом
    // `notification_center` до приёмки (`Р-Э5-8`).
    {
      href: '/leader/notifications',
      sectionKey: 'notifications',
      flag: 'notification_center',
      pinnedBottom: true,
    },
    { href: '/leader/settings', sectionKey: 'settings', pinnedBottom: true },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  // У-7: до этапа 2 у партнёра не было НИ ОДНОГО значка — ровно потому, что
  // поле было необязательным. Теперь `iconKey` обязателен на уровне типа.
  partner: [
    { href: '/partner/dashboard', sectionKey: 'dashboard' },
    { href: '/partner/orders', sectionKey: 'orders' },
    // Было «Мои заявки» (решение §5-1 этапа 11 прошлой программы). У-8/У-76
    // требуют одного имени на объект во всех кабинетах, поэтому здесь и в
    // кабинете организации теперь «Обращения» (решение заказчика 09.08.2026).
    { href: '/partner/requests', sectionKey: 'requests' },
    {
      href: '/partner/enrollments',
      sectionKey: 'enrollments',
    },
    {
      href: '/partner/certificates',
      sectionKey: 'certificates',
    },
    { href: '/partner/documents', sectionKey: 'documents' },
    { href: '/partner/finance', sectionKey: 'finance' },
    // `У-115`: «Портфель» стоит там же, где у заказчика «Моя организация» —
    // восьмым пунктом. Это разные объекты (у партнёра список его клиентов, у
    // заказчика — своя организация), поэтому расхождение записано в
    // `mirrorExceptions.ts` с причиной; МЕСТО в меню при этом общее.
    { href: '/partner/portfolio', sectionKey: 'portfolio' },
    // Этап 6 (`У-237`): материалы от учебного центра — между «Портфелем» и
    // «Сообщениями»; у заказчика аналога нет (исключение зеркала записано).
    { href: '/partner/materials', sectionKey: 'materials' },
    // У-60 (этап 4): «Команда» уехала из главного меню на вкладку настроек —
    // это служебный раздел, ему не место рядом с «Заказами». Прежний адрес
    // /partner/team удалён (`У-263`).
    // `У-234`: раздел несёт переписку с менеджером и чат по заказам — живёт,
    // пока включён хотя бы один домен.
    { href: '/partner/messages', sectionKey: 'messages', anyFlags: ['chat', 'cabinet_questions'] },
    // Этап 5 (`У-228`): лента уведомлений — над «Настройками», под флагом
    // `notification_center` до приёмки (`Р-Э5-8`).
    {
      href: '/partner/notifications',
      sectionKey: 'notifications',
      flag: 'notification_center',
      pinnedBottom: true,
    },
    { href: '/partner/settings', sectionKey: 'settings', pinnedBottom: true },
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
    },
    {
      href: '/organization/orders',
      sectionKey: 'orders',
    },
    // Было «Мои заявки» — см. комментарий у партнёра.
    {
      href: '/organization/requests',
      sectionKey: 'requests',
    },
    {
      href: '/organization/enrollments',
      sectionKey: 'enrollments',
    },
    {
      href: '/organization/certificates',
      sectionKey: 'certificates',
    },
    {
      href: '/organization/documents',
      sectionKey: 'documents',
    },
    {
      href: '/organization/finance',
      sectionKey: 'finance',
    },
    // `У-100`: сотрудники и доступ в кабинет — это части ОДНОГО объекта, своей
    // организации, а были двумя отдельными пунктами меню. Теперь это один
    // раздел с вкладками, как карточка организации у сотрудников ЦО и
    // партнёра (§0.2, правило зеркала). Старые адреса остались шлюзами.
    {
      href: '/organization/company',
      sectionKey: 'myOrganization',
    },
    // «Сообщения» намеренно под более узким флагом chat (см. CLAUDE.md §5);
    // /student — отдельный shared-entry домен, не часть organization_cabinet.
    // `У-234`: зеркало партнёрского пункта — те же два домена.
    {
      href: '/organization/messages',
      sectionKey: 'messages',
      anyFlags: ['chat', 'cabinet_questions'],
    },
    { href: '/student', sectionKey: 'studentCabinet' },
    // Этап 5 (`У-228`): лента уведомлений — над «Настройками», под флагом
    // `notification_center` до приёмки (`Р-Э5-8`).
    {
      href: '/organization/notifications',
      sectionKey: 'notifications',
      flag: 'notification_center',
      pinnedBottom: true,
    },
    {
      href: '/organization/settings',
      sectionKey: 'settings',
      pinnedBottom: true,
    },
    // `У-76`: словарь терминов — один на все кабинеты, поэтому пункт одинаков
    // у всех шести ролей и закреплён внизу рядом с «Настройками».
    { href: '/help', sectionKey: 'help', pinnedBottom: true },
  ],
  student: [
    { href: '/student', sectionKey: 'learning' },
    // Этап 2 ТЗ 13.10.2026 (`У-284`).
    { href: '/student/profile', sectionKey: 'myProfile' },
    // Этап 5 (`У-228`): у слушателя «Настроек» нет — лента встаёт над
    // «Справкой». С этапа 2 ТЗ 13.10.2026 (`У-286`) в ней — уведомления о его
    // обучении.
    {
      href: '/student/notifications',
      sectionKey: 'notifications',
      flag: 'notification_center',
      pinnedBottom: true,
    },
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
export function navItemsFor(role: Role | 'leader'): NavItem[] {
  return navByRole[role]
    .filter((item) => {
      if (item.flag && !isFeatureEnabled(item.flag)) return false;
      if (item.anyFlags && !item.anyFlags.some((f) => isFeatureEnabled(f))) return false;
      return true;
    })
    .map(({ childrenOf, ...item }) => (childrenOf ? { ...item, children: childrenOf() } : item));
}
