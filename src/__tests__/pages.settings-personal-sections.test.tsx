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

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect,
}));

vi.mock('@/components/manager/settings/internal-phone-card', () => ({
  InternalPhoneCard: (props: { initialInternalPhone: string | null }) =>
    React.createElement(
      'div',
      { 'data-testid': 'internal-phone-card' },
      String(props.initialInternalPhone)
    ),
}));

const { getStaffInternalPhone } = vi.hoisted(() => ({ getStaffInternalPhone: vi.fn() }));
vi.mock('@/lib/services/manager/staffProfile', () => ({ getStaffInternalPhone }));

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
vi.mock('@/components/admin/integrations-health-panel', () => ({
  IntegrationsHealthPanel: (props: {
    rows: Array<{ flagEditable?: boolean }>;
    lockedLabel?: string;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'health-panel' },
      `${props.rows.map((r) => String(r.flagEditable)).join(',')}|${props.lockedLabel}`
    ),
}));

const { getIntegrationsHealth } = vi.hoisted(() => ({ getIntegrationsHealth: vi.fn() }));
vi.mock('@/lib/services/admin/integrationsHealth', () => ({ getIntegrationsHealth }));

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
import AdminPersonalSettingsPage from '@/app/admin/settings/personal/page';
import LeaderPersonalSettingsPage from '@/app/leader/settings/personal/page';
import { personalSettingsTabsFor } from '@/lib/navigation/personalSettings';
import AdminRequisitesPage from '@/app/admin/settings/catalogs/requisites/page';
import LeaderRequisitesPage from '@/app/leader/settings/catalogs/requisites/page';
import LeaderIntegrationsPage from '@/app/leader/settings/integrations/page';
import AdminFeatureFlagsPage from '@/app/admin/settings/system/feature-flags/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'leader' as const };

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
  getStaffInternalPhone.mockReset().mockResolvedValue(null);
  redirect.mockReset();
});

/**
 * `У-114`: «Каналы уведомлений» и «Личная безопасность» были двумя разделами в
 * двух разных группах хаба, хотя это одно и то же — настройки себя. Теперь один
 * раздел с теми же вкладками, что у менеджера, партнёра и заказчика.
 */
describe('личные настройки в хабе (У-114)', () => {
  const render = (
    page: (a: { searchParams: Promise<{ tab?: string }> }) => unknown,
    tab?: string
  ) =>
    renderServerComponent(
      page({ searchParams: Promise.resolve(tab ? { tab } : {}) }) as Promise<React.ReactNode>
    );

  it('админ: гард раздела и те же вкладки в том же порядке', async () => {
    const { container } = await render(AdminPersonalSettingsPage);

    expect(requireSettingsSection).toHaveBeenCalledWith('personal.settings', 'admin');
    expect(container.querySelector('h1')?.textContent).toBe('Личные настройки');
    const shown = [...container.querySelectorAll('[data-testid^="personal-tab-"]')].map(
      (el) => el.textContent
    );
    expect(shown).toEqual(personalSettingsTabsFor().map((t) => t.label));
  });

  it('«Профиль» админа: привязка Telegram, но без внутреннего номера', async () => {
    // Внутренний номер — менеджерский контур: click-to-call через Mango, и
    // `updateInternalPhoneAction` админа всё равно не пустит.
    const { container } = await render(AdminPersonalSettingsPage, 'profile');
    expect(container.querySelector('[data-testid="telegram-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="internal-phone-card"]')).toBeNull();
    expect(getStaffInternalPhone).not.toHaveBeenCalled();
  });

  it('«Профиль» руководителя: и Telegram, и внутренний номер', async () => {
    getStaffInternalPhone.mockResolvedValue('1234');
    const { container } = await render(LeaderPersonalSettingsPage, 'profile');

    expect(requireSettingsSection).toHaveBeenCalledWith('personal.settings', 'leader');
    expect(container.querySelector('[data-testid="internal-phone-card"]')?.textContent).toBe(
      '1234'
    );
  });

  it('«Уведомления»: каналы, и за телеграмом сюда не ходим', async () => {
    const { container } = await render(AdminPersonalSettingsPage, 'notifications');
    expect(container.querySelector('[data-testid="notif-card"]')).not.toBeNull();
    expect(getNotificationSettings).toHaveBeenCalledWith({}, ADMIN);
    expect(getTelegramStatus).not.toHaveBeenCalled();
  });

  it('«Безопасность»: сессии всегда, коды восстановления — под флагом', async () => {
    const off = await render(AdminPersonalSettingsPage, 'security');
    expect(off.container.querySelector('[data-testid="security-card"]')).not.toBeNull();
    expect(off.container.querySelector('[data-testid="backup-codes"]')).toBeNull();
    expect(isFeatureEnabled).toHaveBeenCalledWith('staff_2fa');

    isFeatureEnabled.mockReturnValue(true);
    const on = await render(AdminPersonalSettingsPage, 'security');
    expect(on.container.querySelector('[data-testid="backup-codes"]')).not.toBeNull();
  });

  it('незнакомая вкладка открывает «Профиль», а не пустой экран', async () => {
    const { container } = await render(LeaderPersonalSettingsPage, 'нет-такой');
    expect(container.querySelector('[data-testid="telegram-card"]')).not.toBeNull();
  });
});

