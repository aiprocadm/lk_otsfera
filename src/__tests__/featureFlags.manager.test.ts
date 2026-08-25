import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isFeatureEnabled, requireFeature, notFoundIfDisabled } from '@/lib/featureFlags';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FEATURE_MANAGER_CABINET;
  delete process.env.FEATURE_LEADER_CABINET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('manager_cabinet (opt-in flag)', () => {
  it('is DISABLED when env is unset (opt-in default)', () => {
    expect(isFeatureEnabled('manager_cabinet')).toBe(false);
  });

  it('is DISABLED when env is empty string', () => {
    process.env.FEATURE_MANAGER_CABINET = '';
    expect(isFeatureEnabled('manager_cabinet')).toBe(false);
  });

  it.each(['0', 'false', 'off', 'no', 'disabled'])('stays disabled for falsy value %s', (val) => {
    process.env.FEATURE_MANAGER_CABINET = val;
    expect(isFeatureEnabled('manager_cabinet')).toBe(false);
  });

  it.each(['1', 'true', 'on', 'yes', 'enabled', 'True', ' 1 '])(
    'is ENABLED for truthy value %s',
    (val) => {
      process.env.FEATURE_MANAGER_CABINET = val;
      expect(isFeatureEnabled('manager_cabinet')).toBe(true);
    }
  );

  it('rejects unknown / garbage values (strict opt-in)', () => {
    process.env.FEATURE_MANAGER_CABINET = 'maybe';
    expect(isFeatureEnabled('manager_cabinet')).toBe(false);
  });

  it('requireFeature throws when disabled (default)', () => {
    expect(() => requireFeature('manager_cabinet')).toThrow();
  });

  it('requireFeature is silent when enabled', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    expect(() => requireFeature('manager_cabinet')).not.toThrow();
  });

  it('notFoundIfDisabled returns 404 when default-disabled', () => {
    const res = notFoundIfDisabled('manager_cabinet');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it('notFoundIfDisabled returns null when explicitly enabled', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    expect(notFoundIfDisabled('manager_cabinet')).toBeNull();
  });
});

describe('navByRole.manager — feature-flag gated', () => {
  // `У-103`: пункт «Сотрудники» снят — сотрудники ведутся в карточке
  // организации, сквозной список показывал людей вперемешку из разных клиентов.
  it('lists all twenty-one manager cabinet items in the raw nav (including Поиск, Обращения, leader-only Команда + вход в /leader + Воронка + Сделки + Задачи + Календарь + Обращения + Звонки + Настройки)', () => {
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
      '/manager/finance',
      '/manager/exchange',
            '/manager/documents',
      '/manager/enrollments',
      '/manager/messages',
      '/manager/inbox',
      '/manager/calls',
      '/manager/team',
      '/leader/dashboard',
      '/manager/settings',
      // `У-76` (этап 9): словарь терминов, закреплён внизу.
      '/help',
    ]);
  });

  it('every manager item carries flag=manager_cabinet (so they hide together), кроме search/requests/enrollments/funnel/deals/tasks/calendar/inbox/calls (свои флаги) и входа в /leader (leader_cabinet)', () => {
    const ownItems = navByRole.manager.filter(
      (i) =>
        i.href.startsWith('/manager/') &&
        i.href !== '/manager/search' &&
        i.href !== '/manager/requests' &&
        i.href !== '/manager/intake' &&
        i.href !== '/manager/enrollments' &&
        i.href !== '/manager/funnel' &&
        i.href !== '/manager/deals' &&
        i.href !== '/manager/tasks' &&
        i.href !== '/manager/calendar' &&
        i.href !== '/manager/inbox' &&
        i.href !== '/manager/calls'
    );
    expect(ownItems.every((i) => i.flag === 'manager_cabinet')).toBe(true);
    const requests = navByRole.manager.find((i) => i.href === '/manager/requests');
    expect(requests?.flag).toBe('client_requests');
    const enrollment = navByRole.manager.find((i) => i.href === '/manager/enrollments');
    expect(enrollment?.flag).toBe('enrollment_requests');
    const search = navByRole.manager.find((i) => i.href === '/manager/search');
    expect(search?.flag).toBe('global_search');
    const funnel = navByRole.manager.find((i) => i.href === '/manager/funnel');
    expect(funnel?.flag).toBe('sales_funnel');
    const deals = navByRole.manager.find((i) => i.href === '/manager/deals');
    expect(deals?.flag).toBe('deals_pipeline');
    const tasks = navByRole.manager.find((i) => i.href === '/manager/tasks');
    expect(tasks?.flag).toBe('internal_tasks');
    const calendar = navByRole.manager.find((i) => i.href === '/manager/calendar');
    expect(calendar?.flag).toBe('staff_calendar');
    const inbox = navByRole.manager.find((i) => i.href === '/manager/inbox');
    expect(inbox?.flag).toBe('inbound_messaging');
    const calls = navByRole.manager.find((i) => i.href === '/manager/calls');
    expect(calls?.flag).toBe('telephony_mango');
    const leaderEntry = navByRole.manager.find((i) => i.href === '/leader/dashboard');
    expect(leaderEntry?.flag).toBe('leader_cabinet');
  });

  it('navItemsFor("manager") при выключенном флаге оставляет только «Справку»', () => {
    // Все рабочие пункты гейтятся флагом кабинета, а словарь терминов (`У-76`)
    // — нет: он общий для всех ролей и от кабинета не зависит. До меню в этом
    // случае всё равно не доходит — middleware отдаёт 404 на весь префикс.
    expect(navItemsFor('manager').map((i) => i.href)).toEqual(['/help']);
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

  it('navItemsFor("manager") руководителю: импорт и «Команда» на месте (leaderOnly)', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    const items = navItemsFor('manager', { isManagerLeader: true });
    // `У-103`: пункт «Сотрудники» снят — было 13. `У-113`: две загрузки
    // схлопнуты в один «Обмен с 1С» — стало 11.
    expect(items).toHaveLength(11); // +«Справка» (`У-76`)
    expect(items.map((i) => i.label)).toEqual([
      'Главная',
      'Заказы',
      'Лиды',
      'Организации',
      'Финансы',
      'Обмен с 1С',
      'Документы',
      'Сообщения',
      'Команда',
      'Настройки',
      'Справка',
    ]);
  });
});
