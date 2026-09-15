import React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import type { OverdueTaskRow } from '@/lib/services/tasks/overdue';

/**
 * Блок «Просроченные задачи» на главной руководителя (`У-225`).
 *
 * До этого просрочка была одной цифрой в «Моём дне» менеджера, то есть у
 * руководителя её не было вообще. Здесь он видит не число, а сами задачи: что
 * висит, сколько дней и на ком.
 *
 * Пустой блок — это ХОРОШАЯ новость, поэтому у него свой заголовок, а не общее
 * «Здесь пока пусто» (`У-74`): человек должен понять, что всё в порядке, а не
 * решить, что раздел сломался.
 */
export function OverdueTasksBlock({
  rows,
  total,
  href,
}: {
  rows: OverdueTaskRow[];
  total: number;
  /** Куда ведёт «Показать все» — доска задач с фильтром просрочки. */
  href: string;
}) {
  if (rows.length === 0) {
    return (
      <section className="space-y-1 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-[#111111]">Просроченные задачи</h2>
        <p className="text-sm text-gray-500">Просроченных задач нет — команда идёт по срокам.</p>
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#111111]">Просроченные задачи</h2>
        <Badge tone="danger">{total}</Badge>
      </div>
      <ul className="space-y-1.5">
        {rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline gap-2 text-sm">
            <Link
              href={`${href}/${t.id}`}
              className="text-[#111111] hover:text-[#EA580C] hover:underline"
            >
              {t.title}
            </Link>
            <span className="text-xs text-red-600">просрочена на {t.overdueDays} дн.</span>
            <span className="text-xs text-gray-400">
              {t.assigneeNames.length > 0 ? t.assigneeNames.join(', ') : 'без исполнителя'}
            </span>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <Link
          href={`${href}?overdue=1`}
          className="inline-block text-sm text-[#EA580C] hover:underline"
        >
          Показать все ({total}) →
        </Link>
      )}
    </section>
  );
}
