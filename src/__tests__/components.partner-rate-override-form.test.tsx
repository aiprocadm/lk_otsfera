// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { RateOverrideForm } from '@/components/partner/rate-override-form';

describe('RateOverrideForm', () => {
  beforeEach(() => {
    refresh.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes the rate field from initialRate (as a percentage) and the reason from initialNote', () => {
    render(
      React.createElement(RateOverrideForm, {
        orgId: 'o1',
        initialRate: '0.085',
        initialNote: 'VIP',
      })
    );
    expect((screen.getByPlaceholderText('напр. 8.00') as HTMLInputElement).value).toBe('8.50');
    expect(screen.getByDisplayValue('VIP')).toBeTruthy();
  });

  it('renders an empty rate/reason when initialRate and initialNote are null, and hides the "clear" button', () => {
    render(
      React.createElement(RateOverrideForm, { orgId: 'o1', initialRate: null, initialNote: null })
    );
    expect((screen.getByPlaceholderText('напр. 8.00') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Вернуть базовую ставку')).toBeNull();
  });

  it('shows the "clear" button when initialRate is not null', () => {
    render(
      React.createElement(RateOverrideForm, { orgId: 'o1', initialRate: '0.1', initialNote: null })
    );
    expect(screen.getByText('Вернуть базовую ставку')).toBeTruthy();
  });

  it('"Сохранить" is disabled until both rate and reason are filled', () => {
    render(
      React.createElement(RateOverrideForm, { orgId: 'o1', initialRate: null, initialNote: null })
    );
    const save = screen.getByText('Сохранить') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '5' } });
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'Причина' },
    });
    expect(save.disabled).toBe(false);
  });

  it('"Сохранить" success path: PUT rate/100 + reason, then router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(RateOverrideForm, { orgId: 'o1', initialRate: null, initialNote: null })
    );

    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '8.5' } });
    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'VIP' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/portfolio/o1/rate',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ rate: 0.085, reason: 'VIP' }),
      })
    );
  });

  it('"Сохранить" error path (JSON error body): shows the error message and does not refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'rate_out_of_range' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(RateOverrideForm, { orgId: 'o1', initialRate: null, initialNote: null })
    );

    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '8.5' } });
    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'VIP' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    expect(await screen.findByText('Ставка должна быть в диапазоне (0, 1).')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('"Сохранить" error path (non-JSON body): falls back to a generic error message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('bad json')) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(RateOverrideForm, { orgId: 'o1', initialRate: null, initialNote: null })
    );

    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '8.5' } });
    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'VIP' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    expect(
      await screen.findByText('Не удалось сохранить ставку. Попробуйте ещё раз.')
    ).toBeTruthy();
  });

  it('"Вернуть базовую ставку" (clear): PUT rate=null + trimmed reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(RateOverrideForm, {
        orgId: 'o1',
        initialRate: '0.1',
        initialNote: 'заметка',
      })
    );

    fireEvent.click(screen.getByText('Вернуть базовую ставку'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/portfolio/o1/rate',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ rate: null, reason: 'заметка' }),
      })
    );
  });

  it('"Вернуть базовую ставку" with an empty reason falls back to the default audit note', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(RateOverrideForm, { orgId: 'o1', initialRate: '0.1', initialNote: null })
    );

    fireEvent.click(screen.getByText('Вернуть базовую ставку'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/portfolio/o1/rate',
      expect.objectContaining({
        body: JSON.stringify({ rate: null, reason: 'Возврат к базовой ставке' }),
      })
    );
  });
});
