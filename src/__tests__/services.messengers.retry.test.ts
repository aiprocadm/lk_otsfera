import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  deliverDialogText: vi.fn(),
  isMessengerAvailable: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: m.recordAudit }));
vi.mock('@/lib/services/messengers/deliver', () => ({ deliverDialogText: m.deliverDialogText }));
vi.mock('@/lib/services/messengers/availability', () => ({
  isMessengerAvailable: m.isMessengerAvailable,
}));

import { retryDialogMessage } from '@/lib/services/messengers/retry';

/**
 * Повтор недоставленного сообщения (`У-213`, этап 3 PR-7).
 *
 * Повторяет человек, а не воркер: «бот заблокирован клиентом» автоматическим
 * повтором не лечится. Поэтому у действия узкая дверь — повторить можно ровно
 * ту реплику, которая действительно не ушла, и только в своём диалоге.
 *
 * Скоуп НЕ мокается намеренно: именно он решает, чей это диалог, и подмена
 * проверила бы мок вместо правила.
 */
const findUnique = vi.fn();
const update = vi.fn();
const prisma = { messengerMessage: { findUnique, update } } as unknown as PrismaClient;
const session = { sub: 'u1', role: 'manager', companyId: 'co-1' } as SessionPayload;

const DIALOG = {
  id: 'd1',
  channel: 'telegram',
  peerRef: 'chat-1',
  companyId: 'co-1',
  assigneeId: 'u1',
  organizationId: null,
  userId: null,
  messages: [],
};

const message = (over: Record<string, unknown> = {}) => ({
  id: 'mm1',
  dialogId: 'd1',
  body: 'не дошло',
  direction: 'out',
  deliveryStatus: 'failed',
  attachmentPath: null,
  dialog: DIALOG,
  ...over,
});

const args = { dialogId: 'd1', messageId: 'mm1' };

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(message());
  update.mockResolvedValue({});
  m.isMessengerAvailable.mockReturnValue(true);
  m.deliverDialogText.mockResolvedValue({ ok: true });
});

