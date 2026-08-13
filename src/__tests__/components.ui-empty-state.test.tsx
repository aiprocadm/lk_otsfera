import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';

describe('EmptyState', () => {
  it('renders message inside the standard card', () => {
    const html = renderToString(React.createElement(EmptyState, { message: 'Заявок пока нет' }));
    expect(html).toContain('Заявок пока нет');
    expect(html).toContain('rounded-xl');
    expect(html).toContain('p-12');
    expect(html).toContain('text-center');
  });

  it('renders emoji circle only when icon is provided', () => {
    const withIcon = renderToString(
      React.createElement(EmptyState, { icon: '✚', message: 'Пусто' })
    );
    expect(withIcon).toContain('✚');
    expect(withIcon).toContain('rounded-full');
    const withoutIcon = renderToString(React.createElement(EmptyState, { message: 'Пусто' }));
    expect(withoutIcon).not.toContain('rounded-full');
  });

  it('merges caller className over defaults (p-8 beats p-12)', () => {
    const html = renderToString(
      React.createElement(EmptyState, { message: 'Пусто', className: 'p-8' })
    );
    expect(html).toContain('p-8');
    expect(html).not.toContain('p-12');
  });

  it('renders children after the message (CTA slot)', () => {
    const html = renderToString(
      React.createElement(
        EmptyState,
        { message: 'Пусто' },
        React.createElement('a', { href: '/x' }, 'Создать')
      )
    );
    expect(html).toContain('Создать');
  });

  it('У-74: по умолчанию есть заголовок «Здесь пока пусто»', () => {
    const html = renderToString(<EmptyState message="Заявок ещё не было." />);
    expect(html).toContain('Здесь пока пусто');
    expect(html).toContain('Заявок ещё не было.');
  });

  it('У-74: главное действие показывается отдельным блоком', () => {
    const html = renderToString(
      <EmptyState message="Заявок ещё не было." action={<a href="/x">Подать заявку</a>} />
    );
    expect(html).toContain('Подать заявку');
    expect(html).toContain('href="/x"');
  });

  it('заголовок переопределяется — «пусто» не всегда проблема', () => {
    // Например «Всё разобрано»: очередь пуста, и это хорошая новость.
    const html = renderToString(<EmptyState title="Всё разобрано" message="Новых строк нет." />);
    expect(html).toContain('Всё разобрано');
    expect(html).not.toContain('Здесь пока пусто');
  });
});
