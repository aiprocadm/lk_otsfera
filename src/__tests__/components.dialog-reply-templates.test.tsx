// @vitest-environment jsdom
/**
 * Шаблоны ответа и внутренние заметки в форме диалога (`У-208`, `У-209`).
 *
 * Два обещания экрана. **Вставку шаблона можно отменить**: она затирает поле,
 * и без отмены набранный текст пропал бы безвозвратно. И **пустые подстановки
 * показываются ДО отправки** — иначе клиент получит письмо с пропущенным
 * именем или номером заказа.
 *
 * Отдельно: коды отказа различаются. «Нет доступа» и «шаблон удалили» — разные
 * новости, общий текст отправил бы человека искать не ту причину.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  sendDialogMessageAction: vi.fn(),
  addDialogNoteAction: vi.fn(),
  applyReplyTemplateAction: vi.fn(),
}));
vi.mock('@/server-actions/messengers', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DialogReplyForm } from '@/components/manager/messengers/dialog-reply-form';

const TEMPLATES = [
  { id: 't1', title: 'Счёт отправлен', body: 'текст', isActive: true, sortOrder: 0, usageCount: 0 },
] as never;

function mount(withTemplates = true) {
  return render(
    <DialogReplyForm dialogId="d1" {...(withTemplates ? { templates: TEMPLATES } : {})} />
  );
}

const textarea = () => screen.getByLabelText('Текст сообщения') as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
  actions.sendDialogMessageAction.mockResolvedValue({ ok: true });
  actions.addDialogNoteAction.mockResolvedValue({ ok: true, messageId: 'n1' });
  actions.applyReplyTemplateAction.mockResolvedValue({
    ok: true,
    text: 'Здравствуйте! Счёт отправлен.',
    empty: [],
  });
});

describe('Выбор шаблона', () => {
  it('шаблонов нет — списка нет вовсе', () => {
    mount(false);

    expect(screen.queryByLabelText('Шаблон ответа')).toBeNull();
  });

  it('выбранный шаблон подставляется в поле', async () => {
    mount();

    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });

    await waitFor(() => expect(textarea().value).toBe('Здравствуйте! Счёт отправлен.'));
    expect(actions.applyReplyTemplateAction).toHaveBeenCalledWith({
      dialogId: 'd1',
      templateId: 't1',
    });
  });

  it('пустое значение списка — это подпись «Шаблон…», а не выбор', async () => {
    mount();

    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: '' } });

    await Promise.resolve();
    expect(actions.applyReplyTemplateAction).not.toHaveBeenCalled();
  });

  it('незаполненные подстановки видны до отправки', async () => {
    actions.applyReplyTemplateAction.mockResolvedValue({
      ok: true,
      text: 'Здравствуйте, {{contact.name}}!',
      empty: ['{{contact.name}}'],
    });
    mount();

    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });

    await waitFor(() => expect(screen.getByText(/Не удалось подставить/)).toBeTruthy());
  });

  it.each([
    ['forbidden', 'Нет доступа к этому диалогу'],
    ['validation', 'Не удалось вставить шаблон'],
    ['not_found', 'Шаблон не найден — возможно, его удалили'],
  ])('отказ «%s» называет свою причину', async (error, text) => {
    actions.applyReplyTemplateAction.mockResolvedValue({ ok: false, error });
    mount();

    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(text));
    expect(textarea().value).toBe('');
  });
});

describe('Отмена вставки', () => {
  it('набранный текст возвращается по кнопке', async () => {
    mount();
    fireEvent.change(textarea(), { target: { value: 'мой черновик' } });

    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });
    await waitFor(() => expect(textarea().value).toBe('Здравствуйте! Счёт отправлен.'));

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть как было' }));

    expect(textarea().value).toBe('мой черновик');
    expect(screen.queryByRole('button', { name: 'Вернуть как было' })).toBeNull();
  });

  it('поле было пустым — предлагать возврат незачем', async () => {
    mount();

    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });

    await waitFor(() => expect(textarea().value).not.toBe(''));
    expect(screen.queryByRole('button', { name: 'Вернуть как было' })).toBeNull();
  });

  it('смена режима сбрасывает подсказку — она была про ответ, а не про заметку', async () => {
    actions.applyReplyTemplateAction.mockResolvedValue({
      ok: true,
      text: 'текст',
      empty: ['{{x}}'],
    });
    mount();
    fireEvent.change(screen.getByLabelText('Шаблон ответа'), { target: { value: 't1' } });
    await waitFor(() => expect(screen.getByText(/Не удалось подставить/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));

    expect(screen.queryByText(/Не удалось подставить/)).toBeNull();
  });
});

describe('Заметка для своих', () => {
  it('в режиме заметки экран предупреждает, что клиент её не увидит', () => {
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));

    expect(screen.getByText(/Заметку клиент не увидит/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить заметку' })).toBeTruthy();
    // Шаблоны — про ответ клиенту; в заметке их не предлагают.
    expect(screen.queryByLabelText('Шаблон ответа')).toBeNull();
  });

  it('заметка уходит своим действием, а не отправкой клиенту', async () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));

    fireEvent.change(screen.getByLabelText('Текст заметки'), {
      target: { value: 'позвонить завтра' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() =>
      expect(actions.addDialogNoteAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        text: 'позвонить завтра',
      })
    );
    expect(actions.sendDialogMessageAction).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Заметка сохранена — клиент её не увидит');
  });

  it('ответ клиенту уходит своим действием', async () => {
    const { container } = mount();

    fireEvent.change(textarea(), { target: { value: 'здравствуйте' } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() =>
      expect(actions.sendDialogMessageAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        text: 'здравствуйте',
      })
    );
    expect(toastMock.success).toHaveBeenCalledWith('Сообщение отправлено');
  });

  it('возврат к ответу снова показывает шаблоны', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Заметка для своих' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ответ клиенту' }));

    expect(screen.getByLabelText('Шаблон ответа')).toBeTruthy();
  });
});