describe('retryDialogMessage — кому можно', () => {
  it('сессия без компании → forbidden, база не спрашивается', async () => {
    const r = await retryDialogMessage(prisma, { ...session, companyId: null }, args);
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('сообщения нет → not_found', async () => {
    findUnique.mockResolvedValue(null);
    await expect(retryDialogMessage(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('сообщение из другого диалога → not_found (подмена ссылки не проходит)', async () => {
    findUnique.mockResolvedValue(message({ dialogId: 'd-чужой' }));
    await expect(retryDialogMessage(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(m.deliverDialogText).not.toHaveBeenCalled();
  });

  it('диалог чужой компании → not_found, а не forbidden', async () => {
    // Существование чужой переписки не раскрываем — то же правило, что у
    // карточки диалога (§4).
    findUnique.mockResolvedValue(message({ dialog: { ...DIALOG, companyId: 'co-2' } }));
    await expect(retryDialogMessage(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(m.deliverDialogText).not.toHaveBeenCalled();
  });

  it('охват «только свои»: чужой диалог своей компании тоже закрыт (`У-214`)', async () => {
    const own = {
      ...session,
      accessProfile: { dialogs: 'own', capabilities: [] },
    } as unknown as SessionPayload;
    findUnique.mockResolvedValue(message({ dialog: { ...DIALOG, assigneeId: 'u-коллега' } }));
    await expect(retryDialogMessage(prisma, own, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('retryDialogMessage — что можно повторять', () => {
  it.each([
    ['входящее сообщение', { direction: 'in' }],
    ['внутреннюю заметку', { direction: 'note' }],
    ['уже доставленное', { deliveryStatus: 'sent' }],
    ['ещё отправляющееся', { deliveryStatus: 'sending' }],
    ['ждущее проверки файла', { deliveryStatus: 'pending' }],
  ])('%s повторить нельзя → not_failed', async (_name, over) => {
    findUnique.mockResolvedValue(message(over));
    await expect(retryDialogMessage(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_failed',
    });
    expect(m.deliverDialogText).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it('вложение этим путём не повторяется — иначе файл ушёл бы дважды', async () => {
    // У файла своя дорога: проверка антивирусом и захват отправки. Отправить
    // его «ещё раз» текстовым путём значит показать клиенту два одинаковых
    // документа и не понять, какой из них дошёл.
    findUnique.mockResolvedValue(message({ attachmentPath: 'docs/scan.pdf' }));
    await expect(retryDialogMessage(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_failed',
    });
    expect(m.deliverDialogText).not.toHaveBeenCalled();
  });

  it('канал отключили после неудачи → channel_unavailable, отправки нет', async () => {
    m.isMessengerAvailable.mockReturnValue(false);
    await expect(retryDialogMessage(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'channel_unavailable',
    });
    expect(m.deliverDialogText).not.toHaveBeenCalled();
  });
});

describe('retryDialogMessage — сама отправка', () => {
  it('успех: тот же текст, статус «отправлено», причина стёрта', async () => {
    const r = await retryDialogMessage(prisma, session, args);
    expect(r).toEqual({ ok: true });
    // Повторяем ровно то, что лежит в истории: человек видит на экране то, что уйдёт.
    expect(m.deliverDialogText).toHaveBeenCalledWith(DIALOG, 'telegram', 'не дошло');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      // `deliveryError: null` обязателен: старая причина рядом с доставленным
      // сообщением читалась бы как «опять не ушло».
      data: { deliveryStatus: 'sent', deliveryError: null },
    });
  });

  it('новая строка переписки не заводится — обновляется существующая', async () => {
    await retryDialogMessage(prisma, session, args);
    // Иначе одна попытка отправить превращалась бы в две реплики в ленте.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: 'mm1' });
  });

  it('неудача: статус остаётся «не доставлено», причина ПЕРЕЗАПИСЫВАЕТСЯ новой', async () => {
    m.deliverDialogText.mockResolvedValue({ ok: false, error: 'Клиент заблокировал бота' });
    const r = await retryDialogMessage(prisma, session, args);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      data: { deliveryStatus: 'failed', deliveryError: 'Клиент заблокировал бота' },
    });
    // Причина едет и на экран: она могла измениться с прошлой попытки, и
    // повторять дальше бессмысленно, пока не решена именно эта беда.
    expect(r).toEqual({ ok: false, error: 'reply_failed', reason: 'Клиент заблокировал бота' });
  });

  it('неудача без причины: поле обнуляется, лишнего слова человеку не показываем', async () => {
    m.deliverDialogText.mockResolvedValue({ ok: false });
    const r = await retryDialogMessage(prisma, session, args);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      data: { deliveryStatus: 'failed', deliveryError: null },
    });
    expect(r).toEqual({ ok: false, error: 'reply_failed' });
  });

  it('аудит пишется в обоих исходах — повтор виден в журнале', async () => {
    await retryDialogMessage(prisma, session, args);
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'messenger_message_retried',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'u1',
      after: { messageId: 'mm1', channel: 'telegram', delivered: true },
    });

    m.recordAudit.mockClear();
    m.deliverDialogText.mockResolvedValue({ ok: false, error: 'Сеть недоступна' });
    await retryDialogMessage(prisma, session, args);
    expect(m.recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'messenger_message_retried',
        after: expect.objectContaining({ delivered: false }),
      })
    );
  });

  it('за сообщением тянется последнее входящее письмо — почте нужна тема', async () => {
    // Выборка сообщения обязана принести историю: без неё ответ по почте ушёл
    // бы отдельным письмом, а не продолжением переписки (`У-205`).
    await retryDialogMessage(prisma, session, args);
    const select = findUnique.mock.calls[0][0].select.dialog.select.messages;
    expect(select.where).toEqual({ direction: 'in', inboundMessageId: { not: null } });
    expect(select.take).toBe(1);
    expect(select.orderBy).toEqual({ createdAt: 'desc' });
  });
});
