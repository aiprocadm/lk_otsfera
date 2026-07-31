// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

import { RetryButton } from '@/components/admin/retry-button';

describe('RetryButton', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the "Повторить" label and posts to the correct encoded URL on click', async () => {
    let resolveFetch!: (value: { ok: boolean }) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryButton, { queue: 'docs.scanDocument', jobId: 'job/1' }));
    const button = screen.getByRole('button', { name: 'Повторить' });
    fireEvent.click(button);

    expect(await screen.findByRole('button', { name: 'Повтор…' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Повтор…' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    resolveFetch({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/dlq/docs.scanDocument/job%2F1/retry', {
      method: 'POST',
    });
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('shows the error message from the response body on a non-ok response, without refreshing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'boom' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryButton, { queue: 'emails.send', jobId: 'j1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

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

    render(React.createElement(RetryButton, { queue: 'emails.send', jobId: 'j2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('HTTP 503')).toBeTruthy();
  });

  it('falls back to "HTTP <status>" when json() parsing itself rejects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('bad json')),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryButton, { queue: 'emails.send', jobId: 'j3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('HTTP 502')).toBeTruthy();
  });

  it('shows the Error message on a network rejection', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryButton, { queue: 'emails.send', jobId: 'j4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('network down')).toBeTruthy();
  });

  it('shows the generic "Retry failed" fallback when a non-Error is thrown', async () => {
    const fetchMock = vi.fn().mockRejectedValue('some string rejection');
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(RetryButton, { queue: 'emails.send', jobId: 'j5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Retry failed')).toBeTruthy();
  });
});
