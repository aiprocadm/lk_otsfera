// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { invitePartnerOrgAdminAction } = vi.hoisted(() => ({ invitePartnerOrgAdminAction: vi.fn() }));
vi.mock('@/server-actions/partner/inviteOrgAdmin', () => ({ invitePartnerOrgAdminAction }));

const { inviteAdminOrgAdminAction } = vi.hoisted(() => ({ inviteAdminOrgAdminAction: vi.fn() }));
vi.mock('@/server-actions/admin/inviteOrgAdmin', () => ({ inviteAdminOrgAdminAction }));

import { InviteCustomerAdminForm } from '@/components/partner/invite-customer-admin-form';

describe('InviteCustomerAdminForm', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invitePartnerOrgAdminAction.mockReset();
    inviteAdminOrgAdminAction.mockReset();
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

  it('renders the default trigger label; dialog closed by default', () => {
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    expect(screen.getByRole('button', { name: 'Пригласить администратора' })).toBeTruthy();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('accepts a custom label prop', () => {
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1', label: 'Пригласить ещё' }));
    expect(screen.getByRole('button', { name: 'Пригласить ещё' })).toBeTruthy();
  });

  it('opens the dialog on click and renders the email/name form', async () => {
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Имя')).toBeTruthy();
  });

  it('source=partner (default) calls invitePartnerOrgAdminAction, not the admin action', async () => {
    invitePartnerOrgAdminAction.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'a@x.com' }, inviteUrl: 'https://app/invite/a', alreadyHasPassword: false });
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Анна' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(invitePartnerOrgAdminAction).toHaveBeenCalled());
    expect(inviteAdminOrgAdminAction).not.toHaveBeenCalled();
  });

  it('source=admin calls inviteAdminOrgAdminAction', async () => {
    inviteAdminOrgAdminAction.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'b@x.com' }, inviteUrl: null, alreadyHasPassword: true });
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1', source: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'b@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Борис' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(inviteAdminOrgAdminAction).toHaveBeenCalled());
    expect(invitePartnerOrgAdminAction).not.toHaveBeenCalled();
  });

  it('success with alreadyHasPassword=true shows the "already registered" message (no invite link block)', async () => {
    invitePartnerOrgAdminAction.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'c@x.com' }, inviteUrl: null, alreadyHasPassword: true });
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'c@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'В' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/уже зарегистрирован на платформе/)).toBeTruthy());
    expect(screen.queryByLabelText('Ссылка приглашения')).toBeNull();
  });

  it('success with a fresh invite: shows the link, copy works, then Закрыть closes', async () => {
    invitePartnerOrgAdminAction.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'd@x.com' }, inviteUrl: 'https://app/invite/d', alreadyHasPassword: false });
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'd@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Д' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/Приглашение отправлено на/)).toBeTruthy());
    expect(screen.getByLabelText('Ссылка приглашения')).toHaveProperty('value', 'https://app/invite/d');

    fireEvent.click(screen.getByText('Скопировать'));
    await waitFor(() => expect(screen.getByText('Скопировано ✓')).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://app/invite/d');

    const closeButtons = screen.getAllByText('Закрыть');
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('copy is a no-op when inviteUrl is null after success', async () => {
    invitePartnerOrgAdminAction.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'e@x.com' }, inviteUrl: null, alreadyHasPassword: false });
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'e@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Е' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByText(/Приглашение отправлено на/)).toBeTruthy());
    fireEvent.click(screen.getByText('Скопировать'));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('clipboard write failure is swallowed silently', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no-https')) } });
    invitePartnerOrgAdminAction.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'f@x.com' }, inviteUrl: 'https://app/invite/f', alreadyHasPassword: false });
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'f@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Ф' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    await waitFor(() => expect(screen.getByText('Скопировать')).toBeTruthy());

    fireEvent.click(screen.getByText('Скопировать'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(screen.queryByText('Скопировано ✓')).toBeNull();
  });

  it('error path renders the mapped text and stays open', async () => {
    invitePartnerOrgAdminAction.mockResolvedValue({ ok: false, error: 'already_member' });
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'g@x.com' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Г' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() =>
      expect(screen.getByText('Этот пользователь уже состоит в организации.')).toBeTruthy()
    );
  });

  it('"Отмена" closes the dialog and resets state', async () => {
    render(React.createElement(InviteCustomerAdminForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Пригласить администратора' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });
});
