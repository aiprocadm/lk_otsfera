import type { Crumb } from '@/lib/navigation/breadcrumbs';
import type { FeatureFlag } from '@/lib/featureFlags';
import type { SettingsCapability } from '@/lib/auth/accessProfileSchema';

/**
 * Реестр разделов хаба «Настройки» (ТЗ 2026-08-04) — единственный источник
 * правды. Из него выводятся: карточки хаба, боковая навигация, хлебные крошки,
 * проверка прав (`lib/auth/settingsAccess`) и карта редиректов со старых
 * маршрутов. Добавляешь раздел — правишь только этот файл.
 *
 * Хаб живёт в двух кабинетах сотрудников: `/admin/settings` и
 * `/leader/settings`. Раздел объявляет, в каких кабинетах он есть (`cabinets`),
 * а сам путь собирается из кабинета и `path` — зеркала не расходятся.
 */

type SettingsGroupId = 'integrations' | 'catalogs' | 'access' | 'security';
export type SettingsCabinet = 'admin' | 'leader';

export type SettingsSection = {
  /** Стабильный идентификатор (для тестов, крошек и подсветки). */
  id: string;
  group: SettingsGroupId;
  title: string;
  /** Одна строка под названием карточки. Участвует в поиске по хабу. */
  description: string;
  /** Emoji — как в navByRole; своей иконочной библиотеки в проекте нет. */
  icon: string;
  /** Хвост маршрута после `/<кабинет>/settings`. */
  path: string;
  capability: SettingsCapability;
  /** Раздел скрыт целиком, пока флаг выключен (например role_constructor). */
  flag?: FeatureFlag | undefined;
  cabinets: readonly SettingsCabinet[];
  /** Старые маршруты, редиректящие сюда при включённом `settings_hub`. */
  legacyHrefs: readonly LegacyRoute[];
};

/**
 * Старый маршрут раздела. `toPath` нужен там, где один раздел собирает
 * несколько прежних страниц во вкладки: «Обмен с 1С» — это две разные загрузки,
 * и каждая обязана приехать на свою вкладку, а не на общий корень подраздела.
 * `cabinet` — для путей чужого префикса: `/manager/import` руководителя уезжает
 * в leader-хаб, а по префиксу карта вывела бы админский (этап 7 ТЗ импорта).
 */
type LegacyRoute = { from: string; toPath?: string; cabinet?: SettingsCabinet };

/** Порядок групп — из ТЗ §3 (Интеграции → Конфигурация → Доступ → Безопасность). */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; title: string }> = [
  { id: 'integrations', title: 'Интеграции' },
  { id: 'catalogs', title: 'Конфигурация процессов' },
  { id: 'access', title: 'Доступ и роли' },
  { id: 'security', title: 'Безопасность и система' },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'integrations.overview',
    group: 'integrations',
    title: 'Интеграции',
    description: 'Состояние адаптеров: 1С, почта, телефония, боты, хранилище.',
    icon: '🔌',
    path: 'integrations',
    capability: 'settings.integrations.view',
    cabinets: ['admin'],
    legacyHrefs: [{ from: '/admin/integrations' }],
  },
  {
    id: 'integrations.sync',
    group: 'integrations',
    title: 'Синхронизация',
    description: 'Расписания обмена, ручной запуск, история и очереди задач.',
    icon: '🔄',
    path: 'integrations/sync',
    capability: 'settings.integrations.manage',
    cabinets: ['admin'],
    legacyHrefs: [{ from: '/admin/sync' }],
  },
  {
    id: 'integrations.oneC',
    group: 'integrations',
    title: 'Обмен с 1С',
    description: 'Загрузка файлов из 1С: справочники (Excel) и выписка по счёту 51.',
    icon: '🏦',
    path: 'integrations/1c',
    capability: 'settings.integrations.manage',
    // Этап 7 ТЗ импорта (Т-27): руководитель импортирует из своего хаба.
    cabinets: ['admin', 'leader'],
    legacyHrefs: [
      { from: '/admin/import', toPath: 'integrations/1c/excel' },
      { from: '/admin/payments-import', toPath: 'integrations/1c/payments' },
      // Старые адреса менеджерского кабинета — руководителя уводим в его хаб
      // (обычному менеджеру страницы больше не положены, Т-25).
      { from: '/manager/import', toPath: 'integrations/1c/excel', cabinet: 'leader' },
      { from: '/manager/payments-import', toPath: 'integrations/1c/payments', cabinet: 'leader' },
    ],
  },
  {
    id: 'integrations.notifications',
    group: 'integrations',
    title: 'Каналы уведомлений',
    description: 'Telegram, Max, WhatsApp и почта: привязка и выбор событий.',
    icon: '🔔',
    path: 'integrations/notifications',
    capability: 'settings.integrations.view',
    cabinets: ['admin', 'leader'],
    legacyHrefs: [],
  },
  {
    id: 'catalogs.applicationStatuses',
    group: 'catalogs',
    title: 'Статусы заявок',
    description: 'Справочник рабочих статусов: состав, порядок, деактивация.',
    icon: '🚦',
    path: 'catalogs/application-statuses',
    capability: 'settings.catalogs.manage',
    cabinets: ['admin', 'leader'],
    legacyHrefs: [{ from: '/admin/order-statuses' }, { from: '/leader/settings/order-statuses' }],
  },
  {
    id: 'catalogs.customFields',
    group: 'catalogs',
    title: 'Дополнительные поля',
    description: 'Настраиваемые поля карточек: заявка, организация, партнёр, сотрудник, документ.',
    icon: '🧩',
    path: 'catalogs/custom-fields',
    capability: 'settings.catalogs.manage',
    cabinets: ['admin', 'leader'],
    legacyHrefs: [{ from: '/admin/custom-fields' }, { from: '/leader/settings/custom-fields' }],
  },
  {
    id: 'catalogs.requisites',
    group: 'catalogs',
    title: 'Реквизиты исполнителя',
    description: 'Шапка формируемых счетов и актов по каждому юридическому лицу.',
    icon: '🧾',
    path: 'catalogs/requisites',
    capability: 'settings.catalogs.manage',
    cabinets: ['admin'],
    legacyHrefs: [],
  },
  {
    id: 'access.roles',
    group: 'access',
    title: 'Роли и профили доступа',
    description: 'Конструктор ролей: зоны видимости и права сотрудников.',
    icon: '🎭',
    path: 'access/roles',
    capability: 'settings.access.manage',
    flag: 'role_constructor',
    cabinets: ['admin', 'leader'],
    legacyHrefs: [{ from: '/admin/roles' }, { from: '/leader/roles' }],
  },
  {
    id: 'security.audit',
    group: 'security',
    title: 'Аудит',
    description: 'Журнал действий сотрудников: кто, что и когда изменил.',
    icon: '🧾',
    path: 'security/audit',
    capability: 'settings.audit.view',
    cabinets: ['admin'],
    legacyHrefs: [{ from: '/admin/audit' }],
  },
  {
    id: 'security.personalData',
    group: 'security',
    title: 'Доступ к персональным данным',
    description: 'Журнал обращений к ПДн физлиц — требование 152-ФЗ.',
    icon: '🛡️',
    path: 'security/personal-data',
    capability: 'settings.personal_data.view',
    cabinets: ['admin'],
    legacyHrefs: [{ from: '/admin/pii-access' }],
  },
  {
    id: 'security.personal',
    group: 'security',
    title: 'Личная безопасность',
    description: 'Коды восстановления двухфакторного входа и активные сессии.',
    icon: '🔐',
    path: 'security/personal',
    capability: 'settings.system.view',
    cabinets: ['admin', 'leader'],
    legacyHrefs: [],
  },
  {
    id: 'system.health',
    group: 'security',
    title: 'Здоровье системы',
    description: 'База, Redis, очереди, воркеры и внешние сервисы — текущее состояние.',
    icon: '💚',
    path: 'system/health',
    capability: 'settings.system.view',
    cabinets: ['admin'],
    legacyHrefs: [{ from: '/admin/health' }],
  },
  {
    id: 'system.featureFlags',
    group: 'security',
    title: 'Флаги функциональности',
    description: 'Какие модули включены на этом стенде.',
    icon: '🎚️',
    path: 'system/feature-flags',
    capability: 'settings.system.view',
    cabinets: ['admin'],
    legacyHrefs: [],
  },
];

