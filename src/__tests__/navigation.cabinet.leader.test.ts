import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FEATURE_LEADER_CABINET;
  delete process.env.FEATURE_MANAGER_CABINET;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('канон leader', () => {
  it('18 пунктов: сводка/поиск/команда/финансы/корректировки/заказы/организации/роли/воронка/сделки/аналитика/задачи/календарь/обучение/обращения клиентов/сообщения/мои заказы/настройки', () => {
    expect(navByRole.leader.map((i) => i.href)).toEqual([
      '/leader/dashboard',
      '/leader/search',
      '/leader/team',
      '/leader/finance',
      '/leader/commission-corrections',
      '/leader/orders',
      '/leader/organizations',
      '/leader/roles',
      '/leader/funnel',
      '/leader/deals',
      '/leader/analytics',
      '/leader/tasks',
      '/leader/calendar',
      '/leader/enrollments',
      '/leader/requests',
      '/manager/messages',
      '/manager/dashboard',
      '/leader/settings'
    ]);
  });

  it('пункты leader-меню без flag, кроме «Поиска», «Заявок», «Обращений клиентов», «Ролей», «Воронки», «Сделок», «Аналитики», «Задач» и «Календаря» (свои opt-in флаги)', () => {
    for (const item of navByRole.leader) {
      if (item.href === '/leader/search') {
        expect(item.flag).toBe('global_search');
      } else if (item.href === '/leader/deals') {
        expect(item.flag).toBe('deals_pipeline');
      } else if (item.href === '/leader/enrollments') {
        expect(item.flag).toBe('enrollment_requests');
      } else if (item.href === '/leader/requests') {
        expect(item.flag).toBe('client_requests');
      } else if (item.href === '/leader/roles') {
        expect(item.flag).toBe('role_constructor');
      } else if (item.href === '/leader/funnel') {
        expect(item.flag).toBe('sales_funnel');
      } else if (item.href === '/leader/analytics') {
        expect(item.flag).toBe('leader_analytics');
      } else if (item.href === '/leader/tasks') {
        expect(item.flag).toBe('internal_tasks');
      } else if (item.href === '/leader/calendar') {
        expect(item.flag).toBe('staff_calendar');
      } else {
        expect(item.flag).toBeUndefined();
      }
    }
  });

  it('«Настройки» указывает на /leader/settings и имеет иконку', () => {
    const settings = navByRole.leader.find((i) => i.href === '/leader/settings');
    expect(settings).toBeDefined();
    expect(settings!.label).toBe('Настройки');
    expect(settings!.icon).toBeTruthy();
    expect(settings!.flag).toBeUndefined();
  });

  it('каждый пункт по-русски и с иконкой', () => {
    for (const item of navByRole.leader) {
      expect(item.label).toMatch(/[А-Яа-яЁё]/);
      expect(item.icon).toBeTruthy();
    }
  });

  it('navItemsFor("leader") без opt-in флагов скрывает «Поиск», «Заявки на обучение», «Обращения клиентов», «Роли», «Воронку», «Сделки», «Аналитику», «Задачи» и «Календарь»', () => {
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).not.toContain('/leader/enrollments');
    expect(hrefs).not.toContain('/leader/requests');
    expect(hrefs).not.toContain('/leader/roles');
    expect(hrefs).not.toContain('/leader/funnel');
    expect(hrefs).not.toContain('/leader/deals');
    expect(hrefs).not.toContain('/leader/analytics');
    expect(hrefs).not.toContain('/leader/tasks');
    expect(hrefs).not.toContain('/leader/calendar');
    expect(hrefs).not.toContain('/leader/search');
    expect(navItemsFor('leader')).toHaveLength(navByRole.leader.length - 9);
  });

  it('navItemsFor("leader") показывает opt-in пункты при включённых флагах', () => {
    process.env.FEATURE_ENROLLMENT_REQUESTS = '1';
    process.env.FEATURE_CLIENT_REQUESTS = '1';
    process.env.FEATURE_ROLE_CONSTRUCTOR = '1';
    process.env.FEATURE_SALES_FUNNEL = '1';
    process.env.FEATURE_DEALS_PIPELINE = '1';
    process.env.FEATURE_LEADER_ANALYTICS = '1';
    process.env.FEATURE_INTERNAL_TASKS = '1';
    process.env.FEATURE_STAFF_CALENDAR = '1';
    process.env.FEATURE_GLOBAL_SEARCH = '1';
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).toContain('/leader/enrollments');
    expect(hrefs).toContain('/leader/requests');
    expect(hrefs).toContain('/leader/roles');
    expect(hrefs).toContain('/leader/funnel');
    expect(hrefs).toContain('/leader/deals');
    expect(hrefs).toContain('/leader/analytics');
    expect(hrefs).toContain('/leader/tasks');
    expect(hrefs).toContain('/leader/calendar');
    expect(hrefs).toContain('/leader/search');
    expect(navItemsFor('leader')).toHaveLength(navByRole.leader.length);
  });
});

describe('меню менеджера при включённом leader_cabinet', () => {
  it('лидер: «Команда» уезжает, появляется «Кабинет руководителя»', () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager', { isManagerLeader: true }).map((i) => i.label);
    expect(labels).not.toContain('Команда');
    expect(labels).toContain('Кабинет руководителя');
  });

  it('при выключенном флаге всё как раньше: «Команда» у лидера, входа в /leader нет', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager', { isManagerLeader: true }).map((i) => i.label);
    expect(labels).toContain('Команда');
    expect(labels).not.toContain('Кабинет руководителя');
  });

  it('рядовой менеджер не видит ни «Команду», ни «Кабинет руководителя» ни при каком флаге', () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager').map((i) => i.label);
    expect(labels).not.toContain('Команда');
    expect(labels).not.toContain('Кабинет руководителя');
  });

  it('пункт /manager/team помечен hiddenWhenFlag: leader_cabinet', () => {
    const team = navByRole.manager.find((i) => i.href === '/manager/team');
    expect(team).toBeDefined();
    expect(team!.hiddenWhenFlag).toBe('leader_cabinet');
  });

  it('пункт-вход /leader/dashboard в меню менеджера гейтится leader_cabinet + leaderOnly', () => {
    const entry = navByRole.manager.find((i) => i.href === '/leader/dashboard');
    expect(entry).toBeDefined();
    expect(entry!.flag).toBe('leader_cabinet');
    expect(entry!.leaderOnly).toBe(true);
  });
});
