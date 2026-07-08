// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe('LoginPage', () => {
  const ORIGINAL_ENV = process.env.SHOW_DEMO_LOGINS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.SHOW_DEMO_LOGINS;
    else process.env.SHOW_DEMO_LOGINS = ORIGINAL_ENV;
  });

  it('renders without demo logins when SHOW_DEMO_LOGINS is unset', async () => {
    delete process.env.SHOW_DEMO_LOGINS;
    const { default: LoginPage } = await import('@/app/(auth)/login/page');
    const { container } = await renderServerComponent(React.createElement(LoginPage));

    expect(container.textContent).toContain('Промтехносфера');
    expect(container.textContent).not.toContain('Админ');
  });

  it('renders demo logins when SHOW_DEMO_LOGINS=1', async () => {
    process.env.SHOW_DEMO_LOGINS = '1';
    const { default: LoginPage } = await import('@/app/(auth)/login/page');
    const { container } = await renderServerComponent(React.createElement(LoginPage));

    expect(container.textContent).toContain('Партнёр (админ)');
  });

  it('treats an unrecognized SHOW_DEMO_LOGINS value as disabled', async () => {
    process.env.SHOW_DEMO_LOGINS = 'nope';
    const { default: LoginPage } = await import('@/app/(auth)/login/page');
    const { container } = await renderServerComponent(React.createElement(LoginPage));

    expect(container.textContent).not.toContain('Студент');
  });
});
