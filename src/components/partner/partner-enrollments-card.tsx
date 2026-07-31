import React from 'react';
import Link from 'next/link';
import type { PartnerEnrollmentSummary } from '@/lib/services/partner/dashboard';
import { EnrollmentStatusBadge } from '@/components/enrollment/enrollment-status-badge';
import { fmtDate, pluralizeRu } from '@/lib/format';

/**
 * Дашборд-блок «Заявки на обучение» партнёра (этап 2 PR-2, ФТ-2.4):
 * кнопка подачи + последние заявки со статус-бейджами и ссылками на деталку.
 */
export function PartnerEnrollmentsCard({ rows }: { rows: PartnerEnrollmentSummary[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-[#111111]">Заявки на обучение</h2>
        <Link
          href="/partner/enrollments"
          className="text-xs font-medium text-white bg-[#F97316] hover:bg-[#EA580C] rounded-lg px-3 py-1.5"
        >
          Подать заявку на обучение
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          Заявок пока нет — подайте первую: направление из справочника, слушатели списком или из
          Excel.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <Link
                href={`/partner/enrollments/${r.id}`}
                className="text-gray-700 hover:text-[#F97316] flex-1 min-w-0 truncate"
              >
                {r.directionName}
                <span className="text-xs text-gray-400">
                  {' '}
                  · {r.studentCount}{' '}
                  {pluralizeRu(r.studentCount, 'слушатель', 'слушателя', 'слушателей')}
                </span>
              </Link>
              <EnrollmentStatusBadge status={r.status} />
              <span className="text-gray-400 text-xs whitespace-nowrap">
                {fmtDate(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
