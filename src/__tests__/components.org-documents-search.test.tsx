// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ replace })),
  useSearchParams: vi.fn(() => new URLSearchParams())
}));

import { useSearchParams } from 'next/navigation';
import { OrgDocumentsSearch } from '@/components/organization/org-documents-search';

function inputValue(el: HTMLElement): string {
  return (el as HTMLInputElement).value;
}

function sp(init?: Record<string, string>): ReturnType<typeof useSearchParams> {
  return new URLSearchParams(init) as unknown as ReturnType<typeof useSearchParams>;
}

describe('OrgDocumentsSearch', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(useSearchParams).mockReturnValue(sp());
  });

  it('initializes empty when there is no search param', () => {
    render(React.createElement(OrgDocumentsSearch));
    expect(inputValue(screen.getByPlaceholderText('Поиск по имени файла…'))).toBe('');
  });

  it('initializes from an existing search param', () => {
    vi.mocked(useSearchParams).mockReturnValue(sp({ search: 'акт' }));
    render(React.createElement(OrgDocumentsSearch));
    expect(inputValue(screen.getByPlaceholderText('Поиск по имени файла…'))).toBe('акт');
  });

  it('typing then pressing Enter applies the search and drops any skip param', () => {
    vi.mocked(useSearchParams).mockReturnValue(sp({ skip: '25' }));
    render(React.createElement(OrgDocumentsSearch));
    const input = screen.getByPlaceholderText('Поиск по имени файла…');
    fireEvent.change(input, { target: { value: 'договор' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(replace).toHaveBeenCalledWith('/organization/documents?search=%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80');
  });

  it('pressing a non-Enter key does not apply', () => {
    render(React.createElement(OrgDocumentsSearch));
    const input = screen.getByPlaceholderText('Поиск по имени файла…');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('clicking Найти with an empty value removes the search param, leaving no query string', () => {
    vi.mocked(useSearchParams).mockReturnValue(sp({ search: 'акт' }));
    render(React.createElement(OrgDocumentsSearch));
    const input = screen.getByPlaceholderText('Поиск по имени файла…');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('Найти'));
    expect(replace).toHaveBeenCalledWith('/organization/documents');
  });

  it('clicking Найти with a value applies it', () => {
    render(React.createElement(OrgDocumentsSearch));
    const input = screen.getByPlaceholderText('Поиск по имени файла…');
    fireEvent.change(input, { target: { value: 'счёт' } });
    fireEvent.click(screen.getByText('Найти'));
    expect(replace).toHaveBeenCalledWith('/organization/documents?search=%D1%81%D1%87%D1%91%D1%82');
  });
});
