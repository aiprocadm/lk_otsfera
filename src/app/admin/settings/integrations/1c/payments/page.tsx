import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { PaymentImportForm } from '@/components/import/payment-import-form';
import { PaymentQueueTable } from '@/components/import/payment-queue-table';
import { loadQueuePage } from '@/lib/services/import/oneCAccountCard/queue-view';

import { PageHeader } from '@/components/ui/page-header';
export const metadata: Metadata = { title: 'Выписка по счёту 51 · Обмен с 1С · Настройки' };

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/settings/integrations/1c/payments';

export default async function AdminPaymentsImportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSettingsSection('integrations.oneC', 'admin');
  const sp = (await searchParams) ?? {};
  // `У-90`: страница очереди со счётчиком и фильтрами — разбор адреса и
  // приведение строк живут в сервисе, экран остаётся тонким.
  const queue = await loadQueuePage(prisma, session, sp);
  // Т-30/Т-41/`У-50`: admin выбирает компанию новой организации — и в диалоге
  // создания из очереди, и для организаций, которые заведёт сам импорт (`У-49`).
  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Импорт оплат"
          subtitle="Загрузите выгрузку 1С «Карточка счёта 51» — банковскую выписку по расчётному счёту. Оплаты клиентов (корр-счёт 62) импортируются; несопоставленные попадают в очередь разбора ниже."
        />
      </div>
      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Здесь только оплаты из банковской выписки. Для загрузки заказов и оплат «чистым» файлом из 3
        листов используйте «Загрузка Excel», а для автоматического обмена по сети — «Синхронизация
        (авто)».
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <PaymentImportForm companies={companies} />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-[#111111] mb-3">Очередь ручного разбора</h2>
        <PaymentQueueTable
          rows={queue.rows}
          companies={companies}
          total={queue.total}
          take={queue.take}
          skip={queue.skip}
          basePath={BASE_PATH}
          searchParams={sp}
        />
      </div>
    </div>
  );
}
