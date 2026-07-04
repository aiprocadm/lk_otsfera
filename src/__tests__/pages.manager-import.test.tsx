// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/components/import/import-form', () => ({
  ImportForm: () => React.createElement('div', { 'data-testid': 'import-form' })
}));

import ManagerImportPage from '@/app/manager/import/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

describe('ManagerImportPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
  });

  it('requires manager auth and renders the import form', async () => {
    requireManager.mockResolvedValue(SESSION);

    const { container } = await renderServerComponent(ManagerImportPage());

    expect(requireManager).toHaveBeenCalled();
    expect(container.textContent).toContain('Загрузка данных из 1С');
    expect(container.querySelector('[data-testid="import-form"]')).not.toBeNull();
  });
});
