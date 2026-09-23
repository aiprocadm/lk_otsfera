import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';

const ORIGINAL_ENV = { ...process.env };

/** Флаги пунктов меню руководителя — с прогона №37 все включены по умолчанию. */
const LEADER_READY_FLAGS = [
  'FEATURE_GLOBAL_SEARCH',
  'FEATURE_SALES_FUNNEL',
  'FEATURE_LEADER_ANALYTICS',
  'FEATURE_INTERNAL_TASKS',
  'FEATURE_STAFF_CALENDAR',
  'FEATURE_CONTACTS',
  'FEATURE_NOTIFICATION_CENTER',
];

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FEATURE_LEADER_CABINET;
  delete process.env.FEATURE_MANAGER_CABINET;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// `У-262`: три проверки отсюда убраны вместе с пунктами меню, которые заменил
// хаб «Настройки»: «Роли», «Статусы заявок» и «Дополнительные поля». Пункты
// прятались флагом `settings_hub`, а он был включён везде — руководитель их
// не видел и попадал в разделы через «Настройки». Сами разделы на месте:
// реестр хаба объявляет их для кабинетов `['admin', 'leader']`.
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
      // Этап 1 ТЗ 12.09.2026 (`У-178`): справочник контактов, свой флаг `contacts`.
      '/leader/contacts',
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
      // Этап 5 ТЗ 12.09.2026 (`У-228`): «Уведомления» над «Настройками», флаг `notification_center`.
      '/leader/notifications',
      '/leader/settings',
      // §11 ТЗ v0.5: зеркало настройки полей — руководителя в /admin/* не пускаем
      // §10 ТЗ v0.5: там же зеркало справочника статусов
      // `У-76` (этап 9): словарь терминов, закреплён внизу.
      '/help',
    ]);
  });

  it('пункты leader-меню без flag, кроме «Поиска», «Заявок», «Обращений клиентов», «Ролей», «Воронки», «Сделок», «Аналитики», «Задач» и «Календаря» (свои opt-in флаги)', () => {
    for (const item of navByRole.leader) {
      // Этап 5 ТЗ 12.09.2026 (`У-228`): «Уведомления» — свой поведенческий флаг.
      if (item.href === '/leader/notifications') {
        expect(item.flag).toBe('notification_center');
        expect(item.pinnedBottom).toBe(true);
      } else if (item.href === '/leader/search') {
        expect(item.flag).toBe('global_search');
      } else if (item.href === '/leader/deals') {
        // `У-262`: флага у сделок больше нет — раздел есть всегда.
        expect(item.flag).toBeUndefined();
      } else if (item.href === '/leader/enrollments') {
        // `У-262`: флага у пункта больше нет — раздел есть всегда.
        expect(item.flag).toBeUndefined();
      } else if (item.href === '/leader/requests') {
        // `У-262`: флага у пункта больше нет — раздел есть всегда.
        expect(item.flag).toBeUndefined();
      } else if (item.href === '/leader/intake') {
        // `У-262`: флага у «Входящих в работу» больше нет.
        expect(item.flag).toBeUndefined();
      } else if (item.href === '/leader/funnel') {
        expect(item.flag).toBe('sales_funnel');
      } else if (item.href === '/leader/analytics') {
        expect(item.flag).toBe('leader_analytics');
      } else if (item.href === '/leader/tasks') {
        expect(item.flag).toBe('internal_tasks');
      } else if (item.href === '/leader/calendar') {
        expect(item.flag).toBe('staff_calendar');
      } else if (item.href === '/leader/contacts') {
        expect(item.flag).toBe('contacts');
      } else {
        expect(item.flag).toBeUndefined();
      }
    }
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

  it('navItemsFor("leader") при выключенных флагах скрывает «Поиск», «Воронку», «Аналитику», «Задачи», «Календарь», «Контакты» и «Уведомления»', () => {
    // Прогон №37: эти функции включены по умолчанию, флаг — аварийный тормоз.
    // Поэтому «выключено» здесь задаётся явно, а не отсутствием переменной.
    for (const flag of LEADER_READY_FLAGS) process.env[flag] = '0';
    const hrefs = navItemsFor('leader').map((i) => i.href);
    // `У-262`: «Заявки на обучение» и «Обращения» из этого списка ушли — их
    // флаги сняты, разделы есть всегда и от окружения больше не зависят.
    expect(hrefs).toContain('/leader/enrollments');
    expect(hrefs).toContain('/leader/requests');
    expect(hrefs).not.toContain('/leader/funnel');
    // `У-262`: «Сделки» из этого списка ушли — флаг снят, раздел есть всегда.
    expect(hrefs).toContain('/leader/deals');
    expect(hrefs).not.toContain('/leader/analytics');
    expect(hrefs).not.toContain('/leader/tasks');
    expect(hrefs).not.toContain('/leader/calendar');
    expect(hrefs).not.toContain('/leader/search');
    // `У-262`: «Входящие в работу» из этого списка ушли — флаг снят.
    expect(hrefs).toContain('/leader/intake');
    expect(hrefs).not.toContain('/leader/contacts');
    expect(hrefs).not.toContain('/leader/notifications');
    expect(navItemsFor('leader')).toHaveLength(navByRole.leader.length - 7);
  });

  it('navItemsFor("leader") без единой переменной FEATURE_* показывает всё меню (§0.3)', () => {
    // Приёмочный критерий «ничего не включается на сервере»: свежий прод без
    // env обязан открывать руководителю полный набор разделов.
    for (const flag of LEADER_READY_FLAGS) delete process.env[flag];
    const hrefs = navItemsFor('leader').map((i) => i.href);
    for (const href of [
      '/leader/search',
      '/leader/funnel',
      '/leader/analytics',
      '/leader/tasks',
      '/leader/calendar',
      '/leader/contacts',
      '/leader/notifications',
    ]) {
      expect(hrefs).toContain(href);
    }
    expect(navItemsFor('leader')).toHaveLength(navByRole.leader.length);
  });

  it('navItemsFor("leader") показывает opt-in пункты при включённых флагах', () => {
    process.env.FEATURE_ROLE_CONSTRUCTOR = '1';
    process.env.FEATURE_SALES_FUNNEL = '1';
    process.env.FEATURE_LEADER_ANALYTICS = '1';
    process.env.FEATURE_INTERNAL_TASKS = '1';
    process.env.FEATURE_STAFF_CALENDAR = '1';
    process.env.FEATURE_GLOBAL_SEARCH = '1';
    process.env.FEATURE_CONTACTS = '1';
    process.env.FEATURE_NOTIFICATION_CENTER = '1';
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).toContain('/leader/notifications');
    expect(hrefs).toContain('/leader/contacts');
    expect(hrefs).toContain('/leader/enrollments');
    expect(hrefs).toContain('/leader/requests');
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
  it('рядовой менеджер не видит «Команду» ни при каком флаге', () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager').map((i) => i.label);
    expect(labels).not.toContain('Команда');
  });

  it('`У-111`: пункта-входа в кабинет руководителя в меню менеджера больше нет', () => {
    // Он был закреплён внизу и назывался «Кабинет руководителя», а в меню
    // руководителя то же действие звалось «Мои заказы». Теперь смена кабинета
    // живёт в шапке одним переключателем, и её не надо искать среди разделов.
    expect(navByRole.manager.find((i) => i.href === '/leader/dashboard')).toBeUndefined();
    expect(navByRole.manager.filter((i) => i.href.startsWith('/leader/'))).toEqual([]);
  });
});
