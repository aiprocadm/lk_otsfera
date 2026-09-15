import { describe, it, expect, vi, beforeEach } from 'vitest';

const t = vi.hoisted(() => ({ tg: vi.fn(), max: vi.fn(), wa: vi.fn() }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: t.tg }));
vi.mock('@/lib/max/client', () => ({ sendMaxMessage: t.max }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ sendWhatsAppMessage: t.wa }));

import { sendToMessenger } from '@/lib/services/messengers/transport';

/**
 * Единый исходящий транспорт (Р-М-7): роутит в существующие клиенты и всегда
 * отвечает `{ ok }` — а с `У-213` ещё и причиной отказа. Сети здесь нет —
 * клиенты замоканы (страж E4).
 *
 * Правило причины: своё транспорт НЕ выдумывает. Что дал клиент — то и отдаёт;
 * если клиент причины не дал (чужой мок, будущий канал) — честное «неизвестно»,
 * а не пустая строка, которую экран покажет как молчание.
 */
describe('sendToMessenger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('telegram → клиент Telegram с адресом и текстом', async () => {
    t.tg.mockResolvedValue({ ok: true });
    await expect(sendToMessenger('telegram', 'chat-1', 'привет')).resolves.toEqual({ ok: true });
    expect(t.tg).toHaveBeenCalledWith('chat-1', 'привет');
    expect(t.max).not.toHaveBeenCalled();
    expect(t.wa).not.toHaveBeenCalled();
  });

  it('max → клиент MAX', async () => {
    t.max.mockResolvedValue({ ok: true });
    await expect(sendToMessenger('max', 'mx-1', 'текст')).resolves.toEqual({ ok: true });
    expect(t.max).toHaveBeenCalledWith('mx-1', 'текст');
  });

  it('whatsapp → агрегатор по номеру', async () => {
    t.wa.mockResolvedValue({ ok: true });
    await expect(sendToMessenger('whatsapp', '+79990001122', 'текст')).resolves.toEqual({
      ok: true,
    });
    expect(t.wa).toHaveBeenCalledWith('+79990001122', 'текст');
  });

  it('причина от клиента доезжает наружу слово в слово', async () => {
    // Переписывать её нельзя: текст провайдера точнее любой нашей подписи.
    t.tg.mockResolvedValue({ ok: false, error: 'Telegram отклонил отправку (403)' });
    await expect(sendToMessenger('telegram', 'chat-1', 'x')).resolves.toEqual({
      ok: false,
      error: 'Telegram отклонил отправку (403)',
    });
  });

  it('отказ без причины → «Причина неизвестна», а не пустота', async () => {
    t.tg.mockResolvedValue({ ok: false });
    await expect(sendToMessenger('telegram', 'chat-1', 'x')).resolves.toEqual({
      ok: false,
      error: 'Причина неизвестна',
    });
  });

  it('клиент ответил не по контракту (undefined) → ok:false, а не исключение', async () => {
    t.max.mockResolvedValue(undefined);
    await expect(sendToMessenger('max', 'mx-1', 'x')).resolves.toEqual({
      ok: false,
      error: 'Причина неизвестна',
    });
  });

  it('клиент бросил → ok:false, вызывающему не нужен свой try/catch', async () => {
    t.wa.mockRejectedValue(new Error('network'));
    await expect(sendToMessenger('whatsapp', '+7', 'x')).resolves.toEqual({
      ok: false,
      error: 'Сбой транспорта',
    });
  });
});
