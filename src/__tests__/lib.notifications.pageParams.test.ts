import { describe, it, expect } from 'vitest';
import { readNotificationsSearchParams } from '@/lib/notifications/pageParams';

/** Разбор адреса страницы «Уведомления» (`У-228`): мусор не роняет страницу. */

describe('readNotificationsSearchParams', () => {
  it('пустой адрес — всё, первая страница, без группы и типа', () => {
    expect(readNotificationsSearchParams({})).toEqual({
      unread: false,
      group: null,
      type: null,
      page: 1,
    });
  });

  it('фильтры читаются; массив (повтор параметра) игнорируется', () => {
    expect(
      readNotificationsSearchParams({
        unread: '1',
        group: 'tasks',
        type: 'task_assigned',
        page: '3',
      })
    ).toEqual({ unread: true, group: 'tasks', type: 'task_assigned', page: 3 });
    expect(
      readNotificationsSearchParams({ unread: ['1', '1'], group: ['a', 'b'], type: ['a', 'b'] })
    ).toEqual({
      unread: false,
      group: null,
      type: null,
      page: 1,
    });
  });

  it('некорректный номер страницы становится первой, дробный — округляется вниз', () => {
    expect(readNotificationsSearchParams({ page: 'abc' }).page).toBe(1);
    expect(readNotificationsSearchParams({ page: '0' }).page).toBe(1);
    expect(readNotificationsSearchParams({ page: '-4' }).page).toBe(1);
    expect(readNotificationsSearchParams({ page: '2.9' }).page).toBe(2);
    expect(readNotificationsSearchParams({ page: 'Infinity' }).page).toBe(1);
  });
});
