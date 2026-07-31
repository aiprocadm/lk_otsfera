// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

function inputValue(el: HTMLElement): string {
  return (el as HTMLInputElement).value;
}
import React from 'react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ replace })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

import { useSearchParams } from 'next/navigation';
import { OrgOrdersFilter } from '@/components/organization/org-orders-filter';

function sp(init?: Record<string, string>): ReturnType<typeof useSearchParams> {
  return new URLSearchParams(init) as unknown as ReturnType<typeof useSearchParams>;
}

describe('OrgOrdersFilter', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(useSearchParams).mockReturnValue(sp());
  });

  it('initializes fields from the current search params and hides Сбросить when no filter is active', () => {
    render(React.createElement(OrgOrdersFilter));
    expect(inputValue(screen.getByPlaceholderText('Поиск по названию или номеру заказа…'))).toBe(
      ''
    );
    expect(screen.queryByText('Сбросить')).toBeNull();
  });

  it('initializes from non-empty search/execution/financial params and shows Сбросить', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      sp({ search: 'abc', execution: 'in_progress', financial: 'billed' })
    );
    render(React.createElement(OrgOrdersFilter));
    expect(inputValue(screen.getByPlaceholderText('Поиск по названию или номеру заказа…'))).toBe(
      'abc'
    );
    expect(screen.getByText('Сбросить')).toBeTruthy();
  });

  it('typing then pressing Enter applies the search filter (no org param)', () => {
    render(React.createElement(OrgOrdersFilter));
    const input = screen.getByPlaceholderText('Поиск по названию или номеру заказа…');
    fireEvent.change(input, { target: { value: 'заказ 5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(replace).toHaveBeenCalledWith(
      '/organization/orders?search=%D0%B7%D0%B0%D0%BA%D0%B0%D0%B7+5'
    );
  });

  it('pressing a non-Enter key does not apply', () => {
    render(React.createElement(OrgOrdersFilter));
    const input = screen.getByPlaceholderText('Поиск по названию или номеру заказа…');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'a' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('changing the execution select applies immediately and preserves the org param', () => {
    vi.mocked(useSearchParams).mockReturnValue(sp({ org: 'org1' }));
    render(React.createElement(OrgOrdersFilter));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'completed' } });
    expect(replace).toHaveBeenCalledWith('/organization/orders?org=org1&execution=completed');
  });

  it('changing the financial select applies immediately', () => {
    render(React.createElement(OrgOrdersFilter));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'paid' } });
    expect(replace).toHaveBeenCalledWith('/organization/orders?financial=paid');
  });

  it('clicking Найти applies the current field values', () => {
    render(React.createElement(OrgOrdersFilter));
    const input = screen.getByPlaceholderText('Поиск по названию или номеру заказа…');
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.click(screen.getByText('Найти'));
    expect(replace).toHaveBeenCalledWith('/organization/orders?search=zzz');
  });

  it('clicking Сбросить clears all fields and navigates without org param', () => {
    vi.mocked(useSearchParams).mockReturnValue(sp({ search: 'abc' }));
    render(React.createElement(OrgOrdersFilter));
    fireEvent.click(screen.getByText('Сбросить'));
    expect(replace).toHaveBeenCalledWith('/organization/orders');
    expect(inputValue(screen.getByPlaceholderText('Поиск по названию или номеру заказа…'))).toBe(
      ''
    );
  });

  it('clicking Сбросить with an org param present preserves it in the reset URL', () => {
    vi.mocked(useSearchParams).mockReturnValue(sp({ search: 'abc', org: 'org9' }));
    render(React.createElement(OrgOrdersFilter));
    fireEvent.click(screen.getByText('Сбросить'));
    expect(replace).toHaveBeenCalledWith('/organization/orders?org=org9');
  });
});
