import Link from 'next/link';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listDocuments } from '@/lib/services/manager/documents';
import { DocumentsList } from '@/components/partner/documents-list';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

type SearchParams = { q?: string; type?: string; orderId?: string; cursor?: string };

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

export default async function ManagerDocumentsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const { rows, nextCursor } = await listDocuments(prisma, {
    session,
    q: sp.q,
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
  if (sp.q) nextParams.set('q', sp.q);
  if (sp.type) nextParams.set('type', sp.type);
  if (sp.orderId) nextParams.set('orderId', sp.orderId);
  if (nextCursor) nextParams.set('cursor', nextCursor);

  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Документы</h1>

      <form method='get' className='flex flex-wrap items-center gap-2'>
        <input
          name='q'
          defaultValue={sp.q ?? ''}
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
