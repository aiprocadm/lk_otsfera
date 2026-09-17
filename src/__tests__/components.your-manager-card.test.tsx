import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/support/ask-question-button', () => ({
  AskQuestionButton: () => React.createElement('button', { 'data-testid': 'ask' }, 'Задать вопрос'),
}));

import { YourManagerCard } from '@/components/dashboard/your-manager-card';

/** Блок «Ваш менеджер» (`У-240`): три вопроса, имя и e-mail, «и ещё N», кнопка «Написать». */

describe('YourManagerCard', () => {
  it('имя, e-mail ссылкой, «и ещё N» и ссылка «Написать»', () => {
    const html = renderToStaticMarkup(
      <YourManagerCard
        view={{ manager: { name: 'Анна Иванова', email: 'a@uc.ru' }, othersCount: 2 }}
        writeHref="/organization/messages?tab=manager"
      />
    );
    expect(html).toContain('Ваш менеджер');
    expect(html).toContain('Кто ведёт ваши заказы');
    expect(html).toContain('Анна Иванова');
    expect(html).toContain('href="mailto:a@uc.ru"');
    expect(html).toContain('и ещё 2');
    expect(html).toContain('href="/organization/messages?tab=manager"');
    expect(html).toContain('Написать');
    expect(html).not.toContain('data-testid="ask"');
  });

  it('без адреса переписки — кнопка «Задать вопрос» (до У-234)', () => {
    const html = renderToStaticMarkup(
      <YourManagerCard view={{ manager: { name: 'Анна', email: 'a@uc.ru' }, othersCount: 0 }} />
    );
    expect(html).toContain('data-testid="ask"');
    expect(html).not.toContain('и ещё');
  });

  it('менеджера нет — объяснение и та же кнопка', () => {
    const html = renderToStaticMarkup(
      <YourManagerCard view={{ manager: null, othersCount: 0 }} writeHref="/partner/messages" />
    );
    expect(html).toContain('Менеджер назначается');
    expect(html).toContain('href="/partner/messages"');
  });
});
