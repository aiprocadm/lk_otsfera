// @vitest-environment jsdom
/**
 * Разделы, собранные из прежней общей страницы настроек (спека §3.4):
 * «Каналы уведомлений», «Личная безопасность», «Реквизиты исполнителя» и
 * «Флаги функциональности». Содержимое не менялось — проверяем, что каждый
 * кусок доехал целым и спрашивает права своего раздела.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getTelegramStatus } = vi.hoisted(() => ({ getTelegramStatus: vi.fn() }));
vi.mock('@/lib/services/telegram/link', () => ({ getTelegramStatus }));

const { getNotificationSettings } = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('@/lib/services/notifications/preferences', () => ({ getNotificationSettings }));

const { listCompaniesRequisites } = vi.hoisted(() => ({ listCompaniesRequisites: vi.fn() }));
vi.mock('@/lib/services/admin/companyRequisites', () => ({ listCompaniesRequisites }));
vi.mock('@/server-actions/requisites', () => ({ setCompanyRequisitesAction: vi.fn() }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock('@/components/settings/telegram-link-card', () => ({
  TelegramLinkCard: (props: { status: unknown }) =>
    React.createElement('div', { 'data-testid': 'telegram-card' }, JSON.stringify(props.status)),
}));
vi.mock('@/components/settings/notification-channels-card', () => ({
  NotificationChannelsCard: (props: { settings: unknown }) =>
    React.createElement('div', { 'data-testid': 'notif-card' }, JSON.stringify(props.settings)),
}));
vi.mock('@/components/settings/security-card', () => ({
  SecurityCard: () => React.createElement('div', { 'data-testid': 'security-card' }, 'SECURITY'),
}));
vi.mock('@/components/settings/staff-backup-codes-section', () => ({
  StaffBackupCodesSection: () =>
    React.createElement('div', { 'data-testid': 'backup-codes' }, 'BACKUP'),
}));
vi.mock('@/components/requisites/requisites-card', () => ({
  RequisitesCard: (props: { title: string }) =>
    React.createElement('div', { 'data-testid': 'requisites-card' }, props.title),
}));
vi.mock('@/components/admin/feature-flags-matrix', () => ({
  FeatureFlagsMatrix: () => React.createElement('div', { 'data-testid': 'flags-matrix' }, 'FLAGS'),
}));

// Этап 8: страница флагов теперь спрашивает у сервиса значения и их источник.
const { listFeatureFlags } = vi.hoisted(() => ({
  listFeatureFlags: vi.fn(async (): Promise<{ ok: boolean; rows?: unknown[]; error?: string }> => ({
    ok: true,
    rows: [],
  })),
}));
vi.mock('@/lib/services/admin/featureFlags', () => ({ listFeatureFlags }));

import AdminNotificationChannelsPage from '@/app/admin/settings/integrations/notifications/page';
import LeaderNotificationChannelsPage from '@/app/leader/settings/integrations/notifications/page';
import AdminPersonalSecurityPage from '@/app/admin/settings/security/personal/page';
import LeaderPersonalSecurityPage from '@/app/leader/settings/security/personal/page';
import AdminRequisitesPage from '@/app/admin/settings/catalogs/requisites/page';
import AdminFeatureFlagsPage from '@/app/admin/settings/system/feature-flags/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'manager' as const, managerRole: 'leader' as const };

beforeEach(() => {
  requireSettingsSection
    .mockReset()
    .mockImplementation((_id: string, cabinet: string) =>
      Promise.resolve(cabinet === 'admin' ? ADMIN : LEADER)
    );
  getTelegramStatus.mockReset().mockResolvedValue({ linked: true });
  getNotificationSettings.mockReset().mockResolvedValue({ view: { email: true } });
  listCompaniesRequisites.mockReset().mockResolvedValue({ ok: true, companies: [] });
  isFeatureEnabled.mockReset().mockReturnValue(false);
});

describe('каналы уведомлений', () => {
  it('админ: гард раздела, привязка Telegram и карточка каналов', async () => {
    const { container } = await renderServerComponent(AdminNotificationChannelsPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.notifications', 'admin');
    expect(getTelegramStatus).toHaveBeenCalledWith({}, ADMIN);
    expect(getNotificationSettings).toHaveBeenCalledWith({}, ADMIN);
    expect(container.querySelector('h1')?.textContent).toBe('Каналы уведомлений');
    expect(container.textContent).toContain('linked');
    expect(container.textContent).toContain('email');
  });

  it('руководитель: тот же экран в своём кабинете', async () => {
    const { container } = await renderServerComponent(LeaderNotificationChannelsPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.notifications', 'leader');
    expect(getTelegramStatus).toHaveBeenCalledWith({}, LEADER);
    expect(container.querySelector('[data-testid="notif-card"]')).not.toBeNull();
  });
});

describe('личная безопасность', () => {
  it('без флага staff_2fa секции кодов восстановления нет', async () => {
    const { container } = await renderServerComponent(AdminPersonalSecurityPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('security.personal', 'admin');
    expect(isFeatureEnabled).toHaveBeenCalledWith('staff_2fa');
    expect(container.querySelector('[data-testid="backup-codes"]')).toBeNull();
    expect(container.querySelector('[data-testid="security-card"]')).not.toBeNull();
  });

  it('с флагом staff_2fa секция кодов восстановления появляется', async () => {
    isFeatureEnabled.mockReturnValue(true);
    const { container } = await renderServerComponent(AdminPersonalSecurityPage());
    expect(container.querySelector('[data-testid="backup-codes"]')).not.toBeNull();
  });

  it('руководитель: тот же экран в своём кабинете', async () => {
    const { container } = await renderServerComponent(LeaderPersonalSecurityPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('security.personal', 'leader');
    expect(container.querySelector('[data-testid="security-card"]')).not.toBeNull();
  });
});

describe('реквизиты исполнителя', () => {
  it('карточка на каждую компанию', async () => {
    listCompaniesRequisites.mockResolvedValue({
      ok: true,
      companies: [
        { id: 'c1', name: 'Промтехносфера', phone: '+7 495 000-00-00', email: 'doc@pts.ru' },
        { id: 'c2', name: 'Вторая', phone: null, email: null },
      ],
    });

    const { container } = await renderServerComponent(AdminRequisitesPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.requisites', 'admin');
    expect(container.textContent).toContain('Реквизиты исполнителя: Промтехносфера');
    expect(container.textContent).toContain('Реквизиты исполнителя: Вторая');
  });

  it('отказ сервиса не роняет страницу', async () => {
    listCompaniesRequisites.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(AdminRequisitesPage());
    expect(container.querySelector('[data-testid="requisites-card"]')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Реквизиты исполнителя');
  });
});

describe('флаги функциональности', () => {
  it('гард раздела и смонтированная матрица', async () => {
    listFeatureFlags.mockResolvedValueOnce({ ok: true, rows: [] });
    const { container } = await renderServerComponent(AdminFeatureFlagsPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('system.featureFlags', 'admin');
    expect(container.querySelector('[data-testid="flags-matrix"]')).not.toBeNull();
    // §15: экран говорит, что здесь делают, а не только как называется.
    expect(container.textContent).toContain('можно включить или выключить');
  });

  it('отказ сервиса — понятный текст вместо пустого экрана', async () => {
    listFeatureFlags.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(AdminFeatureFlagsPage());
    expect(container.querySelector('[data-testid="flags-matrix"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Недостаточно прав');
  });
});
