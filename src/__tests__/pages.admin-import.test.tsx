// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/components/import/import-form', () => ({
  ImportForm: () => React.createElement('div', { 'data-testid': 'import-form' }),
}));

import AdminImportPage from '@/app/admin/settings/integrations/1c/excel/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminImportPage', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset();
  });

  it('requires admin and renders the import form', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);

    const { container } = await renderServerComponent(AdminImportPage());

    expect(requireSettingsSection).toHaveBeenCalled();
    expect(container.textContent).toContain('Загрузка Excel из 1С');
    expect(container.querySelector('[data-testid="import-form"]')).not.toBeNull();
  });
});
