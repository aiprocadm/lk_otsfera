import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { DocumentsList } from '@/components/partner/documents-list';
import { DocumentsPanel } from '@/components/documents/documents-panel';
import { listGeneralDocuments } from '@/lib/services/documents/generalList';

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
    const documentRows = await listGeneralDocuments(prisma);

    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-[#111111]">Документы</h1>
        {/* `У-73`: одна строка «что здесь делают». */}
        <p className="text-sm text-gray-500 mt-0.5">
          Договоры, счета и акты по всем клиентам платформы
        </p>
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
