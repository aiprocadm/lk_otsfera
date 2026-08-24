import React from 'react';
import Link from 'next/link';
import { AddStudentDialog } from '@/components/students/add-student-dialog';
import { EmptyState, Paginator, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import type { OrgCardEmployeeRow } from '@/lib/services/organization/orgCardEmployees';

/**
 * Вкладка «Сотрудники» карточки организации (`У-97`).
 *
 * Один презентационный компонент на все кабинеты (`Р-23`): что показывать —
 * одинаково, а кто это видит и может ли добавлять — решает сервис роли
 * (`listOrgCardEmployees` → `canWrite`).
 *
 * Список и кнопка живут вместе намеренно: до этапа 2 у партнёра кнопка
 * заводила сотрудника организации, а список показывал пользователей кабинета —
 * добавленный человек не появлялся в нём никогда (`Д-27`).
 */
export function OrgEmployeesSection({
  orgId,
  basePath,
  searchParams,
  rows,
  total,
  canWrite,
  take,
  skip,
}: {
  orgId: string;
  /** Адрес карточки — строка ведёт на карточку сотрудника внутри неё. */
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  rows: OrgCardEmployeeRow[];
  total: number;
  canWrite: boolean;
  take: number;
  skip: number;
}) {
  const q = typeof searchParams.q === 'string' ? searchParams.q : '';
  const dateRu = (d: Date) => new Date(d).toLocaleDateString('ru-RU');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500" data-testid="employees-total">
          {`Сотрудников: ${total}`}
        </p>
        {/* При пустом списке главная кнопка живёт в пустом состоянии (`У-74`),
            чтобы на экране не было двух одинаковых действий. */}
        {canWrite && rows.length > 0 && <AddStudentDialog organizationId={orgId} />}
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        {/* Поиск живёт в адресе: ссылкой на отфильтрованный список можно
            поделиться, и «назад» работает. */}
        <input type="hidden" name="tab" value="employees" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Поиск по ФИО или почте"
          aria-label="Поиск сотрудника"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="text-sm text-[#EA580C] hover:underline">
          Найти
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={q ? 'Никого не нашли' : 'Сотрудников пока нет'}
          message={
            q
              ? 'Проверьте написание фамилии или очистите поиск — возможно, человек записан иначе.'
              : 'Сотрудники организации — это люди, которых обучают. Добавьте первого, чтобы записывать его на обучение и выдавать удостоверения.'
          }
          {...(canWrite ? { action: <AddStudentDialog organizationId={orgId} /> } : {})}
        />
      ) : (
        <>
          <TableShell>
            <THead>
              <Th>ФИО</Th>
              <Th>Должность</Th>
              <Th>Почта</Th>
              <Th>Добавлен</Th>
            </THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id} data-testid={`employee-row-${r.id}`}>
                  <Td>
                    <Link
                      href={`${basePath}/students/${r.id}`}
                      className="font-medium text-[#111111] hover:text-[#F97316]"
                    >
                      {r.name}
                    </Link>
                  </Td>
                  <Td className="text-gray-700">{r.position ?? '—'}</Td>
                  <Td className="text-gray-700">{r.email ?? '—'}</Td>
                  <Td className="text-gray-700">{dateRu(r.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
          <Paginator
            basePath={basePath}
            searchParams={searchParams}
            take={take}
            skip={skip}
            total={total}
          />
        </>
      )}
    </div>
  );
}
