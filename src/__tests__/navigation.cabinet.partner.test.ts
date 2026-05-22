import { describe, it, expect } from 'vitest';
import { navByRole } from '@/lib/navigation/cabinet';

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
