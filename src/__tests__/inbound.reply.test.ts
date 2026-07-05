import { describe, it, expect, vi, beforeEach } from 'vitest';

const t = vi.hoisted(() => ({ tg: vi.fn(), max: vi.fn(), wa: vi.fn() }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: t.tg }));
vi.mock('@/lib/max/client', () => ({ sendMaxMessage: t.max }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ sendWhatsAppMessage: t.wa }));

import { replyToInbound } from '@/lib/services/inbound/reply';

describe('replyToInbound', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes to whatsapp transport by channel', async () => {
    t.wa.mockResolvedValue({ ok: true });
    const r = await replyToInbound({ channel: 'whatsapp', senderRef: '+79990001122', subject: null } as any, 'спасибо');
    expect(t.wa).toHaveBeenCalledWith('+79990001122', 'спасибо');
    expect(r.ok).toBe(true);
  });

  it('routes to telegram transport', async () => {
    t.tg.mockResolvedValue({ ok: true });
    const r = await replyToInbound({ channel: 'telegram', senderRef: '999', subject: null } as any, 'привет');
    expect(t.tg).toHaveBeenCalledWith('999', 'привет');
    expect(r.ok).toBe(true);
  });

  it('routes to max transport', async () => {
    t.max.mockResolvedValue({ ok: true });
    const r = await replyToInbound({ channel: 'max', senderRef: '5', subject: null } as any, 'ок');
    expect(t.max).toHaveBeenCalledWith('5', 'ок');
    expect(r.ok).toBe(true);
  });

  it('whatsapp transport failure -> ok:false', async () => {
    t.wa.mockResolvedValue({ ok: false });
    const r = await replyToInbound({ channel: 'whatsapp', senderRef: '+7', subject: null } as any, 'x');
    expect(r.ok).toBe(false);
  });

  it('telegram transport rejection -> ok:false (swallowed)', async () => {
    t.tg.mockRejectedValue(new Error('network'));
    const r = await replyToInbound({ channel: 'telegram', senderRef: '1', subject: null } as any, 'x');
    expect(r.ok).toBe(false);
  });

  it('email channel has no raw-send available -> ok:false (deferred)', async () => {
    const r = await replyToInbound({ channel: 'email', senderRef: 'a@b.ru', subject: 'Re: заказ' } as any, 'текст ответа');
    expect(r.ok).toBe(false);
    expect(t.tg).not.toHaveBeenCalled();
    expect(t.max).not.toHaveBeenCalled();
    expect(t.wa).not.toHaveBeenCalled();
  });

  it('unknown channel -> ok:false', async () => {
    const r = await replyToInbound({ channel: 'sms', senderRef: 'x', subject: null } as any, 'x');
    expect(r.ok).toBe(false);
  });
});