/** Корень хаба в кабинете: `/admin/settings` или `/leader/settings`. */
export function settingsRoot(cabinet: SettingsCabinet): string {
  return `/${cabinet}/settings`;
}

export function settingsHref(section: SettingsSection, cabinet: SettingsCabinet): string {
  return `${settingsRoot(cabinet)}/${section.path}`;
}

export function sectionsForCabinet(cabinet: SettingsCabinet): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => s.cabinets.includes(cabinet));
}

/**
 * Раздел, которому принадлежит путь. Совпадение — по самому длинному `path`
 * (иначе `integrations/sync` схлопнулся бы в `integrations`). Корень хаба
 * разделом не является — возвращаем undefined.
 */
export function sectionByPath(
  cabinet: SettingsCabinet,
  pathname: string
): SettingsSection | undefined {
  const root = `${settingsRoot(cabinet)}/`;
  if (!pathname.startsWith(root)) return undefined;
  const tail = pathname.slice(root.length);
  let best: SettingsSection | undefined;
  for (const section of sectionsForCabinet(cabinet)) {
    if (tail !== section.path && !tail.startsWith(`${section.path}/`)) continue;
    if (!best || section.path.length > best.path.length) best = section;
  }
  return best;
}

/**
 * Старый путь → новый. Кабинет определяется префиксом самого старого пути
 * (`/leader/roles` → leader-хаб, `/admin/roles` → админский); явный
 * `legacy.cabinet` побеждает — для путей чужого префикса вроде
 * `/manager/import`, уезжающего в хаб руководителя.
 */
export function legacyRedirectMap(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const section of SETTINGS_SECTIONS) {
    for (const legacy of section.legacyHrefs) {
      const cabinet: SettingsCabinet =
        legacy.cabinet ?? (legacy.from.startsWith('/leader') ? 'leader' : 'admin');
      const target = legacy.toPath
        ? `${settingsRoot(cabinet)}/${legacy.toPath}`
        : settingsHref(section, cabinet);
      map.set(legacy.from, target);
    }
  }
  return map;
}

/**
 * Хлебные крошки подраздела: «Настройки → Интеграции → Обмен с 1С» (ТЗ §4.3).
 * Группа страницы не имеет, поэтому идёт без ссылки; последняя крошка — текущий
 * раздел. На корне хаба крошек нет (заголовок страницы и так «Настройки»).
 */
export function buildSettingsBreadcrumbs(cabinet: SettingsCabinet, pathname: string): Crumb[] {
  const section = sectionByPath(cabinet, pathname);
  if (!section) return [];
  const group = SETTINGS_GROUPS.find((g) => g.id === section.group);
  return [
    { label: 'Настройки', href: settingsRoot(cabinet) },
    /* v8 ignore next -- `?? ''` недостижим: `section.group` типизирован союзом SettingsGroupId, и SETTINGS_GROUPS содержит ровно эти четыре id, поэтому find() всегда что-то находит (инвариант закреплён тестом «у каждого раздела есть своя группа») */
    { label: group?.title ?? '', href: null },
    { label: section.title, href: null },
  ];
}
