// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * «Переписка с клиентом» в карточке заказа (этап 6 ТЗ 13.10.2026, `У-310`):
 * здесь только то, что видит клиент; отправка — комментарием в кабинет или
 * ответом в канал последнего входящего; у сообщения клиента — «Создать заметку
 * из этого сообщения» (цитата + комментарий менеджера во внутренние заметки).
 */
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { addDealNoteAction } = vi.hoisted(() => ({ addDealNoteAction: vi.fn() }));
vi.mock('@/server-actions/deal-activity', () => ({ addDealNoteAction }));

const { replyInboundAction } = vi.hoisted(() => ({ replyInboundAction: vi.fn() }));
vi.mock('@/server-actions/inbound', () => ({ replyInboundAction }));

import { OrderClientThread } from '@/components/orders/order-client-thread';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';
import { fmtDateTime } from '@/lib/format';

const fetchMock = vi.fn();

const AT = new Date('2026-01-01T10:15:00Z');

function mixedItems(): ActivityItem[] {
  return [
    {
      kind: 'message_in',
      id: 'mi1',
      at: new Date('2026-01-01T10:00:00Z'),
      channel: 'telegram',
      sender: 'Иван Клиент',
      body: 'Здравствуйте, есть вопрос',
      attachmentName: 'скан.pdf',
    },
    {
      kind: 'message_out',
      id: 'mo1',
      at: new Date('2026-01-01T10:10:00Z'),
      author: 'Менеджер Мария',
      body: 'Ответ клиенту',
      hasAttachment: false,
    },
    {
      kind: 'message_out',
      id: 'mo2',
      at: new Date('2026-01-01T10:11:00Z'),
      author: 'Менеджер Мария',
      body: 'Файл клиенту',
      hasAttachment: true,
    },
    {
      kind: 'comment',
      id: 'c1',
      at: AT,
      author: 'Организация Ромашка',
      body: 'Комментарий заказчика',
      fromClient: true,
    },
    {
      kind: 'comment',
      id: 'c2',
      at: AT,
      author: 'Менеджер Мария',
      body: 'Комментарий менеджера',
      fromClient: false,
    },
    {
      kind: 'note',
      id: 'n1',
      at: AT,
      author: 'Менеджер Мария',
      body: 'Внутренняя заметка для команды',
    },
    { kind: 'event', id: 'ev1', at: AT, label: 'Смена статуса заказа' },
  ];
}

/** Два входящих (whatsapp → telegram) — telegram последний. */
function tgInboundItems(): ActivityItem[] {
  return [
    {
      kind: 'message_in',
      id: 'in-old',
      at: new Date('2026-01-01T10:00:00Z'),
      channel: 'whatsapp',
      sender: 'Клиент',
      body: 'старое сообщение',
      attachmentName: null,
    },
    {
      kind: 'message_in',
      id: 'in-new',
      at: new Date('2026-01-02T10:00:00Z'),
      channel: 'telegram',
      sender: 'Клиент',
      body: 'новое сообщение',
      attachmentName: null,
    },
  ];
}

