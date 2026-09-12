import {
  CONTACT_LIST_PAGE,
  type ContactListFilters,
  type ContactListScope,
  type ContactListSort,
} from './list';

/**
 * Разбор адреса списка контактов (`У-178`): фильтры живут в query-строке, а не
 * в состоянии — отобранным списком можно поделиться, «назад» работает. Один
 * разборщик на три зеркальных кабинета, чтобы адреса читались одинаково.
 */
export type ContactListSearchParams = { [key: string]: string | string[] | undefined };

const SCOPES: ReadonlySet<string> = new Set<ContactListScope>([
  'all',
  'with_org',
  'without_org',
  'archived',
]);
const SORTS: ReadonlySet<string> = new Set<ContactListSort>(['name', 'updated']);

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export type ParsedContactListQuery = {
  filters: ContactListFilters;
  q: string;
  scope: ContactListScope;
  sort: ContactListSort;
  page: number;
  skip: number;
};

export function parseContactListQuery(sp: ContactListSearchParams): ParsedContactListQuery {
  const q = one(sp.q)?.trim().slice(0, 100) ?? '';
  const rawScope = one(sp.scope);
  const scope: ContactListScope =
    rawScope && SCOPES.has(rawScope) ? (rawScope as ContactListScope) : 'all';
  const rawSort = one(sp.sort);
  const sort: ContactListSort =
    rawSort && SORTS.has(rawSort) ? (rawSort as ContactListSort) : 'name';
  // Постраничность — `skip`, как у `Paginator` и остальных списков кабинетов.
  const rawSkip = Number(one(sp.skip));
  const skip = Number.isFinite(rawSkip) && rawSkip > 0 ? Math.floor(rawSkip) : 0;
  const page = Math.floor(skip / CONTACT_LIST_PAGE) + 1;
  return {
    filters: { ...(q ? { q } : {}), scope, sort, page },
    q,
    scope,
    sort,
    page,
    skip: (page - 1) * CONTACT_LIST_PAGE,
  };
}

/** Адрес списка с изменённым фильтром — для пилюль и сортировки. */
export function contactListHref(
  base: string,
  current: Pick<ParsedContactListQuery, 'q' | 'scope' | 'sort'>,
  patch: Partial<Pick<ParsedContactListQuery, 'q' | 'scope' | 'sort'>>
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.scope !== 'all') params.set('scope', next.scope);
  if (next.sort !== 'name') params.set('sort', next.sort);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Активная вкладка карточки и сдвиг списка вкладки (`У-179`). */
export function parseContactCardQuery<T extends { key: string }>(
  sp: ContactListSearchParams,
  tabs: readonly T[]
): { activeTab: T['key']; skip: number } {
  const rawTab = one(sp.tab) ?? '';
  const tab = tabs.find((t) => t.key === rawTab) ?? tabs[tabs.length - 1];
  const rawSkip = Number(one(sp.skip));
  const skip = Number.isFinite(rawSkip) && rawSkip > 0 ? Math.floor(rawSkip) : 0;
  // Реестр вкладок не бывает пустым: «История» — всегда; `?? ''` — только для типа.
  return { activeTab: (tab?.key ?? '') as T['key'], skip };
}
