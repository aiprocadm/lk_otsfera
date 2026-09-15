// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  sendDialogMessageAction: vi.fn(),
  addDialogNoteAction: vi.fn(),
  applyReplyTemplateAction: vi.fn(),
}));
vi.mock('@/server-actions/messengers', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { DialogReplyForm } from '@/components/manager/messengers/dialog-reply-form';
import type { ReplyTemplateRow } from '@/lib/services/replyTemplates/crud';

/**
 * Форма ответа в диалоге: режим «ответ клиенту» и режим «заметка для своих»
 * (`У-209`) плюс вставка шаблона (`У-208`).
 *
 * Проверяем то, что видит человек ПЕРЕД отправкой: в каком он режиме, уйдёт
 * текст клиенту или нет и всё ли подставилось в шаблоне. Случайно отправить
 * обсуждение коллег клиенту быть не должно.
 */
const TEMPLATES: ReplyTemplateRow[] = [
  {
    id: 't1',
    title: 'Приветствие',
    body: 'Здравствуйте, {{contact.name}}!',
    channels: [],
    isActive: true,
    sortOrder: 0,
    usageCount: 0,
  },
];

beforeEach(() => vi.clearAllMocks());

describe('DialogReplyForm — два режима', () => {
  it('по умолчанию режим ответа: кнопка «Отправить», предупреждения о заметке нет', () => {
    render(<DialogReplyForm dialogId="d1" />);
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сохранить заметку' })).toBeNull();
    expect(screen.queryByText(/клиент не увидит/i)).toBeNull();
    expect(screen.getByLabelText('Текст сообщения')).toBeTruthy();
  });

  it('переключение в заметку меняет подпись кнопки и подсказывает, что клиент её не увидит', () => {
    render(<DialogReplyForm dialogId="d1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));
    expect(screen.getByRole('button', { name: 'Сохранить заметку' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
    expect(screen.getByText(/Заметку клиент не увидит/)).toBeTruthy();
    expect(screen.getByLabelText('Текст заметки')).toBeTruthy();
  });

  it('в режиме заметки сабмит зовёт addDialogNoteAction, а не отправку клиенту', async () => {
    actions.addDialogNoteAction.mockResolvedValue({ ok: true, messageId: 'mm1' });
    render(<DialogReplyForm dialogId="d1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));
    fireEvent.change(screen.getByLabelText('Текст заметки'), {
      target: { value: 'клиент торопится' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заметку' }));
    await waitFor(() =>
      expect(actions.addDialogNoteAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        text: 'клиент торопится',
      })
    );
    expect(actions.sendDialogMessageAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Заметка сохранена — клиент её не увидит')
    );
  });

  it('вернуться в режим ответа можно той же парой кнопок', () => {
    render(<DialogReplyForm dialogId="d1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ответ клиенту' }));
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeTruthy();
    expect(screen.queryByText(/Заметку клиент не увидит/)).toBeNull();
  });
});

describe('DialogReplyForm — шаблоны', () => {
  it('шаблонов нет — выбора шаблона на форме нет', () => {
    render(<DialogReplyForm dialogId="d1" />);
    expect(screen.queryByLabelText('Шаблон ответа')).toBeNull();
  });

  it('выбор шаблона подставляет готовый текст в поле', async () => {
    actions.applyReplyTemplateAction.mockResolvedValue({
      ok: true,
      text: 'Здравствуйте, Иван Петров!',
      empty: [],
    });
    render(<DialogReplyForm dialogId="d1" templates={TEMPLATES} />);
    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });
    await waitFor(() =>
      expect(actions.applyReplyTemplateAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        templateId: 't1',
      })
    );
    const textarea = screen.getByLabelText('Текст сообщения') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe('Здравствуйте, Иван Петров!'));
    expect(screen.queryByText(/Не удалось подставить/)).toBeNull();
  });

  it('пустые подстановки показываются предупреждением ДО отправки', async () => {
    actions.applyReplyTemplateAction.mockResolvedValue({
      ok: true,
      text: 'Здравствуйте, ! Заказ .',
      empty: ['contact.name', 'order.number'],
    });
    render(<DialogReplyForm dialogId="d1" templates={TEMPLATES} />);
    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });
    await waitFor(() =>
      expect(screen.getByText(/Не удалось подставить/).textContent).toContain(
        'contact.name, order.number'
      )
    );
  });

  it('отказ сервиса при вставке шаблона — видимое сообщение, поле не затирается', async () => {
    actions.applyReplyTemplateAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<DialogReplyForm dialogId="d1" templates={TEMPLATES} />);
    const textarea = screen.getByLabelText('Текст сообщения') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'мой текст' } });
    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });
    // Код отказа различается: «шаблон удалили» и «нет доступа» — разные
    // новости, и общий текст отправил бы человека искать не ту причину.
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Шаблон не найден — возможно, его удалили')
    );
    expect(textarea.value).toBe('мой текст');
  });

  it('в режиме заметки шаблоны не предлагаются — это заготовки для клиента', () => {
    render(<DialogReplyForm dialogId="d1" templates={TEMPLATES} />);
    expect(screen.getByLabelText('Шаблон ответа')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));
    expect(screen.queryByLabelText('Шаблон ответа')).toBeNull();
  });

  it('предупреждение о пустых подстановках сбрасывается при смене режима', async () => {
    // Оно было про ответ клиенту: висеть над заметкой для коллег ему незачем.
    actions.applyReplyTemplateAction.mockResolvedValue({
      ok: true,
      text: 'Здравствуйте, !',
      empty: ['Имя контакта'],
    });
    render(<DialogReplyForm dialogId="d1" templates={TEMPLATES} />);
    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });
    await waitFor(() => expect(screen.getByText(/Не удалось подставить/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));
    expect(screen.queryByText(/Не удалось подставить/)).toBeNull();
  });
});
