import Link from 'next/link';
import type { DocumentType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgDocumentsSearch } from '@/components/organization/org-documents-search';
import { DocumentsList } from '@/components/partner/documents-list';
import { listOrgDocuments } from '@/lib/services/organization/documents';

type SearchParams = {
  org?: string;
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
    skip
  });

  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));

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
            <h1 className='text-2xl font-bold text-[#111111]'>Документы</h1>
            <p className='text-sm text-gray-500 mt-0.5'>
              {total} {pluralize(total, 'документ', 'документа', 'документов')}
              {sp.search && (
                <span className='text-gray-400'> · по запросу «{sp.search}»</span>
              )}
            </p>
          </div>
          <OrgDocumentsSearch />
        </div>

        <TypeFilter
          active={typeFilter}
          countsByType={countsByType}
          grandTotal={grandTotal}
          search={sp.search}
          org={sp.org}
        />

        <DocumentsList
          rows={rows}
          downloadEndpointBase='/api/organization/documents'
          downloadEndpointQuery={downloadEndpointQuery}
        />

        {pages > 1 && (
          <Paginator
            take={take}
            skip={skip}
            page={page}
            pages={pages}
            total={total}
            searchParams={sp}
          />
        )}
      </div>
    </OrgAppShell>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function TypeFilter({
  active,
  countsByType,
  grandTotal,
  search,
  org
}: {
  active?: DocumentType;
  countsByType: Partial<Record<DocumentType, number>>;
  grandTotal: number;
  search?: string;
  org?: string;
}) {
  if (grandTotal === 0) return null;
  const present = VALID_TYPES.filter((t) => (countsByType[t] ?? 0) > 0);

  function href(type?: DocumentType): string {
    const params = new URLSearchParams();
    if (org) params.set('org', org);
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

function Paginator({
  take,
  skip,
  page,
  pages,
  total,
  searchParams
}: {
  take: number;
  skip: number;
  page: number;
  pages: number;
  total: number;
  searchParams: SearchParams;
}) {
  function link(targetSkip: number): string {
    const params = new URLSearchParams();
    if (searchParams.org) params.set('org', searchParams.org);
    if (searchParams.search) params.set('search', searchParams.search);
    if (searchParams.type) params.set('type', searchParams.type);
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    return `/organization/documents${params.toString() ? '?' + params.toString() : ''}`;
  }

  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);

  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>
        Страница {page} из {pages} · {total} всего
      </span>
      <div className='flex gap-2'>
        {skip > 0 && (
          <a
            href={link(prev)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Назад
          </a>
        )}
        {skip + take < total && (
          <a
            href={link(next)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}
