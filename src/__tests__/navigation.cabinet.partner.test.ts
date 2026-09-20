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
    // `У-112`: «Поиск» появился и у админа — под тем же флагом, что у менеджера.
    process.env.FEATURE_GLOBAL_SEARCH = '1';
    // Этап 1 ТЗ 12.09.2026: «Контакты» — opt-in флаг `contacts`.
    process.env.FEATURE_CONTACTS = '1';
    // Этап 5 ТЗ 12.09.2026: «Уведомления» — opt-in флаг `notification_center`.
    process.env.FEATURE_NOTIFICATION_CENTER = '1';
    const items = navItemsFor('admin');
    expect(items.length).toBe(navByRole.admin.length);
  });
});

/**
 * Этап 6 (`У-234`): «Сообщения» несут ДВА домена — переписку с менеджером
 * (`cabinet_questions`) и чат по заказам (`chat`). Пункт живёт, пока включён
 * хотя бы один: прежнее правило «только `chat`» прятало бы переписку вместе с
 * выключенным чатом.
 */
describe('navItemsFor — «Сообщения» (два домена, У-234)', () => {
  it('чат выключен, переписка включена — пункт на месте', () => {
    process.env.FEATURE_CHAT = '0';
    process.env.FEATURE_CABINET_QUESTIONS = '1';
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).toContain('Сообщения');
  });

  it('оба домена выключены — пункта нет', () => {
    process.env.FEATURE_CHAT = '0';
    process.env.FEATURE_CABINET_QUESTIONS = '0';
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).not.toContain('Сообщения');
  });

  it('включён только чат — пункт на месте, остальные разделы не задеты', () => {
    process.env.FEATURE_CHAT = '1';
    process.env.FEATURE_CABINET_QUESTIONS = '0';
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).toContain('Сообщения');
    expect(labels).toEqual(
      expect.arrayContaining(['Главная', 'Портфель', 'Заказы', 'Документы', 'Финансы'])
    );
  });

  it('пункт ведёт на /partner/messages и объявляет оба флага', () => {
    const item = navByRole.partner.find((i) => i.href === '/partner/messages');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Сообщения');
    expect(item!.anyFlags).toEqual(['chat', 'cabinet_questions']);
    // Одиночный `flag` снят: он означал бы «раздел живёт только с чатом».
    expect(item!.flag).toBeUndefined();
  });
});

describe('navItemsFor — chat flag (organization)', () => {
  it('оба домена выключены — пункта нет (чат и переписка по умолчанию off)', () => {
    // Оба флага opt-in: без явного включения раздел не показывается.
    const labels = navItemsFor('organization').map((i) => i.label);
    expect(labels).not.toContain('Сообщения');
  });

  it('shows "Сообщения" (/organization/messages) when FEATURE_CHAT=1 (even if org_cabinet also on)', () => {
    process.env.FEATURE_CHAT = '1';
    process.env.FEATURE_ORGANIZATION_CABINET = '1';
    const labels = navItemsFor('organization').map((i) => i.label);
    expect(labels).toContain('Сообщения');
  });

  it('чат выключен и переписка выключена — пункта нет даже при включённом кабинете', () => {
    process.env.FEATURE_CHAT = '0';
    process.env.FEATURE_CABINET_QUESTIONS = '0';
    process.env.FEATURE_ORGANIZATION_CABINET = '1';
    const labels = navItemsFor('organization').map((i) => i.label);
    expect(labels).not.toContain('Сообщения');
  });

  it('переписка включена без чата — пункт на месте (этап 6, У-234)', () => {
    process.env.FEATURE_CABINET_QUESTIONS = '1';
    process.env.FEATURE_ORGANIZATION_CABINET = '1';
    const labels = navItemsFor('organization').map((i) => i.label);
    expect(labels).toContain('Сообщения');
  });

  it('the Сообщения item points to /organization/messages', () => {
    const item = navByRole.organization.find((i) => i.href === '/organization/messages');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Сообщения');
    // `У-234`: два домена вместо одного флага — зеркало партнёрского пункта.
    expect(item!.anyFlags).toEqual(['chat', 'cabinet_questions']);
    expect(item!.flag).toBeUndefined();
  });
});

