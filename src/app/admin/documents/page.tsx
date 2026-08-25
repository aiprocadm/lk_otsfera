import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { DocumentsList } from '@/components/partner/documents-list';
import { DocumentsPanel } from '@/components/documents/documents-panel';
import { listGeneralDocuments } from '@/lib/services/documents/generalList';
import { PageHeader } from '@/components/ui/page-header';

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
        <PageHeader
          title="Документы"
          subtitle="Договоры, счета и акты по всем клиентам платформы"
        />
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
      {/* Вкладка «По заказам» открывается по умолчанию — и до 21.08.2026 несла
          английский заголовок без подзаголовка: сторож искал подзаголовок у
          ПЕРВОГО `<h1>` файла и на вторую ветку уже не смотрел. `У-120` это
          чинит: теперь шапку рисует общий компонент, а сторож проверяет
          каждое его появление. */}
      <PageHeader
        title="Документы"
        subtitle="Договоры, счета и акты, привязанные к заказам клиентов"
      />
      <TabChips activeTab="orders" />
      <DocumentsPanel />
    </div>
  );
}
