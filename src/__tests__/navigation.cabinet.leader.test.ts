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
  it('состав меню руководителя: свои «Сообщения» и «Документы», без пунктов-мостов в чужой кабинет', () => {
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
      '/leader/intake',
      // `У-110`: раздел свой, а не мост в кабинет менеджера.
      '/leader/messages',
      '/leader/documents',
      // `У-111`: пункта «Мои заказы» здесь больше нет — кабинет переключается
      // в шапке, а не пунктом меню, спрятанным среди разделов работы.
      '/leader/settings',
      // §11 ТЗ v0.5: зеркало настройки полей — руководителя в /admin/* не пускаем
      '/leader/settings/custom-fields',
      // §10 ТЗ v0.5: там же зеркало справочника статусов
      '/leader/settings/order-statuses',
      // `У-76` (этап 9): словарь терминов, закреплён внизу.
      '/help',
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
      } else if (item.href === '/leader/intake') {
        expect(item.flag).toBe('intake_inbox');
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

  it('«Статусы заявок» ведут в кабинет руководителя, без флага (§10 ТЗ v0.5)', () => {
    const item = navByRole.leader.find((i) => i.href === '/leader/settings/order-statuses');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Статусы заявок');
    expect(item!.group).toBe('Справочники');
    expect(item!.flag).toBeUndefined();
    expect(item!.href.startsWith('/admin')).toBe(false);
  });

  it('«Дополнительные поля» ведут в кабинет руководителя, без флага (§11 ТЗ v0.5)', () => {
    const item = navByRole.leader.find((i) => i.href === '/leader/settings/custom-fields');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Дополнительные поля');
    expect(item!.group).toBe('Справочники');
    expect(item!.flag).toBeUndefined();
    // ключевое: ссылка НЕ в админский кабинет
    expect(item!.href.startsWith('/admin')).toBe(false);
  });

  it('«Настройки» указывает на /leader/settings и имеет иконку', () => {
    const settings = navByRole.leader.find((i) => i.href === '/leader/settings');
    expect(settings).toBeDefined();
    expect(settings!.label).toBe('Настройки');
    expect(settings!.iconKey).toBeTruthy();
    expect(settings!.flag).toBeUndefined();
  });

  it('каждый пункт по-русски и с иконкой', () => {
    for (const item of navByRole.leader) {
      expect(item.label).toMatch(/[А-Яа-яЁё]/);
      expect(item.iconKey).toBeTruthy();
    }
  });

  it('navItemsFor("leader") без opt-in флагов скрывает «Поиск», «Заявки на обучение», «Обращения», «Роли», «Воронку», «Сделки», «Аналитику», «Задачи» и «Календарь»', () => {
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
    expect(hrefs).not.toContain('/leader/intake');
    expect(navItemsFor('leader')).toHaveLength(navByRole.leader.length - 10);
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
    process.env.FEATURE_INTAKE_INBOX = '1';
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
    expect(hrefs).toContain('/leader/intake');
    expect(navItemsFor('leader')).toHaveLength(navByRole.leader.length);
  });
});

describe('меню менеджера при включённом leader_cabinet', () => {
  it('лидер: «Команда» уезжает в свой кабинет', () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager', { isManagerLeader: true }).map((i) => i.label);
    expect(labels).not.toContain('Команда');
  });

  it('при выключенном флаге всё как раньше: «Команда» у лидера на месте', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager', { isManagerLeader: true }).map((i) => i.label);
    expect(labels).toContain('Команда');
  });

  it('рядовой менеджер не видит «Команду» ни при каком флаге', () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager').map((i) => i.label);
    expect(labels).not.toContain('Команда');
  });

  it('пункт /manager/team помечен hiddenWhenFlag: leader_cabinet', () => {
    const team = navByRole.manager.find((i) => i.href === '/manager/team');
    expect(team).toBeDefined();
    expect(team!.hiddenWhenFlag).toBe('leader_cabinet');
  });

  it('`У-111`: пункта-входа в кабинет руководителя в меню менеджера больше нет', () => {
    // Он был закреплён внизу и назывался «Кабинет руководителя», а в меню
    // руководителя то же действие звалось «Мои заказы». Теперь смена кабинета
    // живёт в шапке одним переключателем, и её не надо искать среди разделов.
    expect(navByRole.manager.find((i) => i.href === '/leader/dashboard')).toBeUndefined();
    expect(navByRole.manager.filter((i) => i.href.startsWith('/leader/'))).toEqual([]);
  });
});
