import Link from 'next/link';
import type { DocumentType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgDocumentsSearch } from '@/components/organization/org-documents-search';
import { DocumentsList } from '@/components/partner/documents-list';
import { listOrgDocuments } from '@/lib/services/organization/documents';
import { OrganizationOrderLessUploadForm } from '@/components/organization/organization-order-less-upload-form';
import { Paginator } from '@/components/ui';
import { pluralizeRu } from '@/lib/format';

type SearchParams = {
  org?: string;
  tab?: string;
  type?: string;
  search?: string;
  take?: string;
  skip?: string;
};

const VALID_TYPES: DocumentType[] = [
  'contract',
  'extra_agreement',
  'invoice',
  'act',
  'waybill',
  'certificate',
  'report',
  'commission_statement',
  'other'
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
  other: 'Прочее'
};

const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;

export default async function OrganizationDocumentsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  const tab = sp.tab === 'general' ? 'general' : 'orders';

  const take = Math.min(
    Number.isFinite(Number(sp.take)) ? Number(sp.take) : DEFAULT_TAKE,
    MAX_TAKE
  );
  const skip = Number.isFinite(Number(sp.skip)) ? Number(sp.skip) : 0;

  const typeFilter = VALID_TYPES.includes(sp.type as DocumentType)
    ? (sp.type as DocumentType)
    : undefined;

  const { rows, total, countsByType } = await listOrgDocuments(prisma, {
    organizationId: ctx.activeOrgId,
    type: typeFilter,
    search: sp.search,
    take,
    skip,
    orderLess: tab === 'general'
  });

  const grandTotal = Object.values(countsByType).reduce((s, n) => s + (n ?? 0), 0);

  const downloadEndpointQuery = sp.org
    ? `?org=${encodeURIComponent(sp.org)}`
    : '';

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-4'>
        <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-semibold text-[#111111]'>Документы</h1>
            <p className='text-sm text-gray-500 mt-0.5'>
              {total} {pluralizeRu(total, 'документ', 'документа', 'документов')}
              {sp.search && (
                <span className='text-gray-400'> · по запросу «{sp.search}»</span>
              )}
            </p>
          </div>
          <OrgDocumentsSearch />
        </div>

        <nav className='flex gap-2'>
          <Link
            href={`/organization/documents${sp.org ? `?org=${sp.org}` : ''}`}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              tab === 'orders'
                ? 'bg-[#F97316] text-white border-[#F97316]'
                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
            }`}
          >
            По заказам
          </Link>
          <Link
            href={`/organization/documents?tab=general${sp.org ? `&org=${sp.org}` : ''}`}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              tab === 'general'
                ? 'bg-[#F97316] text-white border-[#F97316]'
                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
            }`}
          >
            Общие документы
          </Link>
        </nav>

        <TypeFilter
          active={typeFilter}
          countsByType={countsByType}
          grandTotal={grandTotal}
          search={sp.search}
          org={sp.org}
          tab={tab}
        />

        {tab === 'general' && (
          <OrganizationOrderLessUploadForm organizationId={ctx.activeOrgId} />
        )}

        <DocumentsList
          rows={rows}
          downloadEndpointBase='/api/organization/documents'
          downloadEndpointQuery={downloadEndpointQuery}
        />

        <Paginator basePath='/organization/documents' searchParams={sp} take={take} skip={skip} total={total} />
      </div>
    </OrgAppShell>
  );
}

function TypeFilter({
  active,
  countsByType,
  grandTotal,
  search,
  org,
  tab
}: {
  active?: DocumentType;
  countsByType: Partial<Record<DocumentType, number>>;
  grandTotal: number;
  search?: string;
  org?: string;
  tab?: string;
}) {
  if (grandTotal === 0) return null;
  const present = VALID_TYPES.filter((t) => (countsByType[t] ?? 0) > 0);

  function href(type?: DocumentType): string {
    const params = new URLSearchParams();
    if (org) params.set('org', org);
    if (tab === 'general') params.set('tab', 'general');
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    return `/organization/documents${params.toString() ? '?' + params.toString() : ''}`;
  }

  return (
    <nav className='flex flex-wrap gap-1.5'>
      <Chip href={href()} active={!active} label='Все' count={grandTotal} />
      {present.map((t) => (
        <Chip
          key={t}
          href={href(t)}
          active={active === t}
          label={TYPE_LABELS[t]}
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
  active
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
