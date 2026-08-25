// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, within } from '@testing-library/react';
import { CabinetSwitcher } from '@/components/shell/cabinet-switcher';

const nav = { pathname: '/leader/orders' as string | null };
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

beforeEach(() => {
  nav.pathname = '/leader/orders';
});

/**
 * `У-111`: смена кабинета «играющего тренера» была спрятана в пункты меню с
 * двумя разными названиями. Теперь это один переключатель в шапке.
 */
describe('переключатель кабинетов в шапке (У-111)', () => {
  it('показывает оба кабинета и подсвечивает текущий', () => {
    const { container } = render(<CabinetSwitcher current="leader" />);
    const box = within(container.querySelector('[data-testid="cabinet-switcher"]') as HTMLElement);

    const leader = box.getByTestId('cabinet-switch-leader');
    const manager = box.getByTestId('cabinet-switch-manager');
    expect(leader.textContent).toBe('Руководитель');
    expect(manager.textContent).toBe('Менеджер');
    // Текущий кабинет — не ссылка: нажимать на «здесь» некуда.
    expect(leader.getAttribute('aria-current')).toBe('true');
    expect(leader.tagName).toBe('SPAN');
    expect(manager.tagName).toBe('A');
  });

  it('ведёт в тот же раздел соседнего кабинета, если он там есть', () => {
    const { container } = render(<CabinetSwitcher current="leader" />);
    expect(
      container.querySelector('[data-testid="cabinet-switch-manager"]')?.getAttribute('href')
    ).toBe('/manager/orders');
  });

  it('раздела у соседа нет — ведёт на главную, а не в «не найдено»', () => {
    nav.pathname = '/leader/roles';
    const { container } = render(<CabinetSwitcher current="leader" />);
    expect(
      container.querySelector('[data-testid="cabinet-switch-manager"]')?.getAttribute('href')
    ).toBe('/manager/dashboard');
  });

  it('в кабинете менеджера подсвечен менеджер, а ссылка ведёт к руководителю', () => {
    nav.pathname = '/manager/orders';
    const { container } = render(<CabinetSwitcher current="manager" />);
    expect(
      container
        .querySelector('[data-testid="cabinet-switch-manager"]')
        ?.getAttribute('aria-current')
    ).toBe('true');
    expect(
      container.querySelector('[data-testid="cabinet-switch-leader"]')?.getAttribute('href')
    ).toBe('/leader/orders');
  });

  it('без адреса (первый кадр) переключатель не падает и ведёт на главную', () => {
    nav.pathname = null;
    const { container } = render(<CabinetSwitcher current="leader" />);
    expect(
      container.querySelector('[data-testid="cabinet-switch-manager"]')?.getAttribute('href')
    ).toBe('/manager/dashboard');
  });
});
