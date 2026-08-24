import React from 'react';
import Link from 'next/link';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

/**
 * Presentational table of manager-scoped organizations. Same visual tone as
 * `manager-orders-table` and `partner/portfolio-table`. Counts come from
 * `_count` aggregates, so the row payload is already small (~5 fields).
 */
export function ManagerOrgsList({
  orgs,
  basePath = '/manager/organizations',
  withoutInn = false,
}: {
  orgs: ManagerOrgListRow[];
  /**
   * `У-101`: у руководителя своя карточка — список обязан вести в СВОЙ
   * кабинет. По умолчанию менеджерский, чтобы не трогать прежние вызовы.
   */
  basePath?: string;
  /** `У-94`: включён ли отбор «без ИНН». Живёт в адресе, а не в состоянии. */
  withoutInn?: boolean;
}) {
  // `У-94`: фильтр — ссылка, а не кнопка: отобранным списком можно поделиться,
  // и «назад» работает.
  const filter = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">Показать:</span>
      <a
        href={withoutInn ? basePath : `${basePath}?inn=without`}
        aria-current={withoutInn ? 'true' : undefined}
        className={`rounded-full border px-3 py-1 text-xs ${
          withoutInn
            ? 'border-[#EA580C] bg-orange-50 text-[#EA580C]'
            : 'border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        без ИНН
      </a>
    </div>
  );

  if (orgs.length === 0) {
    return (
      <div className="space-y-3">
        {filter}
        <EmptyState
          icon="🏢"
          message={
            withoutInn
              ? 'Организаций без ИНН нет — все реквизиты заполнены.'
              : 'Вам пока не назначено ни одной организации.'
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filter}
      <TableShell>
        <THead>
          <Th>Название</Th>
          <Th>ИНН</Th>
          <Th className="text-right">Заказы</Th>
          <Th className="text-right">Сотрудники</Th>
          <Th className="text-right"></Th>
        </THead>
        <tbody>
          {orgs.map((o) => (
            <Tr key={o.id}>
              <Td>
                <Link
                  href={`${basePath}/${o.id}`}
                  className="font-medium text-[#111111] hover:text-[#F97316]"
                >
                  {o.name}
                </Link>
              </Td>
              <Td className="text-gray-700 font-mono text-xs">
                {o.inn ?? <span className="text-amber-700">не указан</span>}
              </Td>
              <Td className="text-right text-gray-700">{o._count.orders}</Td>
              <Td className="text-right text-gray-700">{o._count.students}</Td>
              <Td className="text-right">
                <Link
                  href={`${basePath}/${o.id}`}
                  className="text-[#F97316] hover:underline text-sm"
                >
                  →
                </Link>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}
