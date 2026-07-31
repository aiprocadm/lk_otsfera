// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { createUserAction } = vi.hoisted(() => ({ createUserAction: vi.fn() }));
vi.mock('@/server-actions/admin/users', () => ({ createUserAction }));

import { UserInviteForm } from '@/components/admin/user-invite-form';

const PARTNERS = [
  { id: 'p1', name: 'Партнёр А' },
  { id: 'p2', name: 'Партнёр Б' },
];

function fillCommonFields() {
  fireEvent.change(document.querySelector('input[name="email"]') as HTMLInputElement, {
    target: { value: 'new@x.com' },
  });
  fireEvent.change(document.querySelector('input[name="name"]') as HTMLInputElement, {
    target: { value: 'Новый' },
  });
}

describe('UserInviteForm', () => {
  beforeEach(() => {
    createUserAction.mockReset();
    push.mockClear();
    refresh.mockClear();
  });

  it('renders default role=organization and does not show the partner select', () => {
    render(React.createElement(UserInviteForm, { partners: PARTNERS }));
    const roleSelect = screen.getByDisplayValue('Организация') as HTMLSelectElement;
    expect(roleSelect.value).toBe('organization');
    expect(screen.queryByText('— выберите —')).toBeNull();
  });

  it('selecting role=partner reveals the partner select', () => {
    render(React.createElement(UserInviteForm, { partners: PARTNERS }));
    const roleSelect = screen.getByDisplayValue('Организация') as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'partner' } });
    expect(screen.getByText('— выберите —')).toBeTruthy();
    expect(screen.getByText('Партнёр А')).toBeTruthy();
    expect(screen.getByText('Партнёр Б')).toBeTruthy();
  });

  it('switching back away from partner hides the partner select again', () => {
    render(React.createElement(UserInviteForm, { partners: PARTNERS }));
    const roleSelect = screen.getByDisplayValue('Организация') as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'partner' } });
    fireEvent.change(roleSelect, { target: { value: 'manager' } });
    expect(screen.queryByText('— выберите —')).toBeNull();
  });

  it('success path: shows the invite link block, hides the submit button; "К списку" navigates', async () => {
    createUserAction.mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: 'new@x.com' },
      inviteUrl: 'https://app/invite/u1',
    });
    render(React.createElement(UserInviteForm, { partners: PARTNERS }));
    fillCommonFields();
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByDisplayValue('https://app/invite/u1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Пригласить' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'К списку' }));
    expect(push).toHaveBeenCalledWith('/admin/users');
  });

  it('focusing the readonly invite url input selects its text', async () => {
    createUserAction.mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: 'new@x.com' },
      inviteUrl: 'https://app/invite/u1',
    });
    render(React.createElement(UserInviteForm, { partners: PARTNERS }));
    fillCommonFields();
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());

    const urlInput = screen.getByDisplayValue('https://app/invite/u1') as HTMLInputElement;
    const selectSpy = vi.spyOn(urlInput, 'select');
    fireEvent.focus(urlInput);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('error path (duplicate_email) renders the mapped alert, keeps the submit button visible', async () => {
    createUserAction.mockResolvedValue({ ok: false, error: 'duplicate_email' });
    render(React.createElement(UserInviteForm, { partners: PARTNERS }));
    fillCommonFields();
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'Пользователь с такой почтой уже существует.'
      )
    );
    expect(screen.getByRole('button', { name: 'Пригласить' })).toBeTruthy();
  });

  it('busy state shows "Создаю…" and disables the submit button', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    createUserAction.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );
    render(React.createElement(UserInviteForm, { partners: PARTNERS }));
    fillCommonFields();
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Создаю…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Создаю…' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    resolvePromise({ ok: true, user: { id: 'u1', email: 'new@x.com' }, inviteUrl: 'u' });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
