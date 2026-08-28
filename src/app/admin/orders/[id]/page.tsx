import React from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/ui';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { AssignOrderManagerForm } from '@/components/admin/assign-order-manager-form';
import {
  executionStage,
  paymentStage,
  orderWorkingStage,
  WORKING_STAGE_LABELS,
} from '@/lib/orders/humanStage';
import { OrderStageStepper } from '@/components/orders/order-stage-stepper';
import { getValuesForEntity } from '@/lib/services/customFields';
import { getOrderForAdmin } from '@/lib/services/admin/orders';
import { listManagerCandidates } from '@/lib/services/admin/users';
import { OrderCustomFields } from '@/components/orders/order-custom-fields';
import { OrderDealPanel } from '@/components/orders/order-deal-panel';
import { loadOrderDeal } from '@/lib/services/manager/orderDetail';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { DocumentsPanel } from '@/components/documents/documents-panel';
import { getOrderLinesPanel } from '@/lib/services/orders/linesPanel';
import { OrderLinesSection } from '@/components/orders/order-lines-section';
import { GenerateDocumentsPanel } from '@/components/manager/generate-documents-panel';
import { getDocumentGenerationPanel } from '@/lib/services/documents/generationPanel';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

function fmtMoney(amount: { toNumber(): number } | number | null | undefined): string {
  if (amount == null) return '—';
  const n = typeof amount === 'number' ? amount : amount.toNumber();
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;

  const [order, candidates, customFieldsResult, deal] = await Promise.all([
    getOrderForAdmin(prisma, id),
    listManagerCandidates(prisma),
    getValuesForEntity(prisma, session, 'order', id),
    // Сделка, из которой вырос заказ (19.08.2026). Админ по Model A видит
    // всё, поэтому границы компании у запроса нет.
    isFeatureEnabled('deals_pipeline')
      ? loadOrderDeal(prisma, id, { allCompanies: true })
      : Promise.resolve(null),
  ]);
  if (!order) notFound();

  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];
  // Этап 5 (`У-139`, `У-140`): состав и стоимость. Тот же блок, что у
  // менеджера и руководителя — правило зеркала (§0.2).
  const linesPanel = await getOrderLinesPanel(prisma, session, id);

  // `У-144`: панель выпуска документов — ТОТ ЖЕ компонент, что у менеджера и
  // руководителя (правило зеркала §0.2). До этапа 6 админ выпустить документ
  // не мог (`Д-13`).
  const documentsPanel =
    isFeatureEnabled('document_generation') && order.organizationId && order.companyId
      ? await getDocumentGenerationPanel(prisma, {
          orderId: id,
          companyId: order.companyId,
          organizationId: order.organizationId,
        })
      : null;

  return (
    <div className="space-y-5">
      <div>
        {/* `У-112`: список заказов у админа появился — крошка ведёт в него,
            а не на «Главную», как было при deprecated-редиректе. */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs('admin', '/admin/orders', [
            { label: `Заказ № ${order.orderNumber}` },
          ])}
        />
        <PageHeader title={<>Заказ № {order.orderNumber}</>} subtitle={order.title} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <OrderStageStepper
          stage={orderWorkingStage({
            executionStatus: order.executionStatus,
            contractSignedAt: order.contractSignedAt,
            completedAt: order.completedAt,
            closedAt: order.closedAt,
            amount: Number(order.totalAmount),
            paidTotal: Number(order.paidAmount),
          })}
          labels={[...WORKING_STAGE_LABELS]}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Организация</div>
          <div className="text-sm text-[#111111] mt-1">
            {order.organization ? (
              <Link
                href={`/admin/organizations/${order.organization.id}`}
                className="text-[#F97316] hover:underline"
              >
                {order.organization.name}
              </Link>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Партнёр</div>
          <div className="text-sm text-[#111111] mt-1">{order.partner?.name ?? '—'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Сумма</div>
          <div className="text-sm text-[#111111] mt-1">{fmtMoney(order.totalAmount)}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Исполнение</div>
          <div className="text-sm font-medium text-[#111111] mt-1">
            {executionStage(order.executionStatus).label}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Финансы</div>
          <div className="text-sm font-medium text-[#111111] mt-1">
            {
              paymentStage({
                financialStatus: order.financialStatus,
                amount: Number(order.totalAmount),
                paidTotal: Number(order.paidAmount),
                completed: order.executionStatus === 'completed',
              }).label
            }
          </div>
        </div>
      </div>

      {linesPanel && (
        <OrderLinesSection
          orderId={id}
          view={linesPanel.view}
          catalog={linesPanel.catalog}
          canEdit
        />
      )}

      {/* Зеркала сделок в /admin/* нет (Model A), поэтому панель справочная:
          ни доски, ни карточки лида админу отсюда не предлагаем. */}
      {deal && <OrderDealPanel deal={deal} dealsHref={null} leadHrefBase={null} />}

      {documentsPanel && (
        <GenerateDocumentsPanel
          orderId={order.id}
          counterpartyName={documentsPanel.counterpartyName}
          orderLines={documentsPanel.orderLines}
          missingByType={documentsPanel.missingByType}
          baseDocuments={documentsPanel.baseDocuments}
          hasInvoice={documentsPanel.hasInvoice}
          hasContract={documentsPanel.hasContract}
        />
      )}

      {/* `У-112`: тот же состав блоков, что у менеджера — список документов и
          загрузка, причём номер заказа панель берёт сама. */}
      <DocumentsPanel orderId={order.id} />

      <OrderCustomFields fields={customFields} orderId={order.id} editable={true} />

      <AssignOrderManagerForm
        orderId={order.id}
        currentManagerId={order.managerId}
        candidates={candidates}
      />
    </div>
  );
}
