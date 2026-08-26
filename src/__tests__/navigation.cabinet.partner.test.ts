import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';
import { MENU_GROUP_ORDER } from '@/lib/navigation/menuGroups';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FEATURE_PARTNER_LEADS;
  delete process.env.FEATURE_CHAT;
  delete process.env.FEATURE_ORGANIZATION_CABINET;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('navByRole.partner', () => {
  it('contains all active items including Финансы (Phase 4 shipped)', () => {
    const labels = navByRole.partner.filter((i) => !i.disabled).map((i) => i.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Главная', 'Портфель', 'Заказы', 'Документы', 'Финансы'])
    );
  });

  it('has no disabled items (all phases shipped)', () => {
    const disabled = navByRole.partner.filter((i) => i.disabled);
    expect(disabled).toHaveLength(0);
  });

  it('all items have href and label', () => {
    for (const item of navByRole.partner) {
      expect(item.href).toBeTypeOf('string');
      expect(item.label).toBeTypeOf('string');
    }
  });

  it('admin/manager/organization/student nav unchanged shape', () => {
    expect(Array.isArray(navByRole.admin)).toBe(true);
    expect(Array.isArray(navByRole.manager)).toBe(true);
    expect(navByRole.admin.length).toBeGreaterThan(0);
  });
});

describe('navItemsFor (feature-flag filter)', () => {
  it('пункта «Заявки» (лиды) у партнёра нет — домен внутренний (§3.2 ТЗ, этап 10)', () => {
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).not.toContain('Заявки');
  });
  it('does not filter items without a flag annotation', () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
    process.env.FEATURE_ENROLLMENT_REQUESTS = '1'; // admin opt-in items: enrollments + requests + roles
    process.env.FEATURE_ROLE_CONSTRUCTOR = '1';
    process.env.FEATURE_CLIENT_REQUESTS = '1';
    process.env.FEATURE_INTAKE_INBOX = '1';
    // `У-112`: «Поиск» появился и у админа — под тем же флагом, что у менеджера.
    process.env.FEATURE_GLOBAL_SEARCH = '1';
    const items = navItemsFor('admin');
    expect(items.length).toBe(navByRole.admin.length);
  });
});

describe('navItemsFor — chat flag (partner)', () => {
  it('hides "Сообщения" (/partner/messages) when FEATURE_CHAT is unset (opt-in default off)', () => {
    // FEATURE_CHAT unset — deleted in beforeEach
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).not.toContain('Сообщения');
  });

  it('hides "Сообщения" (/partner/messages) when FEATURE_CHAT=0', () => {
    process.env.FEATURE_CHAT = '0';
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).not.toContain('Сообщения');
  });

  it('shows "Сообщения" (/partner/messages) when FEATURE_CHAT=1', () => {
    process.env.FEATURE_CHAT = '1';
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).toContain('Сообщения');
    // Other items still present
    expect(labels).toEqual(
      expect.arrayContaining(['Главная', 'Портфель', 'Заказы', 'Документы', 'Финансы'])
    );
  });

  it('the Сообщения item points to /partner/messages', () => {
    const item = navByRole.partner.find((i) => i.href === '/partner/messages');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Сообщения');
    expect(item!.flag).toBe('chat');
  });
});

describe('navItemsFor — chat flag (organization)', () => {
  it('hides "Сообщения" (/organization/messages) when FEATURE_CHAT is unset', () => {
    // org_cabinet also unset, but the item check is for the chat flag specifically
    const labels = navItemsFor('organization').map((i) => i.label);
    expect(labels).not.toContain('Сообщения');
  });

  it('shows "Сообщения" (/organization/messages) when FEATURE_CHAT=1 (even if org_cabinet also on)', () => {
    process.env.FEATURE_CHAT = '1';
    process.env.FEATURE_ORGANIZATION_CABINET = '1';
    const labels = navItemsFor('organization').map((i) => i.label);
    expect(labels).toContain('Сообщения');
  });

  it('hides "Сообщения" when FEATURE_CHAT=0 even if org_cabinet=1', () => {
    process.env.FEATURE_CHAT = '0';
    process.env.FEATURE_ORGANIZATION_CABINET = '1';
    const labels = navItemsFor('organization').map((i) => i.label);
    expect(labels).not.toContain('Сообщения');
  });

  it('the Сообщения item points to /organization/messages', () => {
    const item = navByRole.organization.find((i) => i.href === '/organization/messages');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Сообщения');
    expect(item!.flag).toBe('chat');
  });
});

