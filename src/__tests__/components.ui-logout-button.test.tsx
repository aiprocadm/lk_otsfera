import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

import { LogoutButton } from '@/components/ui/logout-button';

describe('LogoutButton', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });

  it('рендерит кнопку с единым текстом «Выйти» (не «Выход»)', () => {
    const html = renderToString(React.createElement(LogoutButton));
    expect(html).toContain('Выйти');
    expect(html).not.toContain('Выход<');
    expect(html).toContain('type="button"');
  });

  it('принимает className для тёмной шапки партнёра', () => {
    const html = renderToString(React.createElement(LogoutButton, { className: 'text-gray-400' }));
    expect(html).toContain('text-gray-400');
  });
});
