// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { CounterpartiesPreview } from '@/components/import/counterparties-preview';
import type { NewCounterparty } from '@/lib/services/import/oneCAccountCard/new-counterparties';

function cp(over: Partial<NewCounterparty> = {}): NewCounterparty {
  return {
    key: 'РОМАШКА',
    name: 'ООО «Ромашка»',
    inn: null,
    innSource: null,
    rows: 2,
    ...over,
  };
}

const list: NewCounterparty[] = [
  cp({ key: 'АЛЬФА', name: 'ООО «Альфа»', inn: '7707083893', innSource: 'file', rows: 1 }),
  cp({
    key: 'БЕТА',
    name: 'Бета',
    inn: '7736207543',
    innSource: 'dadata',
    egrulName: 'ООО «Бета-Трейд»',
    rows: 3,
  }),
  cp(),
];

// `У-87`: до применения человек видит, кого именно заведёт импорт, и может
// вмешаться — снять галочку или вписать ИНН руками.
describe('CounterpartiesPreview (У-87)', () => {
  it('делит кандидатов на три группы с понятными заголовками', () => {
    render(<CounterpartiesPreview list={list} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/Будет создано организаций: 3/)).toBeTruthy();
    expect(screen.getByTestId('cp-group-file').textContent).toContain('ООО «Альфа»');
    expect(screen.getByTestId('cp-group-dadata').textContent).toContain('Бета');
    expect(screen.getByTestId('cp-group-none').textContent).toContain('ООО «Ромашка»');
  });

  it('у найденного через ЕГРЮЛ показывает название из реестра рядом с названием из файла', () => {
    render(<CounterpartiesPreview list={list} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId('cp-group-dadata').textContent).toContain('ООО «Бета-Трейд»');
  });

  it('снятая галочка уходит наверх правкой create: false', () => {
    const onChange = vi.fn();
    render(<CounterpartiesPreview list={list} overrides={[]} onChange={onChange} />);
    fireEvent.click(within(screen.getByTestId('cp-row-РОМАШКА')).getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith([{ key: 'РОМАШКА', create: false }]);
  });

  it('вписанный ИНН уходит наверх правкой inn', () => {
    const onChange = vi.fn();
    render(<CounterpartiesPreview list={list} overrides={[]} onChange={onChange} />);
    const input = within(screen.getByTestId('cp-row-РОМАШКА')).getByRole('textbox');
    fireEvent.change(input, { target: { value: '7707083893' } });
    expect(onChange).toHaveBeenCalledWith([{ key: 'РОМАШКА', inn: '7707083893' }]);
  });

  it('негодный ИНН помечается прямо в строке — до применения, а не после', () => {
    render(
      <CounterpartiesPreview
        list={list}
        overrides={[{ key: 'РОМАШКА', inn: '123' }]}
        onChange={vi.fn()}
      />
    );
    expect(within(screen.getByTestId('cp-row-РОМАШКА')).getByRole('alert').textContent).toContain(
      'ИНН'
    );
  });

  it('снятый кандидат виден как исключённый и не считается в заголовке', () => {
    render(
      <CounterpartiesPreview
        list={list}
        overrides={[{ key: 'РОМАШКА', create: false }]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/Будет создано организаций: 2/)).toBeTruthy();
  });

  it('пустой список — блока нет', () => {
    const { container } = render(
      <CounterpartiesPreview list={[]} overrides={[]} onChange={vi.fn()} />
    );
    expect(container.textContent).toBe('');
  });
});
