import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';

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
      expect.arrayContaining(['Главная', 'Портфель', 'Заказы', 'Заявки', 'Документы', 'Команда', 'Финансы'])
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
  it('includes flag-gated «Заявки» for partner when partner_leads default-enabled', () => {
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).toContain('Заявки');
  });

  it('hides "Заявки" when FEATURE_PARTNER_LEADS=0', () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
    const labels = navItemsFor('partner', { isPartnerAdmin: true }).map((i) => i.label);
    expect(labels).not.toContain('Заявки');
    // Other items still present.
    expect(labels).toEqual(
      expect.arrayContaining(['Главная', 'Портфель', 'Заказы', 'Документы', 'Финансы', 'Команда']),
    );
  });

  it('does not filter items without a flag annotation', () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
    process.env.FEATURE_ENROLLMENT_REQUESTS = '1'; // admin opt-in items: enrollments + roles
    process.env.FEATURE_ROLE_CONSTRUCTOR = '1';
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
    const labels = navItemsFor('partner', { isPartnerAdmin: true }).map((i) => i.label);
    expect(labels).toContain('Сообщения');
    // Other items still present
    expect(labels).toEqual(
      expect.arrayContaining(['Главная', 'Портфель', 'Заказы', 'Документы', 'Финансы', 'Команда']),
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

describe('navItemsFor — partnerAdminOnly гейтинг (/partner/team)', () => {
  it('скрывает «Команда» для partner без opts (не-admin по умолчанию)', () => {
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).not.toContain('Команда');
  });

  it('скрывает «Команда» для partner с isPartnerAdmin=false', () => {
    const labels = navItemsFor('partner', { isPartnerAdmin: false }).map((i) => i.label);
    expect(labels).not.toContain('Команда');
  });

  it('показывает «Команда» для partner с isPartnerAdmin=true', () => {
    const labels = navItemsFor('partner', { isPartnerAdmin: true }).map((i) => i.label);
    expect(labels).toContain('Команда');
  });

  it('пункт /partner/team помечен partnerAdminOnly в navByRole', () => {
    const item = navByRole.partner.find((i) => i.href === '/partner/team');
    expect(item).toBeDefined();
    expect(item!.partnerAdminOnly).toBe(true);
  });
});

describe('navByRole.manager — Загрузка из 1С item', () => {
  it('содержит пункт /manager/import с флагом manager_cabinet', () => {
    const item = navByRole.manager.find((i) => i.href === '/manager/import');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Загрузка из 1С');
    expect(item!.flag).toBe('manager_cabinet');
  });

  it('пункт /manager/import стоит после Организации и до Документы', () => {
    const hrefs = navByRole.manager.map((i) => i.href);
    const orgIdx = hrefs.indexOf('/manager/organizations');
    const importIdx = hrefs.indexOf('/manager/import');
    const docsIdx = hrefs.indexOf('/manager/documents');
    expect(importIdx).toBeGreaterThan(orgIdx);
    expect(importIdx).toBeLessThan(docsIdx);
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
    expect(hrefs.indexOf('/manager/finance')).toBeGreaterThan(hrefs.indexOf('/manager/organizations'));
  });
});

describe('navByRole.admin — русский канон с группами (все 21 страниц)', () => {
  it('содержит все админские страницы, включая ранее потерянные documents/messages/finance + корректировки комиссии + заявки на обучение + настройки', () => {
    const hrefs = navByRole.admin.map((i) => i.href);
    for (const lost of ['/admin/documents', '/admin/messages', '/admin/finance', '/admin/enrollments']) {
      expect(hrefs).toContain(lost);
    }
    expect(hrefs).toContain('/admin/commission-corrections');
    expect(hrefs).toContain('/admin/training-directions');
    expect(hrefs).toContain('/admin/custom-fields');
    expect(hrefs).toContain('/admin/settings');
    expect(hrefs).toContain('/admin/payments-import');
    expect(hrefs).toContain('/admin/roles');
    expect(hrefs).toContain('/admin/pii-access');
    expect(navByRole.admin).toHaveLength(21);
  });
  it('каждый пункт по-русски, с иконкой и группой', () => {
    for (const item of navByRole.admin) {
      expect(item.label).toMatch(/[А-Яа-яЁё]/);
      expect(item.icon).toBeTruthy();
      expect(['Платформа', 'Операции', 'Обмен с 1С', 'Справочники']).toContain(item.group);
    }
  });
});

describe('navByRole.organization — единый источник (канон 11 пунктов)', () => {
  it('содержит базовые пункты + Заявки на обучение + Удостоверения + Сообщения + Кабинет слушателя + Настройки', () => {
    const hrefs = navByRole.organization.map((i) => i.href);
    expect(hrefs).toEqual([
      '/organization/dashboard',
      '/organization/orders',
      '/organization/documents',
      '/organization/finance',
      '/organization/students',
      '/organization/enrollments',
      '/organization/certificates',
      '/organization/team',
      '/organization/messages',
      '/student',
      '/organization/settings'
    ]);
  });

  it('«Команда» помечена orgAdminOrLeaderOnly', () => {
    const team = navByRole.organization.find((i) => i.href === '/organization/team');
    expect(team?.orgAdminOrLeaderOnly).toBe(true);
  });

  it('каждый пункт имеет иконку', () => {
    expect(navByRole.organization.every((i) => typeof i.icon === 'string' && i.icon.length > 0)).toBe(true);
  });

  it('«Кабинет слушателя» указывает на /student', () => {
    const student = navByRole.organization.find((i) => i.href === '/student');
    expect(student?.label).toBe('Кабинет слушателя');
    expect(student?.flag).toBeUndefined();
  });
});