const send = (text: string) => {
  const textarea = screen.getByLabelText('Текст сообщения клиенту') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить клиенту' }));
  return textarea;
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('OrderClientThread — что видно', () => {
  it('заголовок с пометкой «Видит клиент»; пустая лента объясняет, что делать', () => {
    render(<OrderClientThread orderId="o1" items={[]} inboundEnabled={true} />);
    expect(screen.getByRole('heading', { name: 'Переписка с клиентом' })).toBeTruthy();
    expect(screen.getByText('Видит клиент')).toBeTruthy();
    expect(
      screen.getByText(
        'Сообщений по заказу пока нет. Напишите клиенту — он увидит сообщение в своём кабинете.'
      )
    ).toBeTruthy();
  });

  it('`У-310`: только клиентское — заметок и событий здесь нет', () => {
    render(<OrderClientThread orderId="o1" items={mixedItems()} inboundEnabled={true} />);
    expect(screen.getByText('Здравствуйте, есть вопрос')).toBeTruthy();
    expect(screen.getByText('Ответ клиенту')).toBeTruthy();
    // Вложения видны: имя файла у входящего, скрепка у исходящего.
    expect(screen.getByText('📎 скан.pdf')).toBeTruthy();
    expect(screen.getByText('📎')).toBeTruthy();
    expect(screen.getByText('Комментарий заказчика')).toBeTruthy();
    expect(screen.getByText('Комментарий менеджера')).toBeTruthy();
    expect(screen.queryByText('Внутренняя заметка для команды')).toBeNull();
    expect(screen.queryByText(/Смена статуса заказа/)).toBeNull();
  });

  it('мессенджеры выключены — сообщения каналов скрыты, комментарии видны, выбора канала нет', () => {
    render(<OrderClientThread orderId="o1" items={mixedItems()} inboundEnabled={false} />);
    expect(screen.queryByText('Здравствуйте, есть вопрос')).toBeNull();
    expect(screen.queryByText('Ответ клиенту')).toBeNull();
    expect(screen.getByText('Комментарий заказчика')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'В кабинет' })).toBeNull();
  });

  it('«Создать заметку…» — только у сообщений клиента, не у своих', () => {
    render(<OrderClientThread orderId="o1" items={mixedItems()} inboundEnabled={true} />);
    // message_in и комментарий заказчика — да; ответ и комментарий менеджера — нет.
    expect(screen.getAllByText('Создать заметку из этого сообщения')).toHaveLength(2);
  });

  it('диалоги мессенджеров — частью блока', () => {
    render(
      <OrderClientThread orderId="o1" items={[]} inboundEnabled={true}>
        <p>Список диалогов</p>
      </OrderClientThread>
    );
    expect(screen.getByText('Список диалогов')).toBeTruthy();
  });
});

