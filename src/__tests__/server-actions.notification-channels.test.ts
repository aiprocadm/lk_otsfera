import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, updateChannelPreference, saveWhatsappPhone } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  updateChannelPreference: vi.fn(),
  saveWhatsappPhone: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/services/notifications/preferences', () => ({
  updateChannelPreference,
  saveWhatsappPhone,
}));

import {
  saveWhatsappPhoneAction,
  updateChannelPreferenceAction,
} from '@/server-actions/notification-channels';

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'u-1' });
});

describe('updateChannelPreferenceAction', () => {
  it('требует сессию и делегирует сервису', async () => {
    updateChannelPreference.mockResolvedValue({ ok: true, channels: { telegram: false } });
    const result = await updateChannelPreferenceAction('telegram', false);
    expect(requireSession).toHaveBeenCalled();
    expect(updateChannelPreference).toHaveBeenCalledWith({}, { sub: 'u-1' }, {
      channel: 'telegram',
      enabled: false,
    });
    expect(result).toEqual({ ok: true, channels: { telegram: false } });
  });
});

describe('saveWhatsappPhoneAction', () => {
  it('требует сессию и делегирует сервису', async () => {
    saveWhatsappPhone.mockResolvedValue({ ok: true, phone: '+79991234567' });
    const result = await saveWhatsappPhoneAction('+7 999 123-45-67');
    expect(requireSession).toHaveBeenCalled();
    expect(saveWhatsappPhone).toHaveBeenCalledWith({}, { sub: 'u-1' }, {
      phone: '+7 999 123-45-67',
    });
    expect(result).toEqual({ ok: true, phone: '+79991234567' });
  });
});
