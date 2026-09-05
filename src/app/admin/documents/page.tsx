import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { StaffDocumentsPushList } from '@/components/documents/staff-documents-push-list';
import { OneCPushStatusSelect } from '@/components/documents/one-c-push-status-select';
import { DocumentsPanel } from '@/components/documents/documents-panel';
import { listGeneralDocuments } from '@/lib/services/documents/generalList';
import { parseOneCPushStatus } from '@/lib/documents/oneCPushStatus';
import { PageHeader } from '@/components/ui/page-header';
import { ListCapNotice } from '@/components/ui';

type SearchParams = { tab?: string; oneCPushStatus?: string };

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
    // `У-169`: фильтр «Выгрузка в 1С» и массовая выгрузка — зеркало экрана
    // сотрудников. Вкладка «По заказам» пока на прежней панели (см. план PR-5).
    const oneCPushStatus = parseOneCPushStatus(sp.oneCPushStatus);
    const { rows: documentRows, total } = await listGeneralDocuments(prisma, { oneCPushStatus });

    return (
      <div className="space-y-4">
        <PageHeader
          title="Документы"
          subtitle="Договоры, счета и акты по всем клиентам платформы"
        />
        <TabChips activeTab="general" />
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="general" />
          <OneCPushStatusSelect value={sp.oneCPushStatus} />
          <button
            type="submit"
            className="px-3 py-1 bg-[#F97316] text-white rounded text-sm hover:bg-[#EA580C]"
          >
            Показать
          </button>
        </form>
        <StaffDocumentsPushList
          rows={documentRows}
          downloadEndpointBase="/api/documents"
          cardHrefBase="/admin/documents"
          resetHref={oneCPushStatus ? '/admin/documents?tab=general' : undefined}
        />
        {/* `С-6`: список режется по 200 — человек должен видеть, что это не всё. */}
        <ListCapNotice shown={documentRows.length} total={total} />
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
