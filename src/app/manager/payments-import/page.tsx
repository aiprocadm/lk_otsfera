import React from 'react';
import { redirect } from 'next/navigation';
import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import LeaderPaymentsImportPage from '@/app/leader/settings/integrations/1c/payments/page';
import { requireManager } from '@/lib/auth/requireRole';
import { isManagerLeader, mayImportOneC } from '@/lib/auth/managerPolicy';
import { prisma } from '@/lib/db/prisma';
import { PaymentImportForm } from '@/components/import/payment-import-form';
import { PaymentQueueTable } from '@/components/import/payment-queue-table';
import { loadQueuePage } from '@/lib/services/import/oneCAccountCard/queue-view';

export const dynamic = 'force-dynamic';

/**
 * Импорт банковской выписки в кабинете менеджера.
 *
 * **Решение заказчика 11.08.2026:** импорт доступен и обычному менеджеру.
 * Руководитель уходит в свой хаб настроек, у обычного менеджера хаба нет —
 * страница рисуется здесь. Очередь разбора уже отскоуплена сервисом: менеджер
 * видит строки только своих организаций (§4 — граница в сервисе, не в экране).
 */
const BASE_PATH = '/manager/payments-import';

export default async function ManagerPaymentsImportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManager();
  if (isManagerLeader(session)) {
    redirectToSettingsHub('/manager/payments-import');
    // Фильтры и страница очереди переносятся в кабинет руководителя как есть.
    return LeaderPaymentsImportPage({ searchParams: Promise.resolve((await searchParams) ?? {}) });
  }
  if (!mayImportOneC(session)) redirect('/forbidden');

  const sp = (await searchParams) ?? {};
  // `У-90`: страница очереди со счётчиком и фильтрами.
  const queue = await loadQueuePage(prisma, session, sp);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Импорт оплат</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Загрузите выгрузку 1С «Карточка счёта 51» — банковскую выписку по расчётному счёту. Оплаты
          клиентов привязываются к заказам; непонятные строки попадают в очередь разбора ниже.
        </p>
      </div>
      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Здесь только оплаты из банковской выписки. Заказы и клиентов загружают «чистым» файлом на
        странице «Загрузка из 1С».
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
