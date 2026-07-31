// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { AddCommentForm } from '@/components/partner/add-comment-form';

describe('AddCommentForm (SSR structure)', () => {
  it('renders a textarea and a disabled submit button when empty', () => {
    render(React.createElement(AddCommentForm, { orderId: 'o1' }));
    expect(screen.getByPlaceholderText('Написать комментарий…')).toBeTruthy();
    const button = screen.getByText('Отправить') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe('AddCommentForm (interactive, jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it('typing enables the submit button and updates the char counter', () => {
    render(React.createElement(AddCommentForm, { orderId: 'o1' }));
    const textarea = screen.getByPlaceholderText('Написать комментарий…');
    fireEvent.change(textarea, { target: { value: 'Привет' } });
    expect(screen.getByText('6/5000')).toBeTruthy();
    const button = screen.getByText('Отправить') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('whitespace-only text keeps the submit button disabled', () => {
    render(React.createElement(AddCommentForm, { orderId: 'o1' }));
    const textarea = screen.getByPlaceholderText('Написать комментарий…');
    fireEvent.change(textarea, { target: { value: '   ' } });
    const button = screen.getByText('Отправить') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('success path: submitting POSTs the trimmed body, clears the field, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(AddCommentForm, { orderId: 'o1' }));
    const textarea = screen.getByPlaceholderText('Написать комментарий…');
    fireEvent.change(textarea, { target: { value: '  Привет мир  ' } });
    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orderId: 'o1', body: 'Привет мир' }),
      })
    );
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Написать комментарий…') as HTMLTextAreaElement).value
      ).toBe('')
    );
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('error path: renders the mapped error alert and does not clear the field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'validation' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(AddCommentForm, { orderId: 'o1' }));
    const textarea = screen.getByPlaceholderText('Написать комментарий…');
    fireEvent.change(textarea, { target: { value: 'Текст' } });
    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(screen.getByText('Проверьте поля формы.')).toBeTruthy());
    expect(
      (screen.getByPlaceholderText('Написать комментарий…') as HTMLTextAreaElement).value
    ).toBe('Текст');
    vi.unstubAllGlobals();
  });
});
