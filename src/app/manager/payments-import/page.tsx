import React from 'react';
import { redirect } from 'next/navigation';
import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import LeaderPaymentsImportPage from '@/app/leader/settings/integrations/1c/payments/page';
import { requireManager } from '@/lib/auth/requireRole';
import { isManagerLeader, mayImportOneC } from '@/lib/auth/managerPolicy';
import { prisma } from '@/lib/db/prisma';
import { PaymentImportForm } from '@/components/import/payment-import-form';
import { PaymentQueueTable, type QueueRow } from '@/components/import/payment-queue-table';
import { listQueue, listQueueOrgNames } from '@/lib/services/import/oneCAccountCard';

export const dynamic = 'force-dynamic';

/**
 * Импорт банковской выписки в кабинете менеджера.
 *
 * **Решение заказчика 11.08.2026:** импорт доступен и обычному менеджеру.
 * Руководитель уходит в свой хаб настроек, у обычного менеджера хаба нет —
 * страница рисуется здесь. Очередь разбора уже отскоуплена сервисом: менеджер
 * видит строки только своих организаций (§4 — граница в сервисе, не в экране).
 */
export default async function ManagerPaymentsImportPage() {
  const session = await requireManager();
  if (isManagerLeader(session)) {
    redirectToSettingsHub('/manager/payments-import');
    return LeaderPaymentsImportPage();
  }
  if (!mayImportOneC(session)) redirect('/forbidden');

  const raw = await listQueue(prisma, session);
  const orgIds = raw.map((r) => r.candidateOrgId).filter((x): x is string => !!x);
  const orgName = await listQueueOrgNames(prisma, orgIds);
  const rows: QueueRow[] = raw.map((r) => ({
    id: r.id,
    externalId: r.externalId,
    paidAt: r.paidAt.toISOString(),
    amount: String(r.amount),
    isRefund: r.isRefund,
    purpose: r.purpose,
    counterpartyName: r.counterpartyName,
    counterpartyInn: r.counterpartyInn,
    accountCandidates: (r.accountCandidates as string[]) ?? [],
    candidateOrgId: r.candidateOrgId,
    candidateOrgName: r.candidateOrgId ? (orgName.get(r.candidateOrgId) ?? null) : null,
    matchMethod: r.matchMethod,
    batchCompanyId: r.batch.companyId,
  }));

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
        <PaymentQueueTable rows={rows} />
      </div>
    </div>
  );
}
