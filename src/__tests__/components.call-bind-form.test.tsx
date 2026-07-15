// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { bindCallAction, createContactFromCallAction } = vi.hoisted(() => ({
  bindCallAction: vi.fn(),
  createContactFromCallAction: vi.fn()
}));
vi.mock('@/server-actions/contacts', () => ({ bindCallAction, createContactFromCallAction }));

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/ui/toast', () => ({ toast }));

import { CallBindForm } from '@/components/manager/contacts/call-bind-form';

const orgs = [{ id: 'o1', name: 'ООО Ромашка' }];

describe('CallBindForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds an unresolved call to a selected org', async () => {
    bindCallAction.mockResolvedValue({ ok: true });
    render(React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs }));

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: /привязать/i }));

    await waitFor(() =>
      expect(bindCallAction).toHaveBeenCalledWith({ callId: 'call1', organizationId: 'o1' })
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('creates a contact from the caller number and binds', async () => {
    createContactFromCallAction.mockResolvedValue({ ok: true, contactId: 'k1' });
    render(React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs }));

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.change(screen.getByLabelText(/имя контакта/i), { target: { value: 'Иван' } });
    fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

    await waitFor(() =>
      expect(createContactFromCallAction).toHaveBeenCalledWith({
        callId: 'call1',
        organizationId: 'o1',
        name: 'Иван',
        phone: '+79990001122'
      })
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('без выбранной организации «Привязать» показывает ошибку и не вызывает action', async () => {
    render(React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs }));

    fireEvent.click(screen.getByRole('button', { name: /привязать/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(bindCallAction).not.toHaveBeenCalled();
  });

  it('без имени контакта «Создать контакт» показывает ошибку и не вызывает action', async () => {
    render(React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs }));

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(createContactFromCallAction).not.toHaveBeenCalled();
  });

  it('ошибка bindCallAction показывает toast.error с замапленным текстом', async () => {
    bindCallAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs }));

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: /привязать/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('пустой список организаций → нотис вместо формы', () => {
    render(React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs: [] }));
    expect(screen.getByText(/нет доступных организаций/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /привязать/i })).toBeNull();
  });
});
