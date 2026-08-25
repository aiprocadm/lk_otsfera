import React from 'react';
import Link from 'next/link';

type Props = {
  role?: string | undefined;
  active?: string | undefined;
  q?: string | undefined;
  partnerId?: string | undefined;
  organizationId?: string | undefined;
  companyId?: string | undefined;
  /** `У-119`: компании-продавцы для фильтра (закрывает дефект `Д-34`). */
  companies?: Array<{ id: string; name: string }>;
};

const ROLES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Все роли' },
  { value: 'admin', label: 'Админы' },
  { value: 'manager', label: 'Менеджеры' },
  // `У-119`: руководитель — самостоятельная роль, и фильтроваться должен
  // наравне с менеджером, а не прятаться внутри него.
  { value: 'leader', label: 'Руководители' },
  { value: 'partner', label: 'Партнёры' },
  { value: 'organization', label: 'Организации' },
  { value: 'student', label: 'Студенты' },
];

export function UsersFilters({
  role,
  active,
  q,
  partnerId,
  organizationId,
  companyId,
  companies,
}: Props) {
  const hasActive = role || active || q || partnerId || organizationId || companyId;
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-xl p-3"
    >
      <label className="flex flex-col text-xs text-gray-500">
        Роль
        <select
          name="role"
          defaultValue={role ?? ''}
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        >
          {ROLES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-gray-500">
        Активность
        <select
          name="active"
          defaultValue={active ?? ''}
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        >
          <option value="">Все</option>
          <option value="true">Активные</option>
          <option value="false">Деактивированные</option>
        </select>
      </label>
      {companies && (
        <label className="flex flex-col text-xs text-gray-500">
          Компания
          <select
            name="companyId"
            defaultValue={companyId ?? ''}
            className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
          >
            <option value="">Все компании</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col text-xs text-gray-500 flex-1 min-w-[200px]">
        Поиск
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Email или имя"
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        />
      </label>
      {partnerId && <input type="hidden" name="partnerId" value={partnerId} />}
      {organizationId && <input type="hidden" name="organizationId" value={organizationId} />}
      <button
        type="submit"
        className="px-3 py-1.5 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C]"
      >
        Применить
      </button>
      {hasActive && (
        <Link
          href="/admin/users"
          className="px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50"
        >
          Сбросить
        </Link>
      )}
    </form>
  );
}
