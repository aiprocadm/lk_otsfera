// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { addDealNoteAction, initiateCallAction } = vi.hoisted(() => ({
  addDealNoteAction: vi.fn(),
  initiateCallAction: vi.fn()
}));
vi.mock('@/server-actions/deal-activity', () => ({ addDealNoteAction, initiateCallAction }));

const { replyInboundAction } = vi.hoisted(() => ({ replyInboundAction: vi.fn() }));
vi.mock('@/server-actions/inbound', () => ({ replyInboundAction }));

import { DealActivityThread } from '@/components/manager/deal-activity/deal-activity-thread';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';

const fetchMock = vi.fn();

function allKindsItems(): ActivityItem[] {
  return [
    {
      kind: 'message_in',
      id: 'mi1',
      at: new Date('2026-01-01T10:00:00Z'),
      channel: 'telegram',
      sender: 'Иван Клиент',
      body: 'Здравствуйте, есть вопрос',
      attachmentName: 'скан.pdf'
    },
    {
      kind: 'message_in',
      id: 'mi2',
      at: new Date('2026-01-01T10:05:00Z'),
      channel: 'sms',
      sender: 'Пётр',
      body: 'Без вложения',
      attachmentName: null
    },
    {
      kind: 'message_out',
      id: 'mo1',
      at: new Date('2026-01-01T10:10:00Z'),
      author: 'Менеджер Мария',
      body: 'Ответ клиенту с файлом',
      hasAttachment: true
    },
    {
      kind: 'message_out',
      id: 'mo2',
      at: new Date('2026-01-01T10:12:00Z'),
      author: 'Менеджер Мария',
      body: 'Ответ без файла',
      hasAttachment: false
    },
    {
      kind: 'comment',
      id: 'c1',
      at: new Date('2026-01-01T10:15:00Z'),
      author: 'Организация Ромашка',
      body: 'Комментарий заказчика'
    },
    {
      kind: 'call',
      id: 'call1',
      at: new Date('2026-01-01T10:20:00Z'),
      direction: 'inbound',
      number: '+79990000000',
      durationSec: 125,
      recordingReady: true,
      initiator: 'Оператор Олег'
    },
    {
      kind: 'call',
      id: 'call2',
      at: new Date('2026-01-01T10:21:00Z'),
      direction: 'outbound',
      number: '+79991111111',
      durationSec: null,
      recordingReady: false,
      initiator: null
    },
    {
      kind: 'call',
      id: 'call3',
      at: new Date('2026-01-01T10:22:00Z'),
      direction: 'transfer',
      number: '+79992222222',
      durationSec: Number.NaN,
      recordingReady: false,
      initiator: null
    },
    {
      kind: 'call',
      id: 'call4',
      at: new Date('2026-01-01T10:23:00Z'),
      direction: 'outbound',
      number: '+79993333333',
      durationSec: -5,
      recordingReady: false,
      initiator: null
    },
    {
      kind: 'note',
      id: 'n1',
      at: new Date('2026-01-01T10:25:00Z'),
      author: 'Менеджер Мария',
      body: 'Внутренняя заметка для команды'
    },
    {
      kind: 'event',
      id: 'ev1',
      at: new Date('2026-01-01T10:30:00Z'),
      label: 'Смена статуса заказа'
    }
  ];
}

/** Два входящих (whatsapp → telegram, по возрастанию at) — telegram последний. */
function tgInboundItems(): ActivityItem[] {
  return [
    {
      kind: 'message_in',
      id: 'in-old',
      at: new Date('2026-01-01T10:00:00Z'),
      channel: 'whatsapp',
      sender: 'Клиент',
      body: 'старое сообщение',
      attachmentName: null
    },
    {
      kind: 'message_in',
      id: 'in-new',
      at: new Date('2026-01-02T10:00:00Z'),
      channel: 'telegram',
      sender: 'Клиент',
      body: 'новое сообщение',
      attachmentName: null
    }
  ];
}

