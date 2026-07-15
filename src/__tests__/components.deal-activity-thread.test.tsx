// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { addDealNoteAction, initiateCallAction } = vi.hoisted(() => ({
  addDealNoteAction: vi.fn(),
  initiateCallAction: vi.fn()
}));
vi.mock('@/server-actions/deal-activity', () => ({ addDealNoteAction, initiateCallAction }));

import { DealActivityThread } from '@/components/manager/deal-activity/deal-activity-thread';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';

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
      initiator: 'Менеджер Мария'
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

describe('DealActivityThread', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    addDealNoteAction.mockReset();
    initiateCallAction.mockReset();
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

  it('переключение на «Вся активность» показывает call/note/event; «клиент не видит» маркер у заметки', () => {
    render(
      <DealActivityThread orderId='o1' items={allKindsItems()} inboundEnabled={true} telephonyEnabled={true} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Вся активность' }));

    expect(screen.getByText('Внутренняя заметка для команды')).toBeTruthy();
    expect(screen.getByText('Клиент не видит')).toBeTruthy();
    expect(screen.getByText('+79990000000')).toBeTruthy();
    expect(screen.getByText('▶ запись')).toBeTruthy();
    expect(screen.getByText('+79991111111')).toBeTruthy();
    expect(screen.getByText('+79992222222')).toBeTruthy();
    expect(screen.getByText('+79993333333')).toBeTruthy();
    expect(screen.getByText(/Смена статуса заказа/)).toBeTruthy();

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
