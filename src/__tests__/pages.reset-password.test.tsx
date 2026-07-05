// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import ResetPasswordPage from '@/app/(auth)/reset-password/page';

describe('ResetPasswordPage', () => {
  it('renders the invalid-link message when token is missing', async () => {
    const { container } = await renderServerComponent(
      ResetPasswordPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('Ссылка недействительна');
    expect(container.textContent).toContain('Вернуться на страницу входа');
  });

  it('renders the ResetPasswordForm when a token is present', async () => {
    const { container } = await renderServerComponent(
      ResetPasswordPage({ searchParams: Promise.resolve({ token: 'tok-123' }) })
    );

    expect(container.textContent).toContain('Установка пароля');
    expect(container.querySelector('form')).toBeTruthy();
  });
});
