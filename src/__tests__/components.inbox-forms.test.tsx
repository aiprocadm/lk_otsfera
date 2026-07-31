// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { bindInboundMessageAction, replyInboundAction } = vi.hoisted(() => ({
  bindInboundMessageAction: vi.fn(),
  replyInboundAction: vi.fn(),
}));
vi.mock('@/server-actions/inbound', () => ({ bindInboundMessageAction, replyInboundAction }));

const { createContactFromInboundAction } = vi.hoisted(() => ({
  createContactFromInboundAction: vi.fn(),
}));
vi.mock('@/server-actions/contacts', () => ({ createContactFromInboundAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { InboxBindForm } from '@/components/manager/inbox-bind-form';
import { InboxReplyForm } from '@/components/manager/inbox-reply-form';

const ORGS = [
  { id: 'org-1', name: 'Первая' },
  { id: 'org-2', name: 'Вторая' },
] as never;

describe('InboxBindForm', () => {
  beforeEach(() => {
    bindInboundMessageAction.mockReset();
    toastSuccess.mockClear();
  });

  it('без организаций → заглушка вместо формы', () => {
    render(<InboxBindForm inboundMessageId="m1" organizations={[] as never} />);
    expect(screen.getByText('Нет доступных организаций для привязки.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('кнопка заблокирована, пока организация не выбрана', () => {
    render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} />);
    const button = screen.getByRole('button', { name: 'Привязать' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'org-1' } });
    expect(button.disabled).toBe(false);
  });

  it('успешная привязка без orderId: action без orderId, тост, сброс формы', async () => {
    bindInboundMessageAction.mockResolvedValue({ ok: true });
    render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} />);

    const select = screen.getByLabelText('Организация') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'org-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));

    await waitFor(() => expect(bindInboundMessageAction).toHaveBeenCalledTimes(1));
    expect(bindInboundMessageAction).toHaveBeenCalledWith({
      inboundMessageId: 'm1',
      organizationId: 'org-1',
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Привязано'));
    await waitFor(() => expect(select.value).toBe(''));
  });

  it('заполненный orderId уходит в action (с trim)', async () => {
    bindInboundMessageAction.mockResolvedValue({ ok: true });
    render(<InboxBindForm inboundMessageId="m2" organizations={ORGS} />);

    fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'org-2' } });
    fireEvent.change(screen.getByLabelText('ID заказа'), { target: { value: '  ord-9  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));

    await waitFor(() =>
      expect(bindInboundMessageAction).toHaveBeenCalledWith({
        inboundMessageId: 'm2',
        organizationId: 'org-2',
        orderId: 'ord-9',
      })
    );
  });

  it('поля без name отсутствуют в FormData → защитные ?? отдают пустые строки', async () => {
    bindInboundMessageAction.mockResolvedValue({ ok: true });
    render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} />);

    const select = screen.getByLabelText('Организация') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'org-1' } }); // разблокирует кнопку
    select.removeAttribute('name');
    screen.getByLabelText('ID заказа').removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));

    await waitFor(() =>
      expect(bindInboundMessageAction).toHaveBeenCalledWith({
        inboundMessageId: 'm1',
        organizationId: '',
      })
    );
  });

  it('forbidden → маппированная ошибка в role=alert', async () => {
    bindInboundMessageAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} />);

    fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'org-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Организация вне вашей зоны видимости.');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  describe('создание контакта из отправителя (Task 11, флаг contacts)', () => {
    beforeEach(() => {
      createContactFromInboundAction.mockReset();
      toastSuccess.mockClear();
      toastError.mockClear();
    });

    it('contactsEnabled=false (по умолчанию) → контрол не рендерится', () => {
      render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} />);
      expect(screen.queryByLabelText('Имя контакта')).toBeNull();
      expect(screen.queryByRole('button', { name: /создать контакт/i })).toBeNull();
    });

    it('contactsEnabled=true → контрол рендерится', () => {
      render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} contactsEnabled />);
      expect(screen.getByLabelText('Имя контакта')).toBeTruthy();
      expect(screen.getByRole('button', { name: /создать контакт/i })).toBeTruthy();
    });

    it('без выбранной организации → toast.error, action не вызывается', async () => {
      render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} contactsEnabled />);

      fireEvent.change(screen.getByLabelText('Имя контакта'), { target: { value: 'Иван' } });
      fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Выберите организацию.'));
      expect(createContactFromInboundAction).not.toHaveBeenCalled();
    });

    it('без имени контакта → toast.error, action не вызывается', async () => {
      render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} contactsEnabled />);

      fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'org-1' } });
      fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Введите имя контакта.'));
      expect(createContactFromInboundAction).not.toHaveBeenCalled();
    });

    it('успешное создание: action с org+именем, тост, сброс имени', async () => {
      createContactFromInboundAction.mockResolvedValue({ ok: true, contactId: 'k1' });
      render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} contactsEnabled />);

      fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'org-1' } });
      const nameInput = screen.getByLabelText('Имя контакта') as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: '  Иван  ' } });
      fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

      await waitFor(() =>
        expect(createContactFromInboundAction).toHaveBeenCalledWith({
          inboundMessageId: 'm1',
          organizationId: 'org-1',
          name: 'Иван',
        })
      );
      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith('Контакт создан, обращение привязано.')
      );
      await waitFor(() => expect(nameInput.value).toBe(''));
    });

    it('ошибка action с известным кодом → замапленный toast.error', async () => {
      createContactFromInboundAction.mockResolvedValue({ ok: false, error: 'invalid' });
      render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} contactsEnabled />);

      fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'org-1' } });
      fireEvent.change(screen.getByLabelText('Имя контакта'), { target: { value: 'Иван' } });
      fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Введите имя контакта.'));
    });

    it('незамапленный код ошибки → generic-fallback текст в toast.error', async () => {
      createContactFromInboundAction.mockResolvedValue({ ok: false, error: 'storage' });
      render(<InboxBindForm inboundMessageId="m1" organizations={ORGS} contactsEnabled />);

      fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'org-1' } });
      fireEvent.change(screen.getByLabelText('Имя контакта'), { target: { value: 'Иван' } });
      fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(
          'Не удалось выполнить действие. Попробуйте ещё раз.'
        )
      );
    });
  });
});

