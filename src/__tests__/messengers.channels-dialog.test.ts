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
  it('три мессенджера, почта и кабинет', () => {
    // `У-212`: кабинет — полноценный канал диалога, а не «почти диалог».
    // У вопроса из кабинета есть собеседник (пользователь), история и
    // ответственный; отличается только транспорт — наружу ничего не уходит,
    // ответ кладётся уведомлением внутрь системы. Поэтому он здесь, но НЕ в
    // `MESSENGER_CHANNELS` (следующий тест) — там речь о ботах и вебхуках.
    expect([...DIALOG_CHANNELS]).toEqual(['telegram', 'max', 'whatsapp', 'email', 'cabinet']);
  });

  it('MESSENGER_CHANNELS не изменился — его читают вебхуки и доступность ботов', () => {
    expect([...MESSENGER_CHANNELS]).toEqual(['telegram', 'max', 'whatsapp']);
    expect([...MESSENGER_CHANNELS]).not.toContain('email');
    // Если кабинет просочится сюда, вебхук мессенджера начнёт считать
    // внутреннее обращение своим, а «написать первым» предложит отправить
    // сообщение в несуществующий чат.
    expect([...MESSENGER_CHANNELS]).not.toContain('cabinet');
  });

  it('подписи каналов — русские, у почты «Почта», у кабинета «Кабинет»', () => {
    expect(DIALOG_CHANNEL_LABELS).toEqual({
      telegram: 'Telegram',
      max: 'MAX',
      whatsapp: 'WhatsApp',
      email: 'Почта',
      // `У-212` и правило зеркала (§0.2): одно слово во всех кабинетах.
      cabinet: 'Кабинет',
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
  it('isDialogChannel пропускает мессенджеры, почту и кабинет', () => {
    for (const channel of DIALOG_CHANNELS) {
      expect(isDialogChannel(channel), channel).toBe(true);
    }
    // `У-212`: кабинет вошёл в список в PR-7 вместе со своей отправкой
    // (`deliverToCabinet`) — раньше здесь ожидался `false`.
    expect(isDialogChannel('cabinet')).toBe(true);
  });

  it('isDialogChannel не пропускает мусор и чужой регистр', () => {
    expect(isDialogChannel('sms')).toBe(false);
    expect(isDialogChannel('')).toBe(false);
    expect(isDialogChannel('EMAIL')).toBe(false);
    expect(isDialogChannel('Кабинет')).toBe(false);
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

  it('кабинет доступен всегда — «подключать» там нечего', () => {
    // `У-212`: ответ в кабинет — это уведомление внутрь системы. Ни бота, ни
    // ключа, ни настройки для него не нужно, поэтому предикат не должен ни
    // спрашивать клиентов мессенджеров, ни читать настройки интеграций.
    // Единственное условие — известен пользователь, и его проверяет сама
    // доставка (`deliverToCabinet`), а не этот предикат.
    expect(isMessengerAvailable('cabinet')).toBe(true);
    expect(m.setting).not.toHaveBeenCalled();
    expect(m.tg).not.toHaveBeenCalled();
    expect(m.max).not.toHaveBeenCalled();
    expect(m.wa).not.toHaveBeenCalled();
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
