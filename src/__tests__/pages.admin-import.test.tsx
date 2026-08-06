// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

// Т-41: страница читает список компаний и отдаёт его форме.
const { companyFindMany } = vi.hoisted(() => ({ companyFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { company: { findMany: companyFindMany } } }));

// Этап 9 (Т-39): страница читает историю импортов и отдаёт её таблице.
const { listImportBatches } = vi.hoisted(() => ({ listImportBatches: vi.fn() }));
vi.mock('@/lib/services/import/rollback', () => ({ listImportBatches }));
vi.mock('@/components/import/import-history', () => ({
  ImportHistory: (props: { batches: unknown[] }) =>
    React.createElement('div', {
      'data-testid': 'import-history',
      'data-batches': String(props.batches.length),
    }),
}));

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
    listImportBatches
      .mockReset()
      .mockResolvedValue({ ok: true, batches: [{ id: 'b1' }, { id: 'b2' }] });
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
    // Этап 9 (Т-39): история импортов на странице.
    expect(container.textContent).toContain('История импортов');
    expect(
      container.querySelector('[data-testid="import-history"]')?.getAttribute('data-batches')
    ).toBe('2');
  });

  it('отказ сервиса истории не роняет страницу — таблица пустая', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    listImportBatches.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(AdminImportPage());
    expect(
      container.querySelector('[data-testid="import-history"]')?.getAttribute('data-batches')
    ).toBe('0');
  });
});
