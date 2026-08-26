// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const { replace, get } = vi.hoisted(() => ({
  replace: vi.fn(),
  get: vi.fn((...args: [string]) => (void args, null) as string | null),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({ get }),
}));

import { PartnerOrdersFilter } from '@/components/partner/orders-filter';

describe('PartnerOrdersFilter', () => {
  beforeEach(() => {
    replace.mockClear();
    get.mockReset();
    get.mockImplementation(() => null);
  });

  it('renders search input, both selects and the Найти button; no reset link when no filter is active', () => {
    render(React.createElement(PartnerOrdersFilter));
    expect(screen.getByPlaceholderText('Поиск по названию или номеру…')).toBeTruthy();
    expect(document.querySelectorAll('select')).toHaveLength(2);
    expect(screen.getByText('Найти')).toBeTruthy();
    expect(screen.queryByText('Сбросить')).toBeNull();
  });

  it('initializes fields from the current search params', () => {
    get.mockImplementation((key: string) =>
      key === 'search' ? 'абв' : key === 'execution' ? 'in_progress' : null
    );
    render(React.createElement(PartnerOrdersFilter));
    expect(
      (screen.getByPlaceholderText('Поиск по названию или номеру…') as HTMLInputElement).value
    ).toBe('абв');
    expect(screen.getByText('Сбросить')).toBeTruthy();
  });

  it('pressing Enter in the search field applies the filter via router.replace', () => {
    render(React.createElement(PartnerOrdersFilter));
    const input = screen.getByPlaceholderText('Поиск по названию или номеру…');
    fireEvent.change(input, { target: { value: 'заказ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(replace).toHaveBeenCalledWith('/partner/orders?search=%D0%B7%D0%B0%D0%BA%D0%B0%D0%B7');
  });

  it('a non-Enter key in the search field does not apply the filter', () => {
    render(React.createElement(PartnerOrdersFilter));
    const input = screen.getByPlaceholderText('Поиск по названию или номеру…');
    fireEvent.keyDown(input, { key: 'a' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('changing the execution select applies immediately', () => {
    render(React.createElement(PartnerOrdersFilter));
    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'completed' } });
    expect(replace).toHaveBeenCalledWith('/partner/orders?execution=completed');
  });

  it('changing the financial select applies immediately', () => {
    render(React.createElement(PartnerOrdersFilter));
    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[1], { target: { value: 'paid' } });
    expect(replace).toHaveBeenCalledWith('/partner/orders?financial=paid');
  });

  it('clicking Найти applies all three current values combined', () => {
    render(React.createElement(PartnerOrdersFilter));
    const input = screen.getByPlaceholderText('Поиск по названию или номеру…');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Найти'));
    expect(replace).toHaveBeenCalledWith('/partner/orders?search=x');
  });

  it('clicking Сбросить clears all fields and navigates to the bare path', () => {
    get.mockImplementation((key: string) => (key === 'search' ? 'абв' : null));
    render(React.createElement(PartnerOrdersFilter));
    fireEvent.click(screen.getByText('Сбросить'));
    expect(replace).toHaveBeenCalledWith('/partner/orders');
    expect(
      (screen.getByPlaceholderText('Поиск по названию или номеру…') as HTMLInputElement).value
    ).toBe('');
  });
});
