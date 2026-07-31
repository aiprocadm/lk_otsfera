// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

import { RetryAllButton } from '@/components/admin/retry-all-button';

describe('RetryAllButton', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders "Повторить все" and posts to the encoded retry-all URL on click', async () => {
    let resolveFetch!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryAllButton, { queue: 'docs/scan' }));
    const button = screen.getByRole('button', { name: 'Повторить все' });
    fireEvent.click(button);

    expect(await screen.findByRole('button', { name: 'Повтор…' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Повтор…' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    resolveFetch({ ok: true, json: () => Promise.resolve({ retried: 12 }) });
    await waitFor(() => expect(screen.getByText('Повторно: 12')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/dlq/docs%2Fscan/retry-all', {
      method: 'POST',
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('appends the truncated note when body.truncated is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ retried: 500, truncated: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryAllButton, { queue: 'emails.send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить все' }));

    expect(await screen.findByText('Повторно: 500 (обрезано до 500)')).toBeTruthy();
  });

  it('defaults the retried count to 0 when body.retried is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryAllButton, { queue: 'emails.send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить все' }));

    expect(await screen.findByText('Повторно: 0')).toBeTruthy();
  });

  it('shows the error message from the response body on a non-ok response, without refreshing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'boom' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryAllButton, { queue: 'emails.send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить все' }));

    expect(await screen.findByText('boom')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('falls back to "HTTP <status>" when the error body has no string error field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryAllButton, { queue: 'emails.send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить все' }));

    expect(await screen.findByText('HTTP 503')).toBeTruthy();
  });

  it('shows the Error message on a network rejection', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryAllButton, { queue: 'emails.send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить все' }));

    expect(await screen.findByText('network down')).toBeTruthy();
  });

  it('shows the generic "Ошибка" fallback when a non-Error is thrown', async () => {
    const fetchMock = vi.fn().mockRejectedValue('some string rejection');
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryAllButton, { queue: 'emails.send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить все' }));

    expect(await screen.findByText('Ошибка')).toBeTruthy();
  });
});
