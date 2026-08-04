// @vitest-environment jsdom
/**
 * Корень хаба «Настройки» в обоих кабинетах сотрудников (ТЗ 2026-08-04 §3):
 * карточки видимых разделов и ничего кроме них. Права считает
 * `visibleSettingsSections` — здесь проверяем, что страница отдаёт компоненту
 * именно её результат, а не весь реестр.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin, requireManagerLeader } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin, requireManagerLeader }));

const { visibleSettingsSections } = vi.hoisted(() => ({ visibleSettingsSections: vi.fn() }));
vi.mock('@/lib/auth/settingsAccess', () => ({ visibleSettingsSections }));

vi.mock('@/components/settings/settings-hub-cards', () => ({
  SettingsHubCards: (props: { cabinet: string; sections: { id: string }[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'hub-cards' },
      `${props.cabinet}:${props.sections.map((s) => s.id).join(',')}`
    ),
}));

import AdminSettingsPage from '@/app/admin/settings/page';
import LeaderSettingsPage from '@/app/leader/settings/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'manager' as const, managerRole: 'leader' as const };

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue(ADMIN);
  requireManagerLeader.mockReset().mockResolvedValue(LEADER);
  visibleSettingsSections.mockReset().mockReturnValue([{ id: 'security.audit' }]);
});

describe('хаб настроек администратора', () => {
  it('гард админа, заголовок и карточки доступных разделов', async () => {
    const { container } = await renderServerComponent(AdminSettingsPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(visibleSettingsSections).toHaveBeenCalledWith(ADMIN, 'admin');
    expect(container.querySelector('h1')?.textContent).toBe('Настройки');
    expect(container.textContent).toContain('admin:security.audit');
  });

  it('пустой список разделов не роняет страницу', async () => {
    visibleSettingsSections.mockReturnValue([]);
    const { container } = await renderServerComponent(AdminSettingsPage());
    expect(container.textContent).toContain('admin:');
  });
});

describe('хаб настроек руководителя', () => {
  it('гард руководителя и его собственный набор разделов', async () => {
    visibleSettingsSections.mockReturnValue([{ id: 'access.roles' }]);
    const { container } = await renderServerComponent(LeaderSettingsPage());

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(visibleSettingsSections).toHaveBeenCalledWith(LEADER, 'leader');
    expect(container.textContent).toContain('leader:access.roles');
  });
});
