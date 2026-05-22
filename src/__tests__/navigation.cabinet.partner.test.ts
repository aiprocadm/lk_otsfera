import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FEATURE_PARTNER_LEADS;
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
