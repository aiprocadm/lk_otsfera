// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { addDealNoteAction, initiateCallAction } = vi.hoisted(() => ({
  addDealNoteAction: vi.fn(),
  initiateCallAction: vi.fn(),
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
      attachmentName: 'скан.pdf',
    },
    {
      kind: 'message_in',
      id: 'mi2',
      at: new Date('2026-01-01T10:05:00Z'),
      channel: 'sms',
      sender: 'Пётр',
      body: 'Без вложения',
      attachmentName: null,
    },
    {
      kind: 'message_out',
      id: 'mo1',
      at: new Date('2026-01-01T10:10:00Z'),
      author: 'Менеджер Мария',
      body: 'Ответ клиенту с файлом',
      hasAttachment: true,
    },
    {
      kind: 'message_out',
      id: 'mo2',
      at: new Date('2026-01-01T10:12:00Z'),
      author: 'Менеджер Мария',
      body: 'Ответ без файла',
      hasAttachment: false,
    },
    {
      kind: 'comment',
      id: 'c1',
      at: new Date('2026-01-01T10:15:00Z'),
      author: 'Организация Ромашка',
      body: 'Комментарий заказчика',
      fromClient: true,
    },
    {
      kind: 'call',
      id: 'call1',
      at: new Date('2026-01-01T10:20:00Z'),
      direction: 'inbound',
      number: '+79990000000',
      durationSec: 125,
      recordingReady: true,
      initiator: 'Оператор Олег',
    },
    {
      kind: 'call',
      id: 'call2',
      at: new Date('2026-01-01T10:21:00Z'),
      direction: 'outbound',
      number: '+79991111111',
      durationSec: null,
      recordingReady: false,
      initiator: null,
    },
    {
      kind: 'call',
      id: 'call3',
      at: new Date('2026-01-01T10:22:00Z'),
      direction: 'transfer',
      number: '+79992222222',
      durationSec: Number.NaN,
      recordingReady: false,
      initiator: null,
    },
    {
      kind: 'call',
      id: 'call4',
      at: new Date('2026-01-01T10:23:00Z'),
      direction: 'outbound',
      number: '+79993333333',
      durationSec: -5,
      recordingReady: false,
      initiator: null,
    },
    {
      kind: 'note',
      id: 'n1',
      at: new Date('2026-01-01T10:25:00Z'),
      author: 'Менеджер Мария',
      body: 'Внутренняя заметка для команды',
    },
    {
      kind: 'event',
      id: 'ev1',
      at: new Date('2026-01-01T10:30:00Z'),
      label: 'Смена статуса заказа',
    },
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

  it('пустая лента: объясняет, что сюда пишут, и что клиент этого не увидит', () => {
    render(<DealActivityThread orderId="o1" items={[]} telephonyEnabled={false} />);
    expect(
      screen.getByText(
        'Заметок пока нет. Запишите договорённость или напоминание для коллег — клиент её не увидит.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Активность' })).toBeTruthy();
  });

  it('`У-310`: только внутреннее — заметки, звонки, события; ничего, что видит клиент', () => {
    render(<DealActivityThread orderId="o1" items={allKindsItems()} telephonyEnabled={true} />);
    expect(screen.getByText('Внутренняя заметка для команды')).toBeTruthy();
    expect(screen.getByText('Клиент не видит')).toBeTruthy();
    expect(screen.getByText('+79990000000')).toBeTruthy();
    expect(screen.getByText('▶ запись')).toBeTruthy();
    expect(screen.getByText('+79991111111')).toBeTruthy();
    expect(screen.getByText('+79992222222')).toBeTruthy();
    expect(screen.getByText('+79993333333')).toBeTruthy();
    expect(screen.getByText(/Смена статуса заказа/)).toBeTruthy();
    expect(screen.getAllByText('Оператор Олег')).toHaveLength(1);
    // Клиентское — в «Переписке с клиентом», здесь его нет.
    expect(screen.queryByText('Комментарий заказчика')).toBeNull();
    expect(screen.queryByText('Здравствуйте, есть вопрос')).toBeNull();
    expect(screen.queryByText('Ответ клиенту с файлом')).toBeNull();
  });

  it('`У-310`: у формы одна цель — заметка; переключателя «кому» и отправки клиенту нет', () => {
    render(<DealActivityThread orderId="o1" items={allKindsItems()} telephonyEnabled={false} />);
    expect(screen.queryByRole('button', { name: 'Комментарий' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ответ в канал' })).toBeNull();
    expect(screen.queryByRole('button', { name: /клиент/i })).toBeNull();
    const textarea = screen.getByLabelText('Текст заметки');
    const caption = document.getElementById(textarea.getAttribute('aria-describedby') ?? '');
    expect(caption?.textContent).toBe(
      'Заметку видят только сотрудники. Написать клиенту — в блоке «Переписка с клиентом».'
    );
  });

  it('telephonyEnabled=false: строки звонков скрыты, заметки видны', () => {
    render(<DealActivityThread orderId="o1" items={allKindsItems()} telephonyEnabled={false} />);
    expect(screen.queryByText('+79990000000')).toBeNull();
    expect(screen.getByText('Внутренняя заметка для команды')).toBeTruthy();
  });

  it('telephonyEnabled=false: кнопки «Позвонить» нет вовсе', () => {
    render(<DealActivityThread orderId="o1" items={[]} telephonyEnabled={false} />);
    expect(screen.queryByRole('button', { name: 'Позвонить' })).toBeNull();
  });

  it('заметка: успешная отправка вызывает action, тост, refresh и сбрасывает форму', async () => {
    addDealNoteAction.mockResolvedValue({ ok: true, id: 'note-1' });
    render(<DealActivityThread orderId="order-9" items={[]} telephonyEnabled={false} />);

    const textarea = screen.getByLabelText('Текст заметки') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Перезвонить завтра' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));

    await waitFor(() =>
      expect(addDealNoteAction).toHaveBeenCalledWith({
        orderId: 'order-9',
        body: 'Перезвонить завтра',
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заметка добавлена'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('заметка: textarea без name → защитный ?? отдаёт пустой текст', async () => {
    addDealNoteAction.mockResolvedValue({ ok: true, id: 'note-1' });
    render(<DealActivityThread orderId="order-9" items={[]} telephonyEnabled={false} />);

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
    render(<DealActivityThread orderId="order-9" items={[]} telephonyEnabled={false} />);

    fireEvent.change(screen.getByLabelText('Текст заметки'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Введите текст заметки.');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('звонок: клик «Позвонить» раскрывает форму номера, успешный вызов сворачивает форму и тостит', async () => {
    initiateCallAction.mockResolvedValue({ ok: true, callId: 'call-x' });
    render(<DealActivityThread orderId="order-9" items={[]} telephonyEnabled={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    const numberInput = screen.getByLabelText('Номер телефона') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: '+79995554433' } });
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));

    await waitFor(() =>
      expect(initiateCallAction).toHaveBeenCalledWith({
        orderId: 'order-9',
        toNumber: '+79995554433',
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
    render(<DealActivityThread orderId="order-9" items={[]} telephonyEnabled={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    const numberInput = screen.getByLabelText('Номер телефона') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: 'x' } }); // проходит required
    numberInput.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));

    await waitFor(() =>
      expect(initiateCallAction).toHaveBeenCalledWith({
        orderId: 'order-9',
        toNumber: '',
      })
    );
  });

  it('звонок: «Отмена» сворачивает форму без сабмита', () => {
    render(<DealActivityThread orderId="order-9" items={[]} telephonyEnabled={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    expect(screen.getByLabelText('Номер телефона')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByLabelText('Номер телефона')).toBeNull();
    expect(initiateCallAction).not.toHaveBeenCalled();
  });

  it('звонок: call_failed → ошибка "Звонок недоступен (не настроено)." в role=alert, форма остаётся открытой', async () => {
    initiateCallAction.mockResolvedValue({ ok: false, error: 'call_failed' });
    render(<DealActivityThread orderId="order-9" items={[]} telephonyEnabled={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    fireEvent.change(screen.getByLabelText('Номер телефона'), {
      target: { value: '+79995554433' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Звонок недоступен (не настроено).');
    expect(screen.getByLabelText('Номер телефона')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('звонок: no_internal_phone → ошибка "Укажите ваш внутренний номер…" в role=alert, форма остаётся открытой', async () => {
    initiateCallAction.mockResolvedValue({ ok: false, error: 'no_internal_phone' });
    render(<DealActivityThread orderId="order-9" items={[]} telephonyEnabled={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));
    fireEvent.change(screen.getByLabelText('Номер телефона'), {
      target: { value: '+79995554433' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Позвонить' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Укажите ваш внутренний номер в настройках, чтобы звонить.');
    expect(screen.getByLabelText('Номер телефона')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
