/**
 * Группировка позиций заявки по обучению (`У-43`, этап 6).
 *
 * Чистая функция: её зовут и деталка подателя, и очередь проверяющего — оба
 * экрана обязаны показывать одно и то же (в ТЗ это «во всех пяти кабинетах»,
 * а на деле два общих компонента).
 *
 * Порядок групп — порядок первого появления позиции, чтобы разбивка не
 * «прыгала» между обновлениями. Позиции старых заявок, где направление есть
 * только на шапке (до `У-36`), собираются в понятную группу-заглушку, а не
 * теряются.
 */
export const NO_DIRECTION_TITLE = 'Направление не указано';

export function groupItemsByDirection<T extends { directionName: string | null }>(
  items: T[]
): Array<{ title: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const title = item.directionName ?? NO_DIRECTION_TITLE;
    const bucket = groups.get(title);
    if (bucket) bucket.push(item);
    else groups.set(title, [item]);
  }
  return [...groups.entries()].map(([title, list]) => ({ title, items: list }));
}
