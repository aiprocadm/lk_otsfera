import React from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';

/**
 * «Раздел переехал» — старый адрес «Воронки продаж» (`/manager/funnel` с
 * `У-312`, `/leader/funnel` с `У-349`). Воронка стала видом внутри «Лидов»;
 * закладки и ссылки из писем не ведут в 404, а объясняют, где теперь воронка.
 */
export function FunnelMovedNotice({
  leadsHref,
  note,
}: {
  leadsHref: string;
  /** Что ещё переехало вместе с воронкой (у руководителя — настройка стадий). */
  note?: string;
}) {
  return (
    <div className="space-y-4">
      <PageHeader title="Воронка продаж" subtitle="Раздел переехал в «Лиды»." />
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <p className="text-sm text-gray-700">
          Воронка теперь — вид внутри раздела «Лиды»: переключатель «Список / Воронка» над списком.
          Стадии и перетаскивание карточек остались прежними.
        </p>
        {note && <p className="text-sm text-gray-700">{note}</p>}
        <Link
          href={`${leadsHref}?view=funnel`}
          className="inline-flex rounded-lg bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#EA580C]"
        >
          Открыть воронку в «Лидах»
        </Link>
      </div>
    </div>
  );
}
