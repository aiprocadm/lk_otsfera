// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { MarkPaidForm } from '@/components/admin/mark-paid-form';

describe('MarkPaidForm', () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status=paid renders the "already paid" notice and no button', () => {
    render(React.createElement(MarkPaidForm, { statementId: 's1', status: 'paid' }));
    expect(screen.getByText('Уже отмечен как выплачен.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('status other than approved/paid renders the "unavailable" notice with the status interpolated', () => {
    render(React.createElement(MarkPaidForm, { statementId: 's1', status: 'draft' }));
    expect(screen.getByText('Доступно только для статуса approved (сейчас: draft).')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('status=approved renders the trigger button; clicking opens the confirm panel', () => {
    render(React.createElement(MarkPaidForm, { statementId: 's1', status: 'approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отметить как выплачено' }));
    expect(screen.getByText(/Подтвердите, что комиссия/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Да, отметить выплаченным' })).toBeTruthy();
  });

  it('"Отмена" collapses the panel back and clears any error', () => {
    render(React.createElement(MarkPaidForm, { statementId: 's1', status: 'approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отметить как выплачено' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByText(/Подтвердите, что комиссия/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Отметить как выплачено' })).toBeTruthy();
  });

  it('success path: PATCH ok -> closes panel and router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(MarkPaidForm, { statementId: 'st-42', status: 'approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отметить как выплачено' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, отметить выплаченным' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/partner/finance/statements/st-42', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'markPaid' }),
    });
    expect(screen.queryByText(/Подтвердите, что комиссия/)).toBeNull();
  });

  it('error path: non-ok response with json body renders the error message text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'lifecycle_violation' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(MarkPaidForm, { statementId: 's1', status: 'approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отметить как выплачено' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, отметить выплаченным' }));

    await waitFor(() => expect(screen.getByText('Недопустимый переход статуса.')).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('error path: json() parse failure falls back to "Ошибка <status>"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('bad json')),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(MarkPaidForm, { statementId: 's1', status: 'approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отметить как выплачено' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, отметить выплаченным' }));

    await waitFor(() => expect(screen.getByText('Ошибка 500')).toBeTruthy());
  });

  it('busy state disables both buttons while pending', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(MarkPaidForm, { statementId: 's1', status: 'approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отметить как выплачено' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, отметить выплаченным' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Отмечаю…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Отмечаю…' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((screen.getByRole('button', { name: 'Отмена' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    resolvePromise({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
