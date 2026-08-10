/**
 * Группировка позиций заявки по обучению (`У-43`, этап 6).
 *
 * Чистая функция: её зовут и деталка подателя, и очередь проверяющего — оба
 * экрана обязаны показывать одно и то же (в ТЗ это «во всех пяти кабинетах»,
 * а на деле два общих компонента).
 *
 * Порядок групп — порядок первого появления позиции, чтобы разбивка не
 * «прыгала» между обновлениями. Группы-заглушки «направление не указано»
 * больше нет: с PR-3 «замок» направление у позиции обязательно.
 */
export function groupItemsByDirection<T extends { directionName: string }>(
  items: T[]
): Array<{ title: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const bucket = groups.get(item.directionName);
    if (bucket) bucket.push(item);
    else groups.set(item.directionName, [item]);
  }
  return [...groups.entries()].map(([title, list]) => ({ title, items: list }));
}
