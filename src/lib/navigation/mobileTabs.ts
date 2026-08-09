import type { Role } from '@/lib/auth/jwt';
import type { NavItem } from './cabinet';

/**
 * Нижняя панель телефона: какие четыре раздела показываем в каждом кабинете
 * (`У-15`, этап 3 ТЗ понятности).
 *
 * **Почему явный список, а не «первые четыре пункта меню».** У администратора
 * меню начинается со «Здоровья» и «Настроек» — это не то, ради чего открывают
 * кабинет с телефона. Список согласован с заказчиком 09.08.2026.
 *
 * Пятая вкладка — «Ещё», она рисуется самой панелью и открывает полное меню.
 *
 * Ключ — `href`, а не название: названия ещё будут меняться (этап 2 переименовал
 * пять разделов), а адреса стабильны.
 */
export const MOBILE_TABS: Record<Role | 'leader', string[]> = {
  admin: ['/admin/dashboard', '/admin/organizations', '/admin/documents', '/admin/requests'],
  manager: ['/manager/dashboard', '/manager/orders', '/manager/intake', '/manager/tasks'],
  leader: ['/leader/dashboard', '/leader/orders', '/leader/finance', '/leader/tasks'],
  partner: ['/partner/dashboard', '/partner/deals', '/partner/requests', '/partner/documents'],
  organization: [
    '/organization/dashboard',
    '/organization/orders',
    '/organization/requests',
    '/organization/documents',
  ],
  student: ['/student'],
};

/**
 * Вкладки нижней панели для роли — из **уже отфильтрованного** меню.
 *
 * Раздел, скрытый feature-флагом или правами (`navItemsFor` его не вернул), во
 * вкладках не появится: иначе панель вела бы в 404. Порядок — как в
 * `MOBILE_TABS`, а не как в меню.
 */
export function mobileTabsFor(role: Role | 'leader', items: NavItem[]): NavItem[] {
  const byHref = new Map(items.map((i) => [i.href, i]));
  const tabs: NavItem[] = [];
  // `?? []` — не формальность: шелл партнёра/слушателя рисуется по роли из
  // сессии, и на неизвестной роли (старый токен, новая роль) панель должна
  // просто не появиться, а не уронить весь кабинет.
  for (const href of MOBILE_TABS[role] ?? []) {
    const item = byHref.get(href);
    if (item) tabs.push(item);
  }
  return tabs;
}
