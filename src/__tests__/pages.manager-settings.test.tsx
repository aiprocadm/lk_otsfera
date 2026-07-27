// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique } } }));

const { getTelegramStatus } = vi.hoisted(() => ({ getTelegramStatus: vi.fn() }));
vi.mock('@/lib/services/telegram/link', () => ({ getTelegramStatus }));

const { getNotificationSettings } = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('@/lib/services/notifications/preferences', () => ({ getNotificationSettings }));

vi.mock('@/components/settings/telegram-link-card', () => ({
  TelegramLinkCard: (props: { status: unknown }) =>
    React.createElement('div', { 'data-testid': 'telegram-card' }, JSON.stringify(props.status))
}));

vi.mock('@/components/settings/notification-channels-card', () => ({
  NotificationChannelsCard: (props: { settings: unknown }) =>
    React.createElement('div', { 'data-testid': 'notif-card' }, JSON.stringify(props.settings))
}));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('@/components/settings/security-card', () => ({
  SecurityCard: () => React.createElement('div', { 'data-testid': 'security-card' }, 'SECURITY')
}));

vi.mock('@/components/settings/staff-backup-codes-section', () => ({
  StaffBackupCodesSection: () =>
    React.createElement('div', { 'data-testid': 'backup-codes-section' }, 'BACKUP')
}));

vi.mock('@/components/manager/settings/internal-phone-card', () => ({
  InternalPhoneCard: (props: { initialInternalPhone: string | null }) =>
    React.createElement('div', { 'data-testid': 'internal-phone-card' }, String(props.initialInternalPhone))
}));

import ManagerSettingsPage from '@/app/manager/settings/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

describe('ManagerSettingsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    getTelegramStatus.mockReset();
    getNotificationSettings.mockReset();
    findUnique.mockReset();
    findUnique.mockResolvedValue({ internalPhone: null });
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(false);
  });

  it('renders telegram + notification settings + internal-phone cards', async () => {
    requireManager.mockResolvedValue(SESSION);
    getTelegramStatus.mockResolvedValue({ linked: true });
    getNotificationSettings.mockResolvedValue({ view: { email: true } });
    findUnique.mockResolvedValue({ internalPhone: '101' });

    const { container } = await renderServerComponent(ManagerSettingsPage());

    expect(requireManager).toHaveBeenCalled();
    expect(getTelegramStatus).toHaveBeenCalledWith({ user: { findUnique } }, SESSION);
    expect(getNotificationSettings).toHaveBeenCalledWith({ user: { findUnique } }, SESSION);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { internalPhone: true } });
    expect(container.textContent).toContain('Настройки');
    expect(container.textContent).toContain('linked');
    expect(container.textContent).toContain('email');
    expect(container.querySelector('[data-testid="internal-phone-card"]')?.textContent).toBe('101');
    expect(container.querySelector('[data-testid="backup-codes-section"]')).toBeNull();
  });

  it('passes null to the internal-phone card when the user has no number set', async () => {
    requireManager.mockResolvedValue(SESSION);
    getTelegramStatus.mockResolvedValue({ linked: true });
    getNotificationSettings.mockResolvedValue({ view: { email: true } });
    findUnique.mockResolvedValue(null);

    const { container } = await renderServerComponent(ManagerSettingsPage());

    expect(container.querySelector('[data-testid="internal-phone-card"]')?.textContent).toBe('null');
  });

  it('shows the backup-codes section when staff_2fa is enabled', async () => {
    requireManager.mockResolvedValue(SESSION);
    getTelegramStatus.mockResolvedValue({ linked: true });
    getNotificationSettings.mockResolvedValue({ view: { email: true } });
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(ManagerSettingsPage());

    expect(isFeatureEnabled).toHaveBeenCalledWith('staff_2fa');
    expect(container.querySelector('[data-testid="backup-codes-section"]')).not.toBeNull();
  });
});
