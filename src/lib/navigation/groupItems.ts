import type { NavItem } from './cabinet';

export type NavGroup = { title: string; items: NavItem[] };

/**
 * Группировка пунктов меню по `group` (ФТ-15.1).
 *
 * Секции с одинаковым названием склеиваются независимо от позиции пунктов в
 * массиве — иначе разрозненная группа даёт дубль заголовка и дубль React-key.
 * Пункты без `group` попадают в безымянную секцию (рендерится без заголовка) —
 * так «Главная»/«Поиск» остаются наверху, вне секций.
 *
 * Вынесено из `admin-sidebar` (этап 11): ту же группировку получают сайдбары
 * менеджера и руководителя.
 */
export function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  const byTitle = new Map<string, NavGroup>();
  for (const item of items) {
    const title = item.group ?? '';
    let group = byTitle.get(title);
    if (!group) {
      group = { title, items: [] };
      byTitle.set(title, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
