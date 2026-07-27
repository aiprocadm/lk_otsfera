// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

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

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

// Этап 8 (PR-1): реквизиты Company — сервис и карточка стабятся.
const { listCompaniesRequisites } = vi.hoisted(() => ({ listCompaniesRequisites: vi.fn() }));
vi.mock('@/lib/services/admin/companyRequisites', () => ({ listCompaniesRequisites }));
vi.mock('@/server-actions/requisites', () => ({ setCompanyRequisitesAction: vi.fn() }));
vi.mock('@/components/requisites/requisites-card', () => ({
  RequisitesCard: (props: { title: string }) =>
    React.createElement('div', { 'data-testid': 'requisites-card' }, props.title)
}));

vi.mock('@/components/settings/security-card', () => ({
  SecurityCard: () => React.createElement('div', { 'data-testid': 'security-card' }, 'SECURITY')
}));

vi.mock('@/components/settings/staff-backup-codes-section', () => ({
  StaffBackupCodesSection: () =>
    React.createElement('div', { 'data-testid': 'backup-codes-section' }, 'BACKUP')
}));

// Матрица читает FEATURE_FLAGS напрямую (featureFlags тут замокан) — заглушка;
// сам компонент покрыт components.feature-flags-matrix.test.tsx.
vi.mock('@/components/admin/feature-flags-matrix', () => ({
  FeatureFlagsMatrix: () => React.createElement('div', { 'data-testid': 'flags-matrix' }, 'FLAGS')
}));

import AdminSettingsPage from '@/app/admin/settings/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getTelegramStatus.mockReset();
    getNotificationSettings.mockReset();
    isFeatureEnabled.mockReset();
    listCompaniesRequisites.mockReset().mockResolvedValue({ ok: true, companies: [] });
    isFeatureEnabled.mockReturnValue(false);
  });

  it('renders telegram + notification settings cards', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getTelegramStatus.mockResolvedValue({ linked: true });
    getNotificationSettings.mockResolvedValue({ view: { email: true } });

    const { container } = await renderServerComponent(AdminSettingsPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(getTelegramStatus).toHaveBeenCalledWith({}, SESSION);
    expect(getNotificationSettings).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Настройки');
    expect(container.textContent).toContain('linked');
    expect(container.textContent).toContain('email');
    // Флаг выключен → секции кодов восстановления нет
    expect(container.querySelector('[data-testid="backup-codes-section"]')).toBeNull();
    // ФТ-14.6: read-only матрица флагов смонтирована; плашка ведёт в «Интеграции»
    expect(container.querySelector('[data-testid="flags-matrix"]')).not.toBeNull();
    expect(container.textContent).toContain('на странице «Интеграции»');
  });

  it('shows the backup-codes section when staff_2fa is enabled', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getTelegramStatus.mockResolvedValue({ linked: true });
    getNotificationSettings.mockResolvedValue({ view: { email: true } });
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(AdminSettingsPage());

    expect(isFeatureEnabled).toHaveBeenCalledWith('staff_2fa');
    expect(container.querySelector('[data-testid="backup-codes-section"]')).not.toBeNull();
  });
});
