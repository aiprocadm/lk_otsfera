import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/ui';
import type { Crumb } from '@/lib/navigation/breadcrumbs';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';
import { fmtDateTime } from '@/lib/format';
import { ClientRequestStatusBadge } from './client-request-status-badge';
import { ClientRequestAttachmentDropzone } from './client-request-attachment-dropzone';
import {
  ClientRequestAttachmentsList,
  type ClientRequestAttachmentRowVM,
} from './client-request-attachments-list';

/**
 * Деталка обращения подателя (этап 5, ФТ-1.3): поля, статус, причина отказа,
 * блок вложений (список + загрузка только в статусах submitted/in_triage).
 * Shared presentational для partner/organization — данные уже отскоуплены
 * сервисом, разметка идентична по ролям (как enrollment-detail-view).
 */
export function ClientRequestDetailView({
  request,
  attachments,
  backHref,
  breadcrumbs,
}: {
  request: ClientRequestRow;
  attachments: ClientRequestAttachmentRowVM[];
  backHref: string;
  /**
   * Крошки вместо ссылки «назад» (`У-72`): первая крошка ведёт в тот же
   * раздел, два навигационных элемента подряд не нужны. Проп опциональный —
   * экран без крошек показывает прежнюю ссылку.
   */
  breadcrumbs?: Crumb[] | undefined;
}) {
  const canEditAttachments = request.status === 'submitted' || request.status === 'in_triage';

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} />
        ) : (
          <Link href={backHref} className="text-sm text-[#F97316] hover:underline">
            ← Все обращения
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-[#111111]">{request.subject}</h1>
          <ClientRequestStatusBadge status={request.status} />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Подано {fmtDateTime(request.createdAt)} ({request.submittedByName})
        </p>
      </div>

      {request.status === 'rejected' && request.rejectedReason && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm">
          <div className="font-medium text-gray-700">Причина отклонения</div>
          <div className="text-gray-600 mt-1 whitespace-pre-wrap">{request.rejectedReason}</div>
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
        <h2 className="text-sm font-semibold text-[#111111]">Клиент</h2>
        <dl className="space-y-1.5">
          <DetailField label="Компания">{request.companyName}</DetailField>
          {request.inn && <DetailField label="ИНН">{request.inn}</DetailField>}
          <DetailField label="Контактное лицо">{request.contactName}</DetailField>
          {request.contactPhone && (
            <DetailField label="Телефон">{request.contactPhone}</DetailField>
          )}
          {request.contactEmail && <DetailField label="Email">{request.contactEmail}</DetailField>}
          {request.organizationName && (
            <DetailField label="Организация">{request.organizationName}</DetailField>
          )}
        </dl>
      </section>

      {request.body && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#111111]">Описание</h2>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{request.body}</div>
        </section>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#111111]">Вложения</h2>
        <ClientRequestAttachmentsList requestId={request.id} rows={attachments} />
        {canEditAttachments && <ClientRequestAttachmentDropzone requestId={request.id} />}
        {!canEditAttachments && (
          <p className="text-xs text-gray-500">
            Обращение рассмотрено — добавление вложений недоступно.
          </p>
        )}
      </section>
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="col-span-2 text-[#111111]">{children}</dd>
    </div>
  );
}
