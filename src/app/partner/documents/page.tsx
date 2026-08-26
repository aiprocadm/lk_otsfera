import React from 'react';
import Link from 'next/link';
import type { DocumentType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { listPartnerDocuments } from '@/lib/services/partner/documentsList';
import { viewedDocumentIds } from '@/lib/services/documents/viewMarks';
import { DocumentsList } from '@/components/partner/documents-list';
import { DocumentsSearch } from '@/components/partner/documents-search';
import { Paginator } from '@/components/ui';
import { pluralizeRu } from '@/lib/format';

import { PageHeader } from '@/components/ui/page-header';
import { OrderLessUploadForm } from '@/components/documents/order-less-upload-form';
const VALID_TYPES: DocumentType[] = [
  'contract',
  'extra_agreement',
  'invoice',
  'act',
  'waybill',
  'certificate',
  'report',
  'commission_statement',
  'other',
];

const TYPE_LABELS: Record<DocumentType, string> = {
  contract: 'Договоры',
  extra_agreement: 'Доп. соглашения',
  invoice: 'Счета',
  act: 'Акты',
  waybill: 'Накладные',
  certificate: 'Сертификаты',
  report: 'Отчёты',
  commission_statement: 'Комиссия',
  other: 'Прочее',
};

const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;

export default async function PartnerDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    search?: string;
    take?: string;
    skip?: string;
    tab?: string;
  }>;
}) {
  const session = await requirePartner();

  const sp = await searchParams;
  const tab = sp.tab === 'general' ? 'general' : 'orders';
  const take = Math.min(
    Number.isFinite(Number(sp.take)) ? Number(sp.take) : DEFAULT_TAKE,
    MAX_TAKE
  );
  const skip = Number.isFinite(Number(sp.skip)) ? Number(sp.skip) : 0;

  const typeFilter = VALID_TYPES.includes(sp.type as DocumentType)
    ? (sp.type as DocumentType)
    : undefined;

  const scope =
    session.assignedOrgIds && session.assignedOrgIds.length > 0
      ? session.assignedOrgIds
      : undefined;

  const { rows, total, countsByType } = await listPartnerDocuments(prisma, {
    partnerId: session.partnerId,
    scopeOrgIds: scope,
    type: typeFilter,
    search: sp.search,
    orderLess: tab === 'general',
    take,
    skip,
  });

  const grandTotal = Object.values(countsByType).reduce((s, n) => s + (n ?? 0), 0);

  // Этап 3 PR-2 (ФТ-6.6): «новый» = не скачан текущим пользователем.
  const viewed = await viewedDocumentIds(prisma, {
    userId: session.sub,
    documentIds: rows.map((r) => r.id),
  });
  const newDocIds = rows.filter((r) => !viewed.has(r.id)).map((r) => r.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <PageHeader
            title="Документы"
            subtitle={
              <>
                {total} {pluralizeRu(total, 'документ', 'документа', 'документов')}{' '}
                {sp.search && <span className="text-gray-400"> · по запросу «{sp.search}»</span>}
              </>
            }
          />
        </div>
        <DocumentsSearch />
      </div>

      <nav className="flex gap-2">
        <Link
          href="/partner/documents"
          className={`px-3 py-1.5 text-sm rounded-full border ${tab === 'orders' ? 'bg-[#F97316] text-white border-[#F97316]' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'}`}
        >
          По заказам
        </Link>
        <Link
          href="/partner/documents?tab=general"
          className={`px-3 py-1.5 text-sm rounded-full border ${tab === 'general' ? 'bg-[#F97316] text-white border-[#F97316]' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'}`}
        >
          Общие документы
        </Link>
      </nav>

      <TypeFilter
        active={typeFilter}
        countsByType={countsByType}
        grandTotal={grandTotal}
        search={sp.search}
        tab={tab}
      />

      {tab === 'general' && (
        <OrderLessUploadForm
          url="/api/partner/documents/upload"
          errorMap={{
            company_required:
              'Общий документ пока приложить некуда: в вашем портфеле нет организаций одной компании. Приложите файл к конкретному заказу.',
          }}
        />
      )}

      <DocumentsList
        rows={rows}
        newDocIds={newDocIds}
        groupByOrder={tab === 'orders'}
        cardHrefBase="/partner/documents"
      />

      <Paginator
        basePath="/partner/documents"
        searchParams={sp}
        take={take}
        skip={skip}
        total={total}
      />
    </div>
  );
}

function TypeFilter({
  active,
  countsByType,
  grandTotal,
  search,
  tab,
}: {
  active?: DocumentType | undefined;
  countsByType: Partial<Record<DocumentType, number>>;
  grandTotal: number;
  search?: string | undefined;
  tab?: string | undefined;
}) {
  if (grandTotal === 0) return null;
  const present = VALID_TYPES.filter((t) => (countsByType[t] ?? 0) > 0);

  function href(type?: DocumentType): string {
    const params = new URLSearchParams();
    if (tab === 'general') params.set('tab', 'general');
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    return `/partner/documents${params.toString() ? '?' + params.toString() : ''}`;
  }

  return (
    <nav className="flex flex-wrap gap-1.5">
      <Chip href={href()} active={!active} label="Все" count={grandTotal} />
      {present.map((t) => (
        <Chip
          key={t}
          href={href(t)}
          active={active === t}
          label={TYPE_LABELS[t]}
          /* v8 ignore next -- `present` already filters to `(countsByType[t] ?? 0) > 0`, so countsByType[t] is always truthy here; `?? 0` is unreachable defensive code */
          count={countsByType[t] ?? 0}
        />
      ))}
    </nav>
  );
}

function Chip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
        active
          ? 'bg-[#F97316] text-white border-[#F97316]'
          : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
      }`}
    >
      {label} <span className={active ? 'text-white/80' : 'text-gray-400'}>{count}</span>
    </Link>
  );
}
