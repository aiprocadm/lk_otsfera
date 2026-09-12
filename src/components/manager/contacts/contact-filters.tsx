import React from 'react';
import Link from 'next/link';
import { Button, Input } from '@/components/ui';
import { contactListHref, type ParsedContactListQuery } from '@/lib/services/contacts/listQuery';
import type { ContactListScope, ContactListSort } from '@/lib/services/contacts/list';

/**
 * Фильтры списка контактов (`У-178`): поиск одной строкой (имя, организация,
 * e-mail, телефон в любом написании) и пилюли-ссылки с query-параметрами —
 * без клиентского JS, отобранным списком можно поделиться.
 */
const SCOPES: { value: ContactListScope; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'with_org', label: 'С организацией' },
  { value: 'without_org', label: 'Без организации' },
  { value: 'archived', label: 'Архив' },
];
const SORTS: { value: ContactListSort; label: string }[] = [
  { value: 'name', label: 'По имени' },
  { value: 'updated', label: 'По дате изменения' },
];

function Pill({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-orange-500 text-white'
          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {children}
    </Link>
  );
}

export function ContactFilters({ base, query }: { base: string; query: ParsedContactListQuery }) {
  return (
    <div className="space-y-3">
      <form action={base} method="get" className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          name="q"
          defaultValue={query.q}
          placeholder="Имя, организация, телефон или e-mail"
          aria-label="Поиск контактов"
          className="sm:max-w-md"
        />
        {query.scope !== 'all' && <input type="hidden" name="scope" value={query.scope} />}
        {query.sort !== 'name' && <input type="hidden" name="sort" value={query.sort} />}
        <Button type="submit" variant="secondary">
          Найти
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">Показать</p>
          <div className="flex flex-wrap gap-1.5">
            {SCOPES.map((s) => (
              <Pill
                key={s.value}
                href={contactListHref(base, query, { scope: s.value })}
                active={query.scope === s.value}
              >
                {s.label}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">Сортировка</p>
          <div className="flex flex-wrap gap-1.5">
            {SORTS.map((s) => (
              <Pill
                key={s.value}
                href={contactListHref(base, query, { sort: s.value })}
                active={query.sort === s.value}
              >
                {s.label}
              </Pill>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
