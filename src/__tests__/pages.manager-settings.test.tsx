// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerSettingsPage from '@/app/manager/settings/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { prismaMock } = vi.hoisted(() => ({ prismaMock: {} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

// A1: внутренний номер читает сервис профиля сотрудника (форма запроса
// пиннится в services.manager.staffProfile.unit).
const { getStaffInternalPhone } = vi.hoisted(() => ({ getStaffInternalPhone: vi.fn() }));
vi.mock('@/lib/services/manager/staffProfile', () => ({ getStaffInternalPhone }));

const { getTelegramStatus } = vi.hoisted(() => ({ getTelegramStatus: vi.fn() }));
vi.mock('@/lib/services/telegram/link', () => ({ getTelegramStatus }));

const { getNotificationSettings } = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('@/lib/services/notifications/preferences', () => ({ getNotificationSettings }));

vi.mock('@/components/settings/telegram-link-card', () => ({
  TelegramLinkCard: (props: { status: unknown }) =>
    React.createElement('div', { 'data-testid': 'telegram-card' }, JSON.stringify(props.status)),
}));

vi.mock('@/components/settings/notification-channels-card', () => ({
  NotificationChannelsCard: (props: { settings: unknown }) =>
    React.createElement('div', { 'data-testid': 'notif-card' }, JSON.stringify(props.settings)),
}));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('@/components/settings/security-card', () => ({
  SecurityCard: () => React.createElement('div', { 'data-testid': 'security-card' }, 'SECURITY'),
}));

vi.mock('@/components/settings/staff-backup-codes-section', () => ({
  StaffBackupCodesSection: () =>
    React.createElement('div', { 'data-testid': 'backup-codes-section' }, 'BACKUP'),
}));

vi.mock('@/components/manager/settings/internal-phone-card', () => ({
  InternalPhoneCard: (props: { initialInternalPhone: string | null }) =>
    React.createElement(
      'div',
      { 'data-testid': 'internal-phone-card' },
      String(props.initialInternalPhone)
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};

/**
 * `У-114`: личные настройки — один экран с вкладками во всех пяти кабинетах.
 * Раньше у менеджера это была одна длинная страница со всеми карточками
 * подряд, а у партнёра — четыре вкладки: один и тот же набор выглядел
 * по-разному.
 */
describe('ManagerSettingsPage (У-114)', () => {
  beforeEach(() => {
    requireManager.mockReset().mockResolvedValue(SESSION);
    getTelegramStatus.mockReset().mockResolvedValue({ linked: true });
    getNotificationSettings.mockReset().mockResolvedValue({ view: { email: true } });
    getStaffInternalPhone.mockReset().mockResolvedValue(null);
    isFeatureEnabled.mockReset().mockReturnValue(false);
  });

  const render = (tab?: string) =>
    renderServerComponent(
      ManagerSettingsPage({ searchParams: Promise.resolve(tab ? { tab } : {}) })
    );

  it('вкладки одни и те же во всех кабинетах и в одном порядке', async () => {
    const { container } = await render();
    const tabs = [...container.querySelectorAll('[data-testid^="personal-tab-"]')].map((el) =>
      el.getAttribute('data-testid')
    );
    expect(tabs).toEqual([
      'personal-tab-profile',
      'personal-tab-notifications',
      'personal-tab-security',
    ]);
    // «Команда» есть только у партнёра-администратора.
    expect(tabs).not.toContain('personal-tab-team');
  });

  it('«Профиль»: привязка Telegram и внутренний номер', async () => {
    getStaffInternalPhone.mockResolvedValue('1234');
    const { container } = await render('profile');
    expect(container.querySelector('[data-testid="telegram-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="internal-phone-card"]')?.textContent).toBe(
      '1234'
    );
    // Каналы уведомлений сюда не попадают — у них своя вкладка.
    expect(container.querySelector('[data-testid="notif-card"]')).toBeNull();
  });

  it('«Уведомления»: каналы, и сервис зовётся только здесь', async () => {
    const { container } = await render('notifications');
    expect(container.querySelector('[data-testid="notif-card"]')).not.toBeNull();
    expect(getNotificationSettings).toHaveBeenCalled();
    expect(getTelegramStatus).not.toHaveBeenCalled();
  });

  it('«Безопасность»: сессии, а коды восстановления — под флагом', async () => {
    const off = await render('security');
    expect(off.container.querySelector('[data-testid="security-card"]')).not.toBeNull();
    expect(off.container.querySelector('[data-testid="backup-codes-section"]')).toBeNull();

    isFeatureEnabled.mockReturnValue(true);
    const on = await render('security');
    expect(on.container.querySelector('[data-testid="backup-codes-section"]')).not.toBeNull();
  });

  it('данные грузятся только для открытой вкладки', async () => {
    await render('security');
    expect(getTelegramStatus).not.toHaveBeenCalled();
    expect(getNotificationSettings).not.toHaveBeenCalled();
    expect(getStaffInternalPhone).not.toHaveBeenCalled();
  });

  it('незнакомая вкладка в адресе открывает «Профиль», а не пустой экран', async () => {
    const { container } = await render('нет-такой');
    expect(container.querySelector('[data-testid="telegram-card"]')).not.toBeNull();
  });
});
