// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import ResetPasswordPage from '@/app/(auth)/reset-password/page';

describe('ResetPasswordPage', () => {
  it('renders the forgot-password request form when token is missing', async () => {
    const { container } = await renderServerComponent(
      ResetPasswordPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('Восстановление пароля');
    expect(container.querySelector('form')).toBeTruthy();
    expect(container.querySelector('input[type="email"]')).toBeTruthy();
    const backLink = container.querySelector('a[href="/login"]');
    expect(backLink).toBeTruthy();
    expect(backLink!.textContent).toContain('Вернуться на страницу входа');
  });

  it('renders the ResetPasswordForm when a token is present', async () => {
    const { container } = await renderServerComponent(
      ResetPasswordPage({ searchParams: Promise.resolve({ token: 'tok-123' }) })
    );

    expect(container.textContent).toContain('Установка пароля');
    expect(container.querySelector('form')).toBeTruthy();
  });
});
