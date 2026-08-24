import type { OrgCardCabinet } from './orgCardTabs';

/**
 * Реестр секций вкладки «Настройки» карточки организации (`У-99`).
 *
 * До этапа 2 «настройки организации» были размазаны по кабинетам: реквизиты у
 * админа лежали простынёй на странице, у партнёра — на отдельном экране,
 * ставка комиссии и менеджеры были только у админа, а блок пользователей
 * кабинета висел то под всеми вкладками сразу, то отдельным пунктом меню. Один
 * и тот же набор настроек назывался и располагался по-разному в каждом
 * кабинете — ровно то, что запрещает правило зеркала (§0.2 ТЗ).
 *
 * Теперь состав, названия, пояснения и **порядок** секций живут здесь, а
 * кабинет показывает подмножество: различаются объём данных и права, но не
 * названия и не порядок. Страж `navigation.org-settings-sections.guardrail`
 * держит это механически.
 */
export type OrgSettingsSectionKey =
  | 'requisites'
  | 'cabinetAccess'
  | 'managers'
  | 'commission'
  | 'customFields';

export type OrgSettingsSection = {
  key: OrgSettingsSectionKey;
  /** Название секции — одно на все кабинеты (§0.2, правило зеркала). */
  title: string;
  /** Подзаголовок в одну строку простыми словами (§15, «что здесь делают»). */
  description: string;
  /** Кабинеты, где секция положена. */
  cabinets: readonly OrgCardCabinet[];
};

const ALL: readonly OrgCardCabinet[] = ['admin', 'leader', 'manager', 'partner', 'organization'];
const STAFF: readonly OrgCardCabinet[] = ['admin', 'leader', 'manager'];
/** Ставку видят сотрудники ЦО и партнёр (партнёру — только чтение, `У-3`). */
const STAFF_AND_PARTNER: readonly OrgCardCabinet[] = ['admin', 'leader', 'manager', 'partner'];

/** Порядок здесь — общий порядок секций во всех кабинетах (`У-99`). */
export const ORG_SETTINGS_SECTIONS: readonly OrgSettingsSection[] = [
  {
    key: 'requisites',
    title: 'Реквизиты',
    description: 'Данные организации, которые подставляются в счета, акты и договоры.',
    cabinets: ALL,
  },
  {
    // `У-98`: пользователи кабинета организации везде называются одинаково и
    // живут здесь, а не отдельным пунктом меню и не под всеми вкладками сразу.
    key: 'cabinetAccess',
    title: 'Доступ в кабинет',
    description: 'Кто из сотрудников заказчика может зайти в личный кабинет организации.',
    cabinets: ALL,
  },
  {
    key: 'managers',
    title: 'Менеджеры организации',
    description: 'Сотрудники учебного центра, которые ведут эту организацию.',
    cabinets: STAFF,
  },
  {
    key: 'commission',
    title: 'Ставка комиссии',
    description: 'Индивидуальная ставка партнёра по этой организации и история её изменений.',
    cabinets: STAFF_AND_PARTNER,
  },
  {
    key: 'customFields',
    title: 'Дополнительные поля',
    description: 'Поля, которые учебный центр завёл под свои задачи.',
    cabinets: STAFF,
  },
];

/** Секции кабинета — фильтр реестра, а не свой список на каждом экране. */
export function orgSettingsSectionsFor(cabinet: OrgCardCabinet): OrgSettingsSection[] {
  return ORG_SETTINGS_SECTIONS.filter((s) => s.cabinets.includes(cabinet));
}
