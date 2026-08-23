import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { PaymentImportForm } from '@/components/import/payment-import-form';
import { PaymentQueueTable } from '@/components/import/payment-queue-table';
import { loadQueuePage } from '@/lib/services/import/oneCAccountCard/queue-view';

export const metadata: Metadata = { title: 'Выписка по счёту 51 · Обмен с 1С · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * Зеркало админской вкладки для руководителя (этап 7 ТЗ импорта, Т-27).
 * Очередь разбора уже company-scoped по сессии — руководитель видит только
 * строки своей компании.
 */
const BASE_PATH = '/leader/settings/integrations/1c/payments';

export default async function LeaderPaymentsImportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSettingsSection('integrations.oneC', 'leader');
  const sp = (await searchParams) ?? {};
  // `У-90`: страница очереди со счётчиком и фильтрами.
  const queue = await loadQueuePage(prisma, session, sp);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Импорт оплат</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Загрузите выгрузку 1С «Карточка счёта 51» — банковскую выписку по расчётному счёту. Оплаты
          клиентов (корр-счёт 62) импортируются; несопоставленные попадают в очередь разбора ниже.
        </p>
      </div>
      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Здесь только оплаты из банковской выписки. Для загрузки заказов и оплат «чистым» файлом из 3
        листов используйте «Загрузка Excel».
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <PaymentImportForm />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-[#111111] mb-3">Очередь ручного разбора</h2>
        <PaymentQueueTable
          rows={queue.rows}
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
