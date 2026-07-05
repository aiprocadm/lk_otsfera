// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const { replace, getMock } = vi.hoisted(() => ({
  replace: vi.fn(),
  // Real URLSearchParams#get(key) signature; default stub ignores the key
  // and returns null (no initial "search" param) unless overridden per-test.
  getMock: vi.fn((key: string): string | null => (key === '__never__' ? key : null))
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({
    get: getMock,
    toString: () => ''
  })
}));

import { PortfolioSearch } from '@/components/partner/portfolio-search';

describe('PortfolioSearch', () => {
  beforeEach(() => {
    replace.mockClear();
    getMock.mockReset();
    getMock.mockReturnValue(null);
  });

  it('initializes the input from the current "search" query param', () => {
    getMock.mockImplementation((k: string) => (k === 'search' ? 'Ромашка' : null));
    render(React.createElement(PortfolioSearch));
    expect((screen.getByPlaceholderText('Поиск по названию…') as HTMLInputElement).value).toBe('Ромашка');
  });

  it('defaults to an empty input when there is no "search" param', () => {
    render(React.createElement(PortfolioSearch));
    expect((screen.getByPlaceholderText('Поиск по названию…') as HTMLInputElement).value).toBe('');
  });

  it('clicking "Найти" with a non-empty value navigates with the search param', () => {
    render(React.createElement(PortfolioSearch));
    const input = screen.getByPlaceholderText('Поиск по названию…');
    fireEvent.change(input, { target: { value: 'Иванов' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    expect(replace).toHaveBeenCalledWith('/partner/portfolio?search=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2');
  });

  it('clicking "Найти" with an empty value navigates without the search param', () => {
    render(React.createElement(PortfolioSearch));
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    expect(replace).toHaveBeenCalledWith('/partner/portfolio?');
  });

  it('pressing Enter in the input triggers the same navigation as clicking the button', () => {
    render(React.createElement(PortfolioSearch));
    const input = screen.getByPlaceholderText('Поиск по названию…');
    fireEvent.change(input, { target: { value: 'тест' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(replace).toHaveBeenCalledWith('/partner/portfolio?search=%D1%82%D0%B5%D1%81%D1%82');
  });

  it('pressing a non-Enter key does not trigger navigation', () => {
    render(React.createElement(PortfolioSearch));
    const input = screen.getByPlaceholderText('Поиск по названию…');
    fireEvent.keyDown(input, { key: 'a' });
    expect(replace).not.toHaveBeenCalled();
  });
});
