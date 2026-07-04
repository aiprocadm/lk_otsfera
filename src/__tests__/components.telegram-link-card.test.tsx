import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';

// Classic JSX transform: must import React explicitly (vitest.config has no react plugin)
// Mock next/navigation so useRouter() doesn't crash in SSR
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe('TelegramLinkCard (SSR structural, Pattern P)', () => {
  it('disabled: показывает мутное сообщение об отсутствии настройки', () => {
    const html = renderToString(
      React.createElement(TelegramLinkCard, { status: { linked: false, enabled: false } })
    );
    expect(html).toContain('Telegram-уведомления пока не настроены администратором.');
  });

  it('enabled + !linked: показывает кнопку «Привязать Telegram»', () => {
    const html = renderToString(
      React.createElement(TelegramLinkCard, { status: { linked: false, enabled: true } })
    );
    expect(html).toContain('Привязать Telegram');
    expect(html).not.toContain('Telegram привязан');
    expect(html).not.toContain('Отвязать');
  });

  it('enabled + linked: показывает Badge «Telegram привязан» и кнопку «Отвязать»', () => {
    const html = renderToString(
      React.createElement(TelegramLinkCard, { status: { linked: true, enabled: true } })
    );
    expect(html).toContain('Telegram привязан');
    expect(html).toContain('Отвязать');
    expect(html).not.toContain('Привязать Telegram');
  });
});
