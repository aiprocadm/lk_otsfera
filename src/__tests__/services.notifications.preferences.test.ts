import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  userFindUnique,
  userUpdate,
  recordAudit,
  isTelegramEnabled,
  isMaxEnabled,
  isWhatsAppEnabled,
} = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  recordAudit: vi.fn(),
  isTelegramEnabled: vi.fn(),
  isMaxEnabled: vi.fn(),
  isWhatsAppEnabled: vi.fn(),
}));

vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled }));
vi.mock('@/lib/max/client', () => ({ isMaxEnabled }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ isWhatsAppEnabled }));

import type { PrismaClient } from '@prisma/client';
import {
  getNotificationSettings,
  normalizePhone,
  saveWhatsappPhone,
  updateChannelPreference,
} from '@/lib/services/notifications/preferences';
import {
  channelPrefEnabled,
  isOptionalChannelKey,
  parseChannelPrefs,
} from '@/lib/notifications/channels/preferences';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = {
  user: { findUnique: userFindUnique, update: userUpdate },
} as unknown as PrismaClient;

const session = { sub: 'u-1' } as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  userUpdate.mockResolvedValue({});
  recordAudit.mockResolvedValue(undefined);
  isTelegramEnabled.mockReturnValue(false);
  isMaxEnabled.mockReturnValue(false);
  isWhatsAppEnabled.mockReturnValue(false);
});

describe('parseChannelPrefs / channelPrefEnabled', () => {
  it('null/undefined/мусор → пустые настройки (ничего не выключено)', () => {
    expect(parseChannelPrefs(null)).toEqual({});
    expect(parseChannelPrefs(undefined)).toEqual({});
    expect(parseChannelPrefs('garbage')).toEqual({});
    expect(parseChannelPrefs(42)).toEqual({});
    expect(parseChannelPrefs({ telegram: 'yes' })).toEqual({});
  });

  it('валидные значения проходят, чужие ключи отбрасываются', () => {
    expect(parseChannelPrefs({ telegram: false, max: true, extra: 1 })).toEqual({
      telegram: false,
      max: true,
    });
  });

  it('channelPrefEnabled: !== false семантика', () => {
    expect(channelPrefEnabled(null, 'telegram')).toBe(true);
    expect(channelPrefEnabled({}, 'whatsapp')).toBe(true);
    expect(channelPrefEnabled({ whatsapp: false }, 'whatsapp')).toBe(false);
    expect(channelPrefEnabled({ whatsapp: true }, 'whatsapp')).toBe(true);
  });

  it('isOptionalChannelKey: email и мусор — нет', () => {
    expect(isOptionalChannelKey('telegram')).toBe(true);
    expect(isOptionalChannelKey('max')).toBe(true);
    expect(isOptionalChannelKey('whatsapp')).toBe(true);
    expect(isOptionalChannelKey('email')).toBe(false);
    expect(isOptionalChannelKey('sms')).toBe(false);
  });
});

describe('updateChannelPreference', () => {
  it('email/неизвестный канал → invalid_channel, БД не трогается', async () => {
    const r1 = await updateChannelPreference(prisma, session, { channel: 'email', enabled: false });
    const r2 = await updateChannelPreference(prisma, session, { channel: 'pigeon', enabled: true });
    expect(r1).toEqual({ ok: false, error: 'invalid_channel' });
    expect(r2).toEqual({ ok: false, error: 'invalid_channel' });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('мержит с существующими настройками', async () => {
    userFindUnique.mockResolvedValue({ notificationChannels: { telegram: false } });
    const result = await updateChannelPreference(prisma, session, {
      channel: 'max',
      enabled: true,
    });
    expect(result).toEqual({ ok: true, channels: { telegram: false, max: true } });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { notificationChannels: { telegram: false, max: true } },
    });
  });

  it('мусор в колонке не мешает обновлению (терпимый парсер)', async () => {
    userFindUnique.mockResolvedValue({ notificationChannels: 'garbage' });
    const result = await updateChannelPreference(prisma, session, {
      channel: 'telegram',
      enabled: false,
    });
    expect(result).toEqual({ ok: true, channels: { telegram: false } });
  });

  it('пользователь без строки настроек (null user) → создаёт с нуля', async () => {
    userFindUnique.mockResolvedValue(null);
    const result = await updateChannelPreference(prisma, session, {
      channel: 'whatsapp',
      enabled: false,
    });
    expect(result).toEqual({ ok: true, channels: { whatsapp: false } });
  });
});

describe('getNotificationSettings', () => {
  it('email всегда включён; каналы отражают available/linked/enabled', async () => {
    isTelegramEnabled.mockReturnValue(true);
    isMaxEnabled.mockReturnValue(false);
    isWhatsAppEnabled.mockReturnValue(true);
    userFindUnique.mockResolvedValue({
      telegramChatId: 'tg-1',
      maxChatId: null,
      whatsappPhone: '+79991234567',
      notificationChannels: { telegram: false, whatsapp: true },
    });

    const { view } = await getNotificationSettings(prisma, session);
    expect(view.emailAlwaysOn).toBe(true);
    expect(view.telegram).toEqual({ available: true, linked: true, enabled: false });
    expect(view.max).toEqual({ available: false, linked: false, enabled: true });
    expect(view.whatsapp).toEqual({ available: true, phone: '+79991234567', enabled: true });
  });

  it('пользователь без строки → все каналы unlinked, enabled=true (нет мьюта)', async () => {
    userFindUnique.mockResolvedValue(null);
    const { view } = await getNotificationSettings(prisma, session);
    expect(view.telegram.linked).toBe(false);
    expect(view.telegram.enabled).toBe(true);
    expect(view.whatsapp.phone).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('E.164 и разделители', () => {
    expect(normalizePhone('+7 (912) 345-67-89')).toBe('+79123456789');
    expect(normalizePhone('79123456789')).toBe('+79123456789');
  });

  it('домашний RU-формат 8XXXXXXXXXX → +7', () => {
    expect(normalizePhone('8 912 345-67-89')).toBe('+79123456789');
  });

  it('невалидный ввод → null', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('+7912345678901234567')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('saveWhatsappPhone', () => {
  it('сохраняет нормализованный номер + audit без ПДн', async () => {
    const result = await saveWhatsappPhone(prisma, session, { phone: '8 (912) 345-67-89' });
    expect(result).toEqual({ ok: true, phone: '+79123456789' });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { whatsappPhone: '+79123456789' },
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'u-1',
      action: 'whatsapp_phone_saved',
      entity: 'user',
      entityId: 'u-1',
    });
  });

  it('пустая строка = отвязка', async () => {
    const result = await saveWhatsappPhone(prisma, session, { phone: '  ' });
    expect(result).toEqual({ ok: true, phone: null });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { whatsappPhone: null },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'whatsapp_phone_removed' })
    );
  });

  it('невалидный номер → invalid_phone', async () => {
    const result = await saveWhatsappPhone(prisma, session, { phone: 'not-a-phone' });
    expect(result).toEqual({ ok: false, error: 'invalid_phone' });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('дубль номера (P2002) → phone_taken', async () => {
    userUpdate.mockRejectedValue({ code: 'P2002' });
    const result = await saveWhatsappPhone(prisma, session, { phone: '+79123456789' });
    expect(result).toEqual({ ok: false, error: 'phone_taken' });
  });

  it('прочие ошибки БД пробрасываются', async () => {
    userUpdate.mockRejectedValue(new Error('db down'));
    await expect(saveWhatsappPhone(prisma, session, { phone: '+79123456789' })).rejects.toThrow(
      'db down'
    );
  });
});