describe('InboxReplyForm', () => {
  beforeEach(() => {
    replyInboundAction.mockReset();
    toastSuccess.mockClear();
  });

  it('успешный ответ: action с текстом, тост, сброс формы', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(<InboxReplyForm inboundMessageId="m3" />);

    const textarea = screen.getByLabelText('Текст ответа') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Здравствуйте!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));

    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({
        inboundMessageId: 'm3',
        text: 'Здравствуйте!',
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Ответ отправлен'));
  });

  it('textarea без name → защитный ?? отдаёт пустой текст', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(<InboxReplyForm inboundMessageId="m3" />);

    const textarea = screen.getByLabelText('Текст ответа') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Ау' } }); // required пройден
    textarea.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));

    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({ inboundMessageId: 'm3', text: '' })
    );
  });

  it('not_found → маппированная ошибка в role=alert', async () => {
    replyInboundAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<InboxReplyForm inboundMessageId="m3" />);

    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'Ау' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Обращение не найдено.');
  });

  // Полный контракт replyInboundAction (E3): коды вне локального ERROR_LABEL
  // резолвятся центральной картой errorMessageRu, а не сырым fallback'ом.
  it.each([
    ['invalid', 'Введите текст ответа.'],
    ['reply_failed', 'Не удалось отправить ответ. Попробуйте ещё раз.'],
    [
      'email_unsupported',
      'Ответ по email пока не поддерживается — свяжитесь с клиентом другим каналом.',
    ],
  ])('%s → текст центральной карты в role=alert', async (code, label) => {
    replyInboundAction.mockResolvedValue({ ok: false, error: code });
    render(<InboxReplyForm inboundMessageId="m3" />);

    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'Ау' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(label);
    expect(alert.textContent).not.toContain('Ошибка:');
  });
});
