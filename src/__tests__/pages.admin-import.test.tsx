// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/components/import/import-form', () => ({
  ImportForm: () => React.createElement('div', { 'data-testid': 'import-form' }),
}));

import AdminImportPage from '@/app/admin/import/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminImportPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
  });

  it('requires admin and renders the import form', async () => {
    requireAdmin.mockResolvedValue(SESSION);

    const { container } = await renderServerComponent(AdminImportPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(container.textContent).toContain('Загрузка Excel из 1С');
    expect(container.querySelector('[data-testid="import-form"]')).not.toBeNull();
  });
});
