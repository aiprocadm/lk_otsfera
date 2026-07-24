// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Этап 4 (ФТ-10.3): страница читает назначение токена через peekTokenPurpose —
// мокаем и его, и prisma-синглтон, чтобы тест не трогал БД.
const { peekTokenPurpose } = vi.hoisted(() => ({ peekTokenPurpose: vi.fn() }));
vi.mock('@/lib/auth/passwordReset', () => ({ peekTokenPurpose }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import ResetPasswordPage from '@/app/(auth)/reset-password/page';

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    peekTokenPurpose.mockReset();
  });

  it('renders the forgot-password request form when token is missing (peek не вызывается)', async () => {
    const { container } = await renderServerComponent(
      ResetPasswordPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('Восстановление пароля');
    expect(container.querySelector('form')).toBeTruthy();
    expect(container.querySelector('input[type="email"]')).toBeTruthy();
    const backLink = container.querySelector('a[href="/login"]');
    expect(backLink).toBeTruthy();
    expect(backLink!.textContent).toContain('Вернуться на страницу входа');
    expect(peekTokenPurpose).not.toHaveBeenCalled();
  });

  it('валидный invite-токен → заголовок «Добро пожаловать!» и текст про созданный аккаунт', async () => {
    peekTokenPurpose.mockResolvedValue({ valid: true, purpose: 'invite' });

    const { container } = await renderServerComponent(
      ResetPasswordPage({ searchParams: Promise.resolve({ token: 'tok-invite' }) })
    );

    expect(peekTokenPurpose).toHaveBeenCalledWith(expect.anything(), 'tok-invite');
    expect(container.textContent).toContain('Добро пожаловать!');
    expect(container.textContent).toContain('Аккаунт создан для вас');
    expect(container.textContent).not.toContain('Установка пароля');
    // Форма установки пароля рендерится в обеих ветках.
    expect(container.querySelector('form')).toBeTruthy();
  });

  it('валидный reset-токен → нейтральный заголовок «Установка пароля»', async () => {
    peekTokenPurpose.mockResolvedValue({ valid: true, purpose: 'reset' });

    const { container } = await renderServerComponent(
      ResetPasswordPage({ searchParams: Promise.resolve({ token: 'tok-reset' }) })
    );

    expect(container.textContent).toContain('Установка пароля');
    expect(container.textContent).not.toContain('Добро пожаловать!');
    expect(container.querySelector('form')).toBeTruthy();
  });

  it('невалидный/просроченный токен → «Установка пароля» (точную ошибку выдаст confirm-роут)', async () => {
    peekTokenPurpose.mockResolvedValue({ valid: false, purpose: null });

    const { container } = await renderServerComponent(
      ResetPasswordPage({ searchParams: Promise.resolve({ token: 'tok-dead' }) })
    );

    expect(container.textContent).toContain('Установка пароля');
    expect(container.textContent).not.toContain('Добро пожаловать!');
    expect(container.querySelector('form')).toBeTruthy();
  });
});
