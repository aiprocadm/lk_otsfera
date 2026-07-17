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

  it.each(['0', 'false', 'off', 'no', 'disabled'])(
    'stays disabled for falsy value %s',
    (val) => {
      process.env.FEATURE_MANAGER_CABINET = val;
      expect(isFeatureEnabled('manager_cabinet')).toBe(false);
    }
  );

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
  it('lists all nineteen manager cabinet items in the raw nav (including leader-only Команда + вход в /leader + Воронка + Задачи + Календарь + Обращения + Звонки + Настройки)', () => {
    expect(navByRole.manager.map((i) => i.href)).toEqual([
      '/manager/dashboard',
      '/manager/orders',
      '/manager/leads',
      '/manager/funnel',
      '/manager/tasks',
      '/manager/calendar',
      '/manager/organizations',
      '/manager/finance',
      '/manager/import',
      '/manager/payments-import',
      '/manager/documents',
      '/manager/students',
      '/manager/enrollments',
      '/manager/messages',
      '/manager/inbox',
      '/manager/calls',
      '/manager/team',
      '/leader/dashboard',
      '/manager/settings'
    ]);
  });

  it('every manager item carries flag=manager_cabinet (so they hide together), кроме enrollments/funnel/tasks/calendar/inbox/calls (свои флаги) и входа в /leader (leader_cabinet)', () => {
    const ownItems = navByRole.manager.filter(
      (i) =>
        i.href.startsWith('/manager/') &&
        i.href !== '/manager/enrollments' &&
        i.href !== '/manager/funnel' &&
        i.href !== '/manager/tasks' &&
        i.href !== '/manager/calendar' &&
        i.href !== '/manager/inbox' &&
        i.href !== '/manager/calls'
    );
    expect(ownItems.every((i) => i.flag === 'manager_cabinet')).toBe(true);
    const enrollment = navByRole.manager.find((i) => i.href === '/manager/enrollments');
    expect(enrollment?.flag).toBe('enrollment_requests');
    const funnel = navByRole.manager.find((i) => i.href === '/manager/funnel');
    expect(funnel?.flag).toBe('sales_funnel');
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

  it('navItemsFor("manager") returns [] when the flag is off (default)', () => {
    expect(navItemsFor('manager')).toEqual([]);
  });

  it('navItemsFor("manager") returns eleven items (no leader-only) when the flag is on but not a leader', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    const items = navItemsFor('manager');
    expect(items).toHaveLength(11);
    expect(items.map((i) => i.label)).toEqual([
      'Главная',
      'Заказы',
      'Заявки',
      'Организации',
      'Финансы',
      'Загрузка из 1С',
      'Импорт оплат',
      'Документы',
      'Сотрудники',
      'Сообщения',
      'Настройки'
    ]);
  });

  it('navItemsFor("manager") returns twelve items (with Команда) when the flag is on and isManagerLeader=true', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    const items = navItemsFor('manager', { isManagerLeader: true });
    expect(items).toHaveLength(12);
    expect(items.map((i) => i.label)).toEqual([
      'Главная',
      'Заказы',
      'Заявки',
      'Организации',
      'Финансы',
      'Загрузка из 1С',
      'Импорт оплат',
      'Документы',
      'Сотрудники',
      'Сообщения',
      'Команда',
      'Настройки'
    ]);
  });
});
