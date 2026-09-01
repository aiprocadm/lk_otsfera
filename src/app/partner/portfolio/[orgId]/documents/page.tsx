import React from 'react';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { DocumentType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { canPartnerAccessOrg, isPartnerAdmin } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { getOrgDocuments } from '@/lib/services/partner/orgDocuments';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { orgCardTabsFor } from '@/lib/navigation/orgCardTabs';
import { OrgCardTabsNav } from '@/components/manager/org-card-tabs';
import { partnerOrgTabHref } from '@/lib/navigation/partnerOrgCard';
import { DocumentsList } from '@/components/partner/documents-list';

const VALID_TYPES: DocumentType[] = [
  'contract',
  'extra_agreement',
  'invoice',
  'act',
  'waybill',
  'certificate',
  'report',
  'commission_statement',
  'commercial_proposal',
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
  commercial_proposal: 'Коммерческие предложения',
  other: 'Прочее',
};

export default async function OrgDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requirePartner();

  const { orgId } = await params;

  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) redirect('/forbidden');

  const card = await getOrgCard(prisma, { orgId, partnerId: session.partnerId });
  if (!card) notFound();

  const sp = await searchParams;
  const typeFilter = VALID_TYPES.includes(sp.type as DocumentType)
    ? (sp.type as DocumentType)
    : undefined;

  const { rows, countsByType, total } = await getOrgDocuments(prisma, {
    orgId,
    partnerId: session.partnerId,
    type: typeFilter,
  });

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('partner', '/partner/portfolio', [
          { label: card.name, href: `/partner/portfolio/${orgId}` },
          { label: 'Документы' },
        ])}
      />
      <OrgCardHeader card={card} />
      {/* `У-96`: состав вкладок — фильтр общего реестра, а не свой список. */}
      <OrgCardTabsNav
        tabs={orgCardTabsFor('partner', { flags: isFeatureEnabled }).filter(
          (t) => t.key !== 'settings' || isPartnerAdmin(session)
        )}
        activeTab="documents"
        hrefFor={(key) => partnerOrgTabHref(orgId, key)}
      />

      <TypeFilter orgId={orgId} active={typeFilter} countsByType={countsByType} total={total} />

      <DocumentsList rows={rows} />
    </div>
  );
}

function TypeFilter({
  orgId,
  active,
  countsByType,
  total,
}: {
  orgId: string;
  active?: DocumentType | undefined;
  countsByType: Partial<Record<DocumentType, number>>;
  total: number;
}) {
  const base = `/partner/portfolio/${orgId}/documents`;
  const present = VALID_TYPES.filter((t) => (countsByType[t] ?? 0) > 0);

  if (total === 0) return null;

  return (
    <nav data-testid="doc-type-filter" className="flex flex-wrap gap-1.5">
      <Chip href={base} active={!active} label="Все" count={total} />
      {present.map((t) => (
        <Chip
          key={t}
          href={`${base}?type=${t}`}
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
