import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { PaymentImportForm } from '@/components/import/payment-import-form';
import { PaymentQueueTable, type QueueRow } from '@/components/import/payment-queue-table';
import { listQueue } from '@/lib/services/import/oneCAccountCard';

export const dynamic = 'force-dynamic';

export default async function ManagerPaymentsImportPage() {
  const session = await requireManager();
  const raw = await listQueue(prisma, session);
  const orgIds = raw.map((r) => r.candidateOrgId).filter((x): x is string => !!x);
  const orgs = orgIds.length ? await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const rows: QueueRow[] = raw.map((r) => ({
    id: r.id, externalId: r.externalId, paidAt: r.paidAt.toISOString(), amount: String(r.amount), isRefund: r.isRefund,
    purpose: r.purpose, counterpartyName: r.counterpartyName, counterpartyInn: r.counterpartyInn,
    accountCandidates: (r.accountCandidates as string[]) ?? [], candidateOrgName: r.candidateOrgId ? orgName.get(r.candidateOrgId) ?? null : null, matchMethod: r.matchMethod,
  }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#111111]">Импорт оплат (Карточка счёта 51)</h1>
        <p className="text-sm text-gray-500 mt-0.5">Загрузите выгрузку 1С «Карточка счёта 51». Несопоставленные оплаты попадают в очередь разбора.</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6"><PaymentImportForm /></div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-[#111111] mb-3">Очередь ручного разбора</h2>
        <PaymentQueueTable rows={rows} />
      </div>
    </div>
  );
}
