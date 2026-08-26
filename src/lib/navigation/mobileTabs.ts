import type { Role } from '@/lib/auth/jwt';
import type { NavItem } from './cabinet';
import type { SectionKey } from './sectionLabels';

/**
 * Нижняя панель телефона (`У-15`, `У-117`).
 *
 * **Почему не «первые четыре пункта меню».** У администратора меню начинается
 * со «Здоровья» и «Настроек» — это не то, ради чего открывают кабинет с
 * телефона. Порядок здесь — приоритет: что человек ищет первым делом.
 *
 * **Почему ключ раздела, а не адрес (`У-117`).** Список был на адресах, и это
 * ломалось дважды. Во-первых, переименование раздела (`/partner/orders` →
 * `/partner/orders`, `У-109`) молча выкидывало вкладку из панели: адрес в
 * списке переставал совпадать. Во-вторых — и это дефект `Д-40` — половина
 * пунктов сидит под opt-in флагами, выключенными по умолчанию: у менеджера
 * «Входящие» и «Задачи» гасли, и панель схлопывалась до **двух** вкладок.
 *
 * Поэтому список стал приоритетным и заведомо длиннее четырёх: выключённый
 * пункт заменяется следующим, а если и запасных не хватило — панель добирается
 * обычными пунктами меню. Четыре вкладки есть всегда, пока в меню есть четыре
 * доступных раздела.
 *
 * Пятая вкладка — «Ещё», её рисует сама панель.
 */
export const MOBILE_TABS: Record<Role | 'leader', SectionKey[]> = {
  admin: ['dashboard', 'organizations', 'documents', 'requests', 'enrollments', 'finance'],
  manager: ['dashboard', 'orders', 'intake', 'tasks', 'organizations', 'documents'],
  leader: ['dashboard', 'orders', 'finance', 'tasks', 'organizations', 'documents'],
  partner: ['dashboard', 'orders', 'requests', 'documents', 'portfolio', 'finance'],
  organization: ['dashboard', 'orders', 'requests', 'documents', 'certificates', 'finance'],
  student: ['learning'],
};

/** Сколько вкладок держим, пока хватает доступных разделов. */
const MIN_TABS = 4;

/**
 * Вкладки нижней панели для роли — из **уже отфильтрованного** меню.
 *
 * Раздел, скрытый флагом или правами (`navItemsFor` его не вернул), во вкладках
 * не появится: иначе панель вела бы в 404. Вместо него встаёт следующий по
 * приоритету, а затем — обычные пункты меню в их порядке.
 *
 * «Настройки» и «Справка» в добор не идут: они и так закреплены внизу меню,
 * которое открывает вкладка «Ещё», и вытеснять ими рабочий раздел незачем.
 */
export function mobileTabsFor(role: Role | 'leader', items: NavItem[]): NavItem[] {
  // Ключ раздела может встретиться в меню роли не единожды (мост в соседний
  // кабинет носит свой ключ), поэтому берём ПЕРВОЕ вхождение — оно и есть
  // «свой» раздел.
  // Пункт с пометкой «скоро» (`disabled`) в панель не попадает ни приоритетом,
  // ни добором: в меню он нарисован НЕ ссылкой, а панель сделала бы из него
  // ссылку — и увела бы в раздел, которого ещё нет.
  const available = items.filter((i) => !i.disabled);

  const byKey = new Map<SectionKey, NavItem>();
  for (const item of available) {
    if (!byKey.has(item.sectionKey)) byKey.set(item.sectionKey, item);
  }

  const tabs: NavItem[] = [];
  const taken = new Set<SectionKey>();

  // Шелл партнёра и слушателя рисуется по роли из сессии, и роль может
  // оказаться незнакомой (старый токен, новая роль). Тогда панели нет вовсе:
  // приоритет разделов неизвестен, а панель «из чего попало» хуже, чем её
  // отсутствие. Кабинет при этом не падает.
  const priority = MOBILE_TABS[role] as SectionKey[] | undefined;
  if (!priority) return [];

  for (const key of priority) {
    if (tabs.length >= MIN_TABS) break;
    const item = byKey.get(key);
    if (item && !taken.has(key)) {
      tabs.push(item);
      taken.add(key);
    }
  }

  // Добор до четырёх: `Д-40` — панель не имеет права схлопнуться, если в меню
  // ещё есть куда вести.
  if (tabs.length < MIN_TABS) {
    for (const item of available) {
      if (tabs.length >= MIN_TABS) break;
      if (item.pinnedBottom || taken.has(item.sectionKey)) continue;
      tabs.push(item);
      taken.add(item.sectionKey);
    }
  }

  return tabs;
}
