// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { inviteOrgMemberAction } = vi.hoisted(() => ({ inviteOrgMemberAction: vi.fn() }));
vi.mock('@/server-actions/organization/team', () => ({ inviteOrgMemberAction }));

import { InviteOrgUserForm } from '@/components/organization/invite-org-user-form';

describe('InviteOrgUserForm', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    inviteOrgMemberAction.mockReset();
    refresh.mockClear();
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
    // jsdom has no clipboard API by default.
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('renders the trigger button and dialog is closed by default', () => {
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'member' }));
    expect(screen.getByRole('button', { name: 'Пригласить участника' })).toBeTruthy();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('opens the dialog on click and shows the member/leader options but not admin for a member viewer', async () => {
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'member' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Сотрудник')).toBeTruthy();
    expect(screen.getByText('Руководитель')).toBeTruthy();
    expect(screen.queryByText('Администратор')).toBeNull();
  });

  it('shows the admin role option for an admin viewer', async () => {
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Администратор')).toBeTruthy();
  });

  it('success (new user, no password): shows invite link, copy works, then Close resets to the form', async () => {
    inviteOrgMemberAction.mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: 'new@x.com' },
      inviteUrl: 'https://app/invite/abc',
      alreadyHasPassword: false
    });
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'new@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новый' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/Письмо приглашения отправлено на/)).toBeTruthy());
    expect(screen.getByText('new@x.com')).toBeTruthy();
    expect(screen.getByLabelText('Ссылка приглашения')).toHaveProperty('value', 'https://app/invite/abc');

    fireEvent.click(screen.getByText('Скопировать'));
    await waitFor(() => expect(screen.getByText('Скопировано ✓')).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://app/invite/abc');

    fireEvent.click(screen.getByText('Закрыть'));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('success (already has password): shows the alternate message and no invite-link row', async () => {
    inviteOrgMemberAction.mockResolvedValue({
      ok: true,
      user: { id: 'u2', email: 'existing@x.com' },
      inviteUrl: null,
      alreadyHasPassword: true
    });
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'existing@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Существующий' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/уже зарегистрирован/)).toBeTruthy());
    expect(screen.queryByLabelText('Ссылка приглашения')).toBeNull();
  });

  it('clipboard write failure is swallowed silently (catch branch)', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no-https')) }
    });
    inviteOrgMemberAction.mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: 'new@x.com' },
      inviteUrl: 'https://app/invite/abc',
      alreadyHasPassword: false
    });
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новый' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    await waitFor(() => expect(screen.getByText('Скопировать')).toBeTruthy());

    fireEvent.click(screen.getByText('Скопировать'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    // No crash, and the button never flips to the copied label.
    expect(screen.queryByText('Скопировано ✓')).toBeNull();
  });

  it('success with a null inviteUrl (edge case): renders an empty link field and copy is a no-op', async () => {
    inviteOrgMemberAction.mockResolvedValue({
      ok: true,
      user: { id: 'u3', email: 'nolink@x.com' },
      inviteUrl: null,
      alreadyHasPassword: false
    });
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nolink@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Безссылки' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/Письмо приглашения отправлено на/)).toBeTruthy());
    expect(screen.getByLabelText('Ссылка приглашения')).toHaveProperty('value', '');

    fireEvent.click(screen.getByText('Скопировать'));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('Скопировано ✓')).toBeNull();
  });

  it('error path renders the mapped error text inside the dialog', async () => {
    inviteOrgMemberAction.mockResolvedValue({ ok: false, error: 'already_member' });
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dup@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Дубль' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    await waitFor(() =>
      expect(screen.getByText('Этот пользователь уже состоит в организации.')).toBeTruthy()
    );
  });

  it('Отмена closes the dialog and resets state', async () => {
    render(React.createElement(InviteOrgUserForm, { organizationId: 'org1', viewerRole: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});
