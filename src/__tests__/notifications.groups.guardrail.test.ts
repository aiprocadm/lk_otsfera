import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES } from '@/lib/notifications/registry';
import { NOTIFICATION_GROUPS, NOTIFICATION_TYPE_GROUP } from '@/lib/notifications/groups';

/**
 * Страж полноты групп уведомлений (`У-317`): у каждого типа реестра — группа
 * из списка, и наоборот, в словаре нет типов, которых нет в реестре. Типы
 * держат это и так (`Record`), тест — на случай обхода через приведение.
 */
describe('группы уведомлений', () => {
  it('каждый тип реестра в одной из пяти групп; лишних ключей нет', () => {
    const groups = new Set(NOTIFICATION_GROUPS.map((g) => g.key));
    expect(Object.keys(NOTIFICATION_TYPE_GROUP).sort()).toEqual(
      Object.keys(NOTIFICATION_TYPES).sort()
    );
    for (const g of Object.values(NOTIFICATION_TYPE_GROUP)) expect(groups.has(g)).toBe(true);
  });

  it('пять групп — ровно те, что просил ПМ, в этом порядке', () => {
    expect(NOTIFICATION_GROUPS.map((g) => g.label)).toEqual([
      'Системные',
      'Коммуникация',
      'Задачи',
      'Заказы',
      'Заявки на обучение',
    ]);
  });
});
