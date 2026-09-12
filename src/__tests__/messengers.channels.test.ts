import { describe, it, expect } from 'vitest';
import { MESSENGER_CHANNELS, isMessengerChannel } from '@/lib/services/messengers/channels';

/**
 * Список каналов-мессенджеров (спека 2026-09-12, §4 `channels.ts`) — один на
 * диалоги, транспорт и бэкфилл. Эталон записан здесь, а не взят из модуля:
 * подмена канала в реестре должна ронять тест, а не проходить «сам с собой».
 */
describe('messengers/channels', () => {
  it('ровно три транспорта с исходящей отправкой «в тот же адрес»', () => {
    expect([...MESSENGER_CHANNELS]).toEqual(['telegram', 'max', 'whatsapp']);
  });

  it('isMessengerChannel сужает строку канала письма до мессенджера', () => {
    for (const channel of MESSENGER_CHANNELS) {
      expect(isMessengerChannel(channel), channel).toBe(true);
    }
    // Каналы «Входящих», у которых нет исходящего транспорта «в тот же адрес».
    expect(isMessengerChannel('email')).toBe(false);
    expect(isMessengerChannel('cabinet')).toBe(false);
    expect(isMessengerChannel('')).toBe(false);
  });
});
