import { describe, it, expect, vi, beforeEach } from 'vitest';

const t = vi.hoisted(() => ({ tg: vi.fn(), max: vi.fn(), wa: vi.fn(), createN: vi.fn(), deliver: vi.fn(), warn: vi.fn() }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: t.tg }));
vi.mock('@/lib/max/client', () => ({ sendMaxMessage: t.max }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ sendWhatsAppMessage: t.wa }));
vi.mock('@/lib/notifications', () => ({ createNotification: t.createN, deliverNotificationToUser: t.deliver }));
vi.mock('@/lib/logging', () => ({ log: { warn: t.warn } }));

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

  it('cabinet: ответ уходит уведомлением автору вопроса (ЛК + его каналы)', async () => {
    // У вопроса из кабинета нет внешнего транспорта — ответ доставляется
    // уведомлением автору (решение §9-2). Это единственный канал, где ответ
    // вообще может дойти; сломайся ветка — клиент никогда не увидит ответа.
    t.createN.mockResolvedValue({ id: 'n1' });
    t.deliver.mockResolvedValue(undefined);
    const r = await replyToInbound(
      { channel: 'cabinet', senderRef: 'u1', subject: 'Не открывается документ', resolvedUserId: 'user-9' } as any,
      'Проверьте, пожалуйста, ещё раз'
    );
    expect(r.ok).toBe(true);
    expect(t.createN).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-9',
        type: 'inbound_reply',
        body: '«Не открывается документ»: Проверьте, пожалуйста, ещё раз'
      })
    );
    expect(t.deliver).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-9', dedupKey: 'n1' }));
  });

  it('cabinet: без темы в теле уведомления только текст ответа', async () => {
    t.createN.mockResolvedValue({ id: 'n2' });
    const r = await replyToInbound(
      { channel: 'cabinet', senderRef: 'u1', subject: null, resolvedUserId: 'user-9' } as any,
      'Ответ'
    );
    expect(r.ok).toBe(true);
    expect(t.createN).toHaveBeenCalledWith(expect.objectContaining({ body: 'Ответ' }));
  });

  it('cabinet: автор не определён → ok:false, уведомление не создаётся', async () => {
    const r = await replyToInbound(
      { channel: 'cabinet', senderRef: 'u1', subject: 'Тема', resolvedUserId: null } as any,
      'Ответ'
    );
    expect(r.ok).toBe(false);
    expect(t.createN).not.toHaveBeenCalled();
  });

  it('cabinet: сбой доставки проглатывается с log.warn → ok:false', async () => {
    t.createN.mockRejectedValue(new Error('db down'));
    const r = await replyToInbound(
      { channel: 'cabinet', senderRef: 'u1', subject: 'Тема', resolvedUserId: 'user-9' } as any,
      'Ответ'
    );
    expect(r.ok).toBe(false);
    expect(t.warn).toHaveBeenCalledWith('[inbound/reply] cabinet reply failed', { error: 'db down' });
  });
});
