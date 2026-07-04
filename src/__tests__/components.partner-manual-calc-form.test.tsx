// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { ManualCalcForm } from '@/components/partner/manual-calc-form';

describe('ManualCalcForm', () => {
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

  it('renders the trigger button', () => {
    render(React.createElement(ManualCalcForm));
    expect(screen.getByText('Сформировать за период')).toBeTruthy();
  });

  it('"Сформировать" submit is disabled until a month is chosen', async () => {
    render(React.createElement(ManualCalcForm));
    fireEvent.click(screen.getByText('Сформировать за период'));
    const dialog = await screen.findByRole('dialog', { name: 'Расчёт комиссии' });
    const submit = within(dialog).getByText('Сформировать') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const monthInput = document.getElementById('manual-calc-month') as HTMLInputElement;
    fireEvent.change(monthInput, { target: { value: '2026-03' } });
    expect(submit.disabled).toBe(false);
  });

  it('success path: POST derived periodFrom/periodTo for the chosen month, closes and resets', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ManualCalcForm));

    fireEvent.click(screen.getByText('Сформировать за период'));
    const dialog = await screen.findByRole('dialog', { name: 'Расчёт комиссии' });
    const monthInput = document.getElementById('manual-calc-month') as HTMLInputElement;
    fireEvent.change(monthInput, { target: { value: '2026-03' } });
    fireEvent.submit(dialog.querySelector('form')!);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/finance/statements',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.periodFrom).toBe(new Date(2026, 2, 1).toISOString());
    expect(body.periodTo).toBe(new Date(2026, 3, 0, 23, 59, 59, 999).toISOString());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Расчёт комиссии' })).toBeNull());
  });

  it('error path: shows the error message and keeps the dialog open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'boom' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ManualCalcForm));

    fireEvent.click(screen.getByText('Сформировать за период'));
    const dialog = await screen.findByRole('dialog', { name: 'Расчёт комиссии' });
    const monthInput = document.getElementById('manual-calc-month') as HTMLInputElement;
    fireEvent.change(monthInput, { target: { value: '2026-03' } });
    fireEvent.submit(dialog.querySelector('form')!);

    expect(await within(dialog).findByText('Ошибка: boom')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('"Отмена" closes the dialog and resets the month field', async () => {
    render(React.createElement(ManualCalcForm));
    fireEvent.click(screen.getByText('Сформировать за период'));
    const dialog = await screen.findByRole('dialog', { name: 'Расчёт комиссии' });
    const monthInput = document.getElementById('manual-calc-month') as HTMLInputElement;
    fireEvent.change(monthInput, { target: { value: '2026-03' } });
    fireEvent.click(within(dialog).getByText('Отмена'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Расчёт комиссии' })).toBeNull());

    fireEvent.click(screen.getByText('Сформировать за период'));
    const reopened = await screen.findByRole('dialog', { name: 'Расчёт комиссии' });
    expect((document.getElementById('manual-calc-month') as HTMLInputElement).value).toBe('');
    void reopened;
  });
});
