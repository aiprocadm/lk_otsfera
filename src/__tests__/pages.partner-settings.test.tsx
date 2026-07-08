// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getTelegramStatus } = vi.hoisted(() => ({ getTelegramStatus: vi.fn() }));
vi.mock('@/lib/services/telegram/link', () => ({ getTelegramStatus }));

const { getNotificationSettings } = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('@/lib/services/notifications/preferences', () => ({ getNotificationSettings }));

// TelegramLinkCard ('use client') calls useRouter().
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

import PartnerSettingsPage from '@/app/partner/settings/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1' };

describe('PartnerSettingsPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    getTelegramStatus.mockReset();
    getNotificationSettings.mockReset();
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
        whatsapp: { available: false, phone: null, enabled: false }
      }
    });

    const { container } = await renderServerComponent(PartnerSettingsPage());

    expect(getTelegramStatus).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(getNotificationSettings).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(container.textContent).toContain('Настройки');
  });
});