describe('OrderClientThread — отправка клиенту', () => {
  it('по умолчанию — в кабинет: POST /api/comments (trim), тост, refresh, сброс', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'c-1' }) });
    render(<OrderClientThread orderId="order-9" items={[]} inboundEnabled={true} />);
    expect(
      screen.getByText('Клиент увидит сообщение в карточке заказа в своём кабинете.')
    ).toBeTruthy();
    const textarea = send('  Видимый клиенту текст  ');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: 'order-9', body: 'Видимый клиенту текст' }),
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Сообщение отправлено клиенту'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('поле без name → защитный ?? отдаёт пустое тело', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'c-1' }) });
    render(<OrderClientThread orderId="order-9" items={[]} inboundEnabled={true} />);
    const textarea = screen.getByLabelText('Текст сообщения клиенту') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x' } });
    textarea.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить клиенту' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: 'order-9', body: '' }),
      })
    );
  });

  it.each([
    ['Invalid request', 400, 'Введите текст сообщения.'],
    ['Not found', 404, 'Заказ не найден.'],
    ['Access denied', 403, 'Нет доступа к заказу.'],
  ])('ошибка роута %s → «%s» в role=alert', async (code, status, label) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ error: code }) });
    render(<OrderClientThread orderId="order-9" items={[]} inboundEnabled={true} />);
    send('x');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(label);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('ответ в канал последнего входящего: подпись, replyInboundAction, тост, сброс', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(<OrderClientThread orderId="order-9" items={tgInboundItems()} inboundEnabled={true} />);
    expect(screen.getByRole('button', { name: 'В кабинет', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'В Telegram' }));
    expect(screen.getByText('Ответ уйдёт клиенту в Telegram.').className).toContain('text-sky-800');
    const textarea = send('Отвечаю в мессенджер');
    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({
        inboundMessageId: 'in-new',
        text: 'Отвечаю в мессенджер',
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Ответ отправлен'));
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('канал: max по дате при неотсортированных; неизвестный канал — сырой код', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    const items: ActivityItem[] = [
      {
        kind: 'message_in',
        id: 'in-late',
        at: new Date('2026-01-05T10:00:00Z'),
        channel: 'sms',
        sender: 'Клиент',
        body: 'позднее',
        attachmentName: null,
      },
      {
        kind: 'message_in',
        id: 'in-early',
        at: new Date('2026-01-01T10:00:00Z'),
        channel: 'telegram',
        sender: 'Клиент',
        body: 'раннее',
        attachmentName: null,
      },
    ];
    render(<OrderClientThread orderId="order-9" items={items} inboundEnabled={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'В sms' }));
    expect(screen.getByText('Ответ уйдёт клиенту в sms.')).toBeTruthy();
    send('ок');
    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({ inboundMessageId: 'in-late', text: 'ок' })
    );
  });

  it('канал: при равных датах побеждает последний элемент ленты; поле без name — пустой текст', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    const at = new Date('2026-01-01T10:00:00Z');
    const mk = (id: string): ActivityItem => ({
      kind: 'message_in',
      id,
      at,
      channel: 'telegram',
      sender: 'К',
      body: id,
      attachmentName: null,
    });
    render(<OrderClientThread orderId="order-9" items={[mk('t1'), mk('t2')]} inboundEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'В Telegram' }));
    const textarea = screen.getByLabelText('Текст сообщения клиенту') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x' } });
    textarea.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить клиенту' }));
    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({ inboundMessageId: 't2', text: '' })
    );
  });

  it.each([
    ['forbidden', 'Обращение недоступно вашей компании.'],
    ['not_found', 'Обращение не найдено.'],
    ['reply_failed', 'Не удалось отправить ответ. Попробуйте ещё раз.'],
  ])('канал: ошибка %s → «%s»; смена цели сбрасывает ошибку', async (code, label) => {
    replyInboundAction.mockResolvedValue({ ok: false, error: code });
    render(<OrderClientThread orderId="order-9" items={tgInboundItems()} inboundEnabled={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'В Telegram' }));
    send('x');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(label);
    fireEvent.click(screen.getByRole('button', { name: 'В кабинет' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('мессенджеры выключили на лету — цель «канал» откатывается на кабинет', () => {
    const { rerender } = render(
      <OrderClientThread orderId="o1" items={tgInboundItems()} inboundEnabled={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'В Telegram' }));
    rerender(<OrderClientThread orderId="o1" items={tgInboundItems()} inboundEnabled={false} />);
    expect(
      screen.getByText('Клиент увидит сообщение в карточке заказа в своём кабинете.')
    ).toBeTruthy();
  });
});

describe('OrderClientThread — заметка из сообщения клиента', () => {
  const openNote = (index = 0) =>
    fireEvent.click(screen.getAllByText('Создать заметку из этого сообщения')[index]!);

  it('комментарий заказчика + слова менеджера → заметка с цитатой; тост, refresh', async () => {
    addDealNoteAction.mockResolvedValue({ ok: true, id: 'n-1' });
    render(<OrderClientThread orderId="order-9" items={mixedItems()} inboundEnabled={true} />);
    openNote(1); // второй — комментарий заказчика (первый — сообщение в Telegram)
    fireEvent.change(screen.getByLabelText('Ваш комментарий к заметке (клиент не увидит)'), {
      target: { value: '  Перезвонить в пятницу ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в заметки' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(addDealNoteAction).toHaveBeenCalledWith({
      orderId: 'order-9',
      body: `Перезвонить в пятницу\n\nСообщение клиента (Организация Ромашка, ${fmtDateTime(AT)}):\n«Комментарий заказчика»`,
    });
    expect(toastSuccess).toHaveBeenCalledWith('Заметка добавлена в «Активность»');
    expect(screen.queryByRole('button', { name: 'Сохранить в заметки' })).toBeNull();
  });

  it('сообщение из канала без слов менеджера → только цитата с отправителем', async () => {
    addDealNoteAction.mockResolvedValue({ ok: true, id: 'n-2' });
    render(<OrderClientThread orderId="order-9" items={mixedItems()} inboundEnabled={true} />);
    openNote(0);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в заметки' }));
    await waitFor(() => expect(addDealNoteAction).toHaveBeenCalled());
    expect(addDealNoteAction.mock.calls[0]![0].body).toBe(
      `Сообщение клиента (Иван Клиент, ${fmtDateTime(new Date('2026-01-01T10:00:00Z'))}):\n«Здравствуйте, есть вопрос»`
    );
  });

  it('отказ сервера — объяснение в форме, форма остаётся; «Отмена» закрывает', async () => {
    addDealNoteAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<OrderClientThread orderId="order-9" items={mixedItems()} inboundEnabled={true} />);
    openNote(0);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в заметки' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Заказ не найден.');
    addDealNoteAction.mockResolvedValue({ ok: false, error: 'invalid' });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в заметки' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Заметка получилась пустой.')
    );
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('button', { name: 'Сохранить в заметки' })).toBeNull();
  });
});
