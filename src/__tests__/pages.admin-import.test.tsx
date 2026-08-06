// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

// Т-41: страница читает список компаний и отдаёт его форме.
const { companyFindMany } = vi.hoisted(() => ({ companyFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { company: { findMany: companyFindMany } } }));

vi.mock('@/components/import/import-form', () => ({
  ImportForm: (props: { companies?: Array<{ id: string; name: string }> }) =>
    React.createElement('div', {
      'data-testid': 'import-form',
      'data-companies': (props.companies ?? []).map((c) => c.id).join(','),
    }),
}));

import AdminImportPage from '@/app/admin/settings/integrations/1c/excel/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminImportPage', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset();
    companyFindMany.mockReset().mockResolvedValue([
      { id: 'co-1', name: 'Альфа' },
      { id: 'co-2', name: 'Бета' },
    ]);
  });

  it('requires admin and renders the import form with companies (Т-41)', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);

    const { container } = await renderServerComponent(AdminImportPage());

    expect(requireSettingsSection).toHaveBeenCalled();
    expect(companyFindMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(container.textContent).toContain('Загрузка Excel из 1С');
    expect(
      container.querySelector('[data-testid="import-form"]')?.getAttribute('data-companies')
    ).toBe('co-1,co-2');
  });
});
