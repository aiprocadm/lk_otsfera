import React from 'react';
import Link from 'next/link';
import type { Crumb } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';
import type { EnrollmentDetail } from '@/lib/services/enrollments/detail';
import { groupItemsByDirection } from '@/lib/services/enrollments/grouping';
import { fmtDate, pluralizeRu } from '@/lib/format';
import { EnrollmentStatusBadge } from './enrollment-status-badge';
import { EnrollmentStatusRibbon } from './enrollment-status-ribbon';
import { CertificateDownloadButton } from './certificate-download-button';

/**
 * Подпись заявки — одна на заголовок и на хлебную крошку (`У-72`): если бы
 * крошка считала её сама, две надписи разъехались бы при первой же правке.
 * `У-43`: несколько обучений сворачиваются в количество, названия — строкой ниже.
 */
export function enrollmentTitle(detail: {
  directionName: string;
  directionNames: string[];
}): string {
  return detail.directionNames.length > 1
    ? `Заявка: ${detail.directionNames.length} ${pluralizeRu(detail.directionNames.length, 'обучение', 'обучения', 'обучений')}`
    : `Заявка: ${detail.directionName}`;
}

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
  breadcrumbs,
}: {
  detail: EnrollmentDetail;
  backHref: string;
  /**
   * Крошки вместо ссылки «назад» (`У-72`): первая крошка ведёт в тот же
   * раздел, два навигационных элемента подряд не нужны. Проп опциональный —
   * экран без крошек показывает прежнюю ссылку.
   */
  breadcrumbs?: Crumb[] | undefined;
}) {
  return (
    <div className="space-y-5">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} />
        ) : (
          <Link href={backHref} className="text-sm text-[#F97316] hover:underline">
            ← Все заявки на обучение
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-[#111111]">{enrollmentTitle(detail)}</h1>
          <EnrollmentStatusBadge status={detail.status} />
        </div>
        {detail.directionNames.length > 1 && (
          <p className="text-sm text-gray-600 mt-1">{detail.directionNames.join(' · ')}</p>
        )}
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
        {/* У-43: позиции сгруппированы по обучению — в одной заявке их может
            быть несколько, и списком вперемешку непонятно, кто куда идёт. */}
        {groupItemsByDirection(detail.items).map((group) => (
          <div key={group.title} className="space-y-1.5">
            <h3 className="text-sm font-medium text-gray-700">
              {group.title}{' '}
              <span className="text-xs font-normal text-gray-500">
                ({group.items.length}{' '}
                {pluralizeRu(group.items.length, 'слушатель', 'слушателя', 'слушателей')})
              </span>
            </h3>
            <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
              {group.items.map((item, i) => (
                <li
                  key={item.id}
                  className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                >
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
          </div>
        ))}
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
