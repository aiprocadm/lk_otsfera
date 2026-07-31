import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { DocumentsList } from '@/components/partner/documents-list';
import { DocumentsPanel } from '@/components/documents/documents-panel';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

type SearchParams = { tab?: string };

function TabChips({ activeTab }: { activeTab: 'orders' | 'general' }) {
  return (
    <div className="flex gap-2">
      <Link
        href="/admin/documents"
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          activeTab === 'orders'
            ? 'bg-[#F97316] text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        По заказам
      </Link>
      <Link
        href="/admin/documents?tab=general"
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

export default async function AdminDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const isGeneral = sp.tab === 'general';

  if (isGeneral) {
    const rows = await prisma.document.findMany({
      where: { orderId: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        type: true,
        direction: true,
        signedAt: true,
        createdAt: true,
        size: true,
      },
    });

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
      orderTitle: null,
    }));

    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-[#111111]">Документы</h1>
        <TabChips activeTab="general" />
        <DocumentsList
          rows={documentRows}
          downloadEndpointBase="/api/documents"
          cardHrefBase="/admin/documents"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admin · Documents</h1>
      <TabChips activeTab="orders" />
      <DocumentsPanel />
    </div>
  );
}
