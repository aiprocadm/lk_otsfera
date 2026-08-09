// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PartnerSettingsPage from '@/app/partner/settings/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getTelegramStatus } = vi.hoisted(() => ({ getTelegramStatus: vi.fn() }));
vi.mock('@/lib/services/telegram/link', () => ({ getTelegramStatus }));

const { getNotificationSettings } = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('@/lib/services/notifications/preferences', () => ({ getNotificationSettings }));

// Этап 8 (PR-1): реквизиты партнёра — сервис и карточка стабятся.
const { getPartnerRequisites } = vi.hoisted(() => ({ getPartnerRequisites: vi.fn() }));
vi.mock('@/lib/services/partner/requisites', () => ({ getPartnerRequisites }));
vi.mock('@/server-actions/requisites', () => ({ setPartnerRequisitesAction: vi.fn() }));
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

// TelegramLinkCard ('use client') calls useRouter().
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1' };

describe('PartnerSettingsPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    getPartnerRequisites.mockReset().mockResolvedValue({ ok: false, error: 'forbidden' });
    getTelegramStatus.mockReset();
    getNotificationSettings.mockReset();
  });

  it('карточка реквизитов появляется, когда сервис их отдал; правка — только у админа партнёра', async () => {
    // Реквизиты нужны для автогенерации документов. Если бы карточка не
    // отрисовалась, партнёр не смог бы их заполнить и документы не собрались бы.
    requirePartner.mockResolvedValue({ ...SESSION, partnerRole: 'admin' });
    getTelegramStatus.mockResolvedValue({ ok: true, linked: false, enabled: true });
    getNotificationSettings.mockResolvedValue({
      ok: true,
      view: {
        emailAlwaysOn: true,
        telegram: { available: true, linked: false, enabled: true },
        max: { available: false, linked: false, enabled: false },
        whatsapp: { available: false, phone: null, enabled: false },
      },
    });
    getPartnerRequisites.mockResolvedValue({
      ok: true,
      requisites: {
        legalName: 'ООО Партнёр',
        inn: '7707083893',
        kpp: null,
        ogrn: null,
        legalAddress: null,
        bankName: null,
        bankAccount: null,
        corrAccount: null,
        bic: null,
        signerName: null,
        signerPosition: null,
        signerBasis: null,
      },
    });

    const { container } = await renderServerComponent(
      PartnerSettingsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('Реквизиты партнёра');
  });

  it('renders the telegram link card and notification channels card', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getTelegramStatus.mockResolvedValue({ ok: true, linked: false, enabled: true });
    getNotificationSettings.mockResolvedValue({
      ok: true,
      view: {
        emailAlwaysOn: true,
        telegram: { available: true, linked: false, enabled: true },
        max: { available: false, linked: false, enabled: false },
        whatsapp: { available: false, phone: null, enabled: false },
      },
    });

    // У-60 (этап 4): уведомления уехали на свою вкладку — открываем её явно.
    const { container } = await renderServerComponent(
      PartnerSettingsPage({ searchParams: Promise.resolve({ tab: 'notifications' }) })
    );

    expect(getTelegramStatus).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(getNotificationSettings).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(container.textContent).toContain('Настройки');
  });

  // ── У-60: вкладки настроек партнёра ──────────────────────────────────────
  it('показывает четыре вкладки администратору партнёра', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, partnerRole: 'admin' });

    const { container } = await renderServerComponent(
      PartnerSettingsPage({ searchParams: Promise.resolve({}) })
    );

    for (const key of ['profile', 'team', 'notifications', 'security']) {
      expect(container.querySelector(`[data-testid="partner-settings-tab-${key}"]`)).not.toBeNull();
    }
  });

  it('обычному партнёрскому пользователю вкладки «Команда» не видно', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, partnerRole: 'manager' });

    const { container } = await renderServerComponent(
      PartnerSettingsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.querySelector('[data-testid="partner-settings-tab-team"]')).toBeNull();
  });

  it('прямая ссылка на «Команду» от не-админа открывает «Профиль», а не пустой экран', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, partnerRole: 'manager' });
    getPartnerRequisites.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      PartnerSettingsPage({ searchParams: Promise.resolve({ tab: 'team' }) })
    );

    expect(
      container
        .querySelector('[data-testid="partner-settings-tab-profile"]')
        ?.getAttribute('data-active')
    ).toBe('true');
  });

  it('незнакомая вкладка в адресе открывает «Профиль»', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, partnerRole: 'admin' });

    const { container } = await renderServerComponent(
      PartnerSettingsPage({ searchParams: Promise.resolve({ tab: 'нет-такой' }) })
    );

    expect(
      container
        .querySelector('[data-testid="partner-settings-tab-profile"]')
        ?.getAttribute('data-active')
    ).toBe('true');
  });

  it('§15: у экрана есть подзаголовок, объясняющий, что здесь делают', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, partnerRole: 'admin' });

    const { container } = await renderServerComponent(
      PartnerSettingsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('Реквизиты для документов');
  });
});
