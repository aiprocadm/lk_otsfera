import React from 'react';
import Link from 'next/link';
import type { EnrollmentDetail } from '@/lib/services/enrollments/detail';
import { fmtDate } from '@/lib/format';
import { EnrollmentStatusBadge } from './enrollment-status-badge';
import { EnrollmentStatusRibbon } from './enrollment-status-ribbon';
import { CertificateDownloadButton } from './certificate-download-button';

/**
 * Деталка заявки подателя (этап 2 PR-2, ФТ-2.3): статусная лента, таблица
 * позиций со статус-бейджами, ссылки на удостоверения (§5 спеки). Shared
 * presentational для organization/partner — как остальные компоненты
 * enrollment-домена (сознательное исключение из sibling-паттерна: данные
 * уже отскоуплены сервисом, разметка идентична по ролям).
 */
export function EnrollmentDetailView({
  detail,
  backHref,
}: {
  detail: EnrollmentDetail;
  backHref: string;
}) {
  return (
    <div className="space-y-5">
      <div>
        <Link href={backHref} className="text-sm text-[#F97316] hover:underline">
          ← Все заявки на обучение
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-[#111111]">Заявка: {detail.directionName}</h1>
          <EnrollmentStatusBadge status={detail.status} />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Подана {fmtDate(detail.createdAt)} ({detail.submittedByName})
          {detail.organizationName && <> · организация {detail.organizationName}</>}
        </p>
      </div>

      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <EnrollmentStatusRibbon status={detail.status} rejectedReason={detail.rejectedReason} />
        {detail.status !== 'rejected' && (
          <p className="text-xs text-gray-500 mt-3">
            Статусы обновляет менеджер; на каждую смену статуса вы получите уведомление.
          </p>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-[#111111]">Слушатели ({detail.items.length})</h2>
        <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
          {detail.items.map((item, i) => (
            <li key={item.id} className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-[#111111]">
                {i + 1}. {item.fullName}
              </span>
              <span className="text-xs text-gray-500">{item.email}</span>
              {item.position && <span className="text-xs text-gray-500">{item.position}</span>}
              <span className="ml-auto flex items-center gap-3">
                {item.certificateDocumentId && (
                  <CertificateDownloadButton documentId={item.certificateDocumentId} />
                )}
                <EnrollmentStatusBadge status={item.status} />
              </span>
            </li>
          ))}
        </ul>
        {detail.status === 'certificates_ready' &&
          detail.items.every((i) => !i.certificateDocumentId) && (
            <p className="text-xs text-gray-500">
              Удостоверения готовы — файлы появятся здесь, когда менеджер загрузит их в систему.
            </p>
          )}
        {detail.note && <p className="text-xs text-gray-500">Примечание: {detail.note}</p>}
      </section>
    </div>
  );
}
