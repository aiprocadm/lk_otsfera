// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const { replace, get, toStringMock } = vi.hoisted(() => {
  const toStringMock = vi.fn(() => '');
  return {
    replace: vi.fn(),
    get: vi.fn((...args: [string]) => (void args, null) as string | null),
    toStringMock
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({ get, toString: toStringMock })
}));

import { DocumentsSearch } from '@/components/partner/documents-search';

describe('DocumentsSearch', () => {
  beforeEach(() => {
    replace.mockClear();
    get.mockReset();
    get.mockImplementation(() => null);
    toStringMock.mockReset();
    toStringMock.mockReturnValue('');
  });

  it('renders the search input and Найти button', () => {
    render(React.createElement(DocumentsSearch));
    expect(screen.getByPlaceholderText('Поиск по имени файла…')).toBeTruthy();
    expect(screen.getByText('Найти')).toBeTruthy();
  });

  it('initializes the input value from the current search param', () => {
    get.mockImplementation((key: string) => (key === 'search' ? 'договор' : null));
    render(React.createElement(DocumentsSearch));
    expect((screen.getByPlaceholderText('Поиск по имени файла…') as HTMLInputElement).value).toBe('договор');
  });

  it('pressing Enter applies the search and navigates with the search param set', () => {
    render(React.createElement(DocumentsSearch));
    const input = screen.getByPlaceholderText('Поиск по имени файла…');
    fireEvent.change(input, { target: { value: 'акт' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(replace).toHaveBeenCalledWith('/partner/documents?search=%D0%B0%D0%BA%D1%82');
  });

  it('a non-Enter keydown does not trigger navigation', () => {
    render(React.createElement(DocumentsSearch));
    const input = screen.getByPlaceholderText('Поиск по имени файла…');
    fireEvent.keyDown(input, { key: 'a' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('clicking Найти with an empty value navigates to the bare documents path', () => {
    render(React.createElement(DocumentsSearch));
    fireEvent.click(screen.getByText('Найти'));
    expect(replace).toHaveBeenCalledWith('/partner/documents');
  });

  it('preserves other existing query params while applying the new search', () => {
    toStringMock.mockReturnValue('type=contract');
    render(React.createElement(DocumentsSearch));
    const input = screen.getByPlaceholderText('Поиск по имени файла…');
    fireEvent.change(input, { target: { value: 'счёт' } });
    fireEvent.click(screen.getByText('Найти'));
    const calledWith = replace.mock.calls[0][0] as string;
    expect(calledWith).toContain('type=contract');
    expect(calledWith).toContain('search=');
  });
});
