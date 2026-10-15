'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui';

/**
 * Выбор исполнителей задачи с поиском (этап 5 ТЗ 13.10.2026, `У-301`, `Р-5-6`).
 *
 * Было: сетка флажков из всех сотрудников компании — в компании на сорок
 * человек нужного приходилось искать глазами. Теперь: выбранные — плашками с
 * крестиком, остальные находятся поиском по ФИО и e-mail. Подразделений в
 * системе нет (отделы с подчинением — в `docs/NOT_DOING.md`), поэтому искать по
 * подразделению нечем.
 *
 * Значения уходят в форму скрытыми полями `name` — серверное действие получает
 * тот же список id, что и раньше.
 */
export type AssigneeOption = { id: string; name: string; email?: string | null | undefined };

const SHOWN = 8;

export function AssigneePicker({
  users,
  defaultSelected,
  name,
  label,
  idPrefix,
  exclude = [],
}: {
  users: AssigneeOption[];
  defaultSelected: string[];
  /** Имя скрытых полей формы (`assigneeIds`, `coAssigneeIds`). */
  name: string;
  label: string;
  idPrefix: string;
  /** Кого не предлагать: уже выбранных в соседнем списке. */
  exclude?: string[];
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [query, setQuery] = useState('');
  const byId = new Map(users.map((u) => [u.id, u]));
  const q = query.trim().toLowerCase();
  const found = q
    ? users
        .filter((u) => !selected.includes(u.id) && !exclude.includes(u.id))
        .filter((u) => `${u.name} ${u.email ?? ''}`.toLowerCase().includes(q))
        .slice(0, SHOWN)
    : [];
  const inputId = `${idPrefix}-search`;

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-[#111111]">
        {label}
      </label>
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label}: выбраны`}>
          {selected.map((id) => (
            <li
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
            >
              {byId.get(id)?.name ?? 'Сотрудник'}
              <button
                type="button"
                className="text-gray-400 hover:text-gray-700"
                aria-label={`Убрать: ${byId.get(id)?.name ?? 'сотрудник'}`}
                onClick={() => setSelected((s) => s.filter((x) => x !== id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-500">Пока никто не выбран.</p>
      )}
      <Input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Начните вводить ФИО или e-mail"
        autoComplete="off"
      />
      {q && found.length === 0 && (
        <p className="text-xs text-gray-500">Никого не нашли — проверьте написание.</p>
      )}
      {found.length > 0 && (
        <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          {found.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50"
                onClick={() => {
                  setSelected((s) => [...s, u.id]);
                  setQuery('');
                }}
              >
                {u.name}
                {u.email && <span className="ml-2 text-xs text-gray-500">{u.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
