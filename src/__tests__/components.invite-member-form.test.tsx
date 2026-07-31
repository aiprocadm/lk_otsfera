// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { InviteMemberForm } from '@/components/partner/invite-member-form';

const orgs = [
  { id: 'o1', name: 'ООО Один' },
  { id: 'o2', name: 'ООО Два' },
];

/** Успешный ответ POST /api/partner/team (этап 4: ссылка + статус письма). */
function invitePayload(emailStatus: 'sent' | 'skipped' = 'sent') {
  return {
    userId: 'nu1',
    partnerUserId: 'npu1',
    inviteUrl: 'https://lk.example/invite/tok-1',
    emailStatus,
  };
}

describe('InviteMemberForm', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    refresh.mockClear();
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the trigger button; dialog closed by default', () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    expect(screen.getByRole('button', { name: /Пригласить/ })).toBeTruthy();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('opens the dialog with defaults: manager role, all orgs checked, submit disabled', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Менеджер')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Пригласить' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // org checklist hidden while "all orgs" is checked
    expect(screen.queryByText('ООО Один')).toBeNull();
  });

  it('filling in a valid name+email enables submit', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'p@x.com' },
    });
    const submit = screen.getByRole('button', { name: 'Пригласить' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it('invalid email (no @) keeps submit disabled', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'notanemail' },
    });
    const submit = screen.getByRole('button', { name: 'Пригласить' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('switching role to Админ highlights that option', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Админ'));
    // clicking label toggles the underlying radio
    const radios = document.querySelectorAll('input[type="radio"]');
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
  });

  it('switching back to Менеджер re-highlights that option', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Админ'));
    fireEvent.click(screen.getByText('Менеджер'));
    const radios = document.querySelectorAll('input[type="radio"]');
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
  });

  it('the Dialog onClose prop (e.g. Escape) closes the form same as Отмена', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialogEl, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('unchecking "all orgs" reveals the per-org checklist; selecting one enables submit alongside valid email', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Все организации партнёра'));
    expect(screen.getByText('ООО Один')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Пригласить' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // no org selected yet + no valid email

    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'p@x.com' },
    });
    expect(submit.disabled).toBe(true); // still no org selected

    fireEvent.click(screen.getByText('ООО Один'));
    expect(submit.disabled).toBe(false);

    fireEvent.click(screen.getByText('ООО Один'));
    expect(submit.disabled).toBe(true); // toggled back off
  });

  it('renders the empty-portfolio message when orgs is empty and "all orgs" is off', async () => {
    render(React.createElement(InviteMemberForm, { orgs: [] }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Все организации партнёра'));
    expect(screen.getByText('В портфеле нет организаций.')).toBeTruthy();
  });

  it('форма подписана про письмо со ссылкой (не про временный пароль)', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/письмо со ссылкой для установки пароля/)).toBeTruthy();
    expect(screen.queryByText(/временн\w* парол/i)).toBeNull();
  });

  it('success (emailStatus=sent): submits assignedOrgIds=[], показывает success-вид со ссылкой, диалог НЕ закрывается, refresh вызван', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => invitePayload('sent') });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'p@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/team',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'p@x.com',
          name: 'Пётр',
          roleInPartner: 'manager',
          assignedOrgIds: [],
        }),
      })
    );
    await waitFor(() => expect(screen.getByText(/Письмо приглашения отправлено/)).toBeTruthy());
    expect(screen.getByText('p@x.com')).toBeTruthy();
    const link = screen.getByLabelText('Ссылка приглашения') as HTMLInputElement;
    expect(link.value).toBe('https://lk.example/invite/tok-1');
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('success (emailStatus=skipped): текст «Отправка почты выключена», ссылка тоже показана', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => invitePayload('skipped') })
    );
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'p@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/Отправка почты\s*выключена/)).toBeTruthy());
    expect(screen.queryByText(/Письмо приглашения отправлено/)).toBeNull();
    expect((screen.getByLabelText('Ссылка приглашения') as HTMLInputElement).value).toBe(
      'https://lk.example/invite/tok-1'
    );
    vi.unstubAllGlobals();
  });

  it('success-вид: «Скопировать» пишет ссылку в clipboard и меняет подпись на «Скопировано ✓»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => invitePayload('sent') })
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'p@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировано ✓' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('https://lk.example/invite/tok-1');
    vi.unstubAllGlobals();
  });

  it('success-вид: сбой clipboard оставляет подпись «Скопировать»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => invitePayload('sent') })
    );
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'p@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Скопировано ✓' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('success-вид: «Готово» закрывает диалог; повторное открытие возвращает чистую форму', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => invitePayload('sent') })
    );
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'p@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Готово' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(close).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2));
    // Success-вид сброшен — снова форма с пустыми полями
    expect(screen.queryByLabelText('Ссылка приглашения')).toBeNull();
    expect((screen.getByPlaceholderText('Иван Иванов') as HTMLInputElement).value).toBe('');
    vi.unstubAllGlobals();
  });

  it('success path with specific orgs selected sends assignedOrgIds with the chosen ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Все организации партнёра'));
    fireEvent.click(screen.getByText('ООО Два'));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Оля' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'o@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.assignedOrgIds).toEqual(['o2']);
    vi.unstubAllGlobals();
  });

  it('error path shows the mapped error text and keeps the dialog open', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'email_taken' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByPlaceholderText('ivanov@company.ru'), {
      target: { value: 'dup@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() =>
      expect(screen.getByText('Пользователь с таким email уже существует')).toBeTruthy()
    );
    expect(close).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('"Отмена" closes the dialog', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('reopening the dialog resets fields back to defaults', async () => {
    render(React.createElement(InviteMemberForm, { orgs }));
    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Temp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Пригласить/ }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2));
    expect((screen.getByPlaceholderText('Иван Иванов') as HTMLInputElement).value).toBe('');
  });
});