describe('DealActivityThread', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    addDealNoteAction.mockReset();
    initiateCallAction.mockReset();
    replyInboundAction.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('пустая лента: показывает заглушку', () => {
    render(
      <DealActivityThread orderId='o1' items={[]} inboundEnabled={true} telephonyEnabled={true} />
    );
    expect(screen.getByText('Активности пока нет.')).toBeTruthy();
  });

  it('вид по умолчанию — «Диалог»: показывает message_in/message_out/comment, скрывает call/note/event', () => {
    render(
      <DealActivityThread orderId='o1' items={allKindsItems()} inboundEnabled={true} telephonyEnabled={true} />
    );
    expect(screen.getByText('Здравствуйте, есть вопрос')).toBeTruthy();
    expect(screen.getByText('Ответ клиенту с файлом')).toBeTruthy();
    expect(screen.getByText('Комментарий заказчика')).toBeTruthy();
    expect(screen.queryByText('Внутренняя заметка для команды')).toBeNull();
    expect(screen.queryByText('Смена статуса заказа', { exact: false })).toBeNull();
    expect(screen.queryByText('+79990000000')).toBeNull();
  });

  it('переключение на «Вся активность» показывает call/note/event; «клиент не видит» маркер у заметки; initiator у звонка', () => {
    render(
      <DealActivityThread orderId='o1' items={allKindsItems()} inboundEnabled={true} telephonyEnabled={true} />
    );

    expect(screen.getByRole('button', { name: 'Диалог', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Вся активность' }));
    expect(screen.getByRole('button', { name: 'Вся активность', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Диалог', pressed: false })).toBeTruthy();

    expect(screen.getByText('Внутренняя заметка для команды')).toBeTruthy();
    expect(screen.getByText('Клиент не видит')).toBeTruthy();
    expect(screen.getByText('+79990000000')).toBeTruthy();
    expect(screen.getByText('▶ запись')).toBeTruthy();
    expect(screen.getByText('+79991111111')).toBeTruthy();
    expect(screen.getByText('+79992222222')).toBeTruthy();
    expect(screen.getByText('+79993333333')).toBeTruthy();
    expect(screen.getByText(/Смена статуса заказа/)).toBeTruthy();

    // initiator: рендерится у call1 (единственное вхождение) и отсутствует у
    // звонков с initiator=null (call2..call4 — других текстов инициатора нет).
    expect(screen.getAllByText('Оператор Олег')).toHaveLength(1);

    // Переключение обратно на «Диалог» снова скрывает не-диалоговые виды.
    fireEvent.click(screen.getByRole('button', { name: 'Диалог' }));
    expect(screen.queryByText('+79990000000')).toBeNull();
  });

  it('inboundEnabled=false скрывает message_in/message_out даже во «Вся активность», но не comment', () => {
    render(
      <DealActivityThread orderId='o1' items={allKindsItems()} inboundEnabled={false} telephonyEnabled={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Вся активность' }));

    expect(screen.queryByText('Здравствуйте, есть вопрос')).toBeNull();
    expect(screen.queryByText('Ответ клиенту с файлом')).toBeNull();
    expect(screen.getByText('Комментарий заказчика')).toBeTruthy();
    expect(screen.getByText('Внутренняя заметка для команды')).toBeTruthy();
  });

  it('telephonyEnabled=false: кнопки «Позвонить» нет вовсе', () => {
    render(
      <DealActivityThread orderId='o1' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );
    expect(screen.queryByRole('button', { name: 'Позвонить' })).toBeNull();
  });

  it('telephonyEnabled=false: строки call скрыты даже во «Вся активность» (но comment/note видны)', () => {
    render(
      <DealActivityThread orderId='o1' items={allKindsItems()} inboundEnabled={true} telephonyEnabled={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Вся активность' }));

    expect(screen.queryByText('+79990000000')).toBeNull();
    expect(screen.queryByText('▶ запись')).toBeNull();
    expect(screen.getByText('Комментарий заказчика')).toBeTruthy();
    expect(screen.getByText('Внутренняя заметка для команды')).toBeTruthy();
  });

  // ── Композер: режимы ────────────────────────────────────────────────────

  it('режимы: «Заметка» (pressed по умолчанию) и «Комментарий» всегда; «Ответ в канал» при inboundEnabled и не-email message_in', () => {
    render(
      <DealActivityThread orderId='o1' items={tgInboundItems()} inboundEnabled={true} telephonyEnabled={false} />
    );
    expect(screen.getByRole('button', { name: 'Заметка', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Комментарий', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ответ в канал', pressed: false })).toBeTruthy();
  });

  it('режим «Ответ в канал» скрыт при inboundEnabled=false', () => {
    render(
      <DealActivityThread orderId='o1' items={tgInboundItems()} inboundEnabled={false} telephonyEnabled={false} />
    );
    expect(screen.getByRole('button', { name: 'Заметка' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Комментарий' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ответ в канал' })).toBeNull();
  });

  it('режим «Ответ в канал» скрыт без единого message_in', () => {
    render(
      <DealActivityThread orderId='o1' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );
    expect(screen.queryByRole('button', { name: 'Ответ в канал' })).toBeNull();
  });

  it('режим «Ответ в канал» скрыт, когда последний message_in — email (даже при более раннем telegram)', () => {
    const items: ActivityItem[] = [
      ...tgInboundItems(),
      {
        kind: 'message_in',
        id: 'in-email',
        at: new Date('2026-01-03T10:00:00Z'),
        channel: 'email',
        sender: 'Клиент',
        body: 'письмо',
        attachmentName: null
      }
    ];
    render(
      <DealActivityThread orderId='o1' items={items} inboundEnabled={true} telephonyEnabled={false} />
    );
    expect(screen.queryByRole('button', { name: 'Ответ в канал' })).toBeNull();
  });

  it('rerender с inboundEnabled=false в режиме «Ответ в канал» откатывает композер на заметку', () => {
    const { rerender } = render(
      <DealActivityThread orderId='o1' items={tgInboundItems()} inboundEnabled={true} telephonyEnabled={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ответ в канал' }));
    expect(screen.getByRole('button', { name: 'Ответить в канал' })).toBeTruthy();

    rerender(
      <DealActivityThread orderId='o1' items={tgInboundItems()} inboundEnabled={false} telephonyEnabled={false} />
    );
    expect(screen.queryByRole('button', { name: 'Ответ в канал' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Заметка', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить заметку' })).toBeTruthy();
  });

  it('переключение режима сохраняет черновик в общей textarea', () => {
    render(
      <DealActivityThread orderId='o1' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );
    const textarea = screen.getByLabelText('Текст заметки') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'черновик' } });

    fireEvent.click(screen.getByRole('button', { name: 'Комментарий' }));
    expect((screen.getByLabelText('Текст комментария') as HTMLTextAreaElement).value).toBe('черновик');

    fireEvent.click(screen.getByRole('button', { name: 'Заметка' }));
    expect((screen.getByLabelText('Текст заметки') as HTMLTextAreaElement).value).toBe('черновик');
  });

  it('подпись связана с textarea через aria-describedby; client-visible режим — предупреждающий тон, заметка — обычный', () => {
    render(
      <DealActivityThread orderId='o1' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );
    const noteCaption = screen.getByText('Внутренняя заметка — клиент её не видит');
    expect(noteCaption.id).toBeTruthy();
    expect(screen.getByLabelText('Текст заметки').getAttribute('aria-describedby')).toBe(noteCaption.id);
    expect(noteCaption.className).toContain('text-gray-500');
    expect(noteCaption.className).not.toContain('text-amber-700');

    fireEvent.click(screen.getByRole('button', { name: 'Комментарий' }));
    const commentCaption = screen.getByText('Комментарий клиенту (видит клиент)');
    expect(screen.getByLabelText('Текст комментария').getAttribute('aria-describedby')).toBe(commentCaption.id);
    expect(commentCaption.className).toContain('text-amber-700');
    expect(commentCaption.className).not.toContain('text-gray-500');
  });

  it('пиллы заблокированы во время pending — кросс-режимный двойной сабмит невозможен', async () => {
    let resolveNote!: (v: { ok: true; id: string }) => void;
    addDealNoteAction.mockImplementation(
      () => new Promise<{ ok: true; id: string }>((resolve) => { resolveNote = resolve; })
    );
    render(
      <DealActivityThread orderId='order-9' items={tgInboundItems()} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.change(screen.getByLabelText('Текст заметки'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Заметка' }) as HTMLButtonElement).disabled).toBe(true);
    });
    expect((screen.getByRole('button', { name: 'Комментарий' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Ответ в канал' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveNote({ ok: true, id: 'n1' });
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заметка добавлена'));
    expect((screen.getByRole('button', { name: 'Комментарий' }) as HTMLButtonElement).disabled).toBe(false);
  });

  // ── Композер: заметка (default) ─────────────────────────────────────────

  it('заметка: успешная отправка вызывает action, тост, refresh и сбрасывает форму', async () => {
    addDealNoteAction.mockResolvedValue({ ok: true, id: 'note-1' });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );

    const textarea = screen.getByLabelText('Текст заметки') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Перезвонить завтра' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));

    await waitFor(() =>
      expect(addDealNoteAction).toHaveBeenCalledWith({ orderId: 'order-9', body: 'Перезвонить завтра' })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заметка добавлена'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('заметка: textarea без name → защитный ?? отдаёт пустой текст', async () => {
    addDealNoteAction.mockResolvedValue({ ok: true, id: 'note-1' });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );

    const textarea = screen.getByLabelText('Текст заметки') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x' } }); // проходит required
    textarea.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));

    await waitFor(() =>
      expect(addDealNoteAction).toHaveBeenCalledWith({ orderId: 'order-9', body: '' })
    );
  });

  it('заметка: пустое тело → ошибка "Введите текст заметки." в role=alert', async () => {
    addDealNoteAction.mockResolvedValue({ ok: false, error: 'invalid' });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.change(screen.getByLabelText('Текст заметки'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Введите текст заметки.');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  // ── Композер: комментарий клиенту ───────────────────────────────────────

  it('комментарий: сабмит шлёт POST /api/comments с {orderId, body} (trim), тостит, рефрешит и сбрасывает форму', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'c-1' }) });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Комментарий' }));
    expect(screen.getByText('Комментарий клиенту (видит клиент)')).toBeTruthy();

    const textarea = screen.getByLabelText('Текст комментария') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  Видимый клиенту текст  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить комментарий' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: 'order-9', body: 'Видимый клиенту текст' })
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Комментарий отправлен'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('комментарий: textarea без name → защитный ?? отдаёт пустое тело', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'c-1' }) });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Комментарий' }));
    const textarea = screen.getByLabelText('Текст комментария') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x' } }); // проходит required
    textarea.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить комментарий' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: 'order-9', body: '' })
      })
    );
  });

  it.each([
    ['Invalid request', 400, 'Введите текст комментария.'],
    ['Not found', 404, 'Заказ не найден.'],
    ['Access denied', 403, 'Нет доступа к заказу.']
  ])('комментарий: ошибка роута %s → «%s» в role=alert', async (code, status, label) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ error: code }) });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Комментарий' }));
    fireEvent.change(screen.getByLabelText('Текст комментария'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить комментарий' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(label);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('комментарий: смена режима сбрасывает ошибку (не всплывает при возврате)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Комментарий' }));
    fireEvent.change(screen.getByLabelText('Текст комментария'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить комментарий' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Заметка' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Комментарий' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // ── Композер: ответ в канал ─────────────────────────────────────────────

  it('канал: подпись с channelLabel; сабмит зовёт replyInboundAction с id последнего message_in; тост/refresh/сброс', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(
      <DealActivityThread orderId='order-9' items={tgInboundItems()} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ответ в канал' }));
    const channelCaption = screen.getByText('Ответ в канал (Telegram)');
    expect(channelCaption.className).toContain('text-amber-700');

    const textarea = screen.getByLabelText('Текст ответа') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Отвечаю в мессенджер' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить в канал' }));

    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({
        inboundMessageId: 'in-new',
        text: 'Отвечаю в мессенджер'
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Ответ отправлен'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('канал: берётся max по дате даже при неотсортированных items; неизвестный канал — сырой код в подписи', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    const items: ActivityItem[] = [
      {
        kind: 'message_in',
        id: 'in-late',
        at: new Date('2026-01-05T10:00:00Z'),
        channel: 'sms',
        sender: 'Клиент',
        body: 'позднее',
        attachmentName: null
      },
      {
        kind: 'message_in',
        id: 'in-early',
        at: new Date('2026-01-01T10:00:00Z'),
        channel: 'telegram',
        sender: 'Клиент',
        body: 'раннее',
        attachmentName: null
      }
    ];
    render(
      <DealActivityThread orderId='order-9' items={items} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ответ в канал' }));
    expect(screen.getByText('Ответ в канал (sms)')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'ок' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить в канал' }));

    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({ inboundMessageId: 'in-late', text: 'ок' })
    );
  });

  it('канал: при равных датах побеждает последний элемент ленты', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    const at = new Date('2026-01-01T10:00:00Z');
    const items: ActivityItem[] = [
      { kind: 'message_in', id: 't1', at, channel: 'telegram', sender: 'К', body: 'a', attachmentName: null },
      { kind: 'message_in', id: 't2', at, channel: 'telegram', sender: 'К', body: 'b', attachmentName: null }
    ];
    render(
      <DealActivityThread orderId='order-9' items={items} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ответ в канал' }));
    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'ок' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить в канал' }));

    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({ inboundMessageId: 't2', text: 'ок' })
    );
  });

  it('канал: textarea без name → защитный ?? отдаёт пустой текст', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(
      <DealActivityThread orderId='order-9' items={tgInboundItems()} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ответ в канал' }));
    const textarea = screen.getByLabelText('Текст ответа') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x' } }); // проходит required
    textarea.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить в канал' }));

    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({ inboundMessageId: 'in-new', text: '' })
    );
  });

  it.each([
    ['forbidden', 'Обращение недоступно вашей компании.'],
    ['not_found', 'Обращение не найдено.'],
    ['email_unsupported', 'Ответ по email пока не поддерживается — свяжитесь с клиентом другим каналом.']
  ])('канал: ошибка %s → «%s» в role=alert', async (code, label) => {
    replyInboundAction.mockResolvedValue({ ok: false, error: code });
    render(
      <DealActivityThread orderId='order-9' items={tgInboundItems()} inboundEnabled={true} telephonyEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ответ в канал' }));
    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить в канал' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(label);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  // ── Звонок ──────────────────────────────────────────────────────────────

  it('звонок: клик «Позвонить» раскрывает форму номера, успешный вызов сворачивает форму и тостит', async () => {
    initiateCallAction.mockResolvedValue({ ok: true, callId: 'call-x' });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={true} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    const numberInput = screen.getByLabelText('Номер телефона') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: '+79995554433' } });
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));

    await waitFor(() =>
      expect(initiateCallAction).toHaveBeenCalledWith({
        orderId: 'order-9',
        toNumber: '+79995554433'
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Звонок инициирован'));
    await waitFor(() => expect(screen.queryByLabelText('Номер телефона')).toBeNull());
    expect(screen.getByRole('button', { name: 'Позвонить' })).toBeTruthy();
  });

  // M2 (c31d76a): клиентского поля «Внутренний номер» больше нет — сервер
  // берёт внутренний номер из User.internalPhone; см. кейс no_internal_phone ниже.

  it('звонок: input без name → защитный ?? отдаёт пустой номер', async () => {
    initiateCallAction.mockResolvedValue({ ok: true, callId: 'call-x' });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={true} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    const numberInput = screen.getByLabelText('Номер телефона') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: 'x' } }); // проходит required
    numberInput.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));

    await waitFor(() =>
      expect(initiateCallAction).toHaveBeenCalledWith({
        orderId: 'order-9',
        toNumber: ''
      })
    );
  });

  it('звонок: «Отмена» сворачивает форму без сабмита', () => {
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    expect(screen.getByLabelText('Номер телефона')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByLabelText('Номер телефона')).toBeNull();
    expect(initiateCallAction).not.toHaveBeenCalled();
  });

  it('звонок: call_failed → ошибка "Звонок недоступен (не настроено)." в role=alert, форма остаётся открытой', async () => {
    initiateCallAction.mockResolvedValue({ ok: false, error: 'call_failed' });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={true} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    fireEvent.change(screen.getByLabelText('Номер телефона'), { target: { value: '+79995554433' } });
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Звонок недоступен (не настроено).');
    expect(screen.getByLabelText('Номер телефона')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('звонок: no_internal_phone → ошибка "Укажите ваш внутренний номер…" в role=alert, форма остаётся открытой', async () => {
    initiateCallAction.mockResolvedValue({ ok: false, error: 'no_internal_phone' });
    render(
      <DealActivityThread orderId='order-9' items={[]} inboundEnabled={true} telephonyEnabled={true} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    fireEvent.change(screen.getByLabelText('Номер телефона'), { target: { value: '+79995554433' } });
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Укажите ваш внутренний номер в настройках, чтобы звонить.');
    expect(screen.getByLabelText('Номер телефона')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
