'use client';

import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui';

export type OrgEmployeeRow = {
  id: string;
  roleInOrg: string | null;
  user: { name: string; email: string };
};

/**
 * Список сотрудников организации с поиском (`У-63`, этап 4).
 *
 * Поиск клиентский: список организации — это десятки строк, а не тысячи, и
 * серверная фильтрация здесь только добавила бы круг до базы на каждую букву.
 *
 * Кнопки «Добавить сотрудника» здесь пока нет намеренно: её действие — `У-25`,
 * а сервис создания сотрудника (`У-23`) приходит этапом 5. Решение заказчика
 * 09.08.2026 — отгрузить кнопку вместе с сервисом, а не заглушку сейчас.
 */
export function OrgEmployeesList({ rows }: { rows: OrgEmployeeRow[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.user.name.toLowerCase().includes(q) ||
        r.user.email.toLowerCase().includes(q) ||
        (r.roleInOrg ?? '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по имени, почте или должности"
        aria-label="Поиск сотрудников"
        data-testid="org-employees-search"
        className="w-full md:w-80"
      />

      {filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-700">Никого не нашлось.</p>
          <p className="text-xs text-gray-500 mt-1">
            Проверьте написание или очистите поле поиска.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-xl">
          {filtered.map((r) => (
            <li key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#111111] truncate">{r.user.name}</div>
                <div className="text-xs text-gray-500 truncate">{r.user.email}</div>
              </div>
              {r.roleInOrg && (
                <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded flex-shrink-0">
                  {r.roleInOrg}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
