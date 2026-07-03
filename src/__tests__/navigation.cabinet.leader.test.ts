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
  it('12 пунктов: сводка/команда/финансы/корректировки/заказы/организации/роли/воронка/обучение/сообщения/мои заказы/настройки', () => {
    expect(navByRole.leader.map((i) => i.href)).toEqual([
      '/leader/dashboard',
      '/leader/team',
      '/leader/finance',
      '/leader/commission-corrections',
      '/leader/orders',
      '/leader/organizations',
      '/leader/roles',
      '/leader/funnel',
      '/leader/enrollments',
      '/manager/messages',
      '/manager/dashboard',
      '/leader/settings'
    ]);
  });

  it('пункты leader-меню без flag, кроме «Заявок», «Ролей» и «Воронки» (свои opt-in флаги)', () => {
    for (const item of navByRole.leader) {
      if (item.href === '/leader/enrollments') {
        expect(item.flag).toBe('enrollment_requests');
      } else if (item.href === '/leader/roles') {
        expect(item.flag).toBe('role_constructor');
      } else if (item.href === '/leader/funnel') {
        expect(item.flag).toBe('sales_funnel');
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

  it('navItemsFor("leader") без opt-in флагов скрывает «Заявки на обучение», «Роли» и «Воронку»', () => {
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).not.toContain('/leader/enrollments');
    expect(hrefs).not.toContain('/leader/roles');
    expect(hrefs).not.toContain('/leader/funnel');
    expect(navItemsFor('leader')).toHaveLength(navByRole.leader.length - 3);
  });

  it('navItemsFor("leader") показывает opt-in пункты при включённых флагах', () => {
    process.env.FEATURE_ENROLLMENT_REQUESTS = '1';
    process.env.FEATURE_ROLE_CONSTRUCTOR = '1';
    process.env.FEATURE_SALES_FUNNEL = '1';
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).toContain('/leader/enrollments');
    expect(hrefs).toContain('/leader/roles');
    expect(hrefs).toContain('/leader/funnel');
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
