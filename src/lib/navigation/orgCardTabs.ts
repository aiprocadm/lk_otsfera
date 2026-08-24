import type { FeatureFlag } from '@/lib/featureFlags';
import type { IconKey } from './icons';

/**
 * Реестр вкладок карточки организации (`У-95`, `У-96`).
 *
 * Единственный источник правды: название, значок, порядок, флаг и список
 * кабинетов. **Состав вкладок в кабинете — фильтр этого реестра**, а не свой
 * список в каждом экране: до этапа 2 у менеджера был массив из 12 вкладок в
 * компоненте, у партнёра — свой из 5, у админа вкладок не было вовсе, и один и
 * тот же объект назывался «Заявки» в одном кабинете и «Заказы» в другом.
 *
 * Названия — из глоссария: `Order` → «Заказы», `ClientRequest` → «Обращения»,
 * `InboundMessage` → «Входящие письма». Дореформенные подписи («Заявки»,
 * «Заявки клиентов», «Реквизиты») запрещены стражем
 * `navigation.org-card-tabs.guardrail`.
 *
 * Состав реестра растёт вместе с экранами: вкладки «Обзор», «Заявки на
 * обучение» и «Комментарии» появятся здесь, когда появятся их данные. Пустая
 * вкладка — дефект приёмки (`У-74`), поэтому объявлять её заранее нельзя.
 */
export type OrgCardCabinet = 'admin' | 'leader' | 'manager' | 'partner' | 'organization';

export type OrgCardTabKey =
  | 'overview'
  | 'employees'
  | 'orders'
  | 'enrollments'
  | 'documents'
  | 'payments'
  | 'certificates'
  | 'requests'
  | 'leads'
  | 'deals'
  | 'comments'
  | 'calls'
  | 'inbound'
  | 'history'
  | 'settings';

export type OrgCardTab = {
  key: OrgCardTabKey;
  /** Название по глоссарию — одно на все кабинеты (`У-96`). */
  label: string;
  /** Значок из семантического реестра (`У-9`), не подбирается на глаз. */
  iconKey: IconKey;
  /** Кабинеты, где вкладка положена. Разница — только объём данных и права. */
  cabinets: readonly OrgCardCabinet[];
  /** Флаг, без которого вкладки нет ни у кого. */
  flag?: FeatureFlag;
};

const ALL: readonly OrgCardCabinet[] = ['admin', 'leader', 'manager', 'partner', 'organization'];
const STAFF: readonly OrgCardCabinet[] = ['admin', 'leader', 'manager'];
/** Сотрудники ЦО + партнёр: клиентские данные, которые заказчику про себя не нужны. */
const STAFF_AND_PARTNER: readonly OrgCardCabinet[] = ['admin', 'leader', 'manager', 'partner'];

/**
 * Порядок здесь — общий порядок вкладок во всех кабинетах (`У-96`).
 * Кабинет может показать подмножество, но не может переставить.
 */
export const ORG_CARD_TABS: readonly OrgCardTab[] = [
  // `У-96`: «Обзор» — первая вкладка и вкладка по умолчанию: человек, открывший
  // карточку, сразу видит, что происходит с клиентом. Раньше её роль исполняла
  // вкладка «История», из-за чего настоящей истории (журнала действий) в
  // карточке не было вовсе.
  { key: 'overview', label: 'Обзор', iconKey: 'overview', cabinets: ALL },
  // `У-97`: «Сотрудники» — это `Student` (люди организации), а не пользователи
  // кабинета: их заводит кнопка «Добавить сотрудника» на этой же вкладке.
  { key: 'employees', label: 'Сотрудники', iconKey: 'employees', cabinets: ALL },
  { key: 'orders', label: 'Заказы', iconKey: 'orders', cabinets: ALL },
  {
    key: 'enrollments',
    label: 'Заявки на обучение',
    iconKey: 'enrollments',
    cabinets: ALL,
    flag: 'enrollment_requests',
  },
  { key: 'documents', label: 'Документы', iconKey: 'documents', cabinets: ALL },
  { key: 'payments', label: 'Оплаты', iconKey: 'finance', cabinets: STAFF },
  {
    key: 'certificates',
    label: 'Удостоверения',
    iconKey: 'certificates',
    cabinets: ALL,
    flag: 'certificates_registry',
  },
  {
    key: 'requests',
    label: 'Обращения',
    iconKey: 'requests',
    cabinets: STAFF_AND_PARTNER,
    flag: 'client_requests',
  },
  // `У-96`: вкладка показывает `Comment` — разговор клиента и менеджера по
  // заказам. Называлась «Переписка» и стояла под флагом `chat`, хотя чат — это
  // другой домен (`OrderThread`): человек открывал «Переписку» и видел
  // комментарии, а при выключенном `chat` не видел и их. Комментарии флагом не
  // гейтятся (CLAUDE.md §5), поэтому вкладка есть во всех кабинетах.
  { key: 'comments', label: 'Комментарии', iconKey: 'inbox', cabinets: ALL },
  // Отдельного флага у лидов нет: раздел закрывается флагом кабинета, как и
  // пункт меню «Лиды» у менеджера.
  { key: 'leads', label: 'Лиды', iconKey: 'leads', cabinets: STAFF },
  { key: 'deals', label: 'Сделки', iconKey: 'deals', cabinets: STAFF, flag: 'deals_pipeline' },

  { key: 'calls', label: 'Звонки', iconKey: 'calls', cabinets: STAFF, flag: 'telephony_mango' },
  {
    key: 'inbound',
    label: 'Входящие письма',
    iconKey: 'messages',
    cabinets: STAFF,
    flag: 'inbound_messaging',
  },
  // `У-96`: «История» — журнал действий по организации (кто и что менял). Это
  // внутренняя информация учебного центра, поэтому вкладка только у его
  // сотрудников; клиенту и партнёру полагается «Обзор».
  { key: 'history', label: 'История', iconKey: 'audit', cabinets: STAFF },
  { key: 'settings', label: 'Настройки', iconKey: 'settings', cabinets: ALL },
];

/**
 * Вкладки кабинета: фильтр реестра по роли и флагам. `flags` передаётся
 * вызывающим (страница знает, читать ли флаг синхронно), поэтому реестр
 * остаётся чистым и тестируемым.
 */
export function orgCardTabsFor(
  cabinet: OrgCardCabinet,
  opts: { flags: (flag: FeatureFlag) => boolean }
): OrgCardTab[] {
  return ORG_CARD_TABS.filter(
    (tab) => tab.cabinets.includes(cabinet) && (!tab.flag || opts.flags(tab.flag))
  );
}

/** Подпись вкладки по ключу — для крошек и заголовков (`У-108`). */
export function orgCardTabLabel(key: OrgCardTabKey): string {
  const tab = ORG_CARD_TABS.find((t) => t.key === key);
  // Ключ приходит из типа, поэтому промах возможен только при правке реестра.
  /* v8 ignore next */
  return tab ? tab.label : key;
}
