import { describe, it, expect, vi, beforeEach } from 'vitest';

const enabled = vi.hoisted(() => ({ tg: vi.fn(), max: vi.fn(), wa: vi.fn() }));
vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled: enabled.tg }));
vi.mock('@/lib/max/client', () => ({ isMaxEnabled: enabled.max }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ isWhatsAppEnabled: enabled.wa }));

import {
  MESSENGER_CHANNELS,
  MESSENGER_LABELS,
  isMessengerChannel,
} from '@/lib/services/messengers/channels';
import { isMessengerAvailable } from '@/lib/services/messengers/availability';

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

  it('подписи каналов — те, что видит человек на экране', () => {
    expect(MESSENGER_LABELS).toEqual({ telegram: 'Telegram', max: 'MAX', whatsapp: 'WhatsApp' });
  });
});

describe('isMessengerAvailable — те же предикаты, что у транспортов уведомлений', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['telegram', enabled.tg],
    ['max', enabled.max],
    ['whatsapp', enabled.wa],
  ] as const)('%s спрашивает свой клиент', (channel, predicate) => {
    predicate.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(isMessengerAvailable(channel)).toBe(true);
    expect(isMessengerAvailable(channel)).toBe(false);
    expect(predicate).toHaveBeenCalledTimes(2);
  });
});
