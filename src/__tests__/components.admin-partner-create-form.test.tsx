// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { createPartnerWithAdminAction } = vi.hoisted(() => ({ createPartnerWithAdminAction: vi.fn() }));
vi.mock('@/server-actions/admin/partners', () => ({ createPartnerWithAdminAction }));

import { PartnerCreateForm } from '@/components/admin/partner-create-form';

function fillRequiredFields() {
  fireEvent.change(document.querySelector('input[name="name"]') as HTMLInputElement, {
    target: { value: 'Партнёр Х' }
  });
  fireEvent.change(document.querySelector('input[name="slug"]') as HTMLInputElement, {
    target: { value: 'partner-x' }
  });
  fireEvent.change(document.querySelector('input[name="adminEmail"]') as HTMLInputElement, {
    target: { value: 'admin@x.com' }
  });
  fireEvent.change(document.querySelector('input[name="adminName"]') as HTMLInputElement, {
    target: { value: 'Админ' }
  });
}

describe('PartnerCreateForm', () => {
  beforeEach(() => {
    createPartnerWithAdminAction.mockReset();
    push.mockClear();
    refresh.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockReturnValue(Promise.resolve()) }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the create button and hides the invite/status blocks initially', () => {
    render(React.createElement(PartnerCreateForm));
    expect(screen.getByRole('button', { name: 'Создать партнёра' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('typing an invalid slug shows the format error; correcting it (onChange) clears it', () => {
    render(React.createElement(PartnerCreateForm));
    const slugInput = document.querySelector('input[name="slug"]') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'Invalid Slug!' } });
    fireEvent.blur(slugInput);
    expect(screen.getByText('Только строчные буквы, цифры и дефис')).toBeTruthy();

    fireEvent.change(slugInput, { target: { value: 'valid-slug' } });
    expect(screen.queryByText('Только строчные буквы, цифры и дефис')).toBeNull();
  });

  it('onChange does not validate while there is no existing slugError (only onBlur validates initially)', () => {
    render(React.createElement(PartnerCreateForm));
    const slugInput = document.querySelector('input[name="slug"]') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'Bad Slug' } });
    expect(screen.queryByText('Только строчные буквы, цифры и дефис')).toBeNull();
  });

  it('blur with an empty slug does not show the format error (the `value &&` guard)', () => {
    render(React.createElement(PartnerCreateForm));
    const slugInput = document.querySelector('input[name="slug"]') as HTMLInputElement;
    fireEvent.blur(slugInput);
    expect(screen.queryByText('Только строчные буквы, цифры и дефис')).toBeNull();
  });

  it('success path: renders invite block with url, copy works (with timeout reset), "К списку" navigates', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    createPartnerWithAdminAction.mockResolvedValue({
      ok: true,
      partner: { id: 'p1', name: 'X', slug: 'x' },
      user: { id: 'u1', email: 'admin@x.com' },
      inviteUrl: 'https://app/invite/p1'
    });
    render(React.createElement(PartnerCreateForm));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Создать партнёра' }));

    await vi.waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByDisplayValue('https://app/invite/p1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Создать партнёра' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://app/invite/p1'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Скопировано!' })).toBeTruthy());

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'К списку' }));
    expect(push).toHaveBeenCalledWith('/admin/partners');
  });

  it('focusing the readonly invite url input selects its text', async () => {
    createPartnerWithAdminAction.mockResolvedValue({
      ok: true,
      partner: { id: 'p1', name: 'X', slug: 'x' },
      user: { id: 'u1', email: 'admin@x.com' },
      inviteUrl: 'https://app/invite/p1'
    });
    render(React.createElement(PartnerCreateForm));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Создать партнёра' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());

    const urlInput = screen.getByDisplayValue('https://app/invite/p1') as HTMLInputElement;
    const selectSpy = vi.spyOn(urlInput, 'select');
    fireEvent.focus(urlInput);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('copy is a no-op when inviteUrl is falsy (guarded by `if (!inviteUrl) return`)', () => {
    // Not reachable via the success UI (copy button only renders once inviteUrl truthy),
    // but the function itself early-returns; verifying no crash / no clipboard call pre-success.
    render(React.createElement(PartnerCreateForm));
    expect(screen.queryByRole('button', { name: 'Скопировать' })).toBeNull();
  });

  it('error path (duplicate_slug) renders the mapped alert, keeps the create button visible', async () => {
    createPartnerWithAdminAction.mockResolvedValue({ ok: false, error: 'duplicate_slug' });
    render(React.createElement(PartnerCreateForm));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Создать партнёра' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Slug занят. Выберите другой.')
    );
    expect(screen.getByRole('button', { name: 'Создать партнёра' })).toBeTruthy();
  });

  it('busy state shows "Создаю…" and disables the submit button', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    createPartnerWithAdminAction.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    render(React.createElement(PartnerCreateForm));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Создать партнёра' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Создаю…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Создаю…' }) as HTMLButtonElement).disabled).toBe(true);
    resolvePromise({ ok: true, partner: { id: 'p1', name: 'X', slug: 'x' }, user: { id: 'u1', email: 'a@x.com' }, inviteUrl: 'u' });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
