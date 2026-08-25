// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationSettingsPage from '@/app/organization/settings/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getTelegramStatus } = vi.hoisted(() => ({ getTelegramStatus: vi.fn() }));
vi.mock('@/lib/services/telegram/link', () => ({ getTelegramStatus }));

const { getNotificationSettings } = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('@/lib/services/notifications/preferences', () => ({ getNotificationSettings }));

// Этап 8 (PR-1): реквизиты организации — сервис и карточка стабятся.
const { getOrgRequisites } = vi.hoisted(() => ({ getOrgRequisites: vi.fn() }));
vi.mock('@/lib/services/organization/requisites', () => ({ getOrgRequisites }));
vi.mock('@/server-actions/requisites', () => ({ setOrgRequisitesAction: vi.fn() }));
vi.mock('@/components/settings/telegram-link-card', () => ({
  TelegramLinkCard: () => React.createElement('div', { 'data-testid': 'telegram-card' }, 'TG'),
}));

vi.mock('@/components/settings/notification-channels-card', () => ({
  NotificationChannelsCard: () =>
    React.createElement('div', { 'data-testid': 'notif-card' }, 'NOTIF'),
}));

vi.mock('@/components/settings/security-card', () => ({
  SecurityCard: () => React.createElement('div', { 'data-testid': 'security-card' }, 'SECURITY'),
}));

vi.mock('@/components/requisites/requisites-card', () => ({
  RequisitesCard: (props: { title: string; canEdit?: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'requisites-card' },
      props.title,
      ` canEdit:${String(props.canEdit)}`
    ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

/**
 * `У-114`: личные настройки заказчика — те же вкладки, что у менеджера и
 * партнёра. Раньше здесь же лежали реквизиты организации: настройки СЕБЯ и
 * настройки СВОЕЙ КОМПАНИИ были свалены на один экран. Реквизиты переехали в
 * раздел «Моя организация» (`У-100`).
 */
describe('OrganizationSettingsPage (У-114)', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset().mockResolvedValue(CTX);
    getOrgRequisites.mockReset().mockResolvedValue({ ok: true, requisites: {} });
    getTelegramStatus.mockReset().mockResolvedValue({ linked: false });
    getNotificationSettings.mockReset().mockResolvedValue({ view: { email: true } });
  });

  const render = (tab?: string) =>
    renderServerComponent(
      OrganizationSettingsPage({ searchParams: Promise.resolve(tab ? { tab } : {}) })
    );

  it('вкладки те же и в том же порядке, что у менеджера', async () => {
    const { container } = await render();
    const tabs = [...container.querySelectorAll('[data-testid^="personal-tab-"]')].map((el) =>
      el.getAttribute('data-testid')
    );
    expect(tabs).toEqual([
      'personal-tab-profile',
      'personal-tab-notifications',
      'personal-tab-security',
    ]);
  });

  it('реквизитов организации здесь больше нет — они в «Моей организации» (У-100)', async () => {
    for (const tab of ['profile', 'notifications', 'security']) {
      const { container } = await render(tab);
      expect(container.querySelector('[data-testid="requisites-card"]'), tab).toBeNull();
    }
    expect(getOrgRequisites).not.toHaveBeenCalled();
  });

  it('«Профиль»: привязка Telegram', async () => {
    const { container } = await render('profile');
    expect(container.querySelector('[data-testid="telegram-card"]')).not.toBeNull();
  });

  it('«Уведомления»: каналы, и сервис зовётся только здесь', async () => {
    const { container } = await render('notifications');
    expect(container.querySelector('[data-testid="notif-card"]')).not.toBeNull();
    expect(getNotificationSettings).toHaveBeenCalled();
    expect(getTelegramStatus).not.toHaveBeenCalled();
  });

  it('«Безопасность»: активные сессии', async () => {
    const { container } = await render('security');
    expect(container.querySelector('[data-testid="security-card"]')).not.toBeNull();
  });

  it('экран рисуется в оболочке кабинета заказчика', async () => {
    const { container } = await render();
    expect(container.querySelector('[data-testid="org-app-shell"]')?.textContent).toContain(
      'ООО Ромашка'
    );
  });
});
