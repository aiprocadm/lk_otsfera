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
      expect.arrayContaining(['Дашборд', 'Портфель', 'Сделки', 'Заявки', 'Документы', 'Команда', 'Финансы'])
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
  it('returns the full partner menu when all flags default-enabled', () => {
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).toContain('Заявки');
  });

  it('hides "Заявки" when FEATURE_PARTNER_LEADS=0', () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).not.toContain('Заявки');
    // Other items still present.
    expect(labels).toEqual(
      expect.arrayContaining(['Дашборд', 'Портфель', 'Сделки', 'Документы', 'Финансы', 'Команда']),
    );
  });

  it('does not filter items without a flag annotation', () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
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
      expect.arrayContaining(['Дашборд', 'Портфель', 'Сделки', 'Документы', 'Финансы', 'Команда']),
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
