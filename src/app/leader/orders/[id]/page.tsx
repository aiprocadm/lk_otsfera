import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import {
  loadManagerOrderDetail,
  listOrderStudentOptions,
} from '@/lib/services/manager/orderDetail';
import { getDealActivity } from '@/lib/services/manager/dealActivity';
import { listDirections } from '@/lib/services/training';
import { getValuesForEntity } from '@/lib/services/customFields';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';
import { GenerateDocumentsPanel } from '@/components/manager/generate-documents-panel';
import { getDocumentGenerationPanel } from '@/lib/services/documents/generationPanel';
import { LeaderAssignOrderManagerForm } from '@/components/leader/leader-assign-order-manager-form';
import { getOrderStatusPanel } from '@/lib/services/orderStatuses';
import { loadOrderDeal } from '@/lib/services/manager/orderDetail';
import { OrderDealPanel } from '@/components/orders/order-deal-panel';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { getOrderLinesPanel } from '@/lib/services/orders/linesPanel';
import { OrderLinesSection } from '@/components/orders/order-lines-section';

export default async function LeaderOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManagerLeader();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();

  const [directionsResult, students, customFieldsResult, activity, companyManagers] =
    await Promise.all([
      listDirections(prisma, session),
      listOrderStudentOptions(prisma, data.order.organizationId),
      getValuesForEntity(prisma, session, 'order', id),
      getDealActivity(prisma, session, id, { view: 'all' }),
      // A3: кандидаты для формы назначения — активные менеджеры компании
      // руководителя (C8: граница — компания; без companyId кандидатов нет).
      session.companyId ? listCompanyManagers(prisma, session.companyId) : Promise.resolve([]),
    ]);
  const directions = directionsResult.ok ? directionsResult.directions : [];
  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];
  const activityItems = activity.ok ? activity.items : [];
  const inboundEnabled = isFeatureEnabled('inbound_messaging');
  const telephonyEnabled = isFeatureEnabled('telephony_mango');
  const candidates = companyManagers
    .filter((m) => m.isActive)
    .map((m) => ({ id: m.id, email: m.email, name: m.name }));

  // §10 ТЗ v0.5: данные панели рабочего статуса — считает сервер, чтобы
  // кнопки совпадали с тем, что реально разрешит сервис перехода.
  // `У-144`: панель выпуска документов — ТОТ ЖЕ компонент, что у менеджера и
  // админа (правило зеркала §0.2). До этапа 6 она была смонтирована только у
  // менеджера, и руководитель с админом выпустить документ не могли (`Д-13`).
  let generatePanel: React.ReactNode = null;
  if (
    isFeatureEnabled('document_generation') &&
    data.order.organizationId &&
    data.order.companyId
  ) {
    const panel = await getDocumentGenerationPanel(prisma, {
      orderId: id,
      companyId: data.order.companyId,
      organizationId: data.order.organizationId,
    });
    generatePanel = (
      <GenerateDocumentsPanel
        orderId={id}
        counterpartyName={panel.counterpartyName}
        orderLines={panel.orderLines}
        missingByType={panel.missingByType}
        baseDocuments={panel.baseDocuments}
        hasInvoice={panel.hasInvoice}
        hasContract={panel.hasContract}
      />
    );
  }

  const statusPanel = await getOrderStatusPanel(prisma, session, id);

  // Этап 5 (`У-139`, `У-140`): состав и стоимость — тот же блок, что у
  // менеджера и админа (правило зеркала §0.2: один объект — одно место).
  const linesPanel = await getOrderLinesPanel(prisma, session, id);

  // Сделка, из которой вырос заказ (19.08.2026). Флаг уважаем: при
  // выключенном `deals_pipeline` раздела сделок нет, панель не читается.
  const deal =
    isFeatureEnabled('deals_pipeline') && session.companyId
      ? await loadOrderDeal(prisma, id, { companyId: session.companyId })
      : null;

  return (
    <div className="space-y-5">
      <ManagerOrderDetailView
        breadcrumbs={buildCabinetBreadcrumbs('leader', '/leader/orders', [
          {
            label: data.order.orderNumber ? `Заказ №${data.order.orderNumber}` : data.order.title,
          },
        ])}
        statusPanel={statusPanel}
        data={data}
        backHref="/leader/orders"
        directions={directions}
        students={students}
        customFields={customFields}
        activityItems={activityItems}
        inboundEnabled={inboundEnabled}
        telephonyEnabled={telephonyEnabled}
        generatePanel={generatePanel}
        linesSection={
          linesPanel ? (
            <OrderLinesSection
              orderId={id}
              view={linesPanel.view}
              catalog={linesPanel.catalog}
              canEdit
            />
          ) : null
        }
        dealPanel={
          deal ? (
            /* Лидов в кабинете руководителя нет — имя лида остаётся текстом. */
            <OrderDealPanel deal={deal} dealsHref="/leader/deals" leadHrefBase={null} />
          ) : null
        }
      />
      {/* Форма назначения — leader-only, поэтому монтируется рядом с общей
          деталкой (после неё: back-link и h1 заказа остаются первыми в потоке),
          а не внутри ManagerOrderDetailView (§4 sibling-rule). */}
      <LeaderAssignOrderManagerForm
        orderId={data.order.id}
        currentManagerId={data.order.managerId}
        candidates={candidates}
      />
    </div>
  );
}
