// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { issueLoginLinkAction } = vi.hoisted(() => ({ issueLoginLinkAction: vi.fn() }));
vi.mock('@/server-actions/admin/users', () => ({ issueLoginLinkAction }));
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { AdminLoginLinkPanel } from '@/components/admin/admin-login-link-panel';

/** «Вход в кабинет» (`У-271`, `У-272`): последний итог письма и ссылка входа. */
beforeEach(() => vi.clearAllMocks());

describe('AdminLoginLinkPanel', () => {
  it('писем не было — так и сказано; кнопка создаёт ссылку и показывает её', async () => {
    issueLoginLinkAction.mockResolvedValue({
      ok: true,
      url: 'https://lk/reset-password?token=t',
      expiresAt: '2026-10-14T12:00:00Z',
      email: { status: 'sent' },
    });
    render(<AdminLoginLinkPanel userId="u1" isActive lastAttempt={null} />);
    expect(screen.getByText(/ещё не отправляли/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку входа' }));
    await waitFor(() => expect(issueLoginLinkAction).toHaveBeenCalledWith({ userId: 'u1' }));
    const link = (await screen.findByLabelText('Ссылка входа')) as HTMLInputElement;
    expect(link.value).toBe('https://lk/reset-password?token=t');
    expect(screen.getByRole('status').textContent).toContain('письмо отправлено');
  });

  it('письмо не ушло — причина названа, ссылку предлагают передать самому', async () => {
    issueLoginLinkAction.mockResolvedValue({
      ok: true,
      url: 'https://lk/x',
      expiresAt: '2026-10-14T12:00:00Z',
      email: { status: 'not_sent', reason: 'не задан ключ почтового сервиса' },
    });
    render(<AdminLoginLinkPanel userId="u1" isActive lastAttempt={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку входа' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('письмо не отправлено: не задан ключ почтового сервиса');
    expect(status.textContent).toContain('Передайте её сами');
  });

  it('последняя попытка видна: приглашение не ушло — с причиной и датой по Москве', () => {
    render(
      <AdminLoginLinkPanel
        userId="u1"
        isActive
        lastAttempt={{
          at: '2026-10-07T21:00:00Z',
          kind: 'invite',
          outcome: { status: 'not_sent', reason: 'отправка писем выключена' },
        }}
      />
    );
    const line = screen.getByTestId('last-login-email').textContent ?? '';
    expect(line).toContain('Приглашение от 08.10.2026');
    expect(line).toContain('письмо не отправлено: отправка писем выключена');
  });

  it('ссылка входа, ушедшая письмом, подписана своим видом', () => {
    render(
      <AdminLoginLinkPanel
        userId="u1"
        isActive
        lastAttempt={{
          at: '2026-10-14T05:00:00Z',
          kind: 'login_link',
          outcome: { status: 'sent' },
        }}
      />
    );
    expect(screen.getByTestId('last-login-email').textContent).toContain('Ссылка входа от');
  });

  it('отключённому кнопка недоступна, причина объяснена; отказ сервера — по-русски', async () => {
    const { unmount } = render(
      <AdminLoginLinkPanel userId="u1" isActive={false} lastAttempt={null} />
    );
    expect(
      (screen.getByRole('button', { name: 'Создать ссылку входа' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByText(/Пользователь отключён/)).toBeTruthy();
    unmount();

    issueLoginLinkAction.mockResolvedValue({ ok: false, error: 'inactive' });
    render(<AdminLoginLinkPanel userId="u1" isActive lastAttempt={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку входа' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Пользователь отключён — сначала включите его, потом создайте ссылку.'
      )
    );
  });
});
