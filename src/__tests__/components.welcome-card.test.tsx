// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children)
}));

const { dismissWelcomeAction } = vi.hoisted(() => ({ dismissWelcomeAction: vi.fn() }));
vi.mock('@/server-actions/welcome', () => ({ dismissWelcomeAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { WelcomeCard, type WelcomeAction } from '@/components/welcome/welcome-card';

const actions: WelcomeAction[] = [
  { href: '/partner/orgs', title: 'Добавить организацию', hint: 'Клиенты и их заказы' },
  { href: '/partner/team', title: 'Пригласить команду', hint: 'Коллеги получат письмо' },
  { href: '/partner/enrollments', title: 'Отправить заявку', hint: 'Первая заявка на обучение' }
];

describe('WelcomeCard', () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    dismissWelcomeAction.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('рендерит приветствие с именем', () => {
    render(React.createElement(WelcomeCard, { name: 'Ирина', actions }));
    expect(screen.getByRole('heading', { name: 'Добро пожаловать, Ирина!' })).toBeTruthy();
  });

  it('пустое имя: приветствие без запятой — «Добро пожаловать!»', () => {
    render(React.createElement(WelcomeCard, { name: '', actions }));
    expect(screen.getByRole('heading', { name: 'Добро пожаловать!' })).toBeTruthy();
  });

  it('рендерит карточки-ссылки: href, title и hint каждой', () => {
    render(React.createElement(WelcomeCard, { name: 'Ирина', actions }));
    for (const a of actions) {
      const link = screen.getByRole('link', { name: new RegExp(a.title) }) as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(a.href);
      expect(link.textContent).toContain(a.hint);
    }
  });

  it('без карточек (actions=[]) блок всё равно рендерится с кнопкой «Скрыть»', () => {
    render(React.createElement(WelcomeCard, { name: 'Ирина', actions: [] }));
    expect(screen.getByRole('button', { name: 'Скрыть' })).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('«Скрыть»: зовёт dismissWelcomeAction и router.refresh, кнопка на время busy — «Скрываем…»', async () => {
    let resolve!: (v: { ok: boolean }) => void;
    dismissWelcomeAction.mockReturnValue(new Promise((res) => (resolve = res)));
    render(React.createElement(WelcomeCard, { name: 'Ирина', actions }));

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }));

    const busyBtn = await screen.findByRole('button', { name: 'Скрываем…' });
    expect((busyBtn as HTMLButtonElement).disabled).toBe(true);
    expect(refresh).not.toHaveBeenCalled();

    resolve({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(dismissWelcomeAction).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('сбой action (throw): toast.error, refresh не зовётся, кнопка «Скрыть» снова активна', async () => {
    dismissWelcomeAction.mockRejectedValue(new Error('network'));
    render(React.createElement(WelcomeCard, { name: 'Ирина', actions }));

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось скрыть блок — попробуйте ещё раз')
    );
    expect(refresh).not.toHaveBeenCalled();
    const btn = screen.getByRole('button', { name: 'Скрыть' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('после сбоя повторный клик снова зовёт action (retry работает)', async () => {
    dismissWelcomeAction.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true });
    render(React.createElement(WelcomeCard, { name: 'Ирина', actions }));

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(dismissWelcomeAction).toHaveBeenCalledTimes(2);
  });
});