describe('старые адреса разделов остаются живыми (У-114)', () => {
  it.each([
    [
      'админ · уведомления',
      AdminNotificationChannelsPage,
      '/admin/settings/personal?tab=notifications',
    ],
    [
      'руководитель · уведомления',
      LeaderNotificationChannelsPage,
      '/leader/settings/personal?tab=notifications',
    ],
    ['админ · безопасность', AdminPersonalSecurityPage, '/admin/settings/personal?tab=security'],
    [
      'руководитель · безопасность',
      LeaderPersonalSecurityPage,
      '/leader/settings/personal?tab=security',
    ],
  ])('%s → своя вкладка нового раздела', (_name, page, to) => {
    (page as () => void)();
    expect(redirect).toHaveBeenCalledWith(to);
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

  // `У-135`: тот же экран у руководителя — карточка только своей компании
  // (скоуп даёт сервис), гард своего кабинета.
  it('руководитель: гард раздела и карточка своей компании', async () => {
    requireSettingsSection.mockResolvedValueOnce({ ...LEADER, companyId: 'c1' });
    listCompaniesRequisites.mockResolvedValue({
      ok: true,
      companies: [{ id: 'c1', name: 'Промтехносфера', phone: null, email: null }],
    });

    const { container } = await renderServerComponent(LeaderRequisitesPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.requisites', 'leader');
    expect(container.textContent).toContain('Реквизиты исполнителя: Промтехносфера');
  });

  it('руководитель без компании: объяснение вместо пустоты', async () => {
    // В LEADER нет companyId — hasCompany=false. Сервис при этом отвечает
    // отказом — страница не падает, а объясняет.
    listCompaniesRequisites.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(LeaderRequisitesPage());
    expect(container.querySelector('[data-testid="requisites-card"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('не указана компания');
  });
});

// `У-135` (решение `Р-22`): «Интеграции» руководителя — светофор без секретов.
describe('интеграции руководителя', () => {
  it('гард раздела, светофор read-only (flagEditable=false у каждой строки)', async () => {
    getIntegrationsHealth.mockResolvedValue({
      ok: true,
      rows: [
        { key: 'one_c', flagEditable: true },
        { key: 'mail', flagEditable: true },
      ],
    });

    const { container } = await renderServerComponent(LeaderIntegrationsPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.overview', 'leader');
    // Панель получила обе строки, у обеих переключатель погашен, и подпись
    // говорит правду: канал переключает администратор, а не «сервер».
    expect(container.querySelector('[data-testid="health-panel"]')?.textContent).toBe(
      'false,false|переключает администратор'
    );
    // §15: экран объясняет, кто настраивает подключения.
    expect(container.textContent).toContain('Настраивает их администратор');
  });

  it('отказ сервиса — понятный текст вместо пустого экрана', async () => {
    getIntegrationsHealth.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(LeaderIntegrationsPage());
    expect(container.querySelector('[data-testid="health-panel"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Недостаточно прав');
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
