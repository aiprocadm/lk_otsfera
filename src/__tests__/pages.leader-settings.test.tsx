// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

const { getTelegramStatus } = vi.hoisted(() => ({ getTelegramStatus: vi.fn() }));
vi.mock('@/lib/services/telegram/link', () => ({ getTelegramStatus }));

const { getNotificationSettings } = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('@/lib/services/notifications/preferences', () => ({ getNotificationSettings }));

// TelegramLinkCard / NotificationChannelsCard are 'use client' components that
// call useRouter() -- stub next/navigation covers that.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock('@/components/settings/telegram-link-card', () => ({
  TelegramLinkCard: (props: { status: unknown }) =>
    React.createElement('div', { 'data-testid': 'telegram-card' }, JSON.stringify(props.status))
}));

vi.mock('@/components/settings/notification-channels-card', () => ({
  NotificationChannelsCard: (props: { settings: unknown }) =>
    React.createElement('div', { 'data-testid': 'notification-channels' }, JSON.stringify(props.settings))
}));

import LeaderSettingsPage from '@/app/leader/settings/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'leader' as const, companyId: 'c1' };

describe('LeaderSettingsPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    getTelegramStatus.mockReset();
    getNotificationSettings.mockReset();
  });

  it('renders telegram status and notification settings view', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    getTelegramStatus.mockResolvedValue({ ok: true, linked: true, enabled: true });
    getNotificationSettings.mockResolvedValue({
      ok: true,
      view: { telegramLinked: true, maxLinked: false, channels: [] }
    });

    const { container } = await renderServerComponent(LeaderSettingsPage());

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(getTelegramStatus).toHaveBeenCalledWith({}, SESSION);
    expect(getNotificationSettings).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Настройки');
    expect(container.textContent).toContain('linked');
  });
});
