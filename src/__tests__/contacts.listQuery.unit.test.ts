import { describe, it, expect } from 'vitest';
import { CONTACT_LIST_PAGE } from '@/lib/services/contacts/list';
import {
  contactListHref,
  parseContactCardQuery,
  parseContactListQuery,
} from '@/lib/services/contacts/listQuery';

/**
 * Разбор адреса списка и карточки контактов (этап 1 ТЗ 12.09.2026, `У-178`,
 * `У-179`; спека docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md
 * §3.3): фильтры живут в query-строке — поиск обрезается до 100 знаков,
 * область и сортировка сверяются со словарём (мусор → умолчания), `skip`
 * выравнивается по странице; адрес с умолчаниями остаётся голым; неизвестная
 * вкладка карточки открывает последнюю в реестре («История»).
 */
describe('parseContactListQuery', () => {
  it('без параметров — умолчания; в filters нет ключа q', () => {
    const r = parseContactListQuery({});
    expect(r).toEqual({
      filters: { scope: 'all', sort: 'name', page: 1 },
      q: '',
      scope: 'all',
      sort: 'name',
      page: 1,
      skip: 0,
    });
    expect('q' in r.filters).toBe(false);
  });

  it('q обрезается пробелами и до 100 знаков; попадает в filters', () => {
    const long = `  ${'я'.repeat(150)}  `;
    const r = parseContactListQuery({ q: long });
    expect(r.q).toBe('я'.repeat(100));
    expect(r.filters.q).toBe('я'.repeat(100));
  });

  it('q из одних пробелов и q-массив — пустая строка', () => {
    expect(parseContactListQuery({ q: '   ' }).q).toBe('');
    expect(parseContactListQuery({ q: ['a', 'b'] }).q).toBe('');
    expect(parseContactListQuery({ q: ['a', 'b'] }).filters).toEqual({
      scope: 'all',
      sort: 'name',
      page: 1,
    });
  });

  it('scope: известные значения проходят, чужие и пустые → all', () => {
    for (const scope of ['all', 'with_org', 'without_org', 'archived'] as const) {
      expect(parseContactListQuery({ scope }).scope).toBe(scope);
    }
    expect(parseContactListQuery({ scope: 'foo' }).scope).toBe('all');
    expect(parseContactListQuery({ scope: '' }).scope).toBe('all');
    expect(parseContactListQuery({ scope: ['archived'] }).scope).toBe('all');
  });

  it('sort: name и updated проходят, чужие и пустые → name', () => {
    expect(parseContactListQuery({ sort: 'updated' }).sort).toBe('updated');
    expect(parseContactListQuery({ sort: 'name' }).sort).toBe('name');
    expect(parseContactListQuery({ sort: 'created' }).sort).toBe('name');
    expect(parseContactListQuery({ sort: '' }).sort).toBe('name');
  });

  it('skip → номер страницы и выровненный по странице сдвиг', () => {
    const page = CONTACT_LIST_PAGE;
    const r = parseContactListQuery({ skip: String(page * 2 + 7) });
    expect(r.page).toBe(3);
    expect(r.skip).toBe(page * 2);
    expect(r.filters.page).toBe(3);
    // Ровно граница страницы — без сдвига внутри.
    expect(parseContactListQuery({ skip: String(page) })).toMatchObject({ page: 2, skip: page });
    // Дробное — вниз до целого.
    expect(parseContactListQuery({ skip: '49.9' })).toMatchObject({ page: 1, skip: 0 });
  });

  it('мусорный skip (буквы, отрицательный, бесконечность, массив) → первая страница', () => {
    for (const skip of ['abc', '-5', 'Infinity', '0', ['10']]) {
      expect(parseContactListQuery({ skip })).toMatchObject({ page: 1, skip: 0 });
    }
  });
});

describe('contactListHref', () => {
  const base = '/manager/contacts';
  const defaults = { q: '', scope: 'all' as const, sort: 'name' as const };

  it('умолчания не попадают в адрес — остаётся голый base', () => {
    expect(contactListHref(base, defaults, {})).toBe(base);
    expect(contactListHref(base, { q: 'x', scope: 'archived', sort: 'updated' }, defaults)).toBe(
      base
    );
  });

  it('каждый не-умолчательный фильтр попадает в адрес', () => {
    expect(contactListHref(base, defaults, { q: 'Иван' })).toBe(
      `${base}?q=%D0%98%D0%B2%D0%B0%D0%BD`
    );
    expect(contactListHref(base, defaults, { scope: 'with_org' })).toBe(`${base}?scope=with_org`);
    expect(contactListHref(base, defaults, { sort: 'updated' })).toBe(`${base}?sort=updated`);
  });

  it('patch перекрывает current, остальное сохраняется', () => {
    const current = { q: 'a b', scope: 'archived' as const, sort: 'updated' as const };
    expect(contactListHref(base, current, { scope: 'all' })).toBe(`${base}?q=a+b&sort=updated`);
    expect(contactListHref(base, current, { q: '' })).toBe(`${base}?scope=archived&sort=updated`);
  });
});

describe('parseContactCardQuery', () => {
  const tabs = [{ key: 'dialogs' }, { key: 'orders' }, { key: 'history' }] as const;

  it('известная вкладка открывается; неизвестная и отсутствующая → последняя из списка', () => {
    expect(parseContactCardQuery({ tab: 'orders' }, tabs).activeTab).toBe('orders');
    expect(parseContactCardQuery({ tab: 'tasks' }, tabs).activeTab).toBe('history');
    expect(parseContactCardQuery({}, tabs).activeTab).toBe('history');
    expect(parseContactCardQuery({ tab: ['orders'] }, tabs).activeTab).toBe('history');
  });

  it('skip разбирается так же, как у списка: положительное целое, иначе 0', () => {
    expect(parseContactCardQuery({ skip: '20' }, tabs).skip).toBe(20);
    expect(parseContactCardQuery({ skip: '20.9' }, tabs).skip).toBe(20);
    expect(parseContactCardQuery({ skip: '-1' }, tabs).skip).toBe(0);
    expect(parseContactCardQuery({ skip: 'x' }, tabs).skip).toBe(0);
    expect(parseContactCardQuery({}, tabs).skip).toBe(0);
  });

  it('пустой реестр вкладок — activeTab пустая строка, а не падение', () => {
    expect(parseContactCardQuery({ tab: 'orders' }, [] as { key: string }[])).toEqual({
      activeTab: '',
      skip: 0,
    });
  });
});
