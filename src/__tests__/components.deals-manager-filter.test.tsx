// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

/**
 * Ф1 программы погашения долга покрытия (spec 2026-07-30-coverage-debt-design.md):
 * файл был на 0% — ни один тест его не исполнял. Гармошка та же, что у
 * `calls-org-filter` (компонент — его клон).
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { DealsManagerFilter } from '@/components/deals/deals-manager-filter';

const MANAGERS = [
  { id: 'm-1', name: 'Иванов И.' },
  { id: 'm-2', name: 'Петрова А.' },
];

function getSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector('select');
  if (!select) throw new Error('select не найден');
  return select;
}

describe('DealsManagerFilter', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('рендерит «Все менеджеры» + имена; без managerId выбрана пустая опция', () => {
    const { container } = render(<DealsManagerFilter managers={MANAGERS} />);
    const select = getSelect(container);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Все менеджеры',
      'Иванов И.',
      'Петрова А.',
    ]);
    expect(select.value).toBe('');
    expect(push).not.toHaveBeenCalled();
  });

  it('managerId из searchParams выбирает соответствующую опцию', () => {
    const { container } = render(<DealsManagerFilter managers={MANAGERS} managerId="m-2" />);
    expect(getSelect(container).value).toBe('m-2');
  });

  it('выбор менеджера пушит /leader/deals?manager=<id>', () => {
    const { container } = render(<DealsManagerFilter managers={MANAGERS} />);
    fireEvent.change(getSelect(container), { target: { value: 'm-1' } });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/leader/deals?manager=m-1');
  });

  it('«Все менеджеры» пушит чистый /leader/deals (без пустого query)', () => {
    const { container } = render(<DealsManagerFilter managers={MANAGERS} managerId="m-1" />);
    fireEvent.change(getSelect(container), { target: { value: '' } });
    expect(push).toHaveBeenCalledWith('/leader/deals');
  });

  it('пустой список менеджеров — только опция «Все менеджеры», без падения', () => {
    const { container } = render(<DealsManagerFilter managers={[]} />);
    expect(Array.from(getSelect(container).options).map((o) => o.textContent)).toEqual([
      'Все менеджеры',
    ]);
  });
});
