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
  it('8 пунктов: сводка/команда/финансы/заказы/организации/обучение/сообщения/мои заказы', () => {
    expect(navByRole.leader.map((i) => i.href)).toEqual([
      '/leader/dashboard',
      '/leader/team',
      '/leader/finance',
      '/leader/orders',
      '/leader/organizations',
      '/leader/enrollments',
      '/manager/messages',
      '/manager/dashboard'
    ]);
  });

  it('пункты leader-меню без flag, кроме «Заявок на обучение» (свой opt-in флаг)', () => {
    for (const item of navByRole.leader) {
      if (item.href === '/leader/enrollments') {
        expect(item.flag).toBe('enrollment_requests');
      } else {
        expect(item.flag).toBeUndefined();
      }
    }
  });

  it('каждый пункт по-русски и с иконкой', () => {
    for (const item of navByRole.leader) {
      expect(item.label).toMatch(/[А-Яа-яЁё]/);
      expect(item.icon).toBeTruthy();
    }
  });

  it('navItemsFor("leader") без флага enrollment скрывает «Заявки на обучение» (opt-in off)', () => {
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).not.toContain('/leader/enrollments');
    expect(navItemsFor('leader')).toHaveLength(navByRole.leader.length - 1);
  });

  it('navItemsFor("leader") показывает «Заявки на обучение» при включённом флаге', () => {
    process.env.FEATURE_ENROLLMENT_REQUESTS = '1';
    expect(navItemsFor('leader').map((i) => i.href)).toContain('/leader/enrollments');
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
