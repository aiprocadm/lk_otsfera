import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { PaymentImportForm } from '@/components/import/payment-import-form';
import { PaymentQueueTable, type QueueRow } from '@/components/import/payment-queue-table';
import { listQueue, listQueueOrgNames } from '@/lib/services/import/oneCAccountCard';

export const metadata: Metadata = { title: 'Выписка по счёту 51 · Обмен с 1С · Настройки' };

export const dynamic = 'force-dynamic';

export default async function AdminPaymentsImportPage() {
  const session = await requireSettingsSection('integrations.oneC', 'admin');
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
  }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Импорт выписки (Карточка счёта 51)</h1>
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
        листов используйте «Загрузка Excel», а для автоматического обмена по сети — «Синхронизация
        (авто)».
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
