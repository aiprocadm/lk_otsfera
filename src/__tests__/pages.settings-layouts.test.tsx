// @vitest-environment jsdom
/**
 * Оболочки хаба: гейт доступа в layout'ах обоих кабинетов, общая рамка
 * (крошки + карта разделов) и подраздел «Обмен с 1С» с вкладками.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin, requireManagerLeader } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin, requireManagerLeader }));

const { hasAnySettingsAccess, visibleSettingsSections } = vi.hoisted(() => ({
  hasAnySettingsAccess: vi.fn(),
  visibleSettingsSections: vi.fn(),
}));
vi.mock('@/lib/auth/settingsAccess', () => ({ hasAnySettingsAccess, visibleSettingsSections }));

const nav = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  pathname: '/admin/settings/security/audit',
}));
vi.mock('next/navigation', () => ({
  redirect: nav.redirect,
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AdminSettingsLayout from '@/app/admin/settings/layout';
import LeaderSettingsLayout from '@/app/leader/settings/layout';
import AdminOneCLayout from '@/app/admin/settings/integrations/1c/layout';
import { SettingsShell } from '@/components/settings/settings-shell';
import { sectionsForCabinet } from '@/lib/navigation/settings';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'leader' as const };

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue(ADMIN);
  requireManagerLeader.mockReset().mockResolvedValue(LEADER);
  hasAnySettingsAccess.mockReset().mockReturnValue(true);
  visibleSettingsSections.mockReset().mockReturnValue(sectionsForCabinet('admin'));
  nav.redirect.mockClear();
  nav.pathname = '/admin/settings/security/audit';
});

describe('layout хаба администратора', () => {
  it('пускает и оборачивает содержимое в оболочку с навигацией', async () => {
    const { container } = await renderServerComponent(
      AdminSettingsLayout({ children: <div data-testid="content">СОДЕРЖИМОЕ</div> })
    );
    expect(requireAdmin).toHaveBeenCalled();
    expect(hasAnySettingsAccess).toHaveBeenCalledWith(ADMIN, 'admin');
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-nav"]')).not.toBeNull();
  });

  it('нет доступа ни к одному разделу — 403, а не пустой хаб', async () => {
    hasAnySettingsAccess.mockReturnValue(false);
    await expect(renderServerComponent(AdminSettingsLayout({ children: <div /> }))).rejects.toThrow(
      'REDIRECT'
    );
    expect(nav.redirect).toHaveBeenCalledWith('/forbidden');
  });
});

describe('layout хаба руководителя', () => {
  it('гард под-роли leader и его собственный набор разделов', async () => {
    nav.pathname = '/leader/settings';
    visibleSettingsSections.mockReturnValue(sectionsForCabinet('leader'));
    const { container } = await renderServerComponent(
      LeaderSettingsLayout({ children: <div data-testid="content">СОДЕРЖИМОЕ</div> })
    );
    expect(requireManagerLeader).toHaveBeenCalled();
    expect(hasAnySettingsAccess).toHaveBeenCalledWith(LEADER, 'leader');
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
  });

  it('нет доступа — 403', async () => {
    hasAnySettingsAccess.mockReturnValue(false);
    await expect(
      renderServerComponent(LeaderSettingsLayout({ children: <div /> }))
    ).rejects.toThrow('REDIRECT');
  });
});

describe('оболочка настроек', () => {
  it('рисует крошки, карту разделов и контент', () => {
    const { container } = render(
      <SettingsShell cabinet="admin" sections={sectionsForCabinet('admin')}>
        <div data-testid="content">СОДЕРЖИМОЕ</div>
      </SettingsShell>
    );
    expect(container.querySelector('nav[aria-label="Хлебные крошки"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-nav"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
  });
});

describe('подраздел «Обмен с 1С»', () => {
  it('вкладки над содержимым вкладки', () => {
    nav.pathname = '/admin/settings/integrations/1c/excel';
    const { container } = render(
      AdminOneCLayout({ children: <div data-testid="tab">ВКЛАДКА</div> }) as React.ReactElement
    );
    expect(container.textContent).toContain('Загрузка Excel');
    expect(container.textContent).toContain('Выписка по счёту 51');
    expect(container.querySelector('[data-testid="tab"]')).not.toBeNull();
    // Заголовок первого уровня держит сама вкладка — в оболочке его быть не должно.
    expect(container.querySelector('h1')).toBeNull();
  });

  // `У-47` (этап 7): корень больше НЕ редиректит на форму — он показывает
  // навигатор задачи. Его содержимое проверяет pages.admin-1c-hub.
  it('корень подраздела не уводит молча на форму загрузки', () => {
    expect(nav.redirect).not.toHaveBeenCalled();
  });
});
