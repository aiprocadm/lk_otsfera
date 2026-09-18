// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection, getKpiSettings, notFound } = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  getKpiSettings: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/services/kpi/settings', () => ({ getKpiSettings }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/components/kpi/kpi-settings-screen', () => ({
  KpiSettingsScreen: (p: { view: { year: number; month: number } }) =>
    React.createElement('div', null, `ЭКРАН:${p.view.year}-${p.view.month}`),
}));

import AdminKpiSettingsPage from '@/app/admin/settings/processes/kpi/page';
import LeaderKpiSettingsPage from '@/app/leader/settings/processes/kpi/page';

const SESSION = { sub: 'l1', role: 'leader', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(SESSION);
  getKpiSettings.mockResolvedValue({ ok: true, view: { year: 2026, month: 9 } });
});

describe('«Показатели и планы» — страницы раздела (У-242)', () => {
  it('администратор: гард зовётся с ключом раздела и своим кабинетом', async () => {
    const { container } = await renderServerComponent(
      AdminKpiSettingsPage({ searchParams: Promise.resolve({ month: '2026-09' }) })
    );
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.kpi', 'admin');
    expect(container.textContent).toContain('ЭКРАН:2026-9');
  });

  it('руководитель: тот же экран, свой кабинет — правило зеркала', async () => {
    const { container } = await renderServerComponent(
      LeaderKpiSettingsPage({ searchParams: Promise.resolve({ month: '2026-09' }) })
    );
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.kpi', 'leader');
    expect(container.textContent).toContain('ЭКРАН:2026-9');
  });

  it('мусор в адресе не роняет экран — берётся текущий месяц', async () => {
    await renderServerComponent(
      AdminKpiSettingsPage({ searchParams: Promise.resolve({ month: 'вчера' }) })
    );
    const args = getKpiSettings.mock.calls[0][2] as { year: number; month: number };
    expect(args.year).toBeGreaterThanOrEqual(2026);
    expect(args.month).toBeGreaterThanOrEqual(1);
    expect(args.month).toBeLessThanOrEqual(12);
  });

  it('отказ сервиса — «не найдено», а не пустая страница', async () => {
    getKpiSettings.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(
      renderServerComponent(AdminKpiSettingsPage({ searchParams: Promise.resolve({}) }))
    ).rejects.toThrow('NOT_FOUND');
  });
});
