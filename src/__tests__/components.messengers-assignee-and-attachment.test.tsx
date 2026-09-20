// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Ответственный за диалог (`У-206`) и «Прикрепить файл» (`У-204`).
 *
 * Оба экрана про честность перед человеком: снять ответственного должно быть
 * так же просто, как назначить (иначе диалог навсегда остаётся за
 * уволившимся), а про файл нельзя писать «отправлено» до антивируса.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  assignDialogAction: vi.fn(),
  takeDialogAction: vi.fn(),
}));
vi.mock('@/server-actions/messengers', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { DialogAssigneePanel } from '@/components/manager/messengers/dialog-assignee-panel';
import { DialogAttachmentForm } from '@/components/manager/messengers/dialog-attachment-form';

const STAFF = [
  { id: 'u1', name: 'Иванов' },
  { id: 'u2', name: 'Петров' },
];

beforeEach(() => {
  vi.clearAllMocks();
  actions.assignDialogAction.mockResolvedValue({ ok: true });
  actions.takeDialogAction.mockResolvedValue({ ok: true });
});

describe('DialogAssigneePanel — ответственный за диалог', () => {
  it('никто не взял — видна метка и кнопка «Взять себе»', () => {
    render(<DialogAssigneePanel dialogId="d1" assignee={null} staff={STAFF} />);

    expect(screen.getByText('Никто не взял')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Взять себе' })).toBeTruthy();
  });

  it('ответственный есть — имя видно, кнопки «Взять себе» нет', () => {
    // Имя нарочно не из списка: иначе оно встречается дважды — подписью и
    // пунктом выбора, и запрос по тексту находит оба.
    render(
      <DialogAssigneePanel dialogId="d1" assignee={{ id: 'u9', name: 'Сидоров' }} staff={STAFF} />
    );

    expect(screen.getByText('Сидоров')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Взять себе' })).toBeNull();
  });

  it('«Взять себе» зовёт действие и говорит спасибо', async () => {
    render(<DialogAssigneePanel dialogId="d1" assignee={null} staff={STAFF} />);

    fireEvent.click(screen.getByRole('button', { name: 'Взять себе' }));

    await waitFor(() => expect(actions.takeDialogAction).toHaveBeenCalledWith({ dialogId: 'd1' }));
    expect(toastMock.success).toHaveBeenCalledWith('Диалог теперь ваш');
  });

  it('выбор коллеги уходит с его идентификатором', async () => {
    render(<DialogAssigneePanel dialogId="d1" assignee={null} staff={STAFF} />);

    fireEvent.change(screen.getByLabelText('Ответственный за диалог'), {
      target: { value: 'u2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    await waitFor(() =>
      expect(actions.assignDialogAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        assigneeId: 'u2',
      })
    );
    expect(toastMock.success).toHaveBeenCalledWith('Ответственный обновлён');
  });

  it('пустой выбор снимает ответственного, а не шлёт пустую строку', async () => {
    render(
      <DialogAssigneePanel dialogId="d1" assignee={{ id: 'u1', name: 'Иванов' }} staff={STAFF} />
    );

    fireEvent.change(screen.getByLabelText('Ответственный за диалог'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    await waitFor(() =>
      expect(actions.assignDialogAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        assigneeId: null,
      })
    );
  });

  it('отказ сервиса показывается по-русски, а не кодом', async () => {
    actions.assignDialogAction.mockResolvedValue({ ok: false, error: 'invalid_assignee' });
    render(<DialogAssigneePanel dialogId="d1" assignee={null} staff={STAFF} />);

    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('не из вашей компании');
  });

  it('пока сохраняем — так и написано на кнопке, а выбор заперт', async () => {
    // Действие держим незавершённым ровно до проверки, а потом отпускаем:
    // брошенное «висящее» обещание протекает в следующие тесты и роняет их.
    let release: (v: unknown) => void = () => {};
    actions.assignDialogAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    render(<DialogAssigneePanel dialogId="d1" assignee={null} staff={STAFF} />);

    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    await screen.findByRole('button', { name: 'Сохраняем…' });
    expect((screen.getByLabelText('Ответственный за диалог') as HTMLSelectElement).disabled).toBe(
      true
    );

    release({ ok: true });
    await screen.findByRole('button', { name: 'Назначить' });
  });

  it('отказ у «Взять себе» показывается отдельной строкой', async () => {
    actions.takeDialogAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<DialogAssigneePanel dialogId="d1" assignee={null} staff={STAFF} />);

    fireEvent.click(screen.getByRole('button', { name: 'Взять себе' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Нет доступа к диалогу');
  });
});

describe('DialogAttachmentForm — прикрепить файл', () => {
  const okResponse = () =>
    Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, messageId: 'm1' }),
    } as Response);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(okResponse));
  });

  it('пока файл не выбран, кнопка не нажимается', () => {
    render(<DialogAttachmentForm dialogId="d1" />);

    const button = screen.getByRole('button', { name: 'Прикрепить' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('подпись про предел берётся из общего значения, а не из головы', () => {
    render(<DialogAttachmentForm dialogId="d1" />);

    expect(screen.getByText(/до \d+ МБ/)).toBeTruthy();
  });

  it('предел канала перекрывает общий', () => {
    render(<DialogAttachmentForm dialogId="d1" limitMb={16} />);

    expect(screen.getByText('до 16 МБ')).toBeTruthy();
  });

  it('файл уходит на роут, а обещание честное — «после проверки антивирусом»', async () => {
    const { container } = render(<DialogAttachmentForm dialogId="d7" />);

    const input = screen.getByLabelText('Файл для клиента') as HTMLInputElement;
    const file = new File(['данные'], 'акт.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    expect((screen.getByRole('button', { name: 'Прикрепить' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    // Отправляем форму напрямую: в jsdom нажатие кнопки не доводит дело до
    // отправки, потому что поле файла помечено обязательным и проверка
    // правильности его не пропускает.
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/manager/messengers/d7/attachment');
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Файл принят — уйдёт клиенту после проверки антивирусом'
      )
    );
  });

  it('снятие файла возвращает кнопку в нерабочее состояние', () => {
    render(<DialogAttachmentForm dialogId="d1" />);

    const input = screen.getByLabelText('Файл для клиента') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf')] } });
    fireEvent.change(input, { target: { files: [] } });

    expect((screen.getByRole('button', { name: 'Прикрепить' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('отказ роута показывается по-русски', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({ ok: false, error: 'channel_no_attachments' }),
      }))
    );
    const { container } = render(<DialogAttachmentForm dialogId="d1" />);

    const input = screen.getByLabelText('Файл для клиента') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf')] } });
    fireEvent.submit(container.querySelector('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('только текст');
  });
});
