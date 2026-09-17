// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
const { companyFindMany } = vi.hoisted(() => ({ companyFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { company: { findMany: companyFindMany } } }));
const { listHubMaterials } = vi.hoisted(() => ({ listHubMaterials: vi.fn() }));
vi.mock('@/lib/services/partnerMaterials/hub', () => ({ listHubMaterials }));
// Экран — клиентский с хуками: страница проверяется по переданным пропсам.
vi.mock('@/components/partner-materials/partner-materials-screen', () => ({
  PartnerMaterialsScreen: (props: {
    cabinet: string;
    companyId: string | null;
    companies: unknown[];
    rows: unknown[];
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'screen' },
      `${props.cabinet}|${props.companyId ?? 'none'}|${props.companies.length}|${props.rows.length}`
    ),
}));

import AdminPage from '@/app/admin/settings/processes/partner-materials/page';
import LeaderPage from '@/app/leader/settings/processes/partner-materials/page';

/** Раздел хаба «Материалы для партнёров» (`У-237`): гард раздела, выбор компании у админа, своя компания у руководителя. */
const COMPANIES = [
  { id: 'c1', name: 'А' },
  { id: 'c2', name: 'Б' },
];

beforeEach(() => {
  vi.clearAllMocks();
  companyFindMany.mockResolvedValue(COMPANIES);
  listHubMaterials.mockResolvedValue({ ok: true, rows: [{ id: 'm1' }] });
});

describe('AdminPartnerMaterialsPage', () => {
  it('гард раздела; первая компания по умолчанию; `?company=` выбирает; чужой id → первая', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'a1', role: 'admin' });
    const { container } = await renderServerComponent(
      AdminPage({ searchParams: Promise.resolve({}) })
    );
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.partnerMaterials', 'admin');
    expect(container.textContent).toBe('admin|c1|2|1');
    expect(listHubMaterials).toHaveBeenCalledWith(
      { company: { findMany: companyFindMany } },
      { sub: 'a1', role: 'admin' },
      'c1'
    );

    const second = await renderServerComponent(
      AdminPage({ searchParams: Promise.resolve({ company: 'c2' }) })
    );
    expect(second.container.textContent).toBe('admin|c2|2|1');
    const alien = await renderServerComponent(
      AdminPage({ searchParams: Promise.resolve({ company: 'zz' }) })
    );
    expect(alien.container.textContent).toBe('admin|c1|2|1');
  });

  it('компаний нет — экран без компании, сервис не зовётся; отказ сервиса — пустой список', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'a1', role: 'admin' });
    companyFindMany.mockResolvedValueOnce([]);
    const { container } = await renderServerComponent(
      AdminPage({ searchParams: Promise.resolve({}) })
    );
    expect(container.textContent).toBe('admin|none|0|0');
    expect(listHubMaterials).not.toHaveBeenCalled();
    listHubMaterials.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    const denied = await renderServerComponent(AdminPage({ searchParams: Promise.resolve({}) }));
    expect(denied.container.textContent).toBe('admin|c1|2|0');
  });
});

describe('LeaderPartnerMaterialsPage', () => {
  it('компания из сессии, список компаний пуст; без компании — сервис не зовётся', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'l1', role: 'leader', companyId: 'c9' });
    const { container } = await renderServerComponent(LeaderPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.partnerMaterials', 'leader');
    expect(container.textContent).toBe('leader|c9|0|1');
    expect(listHubMaterials.mock.calls[0][2]).toBe('c9');
    expect(companyFindMany).not.toHaveBeenCalled();

    requireSettingsSection.mockResolvedValue({ sub: 'l2', role: 'leader', companyId: null });
    const none = await renderServerComponent(LeaderPage());
    expect(none.container.textContent).toBe('leader|none|0|0');
    expect(listHubMaterials).toHaveBeenCalledTimes(1);
  });
});
