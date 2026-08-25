// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { PageHeader } from '@/components/ui/page-header';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/**
 * `У-120`: шапка экрана — один компонент. До него заголовок, подзаголовок,
 * крошки и главная кнопка собирались на каждой странице руками и расходились:
 * заголовок был то `font-bold`, то `font-semibold`, кнопка вставала то справа,
 * то под заголовком.
 */
describe('шапка экрана (У-120)', () => {
  it('отвечает на три вопроса §15: где я, что здесь делают, что дальше', () => {
    const { container } = render(
      <PageHeader
        breadcrumbs={[
          { label: 'Заказы', href: '/manager/orders' },
          { label: 'Заказ № 1', href: null },
        ]}
        title="Заказ № 1"
        subtitle="Обучение по электробезопасности"
        action={<button type="button">Создать</button>}
      />
    );

    // «Где я» — крошки и заголовок.
    expect(container.querySelector('nav[aria-label="Хлебные крошки"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Заказ № 1');
    // «Что здесь делают» — подзаголовок.
    expect(container.textContent).toContain('Обучение по электробезопасности');
    // «Что дальше» — главная кнопка.
    expect(container.querySelector('button')?.textContent).toBe('Создать');
  });

  it('заголовок один и тот же во всех кабинетах — стиль в компоненте, не на странице', () => {
    const { container } = render(<PageHeader title="Заказы" subtitle="Список" />);
    const h1 = container.querySelector('h1');
    expect(h1?.getAttribute('class')).toBe('text-2xl font-semibold text-[#111111]');
  });

  it('без крошек и кнопки рисуется только заголовок с подзаголовком', () => {
    const { container } = render(<PageHeader title="Заказы" subtitle="Список" />);
    expect(container.querySelector('nav')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('пустой список крошек не рисует пустую полоску', () => {
    const { container } = render(<PageHeader title="Заказы" subtitle="Список" breadcrumbs={[]} />);
    expect(container.querySelector('nav')).toBeNull();
  });

  it('`subtitle={null}` — осознанный отказ карточки сущности, абзаца нет', () => {
    const { container } = render(<PageHeader title="Заказ № 1" subtitle={null} />);
    expect(container.querySelector('h1')?.textContent).toBe('Заказ № 1');
    expect(container.querySelector('p')).toBeNull();
  });

  it('заголовок принимает разметку — имя и значок статуса рядом', () => {
    const { container } = render(
      <PageHeader
        title={
          <span>
            ООО Ромашка <em data-testid="badge">В архиве</em>
          </span>
        }
        subtitle="Клиент"
      />
    );
    expect(container.querySelector('h1')?.textContent).toContain('ООО Ромашка');
    expect(container.querySelector('[data-testid="badge"]')).not.toBeNull();
  });
});
