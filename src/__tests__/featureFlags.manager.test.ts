import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // `У-262`: флагов `manager_cabinet` и `leader_cabinet` больше нет — чистим
  // окружение целиком, чтобы меню собиралось как на пустом env.
  process.env = { ...ORIGINAL_ENV };
  // Прогон №37: «пустой env» делаем буквальным — иначе переменные из `.env`
  // стенда (там включены мессенджеры и звонки) подмешивались бы в меню.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEATURE_')) delete process.env[key];
  }
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
      // `У-312`: воронка — вид внутри «Лидов», отдельного пункта нет.
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
    const items = navItemsFor('manager');
    // Прогон №37 (§0.3 «ничего не включается на сервере»): на пустом env
    // менеджер видит все готовые разделы. Скрыты только «Входящие письма»,
    // «Мессенджеры» и «Звонки» — их флаги ждут внешний сервис (бот, АТС).
    expect(items.map((i) => i.label)).toEqual([
      'Главная',
      'Поиск',
      'Заказы',
      'Лиды',
      // `У-262`: «Обращения» и «Заявки на обучение» появились в списке без
      // всякого окружения — их флаги сняты, разделы есть всегда.
      'Обращения',
      // `У-262`: «Входящие в работу» и «Сделки» тоже без флагов.
      'Входящие в работу',
      'Сделки',
      'Задачи',
      'Календарь',
      'Организации',
      'Контакты',
      'Финансы',
      // `У-113`: две загрузки схлопнуты в один раздел с вкладками.
      'Обмен с 1С',
      'Документы',
      'Заявки на обучение',
      'Сообщения',
      'Уведомления',
      'Настройки',
      'Справка',
    ]);
    expect(items.map((i) => i.label)).not.toContain('Команда');
  });
});
