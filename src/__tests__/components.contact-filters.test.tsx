// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ContactFilters } from '@/components/manager/contacts/contact-filters';
import type { ParsedContactListQuery } from '@/lib/services/contacts/listQuery';

/**
 * Фильтры списка контактов (этап 1 ТЗ 12.09.2026, `У-178`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.3): поиск одной строкой без
 * клиентского JS, пилюли-ссылки с query-параметрами, скрытые поля формы
 * сохраняют текущий фильтр и сортировку.
 */
function query(overrides: Partial<ParsedContactListQuery> = {}): ParsedContactListQuery {
  return {
    filters: { scope: 'all', sort: 'name', page: 1 },
    q: '',
    scope: 'all',
    sort: 'name',
    page: 1,
    skip: 0,
    ...overrides,
  };
}

describe('ContactFilters', () => {
  it('по умолчанию: «Все» и «По имени» активны, скрытых полей нет, ссылки без параметров', () => {
    const { container } = render(<ContactFilters base="/manager/contacts" query={query()} />);

    const form = container.querySelector('form')!;
    expect(form.getAttribute('action')).toBe('/manager/contacts');
    expect(form.getAttribute('method')).toBe('get');
    const search = screen.getByLabelText('Поиск контактов') as HTMLInputElement;
    expect(search.name).toBe('q');
    expect(search.value).toBe('');
    expect(container.querySelector('input[type="hidden"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Найти' })).toBeTruthy();

    const all = screen.getByRole('link', { name: 'Все' });
    expect(all.getAttribute('aria-current')).toBe('true');
    expect(all.getAttribute('href')).toBe('/manager/contacts');
    expect(all.className).toContain('bg-orange-500');
    const byName = screen.getByRole('link', { name: 'По имени' });
    expect(byName.getAttribute('aria-current')).toBe('true');

    const withOrg = screen.getByRole('link', { name: 'С организацией' });
    expect(withOrg.getAttribute('aria-current')).toBeNull();
    expect(withOrg.className).toContain('border-gray-200');
    expect(withOrg.getAttribute('href')).toBe('/manager/contacts?scope=with_org');
    expect(screen.getByRole('link', { name: 'Без организации' }).getAttribute('href')).toBe(
      '/manager/contacts?scope=without_org'
    );
    expect(screen.getByRole('link', { name: 'Архив' }).getAttribute('href')).toBe(
      '/manager/contacts?scope=archived'
    );
    expect(screen.getByRole('link', { name: 'По дате изменения' }).getAttribute('href')).toBe(
      '/manager/contacts?sort=updated'
    );
  });

  it('с поиском, фильтром и сортировкой: скрытые поля держат фильтр, ссылки несут всё вместе', () => {
    const { container } = render(
      <ContactFilters
        base="/leader/contacts"
        query={query({ q: 'иван', scope: 'archived', sort: 'updated' })}
      />
    );

    expect((screen.getByLabelText('Поиск контактов') as HTMLInputElement).value).toBe('иван');
    const hidden = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')
    ).map((i) => [i.name, i.value]);
    expect(hidden).toEqual([
      ['scope', 'archived'],
      ['sort', 'updated'],
    ]);

    // Активные пилюли — «Архив» и «По дате изменения»; «Все» — обычная ссылка.
    expect(screen.getByRole('link', { name: 'Архив' }).getAttribute('aria-current')).toBe('true');
    expect(
      screen.getByRole('link', { name: 'По дате изменения' }).getAttribute('aria-current')
    ).toBe('true');
    expect(screen.getByRole('link', { name: 'Все' }).getAttribute('aria-current')).toBeNull();
    // Смена фильтра сохраняет поиск и сортировку, смена сортировки — поиск и фильтр.
    expect(screen.getByRole('link', { name: 'Все' }).getAttribute('href')).toBe(
      '/leader/contacts?q=%D0%B8%D0%B2%D0%B0%D0%BD&sort=updated'
    );
    expect(screen.getByRole('link', { name: 'По имени' }).getAttribute('href')).toBe(
      '/leader/contacts?q=%D0%B8%D0%B2%D0%B0%D0%BD&scope=archived'
    );
  });
});