describe('У-60 (этап 4): «Команда» ушла из главного меню в настройки', () => {
  it('пункта «Команда» в меню партнёра нет ни при каких opts', () => {
    // Признак `partnerAdminOnly` удалён этапом 9 (его не носил ни один пункт),
    // поэтому состав меню партнёра от опций больше не зависит.
    for (const opts of [undefined, { isManagerLeader: false }]) {
      const labels = navItemsFor('partner', opts).map((i) => i.label);
      expect(labels, `opts=${JSON.stringify(opts)}`).not.toContain('Команда');
    }
  });

  it('адреса /partner/team в меню тоже нет — он стал редиректом на вкладку настроек', () => {
    expect(navByRole.partner.find((i) => i.href === '/partner/team')).toBeUndefined();
  });

  it('«Настройки» в меню остались — через них и попадают в «Команду»', () => {
    expect(navItemsFor('partner').map((i) => i.href)).toContain('/partner/settings');
  });
});

describe('navByRole.manager — «Обмен с 1С» одним пунктом (У-113)', () => {
  it('вместо двух загрузок один пункт /manager/exchange с флагом кабинета', () => {
    const item = navByRole.manager.find((i) => i.href === '/manager/exchange');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Обмен с 1С');
    expect(item!.flag).toBe('manager_cabinet');
    expect(item!.group).toBe('Финансы');
  });

  it('прежних двух пунктов в меню больше нет — адреса остались шлюзами', () => {
    const hrefs = navByRole.manager.map((i) => i.href);
    expect(hrefs).not.toContain('/manager/import');
    expect(hrefs).not.toContain('/manager/payments-import');
  });
});

describe('navByRole — Финансы (manager + admin)', () => {
  it('manager содержит /manager/finance с флагом manager_cabinet', () => {
    const item = navByRole.manager.find((i) => i.href === '/manager/finance');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Финансы');
    expect(item!.flag).toBe('manager_cabinet');
  });

  it('admin содержит /admin/finance без флага', () => {
    const item = navByRole.admin.find((i) => i.href === '/admin/finance');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Финансы');
    expect(item!.flag).toBeUndefined();
  });

  it('manager /manager/finance стоит после Организации', () => {
    const hrefs = navByRole.manager.map((i) => i.href);
    expect(hrefs.indexOf('/manager/finance')).toBeGreaterThan(
      hrefs.indexOf('/manager/organizations')
    );
  });
});

describe('navByRole.admin — русский канон с группами', () => {
  it('содержит все админские страницы, включая ранее потерянные documents/messages/finance + корректировки комиссии + заявки на обучение + настройки', () => {
    const hrefs = navByRole.admin.map((i) => i.href);
    for (const lost of [
      '/admin/documents',
      '/admin/messages',
      '/admin/finance',
      '/admin/enrollments',
    ]) {
      expect(hrefs).toContain(lost);
    }
    expect(hrefs).toContain('/admin/commission-corrections');
    expect(hrefs).toContain('/admin/training-directions');
    expect(hrefs).toContain('/admin/custom-fields');
    // §10 ТЗ v0.5: справочник рабочих статусов заявки
    expect(hrefs).toContain('/admin/order-statuses');
    expect(hrefs).toContain('/admin/settings');
    expect(hrefs).toContain('/admin/payments-import');
    expect(hrefs).toContain('/admin/roles');
    expect(hrefs).toContain('/admin/pii-access');
    // `У-76` (этап 9): + «Справка» — словарь терминов, общий для всех кабинетов.
    expect(hrefs).toContain('/help');
    // `У-112`: у админа появились «Заказы» (был пункт-обманка с редиректом на
    // дашборд) и «Поиск» (сознательное расширение решения `У-75`).
    expect(hrefs).toContain('/admin/orders');
    expect(hrefs).toContain('/admin/search');
    expect(navByRole.admin).toHaveLength(27);
    expect(hrefs).toContain('/admin/requests');
    expect(hrefs).toContain('/admin/intake');
  });
  it('каждый пункт по-русски, с иконкой и группой', () => {
    for (const item of navByRole.admin) {
      expect(item.label).toMatch(/[А-Яа-яЁё]/);
      expect(item.iconKey).toBeTruthy();
      // ТЗ 2026-08-04: «Настройки» стоят отдельным блоком внизу и группы не имеют.
      if (item.pinnedBottom) {
        expect(item.group).toBeUndefined();
        continue;
      }
      // `У-113`: группы и их порядок — общие для всех кабинетов сотрудников;
      // «Главная» и «Поиск» стоят выше групп и группы не имеют.
      if (item.sectionKey === 'dashboard' || item.sectionKey === 'search') {
        expect(item.group).toBeUndefined();
        continue;
      }
      expect(MENU_GROUP_ORDER as readonly string[]).toContain(item.group);
    }
  });

  it('внизу закреплены «Настройки» и «Справка» — служебное отдельно от работы', () => {
    const pinned = navByRole.admin.filter((i) => i.pinnedBottom);
    expect(pinned.map((i) => i.href)).toEqual(['/admin/settings', '/help']);
  });
});

