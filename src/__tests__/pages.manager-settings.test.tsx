// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

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

import ManagerSettingsPage from '@/app/manager/settings/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

describe('ManagerSettingsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    getTelegramStatus.mockReset();
    getNotificationSettings.mockReset();
  });

  it('renders telegram + notification settings cards', async () => {
    requireManager.mockResolvedValue(SESSION);
    getTelegramStatus.mockResolvedValue({ linked: true });
    getNotificationSettings.mockResolvedValue({ view: { email: true } });

    const { container } = await renderServerComponent(ManagerSettingsPage());

    expect(requireManager).toHaveBeenCalled();
    expect(getTelegramStatus).toHaveBeenCalledWith({}, SESSION);
    expect(getNotificationSettings).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Настройки');
    expect(container.textContent).toContain('linked');
    expect(container.textContent).toContain('email');
  });
});
