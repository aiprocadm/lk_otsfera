import { describe, it, expect } from 'vitest';
import { MESSENGER_LABELS } from '@/lib/services/messengers/channels';
import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNEL_TYPES,
  isContactChannelType,
} from '@/lib/services/contacts/channelLabels';

/**
 * Типы и подписи каналов контакта (этап 1 ТЗ 12.09.2026, `У-180`; спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.4):
 * порядок типов — как в формах; подписи мессенджеров берутся из их реестра,
 * чтобы «Telegram/WhatsApp/MAX» не разъехались между экранами; сужение
 * строки до типа канала отбрасывает чужие значения.
 */
describe('channelLabels', () => {
  it('порядок типов — телефон, почта, затем мессенджеры', () => {
    expect(CONTACT_CHANNEL_TYPES).toEqual(['phone', 'email', 'telegram', 'whatsapp', 'max']);
  });

  it('у каждого типа есть подпись; мессенджеры совпадают с MESSENGER_LABELS', () => {
    for (const type of CONTACT_CHANNEL_TYPES) {
      expect(CONTACT_CHANNEL_LABELS[type]).toBeTruthy();
    }
    expect(CONTACT_CHANNEL_LABELS.phone).toBe('Телефон');
    expect(CONTACT_CHANNEL_LABELS.email).toBe('E-mail');
    expect(CONTACT_CHANNEL_LABELS.telegram).toBe(MESSENGER_LABELS.telegram);
    expect(CONTACT_CHANNEL_LABELS.whatsapp).toBe(MESSENGER_LABELS.whatsapp);
    expect(CONTACT_CHANNEL_LABELS.max).toBe(MESSENGER_LABELS.max);
  });

  it('isContactChannelType: свои типы — да, чужие строки — нет', () => {
    for (const type of CONTACT_CHANNEL_TYPES) expect(isContactChannelType(type)).toBe(true);
    expect(isContactChannelType('fax')).toBe(false);
    expect(isContactChannelType('')).toBe(false);
    expect(isContactChannelType('Phone')).toBe(false);
  });
});