describe('navByRole.organization — единый источник', () => {
  // `У-100` (решение `Р-12`) прямо отменяет прежний порядок ФТ-15.4 в части
  // сотрудников и доступа в кабинет: два пункта заменены одним разделом «Моя
  // организация», внутри которого они стали вкладками. Порядок из `У-100`:
  // Главная · Заказы · Обращения · Заявки на обучение · Удостоверения ·
  // Документы · Финансы · Моя организация · Сообщения · Кабинет слушателя ·
  // Настройки · Справка.
  it('состав и ПОРЯДОК пунктов совпадают с У-100', () => {
    const hrefs = navByRole.organization.map((i) => i.href);
    expect(hrefs).toEqual([
      '/organization/dashboard',
      '/organization/orders',
      '/organization/requests',
      '/organization/enrollments',
      '/organization/certificates',
      '/organization/documents',
      '/organization/finance',
      '/organization/company',
      '/organization/messages',
      '/student',
      '/organization/settings',
      // `У-76` (этап 9): словарь терминов, закреплён внизу.
      '/help',
    ]);
  });

  it('пунктов «Сотрудники» и «Доступ в кабинет» в меню больше нет (У-100)', () => {
    const hrefs = navByRole.organization.map((i) => i.href);
    expect(hrefs).not.toContain('/organization/students');
    expect(hrefs).not.toContain('/organization/team');
  });

  it('раздел обращений называется «Обращения» (У-8, решение заказчика 09.08.2026)', () => {
    const requests = navByRole.organization.find((i) => i.href === '/organization/requests');
    expect(requests?.label).toBe('Обращения');
    // Роут и флаг не переименовываются — только user-facing строка.
    expect(requests?.flag).toBe('client_requests');
  });

  it('«Моя организация» — свой значок, а не значок списка чужих организаций', () => {
    const company = navByRole.organization.find((i) => i.href === '/organization/company');
    expect(company?.label).toBe('Моя организация');
    expect(company?.iconKey).toBe('myOrganization');
  });

  it('каждый пункт имеет иконку', () => {
    expect(
      navByRole.organization.every((i) => typeof i.iconKey === 'string' && i.iconKey.length > 0)
    ).toBe(true);
  });

  it('«Кабинет слушателя» указывает на /student', () => {
    const student = navByRole.organization.find((i) => i.href === '/student');
    expect(student?.label).toBe('Кабинет слушателя');
    expect(student?.flag).toBeUndefined();
  });
});

// Этап 11 PR-3 (ФТ-15.4): партнёрское меню уже в целевом порядке — фиксируем
// его и новое название раздела обращений.
describe('navByRole.partner — состав по ФТ-15.4', () => {
  it('порядок пунктов совпадает с ТЗ', () => {
    expect(navByRole.partner.map((i) => i.href)).toEqual([
      '/partner/dashboard',
      '/partner/portfolio',
      '/partner/orders',
      '/partner/requests',
      '/partner/enrollments',
      '/partner/certificates',
      '/partner/documents',
      '/partner/finance',
      // У-60 (этап 4): '/partner/team' убран — «Команда» стала вкладкой настроек.
      '/partner/messages',
      '/partner/settings',
      // `У-76` (этап 9): словарь терминов, закреплён внизу.
      '/help',
    ]);
  });

  it('раздел обращений называется «Обращения», роут не тронут', () => {
    const requests = navByRole.partner.find((i) => i.href === '/partner/requests');
    expect(requests?.label).toBe('Обращения');
    expect(requests?.flag).toBe('client_requests');
  });
});
