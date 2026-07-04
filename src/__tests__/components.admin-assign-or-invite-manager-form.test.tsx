// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { assignOrInviteManagerAction } = vi.hoisted(() => ({ assignOrInviteManagerAction: vi.fn() }));
vi.mock('@/server-actions/admin/manager', () => ({ assignOrInviteManagerAction }));

import { AssignOrInviteManagerForm } from '@/components/admin/assign-or-invite-manager-form';

describe('AssignOrInviteManagerForm', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assignOrInviteManagerAction.mockReset();
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the trigger button; dialog is closed by default', () => {
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    expect(screen.getByRole('button', { name: 'Назначить менеджера' })).toBeTruthy();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('opens the dialog on click, defaults to "existing" tab', async () => {
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    const existingTab = screen.getByRole('tab', { name: 'Существующий' });
    expect(existingTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByLabelText('Имя (необязательно)')).toBeNull();
  });

  it('switching to "new" tab reveals the name field', async () => {
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Пригласить нового' }));
    expect(screen.getByRole('tab', { name: 'Пригласить нового' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Имя (необязательно)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пригласить' })).toBeTruthy();
  });

  it('clicking the already-active "Существующий" tab is a no-op re-click (still exercises its onClick handler)', async () => {
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Существующий' }));
    expect(screen.getByRole('tab', { name: 'Существующий' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByLabelText('Имя (необязательно)')).toBeNull();
  });

  it('success (reactivated): shows the reactivation message', async () => {
    assignOrInviteManagerAction.mockResolvedValue({
      ok: true,
      inviteUrl: null,
      alreadyHasPassword: false,
      reactivated: true,
    });
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'mgr@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    await waitFor(() => expect(screen.getByText(/восстановлен/)).toBeTruthy());
    expect(screen.getByText('mgr@x.com')).toBeTruthy();
  });

  it('success (already has password, not reactivated): shows the "already registered" message', async () => {
    assignOrInviteManagerAction.mockResolvedValue({
      ok: true,
      inviteUrl: null,
      alreadyHasPassword: true,
      reactivated: false,
    });
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'existing@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    await waitFor(() => expect(screen.getByText(/уже зарегистрирован/)).toBeTruthy());
  });

  it('success (new invite): shows invite link, copy works, then Закрыть closes the dialog', async () => {
    assignOrInviteManagerAction.mockResolvedValue({
      ok: true,
      inviteUrl: 'https://app/invite/mgr',
      alreadyHasPassword: false,
      reactivated: false,
    });
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Пригласить нового' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/Приглашение отправлено на/)).toBeTruthy());
    expect(screen.getByLabelText('Ссылка приглашения')).toHaveProperty('value', 'https://app/invite/mgr');

    fireEvent.click(screen.getByText('Скопировать'));
    await waitFor(() => expect(screen.getByText('Скопировано ✓')).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://app/invite/mgr');

    const closeButtons = screen.getAllByText('Закрыть');
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('copy is a no-op when inviteUrl is null', async () => {
    assignOrInviteManagerAction.mockResolvedValue({
      ok: true,
      inviteUrl: null,
      alreadyHasPassword: false,
      reactivated: false,
    });
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Пригласить нового' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/Приглашение отправлено на/)).toBeTruthy());
    fireEvent.click(screen.getByText('Скопировать'));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('Скопировано ✓')).toBeNull();
  });

  it('clipboard write failure is swallowed silently (catch branch)', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no-https')) },
    });
    assignOrInviteManagerAction.mockResolvedValue({
      ok: true,
      inviteUrl: 'https://app/invite/mgr',
      alreadyHasPassword: false,
      reactivated: false,
    });
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Пригласить нового' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'y@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    await waitFor(() => expect(screen.getByText('Скопировать')).toBeTruthy());

    fireEvent.click(screen.getByText('Скопировать'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(screen.queryByText('Скопировано ✓')).toBeNull();
  });

  it('error path renders the mapped text (role_conflict), stays open', async () => {
    assignOrInviteManagerAction.mockResolvedValue({ ok: false, error: 'role_conflict' });
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'conflict@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    await waitFor(() =>
      expect(screen.getByText('У этого email уже другая роль на платформе.')).toBeTruthy()
    );
  });

  it('"Отмена" closes the dialog and resets state, including tab back to existing', async () => {
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Пригласить нового' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());

    // Reopening should be back on the "existing" tab (state reset by openDialog too).
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('tab', { name: 'Существующий' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switching tabs calls reset() (clears a prior error)', async () => {
    assignOrInviteManagerAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(React.createElement(AssignOrInviteManagerForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить менеджера' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));
    await waitFor(() => expect(screen.getByText(/email/)).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'Пригласить нового' }));
    expect(screen.queryByText('Проверьте формат email и заполненность полей.')).toBeNull();
  });
});
