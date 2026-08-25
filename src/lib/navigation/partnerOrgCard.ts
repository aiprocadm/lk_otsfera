import type { OrgCardTabKey } from './orgCardTabs';

/**
 * Адрес вкладки карточки организации в кабинете партнёра (`У-96`).
 *
 * Состав вкладок партнёр берёт из общего реестра, но две из них остались
 * самостоятельными экранами: у «Документов» свой отбор по типам со счётчиками,
 * у «Настроек» — формы реквизитов и доступа. Складывать их во вкладку значило
 * бы потерять эти возможности, поэтому реестр ведёт на страницы.
 *
 * Правило живёт здесь, а не в трёх экранах: иначе переключатель на странице
 * документов и переключатель на карточке разъехались бы адресами.
 */
const OWN_PAGES: Partial<Record<OrgCardTabKey, string>> = {
  documents: 'documents',
  settings: 'settings',
};

export function partnerOrgTabHref(orgId: string, key: OrgCardTabKey): string {
  const page = OWN_PAGES[key];
  return page
    ? `/partner/portfolio/${orgId}/${page}`
    : `/partner/portfolio/${orgId}?tab=${key}`;
}
