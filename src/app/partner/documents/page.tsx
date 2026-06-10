import Link from 'next/link';
import type { DocumentType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { listPartnerDocuments } from '@/lib/services/partner/documentsList';
import { DocumentsList } from '@/components/partner/documents-list';
import { DocumentsSearch } from '@/components/partner/documents-search';

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

export default async function PartnerDocumentsPage({
  searchParams
}: {
  searchParams: Promise<{ type?: string; search?: string; take?: string; skip?: string; tab?: string }>;
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

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const { rows, total, countsByType } = await listPartnerDocuments(prisma, {
    partnerId: session.partnerId,
    scopeOrgIds: scope,
    type: typeFilter,
    search: sp.search,
    orderLess: tab === 'general',
    take,
    skip
  });

  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));

  const grandTotal = Object.values(countsByType).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <div className='space-y-4'>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Документы</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {total} {pluralize(total, 'документ', 'документа', 'документов')}
            {sp.search && <span className='text-gray-400'> · по запросу «{sp.search}»</span>}
          </p>
        </div>
        <DocumentsSearch />
      </div>

      <nav className='flex gap-2'>
        <Link
          href='/partner/documents'
          className={`px-3 py-1.5 text-sm rounded-full border ${tab === 'orders' ? 'bg-[#F97316] text-white border-[#F97316]' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'}`}
        >
          По заказам
        </Link>
        <Link
          href='/partner/documents?tab=general'
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

      <DocumentsList rows={rows} />

      {pages > 1 && (
        <Paginator
          take={take}
          skip={skip}
          page={page}
          pages={pages}
          total={total}
          type={typeFilter}
          search={sp.search}
          tab={tab}
        />
      )}
    </div>
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
  active, countsByType, grandTotal, search, tab
}: {
  active?: DocumentType;
  countsByType: Partial<Record<DocumentType, number>>;
  grandTotal: number;
  search?: string;
  tab?: string;
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
  href, label, count, active
}: { href: string; label: string; count: number; active: boolean }) {
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
  take, skip, page, pages, total, type, search, tab
}: {
  take: number; skip: number; page: number; pages: number; total: number;
  type?: DocumentType; search?: string; tab?: string;
}) {
  function link(targetSkip: number): string {
    const params = new URLSearchParams();
    if (tab === 'general') params.set('tab', 'general');
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    return `/partner/documents?${params.toString()}`;
  }

  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);

  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>Страница {page} из {pages} · {total} всего</span>
      <div className='flex gap-2'>
        {skip > 0 && (
          <a href={link(prev)} className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'>
            Назад
          </a>
        )}
        {skip + take < total && (
          <a href={link(next)} className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'>
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}
