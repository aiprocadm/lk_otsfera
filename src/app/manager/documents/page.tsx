import React from 'react';
import Link from 'next/link';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listDocuments, listManagerOrderLessDocuments } from '@/lib/services/manager/documents';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
import { DocumentsList } from '@/components/partner/documents-list';
import { ManagerOrderLessUploadForm } from '@/components/manager/manager-order-less-upload-form';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

type SearchParams = { search?: string; type?: string; orderId?: string; cursor?: string; tab?: string };

// Mirrors prisma/schema.prisma `enum DocumentType` (lower_snake_case literal
// values) with Russian-language labels — keep this in sync if the enum gains
// new values.
const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'commission_statement', label: 'Расчёт комиссии' },
  { value: 'other', label: 'Прочее' }
];

function TabChips({ activeTab, ordersHref }: { activeTab: 'orders' | 'general'; ordersHref: string }) {
  return (
    <div className='flex gap-2'>
      <Link
        href={ordersHref}
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          activeTab === 'orders'
            ? 'bg-[#F97316] text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        По заказам
      </Link>
      <Link
        href='/manager/documents?tab=general'
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          activeTab === 'general'
            ? 'bg-[#F97316] text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        Общие документы
      </Link>
    </div>
  );
}

export default async function ManagerDocumentsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const isGeneral = sp.tab === 'general';

  if (isGeneral) {
    const [{ rows }, cps] = await Promise.all([
      listManagerOrderLessDocuments(prisma, session),
      listManagerCounterparties(prisma, session)
    ]);

    const documentRows: OrgDocumentRow[] = rows.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      direction: d.direction,
      signedAt: d.signedAt,
      createdAt: d.createdAt,
      size: d.size,
      orderId: null,
      orderNumber: null,
      orderTitle: null
    }));

    return (
      <div className='space-y-4'>
        <h1 className='text-2xl font-semibold text-[#111111]'>Документы</h1>
        <TabChips activeTab='general' ordersHref='/manager/documents' />
        <ManagerOrderLessUploadForm organizations={cps.organizations} partners={cps.partners} />
        <DocumentsList rows={documentRows} downloadEndpointBase='/api/manager/documents' />
      </div>
    );
  }

  // orders tab (default)
  const { rows, nextCursor } = await listDocuments(prisma, {
    session,
    search: sp.search,
    type: sp.type || undefined,
    orderId: sp.orderId,
    cursor: sp.cursor
  });

  // listDocuments returns raw Document rows (with order include). DocumentsList
  // (shared with the partner / org cabinets) takes the OrgDocumentRow shape:
  // fold the per-order context in here, same pattern as Task 16's order detail
  // page.
  const documentRows: OrgDocumentRow[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    direction: d.direction,
    signedAt: d.signedAt,
    createdAt: d.createdAt,
    size: d.size,
    orderId: d.orderId,
    orderNumber: d.order?.orderNumber ?? null,
    orderTitle: d.order?.title ?? null
  }));

  // Preserve current filters on the "next page" link so cursor pagination does
  // not silently drop the user's filter state.
  const nextParams = new URLSearchParams();
  if (sp.search) nextParams.set('search', sp.search);
  if (sp.type) nextParams.set('type', sp.type);
  if (sp.orderId) nextParams.set('orderId', sp.orderId);
  if (nextCursor) nextParams.set('cursor', nextCursor);

  // Build href for orders tab that preserves current filters
  const ordersTabHref = (() => {
    const p = new URLSearchParams();
    if (sp.search) p.set('search', sp.search);
    if (sp.type) p.set('type', sp.type);
    if (sp.orderId) p.set('orderId', sp.orderId);
    const qs = p.toString();
    return qs ? `/manager/documents?${qs}` : '/manager/documents';
  })();

  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Документы</h1>

      <TabChips activeTab='orders' ordersHref={ordersTabHref} />

      <form method='get' className='flex flex-wrap items-center gap-2'>
        <input
          name='search'
          defaultValue={sp.search ?? ''}
          placeholder='Поиск по названию…'
          className='border border-gray-200 rounded px-2 py-1 text-sm flex-1 min-w-[200px]'
        />
        <select
          name='type'
          defaultValue={sp.type ?? ''}
          className='border border-gray-200 rounded px-2 py-1 text-sm'
        >
          <option value=''>Все типы</option>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {sp.orderId && <input type='hidden' name='orderId' value={sp.orderId} />}
        <button
          type='submit'
          className='px-3 py-1 bg-[#F97316] text-white rounded text-sm hover:bg-[#EA580C]'
        >
          Найти
        </button>
      </form>

      <DocumentsList rows={documentRows} downloadEndpointBase='/api/manager/documents' />

      {nextCursor && (
        <div>
          <Link
            href={`/manager/documents?${nextParams.toString()}`}
            className='inline-block text-sm text-[#F97316] hover:underline'
          >
            Дальше →
          </Link>
        </div>
      )}
    </div>
  );
}