/**
 * Общий каркас кабинета (`У-11`, этап 2): шапка, сайдбар, контент.
 *
 * Проверяется именно то, что раньше дублировалось в пяти шеллах: светлая и
 * тёмная шапка, слоты шапки, нижняя панель и отступ под неё.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { AppShell } from '@/components/shell/app-shell';

function render(props?: { theme?: 'light' | 'dark'; mobileNav?: React.ReactNode }) {
  return renderToString(
    <AppShell
      sidebar={<nav>САЙДБАР</nav>}
      headerLeft={<span>СЛЕВА</span>}
      headerRight={<span>СПРАВА</span>}
      {...props}
    >
      <p>КОНТЕНТ</p>
    </AppShell>
  );
}

describe('AppShell (общий каркас)', () => {
  it('рендерит сайдбар, обе части шапки и контент', () => {
    const html = render();
    expect(html).toContain('САЙДБАР');
    expect(html).toContain('СЛЕВА');
    expect(html).toContain('СПРАВА');
    expect(html).toContain('КОНТЕНТ');
  });

  it('по умолчанию шапка светлая', () => {
    const html = render();
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('bg-white border-b border-gray-200');
  });

  it('theme=dark даёт тёмную шапку кабинета партнёра и слушателя', () => {
    const html = render({ theme: 'dark' });
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('bg-[#111111]');
  });

  // У-17 (этап 3): отступ под нижнюю панель — в шелле и только здесь. Панель
  // теперь во всех шести кабинетах, поэтому условие «если панель передана» ушло.
  it('отступ под нижнюю панель применяется один раз и всегда', () => {
    const html = render();
    expect(html).toContain('pb-16 md:pb-0');
    expect(html.match(/pb-16/g)).toHaveLength(1);
  });

  it('мобильная навигация монтируется в шапку', () => {
    const html = render({ mobileNav: <button type="button">БУРГЕР</button> });
    expect(html).toContain('БУРГЕР');
  });

  it('контент ограничен по ширине — одинаково во всех кабинетах', () => {
    expect(render()).toContain('max-w-[1280px]');
  });
});