describe('У-60 (этап 4): «Команда» ушла из главного меню в настройки', () => {
  it('пункта «Команда» в меню партнёра нет', () => {
    // Признаки `partnerAdminOnly` (этап 9), `leaderOnly` и `hiddenWhenFlag`
    // (прогон сопровождения №34) удалены: их не носил ни один пункт. Поэтому
    // состав меню больше не зависит ни от каких опций — их и нет.
    expect(navItemsFor('partner').map((i) => i.label)).not.toContain('Команда');
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
    // `У-262`: флага у пункта больше нет — кабинет менеджера не выключается.
    expect(item!.flag).toBeUndefined();
    expect(item!.group).toBe('Финансы');
  });

  it('прежних двух пунктов в меню больше нет — адреса остались шлюзами', () => {
    const hrefs = navByRole.manager.map((i) => i.href);
    expect(hrefs).not.toContain('/manager/import');
    expect(hrefs).not.toContain('/manager/payments-import');
  });
});

describe('navByRole — Финансы (manager + admin)', () => {
  it('manager содержит /manager/finance — без флага (У-262)', () => {
    const item = navByRole.manager.find((i) => i.href === '/manager/finance');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Финансы');
    // `У-262`: флага у пункта больше нет — кабинет менеджера не выключается.
    expect(item!.flag).toBeUndefined();
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
    // §10 ТЗ v0.5: справочник рабочих статусов заявки
    expect(hrefs).toContain('/admin/settings');
    // `У-76` (этап 9): + «Справка» — словарь терминов, общий для всех кабинетов.
    expect(hrefs).toContain('/help');
    // `У-112`: у админа появились «Заказы» (был пункт-обманка с редиректом на
    // дашборд) и «Поиск» (сознательное расширение решения `У-75`).
    expect(hrefs).toContain('/admin/orders');
    expect(hrefs).toContain('/admin/search');
    // Этап 1 ТЗ 12.09.2026 (`У-178`): + «Контакты» под флагом `contacts`.
    expect(hrefs).toContain('/admin/contacts');
    // Этап 5 ТЗ 12.09.2026 (`У-228`): + «Уведомления» под флагом `notification_center`.
    expect(hrefs).toContain('/admin/notifications');
    expect(navByRole.admin).toHaveLength(19);
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

  it('внизу закреплены «Уведомления», «Настройки» и «Справка» — служебное отдельно от работы', () => {
    // Этап 5 (`У-228`): лента уведомлений — над «Настройками».
    const pinned = navByRole.admin.filter((i) => i.pinnedBottom);
    expect(pinned.map((i) => i.href)).toEqual(['/admin/notifications', '/admin/settings', '/help']);
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
      // Этап 5 ТЗ 12.09.2026 (`У-228`): «Уведомления» над «Настройками».
      '/organization/notifications',
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
    // `У-262`: флага у пункта больше нет — раздел есть всегда.
    expect(requests?.flag).toBeUndefined();
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
      '/partner/orders',
      '/partner/requests',
      '/partner/enrollments',
      '/partner/certificates',
      '/partner/documents',
      '/partner/finance',
      // `У-115`: «Портфель» стоит там же, где у заказчика «Моя организация», —
      // восьмым. Раньше он был вторым, и два зеркальных меню расходились с
      // самого верха.
      '/partner/portfolio',
      // Этап 6 ТЗ 12.09.2026 (`У-237`): «Материалы» — между «Портфелем» и «Сообщениями».
      '/partner/materials',
      // У-60 (этап 4): '/partner/team' убран — «Команда» стала вкладкой настроек.
      '/partner/messages',
      // Этап 5 ТЗ 12.09.2026 (`У-228`): «Уведомления» над «Настройками».
      '/partner/notifications',
      '/partner/settings',
      // `У-76` (этап 9): словарь терминов, закреплён внизу.
      '/help',
    ]);
  });

  it('раздел обращений называется «Обращения», роут не тронут', () => {
    const requests = navByRole.partner.find((i) => i.href === '/partner/requests');
    expect(requests?.label).toBe('Обращения');
    // `У-262`: флага у пункта больше нет — раздел есть всегда.
    expect(requests?.flag).toBeUndefined();
  });
});
