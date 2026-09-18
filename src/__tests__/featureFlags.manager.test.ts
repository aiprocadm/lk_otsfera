import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // `У-262`: флагов `manager_cabinet` и `leader_cabinet` больше нет — чистим
  // окружение целиком, чтобы меню собиралось как на пустом env.
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('navByRole.manager', () => {
  // `У-103`: пункт «Сотрудники» снят — сотрудники ведутся в карточке
  // организации, сквозной список показывал людей вперемешку из разных клиентов.
  it('состав меню менеджера: свои разделы и «Справка», без входа в чужой кабинет', () => {
    expect(navByRole.manager.map((i) => i.href)).toEqual([
      '/manager/dashboard',
      '/manager/search',
      '/manager/orders',
      '/manager/leads',
      '/manager/requests',
      '/manager/intake',
      '/manager/funnel',
      '/manager/deals',
      '/manager/tasks',
      '/manager/calendar',
      '/manager/organizations',
      // Этап 1 ТЗ 12.09.2026 (`У-178`): справочник контактов, свой флаг `contacts`.
      '/manager/contacts',
      '/manager/finance',
      '/manager/exchange',
      '/manager/documents',
      '/manager/enrollments',
      '/manager/messages',
      '/manager/inbox',
      '/manager/messengers',
      '/manager/calls',
      // `У-262`: пункта «Команда» здесь больше нет — он прятался флагом
      // `leader_cabinet` и при включённом кабинете руководителя не
      // показывался никому. Адрес остался редиректом ради закладок.
      // `У-111`: пункта-входа в кабинет руководителя здесь больше нет — смена
      // кабинета живёт в шапке.
      // Этап 5 ТЗ 12.09.2026 (`У-228`): «Уведомления» над «Настройками», флаг `notification_center`.
      '/manager/notifications',
      '/manager/settings',
      // `У-76` (этап 9): словарь терминов, закреплён внизу.
      '/help',
    ]);
  });

  // Решение заказчика 11.08.2026 отменило `Т-25`: импорт виден и обычному
  // менеджеру. «Команда» осталась только у руководителя (leaderOnly).
  it('navItemsFor("manager"): обычный менеджер видит импорт, но не «Команду»', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    const items = navItemsFor('manager');
    expect(items.map((i) => i.label)).toEqual([
      'Главная',
      'Заказы',
      'Лиды',
      'Организации',
      'Финансы',
      // `У-113`: две загрузки схлопнуты в один раздел с вкладками.
      'Обмен с 1С',
      'Документы',
      'Сообщения',
      'Настройки',
      'Справка',
    ]);
    expect(items.map((i) => i.label)).not.toContain('Команда');
  });
});
