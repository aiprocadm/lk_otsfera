// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { bindCallAction, createContactFromCallAction } = vi.hoisted(() => ({
  bindCallAction: vi.fn(),
  createContactFromCallAction: vi.fn(),
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
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs })
    );

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: /привязать/i }));

    await waitFor(() =>
      expect(bindCallAction).toHaveBeenCalledWith({ callId: 'call1', organizationId: 'o1' })
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('creates a contact from the caller number and binds', async () => {
    createContactFromCallAction.mockResolvedValue({ ok: true, contactId: 'k1' });
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs })
    );

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.change(screen.getByLabelText(/имя контакта/i), { target: { value: 'Иван' } });
    fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

    await waitFor(() =>
      expect(createContactFromCallAction).toHaveBeenCalledWith({
        callId: 'call1',
        organizationId: 'o1',
        name: 'Иван',
        phone: '+79990001122',
      })
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('без выбранной организации «Привязать» показывает ошибку и не вызывает action', async () => {
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs })
    );

    fireEvent.click(screen.getByRole('button', { name: /привязать/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(bindCallAction).not.toHaveBeenCalled();
  });

  it('без имени контакта «Создать контакт» показывает ошибку и не вызывает action', async () => {
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs })
    );

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(createContactFromCallAction).not.toHaveBeenCalled();
  });

  it('«Создать контакт» без выбранной организации показывает ошибку и не вызывает action', async () => {
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs })
    );

    // Организация НЕ выбрана — срабатывает собственный org-guard create-пути.
    fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(createContactFromCallAction).not.toHaveBeenCalled();
  });

  it('ошибка createContactFromCallAction показывает toast.error с замапленным текстом', async () => {
    createContactFromCallAction.mockResolvedValue({ ok: false, error: 'invalid' });
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs })
    );

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.change(screen.getByLabelText(/имя контакта/i), { target: { value: 'Иван' } });
    fireEvent.click(screen.getByRole('button', { name: /создать контакт/i }));

    await waitFor(() =>
      expect(createContactFromCallAction).toHaveBeenCalledWith({
        callId: 'call1',
        organizationId: 'o1',
        name: 'Иван',
        phone: '+79990001122',
      })
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Введите имя контакта.'));
  });

  it('ошибка bindCallAction показывает toast.error с замапленным текстом', async () => {
    bindCallAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs })
    );

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: /привязать/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Звонок или организация не найдены.')
    );
  });

  it('незамапленный код ошибки → generic-fallback текст в toast.error', async () => {
    // Служебный код вне ERROR_LABEL (например будущий `'storage'`) должен падать
    // в общий fallback errorLabel(), а не роняться undefined'ом.
    bindCallAction.mockResolvedValue({ ok: false, error: 'storage' });
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs })
    );

    fireEvent.change(screen.getByLabelText(/организаци/i), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: /привязать/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Не удалось выполнить действие. Попробуйте ещё раз.')
    );
  });

  it('пустой список организаций → нотис вместо формы', () => {
    render(
      React.createElement(CallBindForm, { callId: 'call1', callerNumber: '+79990001122', orgs: [] })
    );
    expect(screen.getByText(/нет доступных организаций/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /привязать/i })).toBeNull();
  });
});
