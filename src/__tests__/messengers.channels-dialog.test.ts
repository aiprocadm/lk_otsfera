/**
 * Реестр каналов ДИАЛОГА (`У-205`, спека этапа 3 §3.1) —
 * `DIALOG_CHANNELS` рядом с `MESSENGER_CHANNELS`.
 *
 * Два списка живут рядом не для красоты: `MESSENGER_CHANNELS` читают вебхуки,
 * доступность ботов и «написать первым» — там речь именно о мессенджерах.
 * Если почта просочится в него, вебхук начнёт считать письмо своим. Поэтому
 * оба эталона записаны здесь ЯВНО, а не взяты из модуля: подмена реестра
 * обязана ронять тест, а не проходить «сама с собой».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  tg: vi.fn(),
  max: vi.fn(),
  wa: vi.fn(),
  setting: vi.fn(),
}));

vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled: m.tg }));
vi.mock('@/lib/max/client', () => ({ isMaxEnabled: m.max }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ isWhatsAppEnabled: m.wa }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ cachedIntegrationSetting: m.setting }));

import {
  DIALOG_CHANNELS,
  DIALOG_CHANNEL_LABELS,
  MESSENGER_CHANNELS,
  MESSENGER_LABELS,
  isDialogChannel,
  isMessengerChannel,
} from '@/lib/services/messengers/channels';
import { isMessengerAvailable } from '@/lib/services/messengers/availability';

beforeEach(() => {
  vi.clearAllMocks();
  m.setting.mockReturnValue(null);
});

describe('DIALOG_CHANNELS — каналы, у которых заводится диалог', () => {
  it('три мессенджера и почта', () => {
    expect([...DIALOG_CHANNELS]).toEqual(['telegram', 'max', 'whatsapp', 'email']);
  });

  it('MESSENGER_CHANNELS не изменился — его читают вебхуки и «написать первым»', () => {
    expect([...MESSENGER_CHANNELS]).toEqual(['telegram', 'max', 'whatsapp']);
    expect([...MESSENGER_CHANNELS]).not.toContain('email');
  });

  it('подписи каналов — русские, у почты «Почта»', () => {
    expect(DIALOG_CHANNEL_LABELS).toEqual({
      telegram: 'Telegram',
      max: 'MAX',
      whatsapp: 'WhatsApp',
      email: 'Почта',
    });
    // Подписи мессенджеров те же самые — два словаря не должны разойтись.
    for (const channel of MESSENGER_CHANNELS) {
      expect(DIALOG_CHANNEL_LABELS[channel]).toBe(MESSENGER_LABELS[channel]);
    }
  });

  it('у каждого канала диалога есть подпись — безымянных в списке нет', () => {
    for (const channel of DIALOG_CHANNELS) {
      expect(DIALOG_CHANNEL_LABELS[channel], channel).toBeTruthy();
    }
  });
});

describe('сужение строки канала', () => {
  it('isDialogChannel пропускает мессенджеры и почту', () => {
    for (const channel of DIALOG_CHANNELS) {
      expect(isDialogChannel(channel), channel).toBe(true);
    }
  });

  it('isDialogChannel не пропускает кабинет и мусор', () => {
    // Канал `cabinet` войдёт в список в PR-7 вместе со своей отправкой
    // (спека §3.1 и план); пока диалога у него нет — и тест это держит.
    expect(isDialogChannel('cabinet')).toBe(false);
    expect(isDialogChannel('sms')).toBe(false);
    expect(isDialogChannel('')).toBe(false);
    expect(isDialogChannel('EMAIL')).toBe(false);
  });

  it('isMessengerChannel остался узким: почта — не мессенджер', () => {
    for (const channel of MESSENGER_CHANNELS) {
      expect(isMessengerChannel(channel), channel).toBe(true);
    }
    expect(isMessengerChannel('email')).toBe(false);
    expect(isMessengerChannel('cabinet')).toBe(false);
  });
});

describe('доступность канала для ответа', () => {
  it.each([
    ['telegram', m.tg],
    ['max', m.max],
    ['whatsapp', m.wa],
  ] as const)('%s спрашивает свой клиент, а настройки почты не трогает', (channel, predicate) => {
    predicate.mockReturnValue(true);
    expect(isMessengerAvailable(channel)).toBe(true);
    expect(m.setting).not.toHaveBeenCalled();
  });

  it('почта доступна: отправка включена, ключ задан И настроен входящий ящик', () => {
    // Входящий ящик — не формальность: без него ответ уйдёт с «no-reply», и
    // ответ клиента попадёт в никуда. Форма ответа не должна появляться там,
    // где ответить по-настоящему нельзя.
    m.setting.mockImplementation((key: string) =>
      key === 'email.enabled'
        ? 'true'
        : key === 'email.resendApiKey'
          ? 're_123'
          : key === 'imap.user'
            ? 'inbox@otsfera.ru'
            : null
    );
    expect(isMessengerAvailable('email')).toBe(true);
  });

  it.each([
    ['ящик не настроен', null],
    ['ящик пустой', '   '],
    ['вместо адреса логин без домена', 'support'],
    ['логин с доменом Windows', 'otsfera\\support'],
  ])('почта недоступна, если %s', (_name, inbox: string | null) => {
    m.setting.mockImplementation((key: string) =>
      key === 'email.enabled'
        ? 'true'
        : key === 'email.resendApiKey'
          ? 're_123'
          : key === 'imap.user'
            ? inbox
            : null
    );
    expect(isMessengerAvailable('email')).toBe(false);
  });

  it.each([
    ['ключа Resend нет', 'true', null],
    ['ключ пустой', 'true', ''],
    ['отправка выключена', 'false', 're_123'],
    ['настройки включения нет', null, 're_123'],
    ['включение пустое', '   ', 're_123'],
    ['включение написано словом «да»', 'да', 're_123'],
  ])('почта недоступна: %s', (_name, enabled: string | null, key: string | null) => {
    m.setting.mockImplementation((k: string) =>
      k === 'email.enabled'
        ? enabled
        : k === 'email.resendApiKey'
          ? key
          : k === 'imap.user'
            ? 'inbox@otsfera.ru'
            : null
    );
    expect(isMessengerAvailable('email')).toBe(false);
  });

  it('значение включения читается без учёта регистра и пробелов', () => {
    m.setting.mockImplementation((key: string) =>
      key === 'email.enabled'
        ? '  TRUE  '
        : key === 'email.resendApiKey'
          ? 're_123'
          : key === 'imap.user'
            ? 'inbox@otsfera.ru'
            : null
    );
    expect(isMessengerAvailable('email')).toBe(true);
  });
});
