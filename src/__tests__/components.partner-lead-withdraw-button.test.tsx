// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LeadWithdrawButton } from '@/components/partner/lead-withdraw-button';

describe('LeadWithdrawButton', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    refresh.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function openTrigger() {
    // The Dialog primitive always renders its markup (toggles `open`
    // imperatively), so a submit button with the same "Отозвать" text also
    // exists in the DOM before the dialog is shown. Scope to the trigger via
    // its distinguishing class instead of matching by text alone.
    return document.querySelector('button.hover\\:bg-gray-50.text-gray-700') as HTMLButtonElement;
  }

  it('renders the trigger button', () => {
    render(React.createElement(LeadWithdrawButton, { leadId: 'l1' }));
    expect(openTrigger()).toBeTruthy();
    expect(openTrigger().textContent).toBe('Отозвать');
  });

  it('opening the dialog resets the reason field to empty', async () => {
    render(React.createElement(LeadWithdrawButton, { leadId: 'l1' }));
    const textarea = () =>
      screen.getByPlaceholderText('Клиент отказался / выбрали другого подрядчика…') as HTMLTextAreaElement;

    fireEvent.click(openTrigger());
    await waitFor(() => expect(textarea().value).toBe(''));
    fireEvent.change(textarea(), { target: { value: 'причина' } });
    expect(textarea().value).toBe('причина');

    const dialog = screen.getByRole('dialog', { name: 'Отозвать заявку' });
    fireEvent.click(within(dialog).getByText('Отмена'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Отозвать заявку' })).toBeNull());

    fireEvent.click(openTrigger());
    await waitFor(() => expect(textarea().value).toBe(''));
  });

  it('success path: PATCH action=withdraw + trimmed reason, closes on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadWithdrawButton, { leadId: 'l1' }));

    fireEvent.click(openTrigger());
    const dialog = await screen.findByRole('dialog', { name: 'Отозвать заявку' });
    fireEvent.change(
      screen.getByPlaceholderText('Клиент отказался / выбрали другого подрядчика…'),
      { target: { value: '  клиент отказался  ' } }
    );
    fireEvent.submit(dialog.querySelector('form')!);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Отозвать заявку' })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/leads/l1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'withdraw', reason: 'клиент отказался' })
      })
    );
  });

  it('error path: maps ALREADY_REJECTED to a Russian message and keeps the dialog open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'ALREADY_REJECTED' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadWithdrawButton, { leadId: 'l1' }));

    fireEvent.click(openTrigger());
    const dialog = await screen.findByRole('dialog', { name: 'Отозвать заявку' });
    fireEvent.submit(dialog.querySelector('form')!);

    expect(await within(dialog).findByText('Заявка уже отклонена')).toBeTruthy();
  });

  it('"Отмена" closes the dialog without submitting', async () => {
    render(React.createElement(LeadWithdrawButton, { leadId: 'l1' }));
    fireEvent.click(openTrigger());
    const dialog = await screen.findByRole('dialog', { name: 'Отозвать заявку' });
    fireEvent.click(within(dialog).getByText('Отмена'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Отозвать заявку' })).toBeNull());
  });

  it('Escape (dialog cancel event) closes it via Dialog.onClose', async () => {
    render(React.createElement(LeadWithdrawButton, { leadId: 'l1' }));
    fireEvent.click(openTrigger());
    const dialog = await screen.findByRole('dialog', { name: 'Отозвать заявку' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Отозвать заявку' })).toBeNull());
  });
});
