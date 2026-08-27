import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import {
  loadManagerOrderDetail,
  listOrderStudentOptions,
  loadOrderDeal,
} from '@/lib/services/manager/orderDetail';
import { getDealActivity } from '@/lib/services/manager/dealActivity';
import { listDirections } from '@/lib/services/training';
import { getValuesForEntity } from '@/lib/services/customFields';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';
import { GenerateDocumentsPanel } from '@/components/manager/generate-documents-panel';
import { getDocumentGenerationPanel } from '@/lib/services/documents/generationPanel';
import { getOrderReadiness } from '@/lib/services/manager/orderDelivery';
import { OrderReadinessPanel } from '@/components/manager/order-readiness-panel';
import { listCertificateScanTargets } from '@/lib/services/manager/certificateScans';
import { CertificateScansPanel } from '@/components/manager/certificate-scans-panel';
import { buildOrderBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { OrderDealPanel } from '@/components/orders/order-deal-panel';
import { getOrderStatusPanel } from '@/lib/services/orderStatuses';
import { getOrderLinesPanel } from '@/lib/services/orders/linesPanel';
import { OrderLinesSection } from '@/components/orders/order-lines-section';

export default async function ManagerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManager();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();

  const [directionsResult, students, customFieldsResult, activity] = await Promise.all([
    listDirections(prisma, session),
    listOrderStudentOptions(prisma, data.order.organizationId),
    getValuesForEntity(prisma, session, 'order', id),
    getDealActivity(prisma, session, id, { view: 'all' }),
  ]);
  const directions = directionsResult.ok ? directionsResult.directions : [];
  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];
  const activityItems = activity.ok ? activity.items : [];
  const inboundEnabled = isFeatureEnabled('inbound_messaging');
  const telephonyEnabled = isFeatureEnabled('telephony_mango');

  // Этап 8 (ФТ-9.4/9.5): панель генерации счёта/акта — за флагом; данные для неё
  // собирает сервис документов, страница только монтирует компонент.
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
        missing={panel.missing}
        hasInvoice={panel.hasInvoice}
        hasContract={panel.hasContract}
      />
    );
  }

  // Этап 12 (Модуль 5, ФТ-5.1/5.2): готовность к передаче + кнопка передачи.
  // §10 ТЗ v0.5: данные панели рабочего статуса — считает сервер, чтобы
  // кнопки совпадали с тем, что реально разрешит сервис перехода.
  const statusPanel = await getOrderStatusPanel(prisma, session, id);

  // Этап 5 (`У-139`, `У-140`): строки заказа и каталог для подстановки.
  // Права и режим «только чтение» (заказ из 1С) решает сервис — страница
  // просто монтирует блок, если он вообще доступен.
  const linesPanel = await getOrderLinesPanel(prisma, session, id);

  const readinessResult = await getOrderReadiness(prisma, session, id);
  const readinessPanel = readinessResult.ok ? (
    <OrderReadinessPanel
      orderId={id}
      serviceType={data.order.serviceType as 'training' | 'document_development'}
      readiness={readinessResult.readiness}
      deliveredAt={readinessResult.deliveredAt ? readinessResult.deliveredAt.toISOString() : null}
      deliverablesApproved={data.order.deliverablesApprovedAt != null}
    />
  ) : null;

  // Этап 12 PR-2 (ФТ-5.3): массовая загрузка сканов — только для заказов обучения,
  // у документов на разработку удостоверений нет.
  let certificateScansPanel: React.ReactNode = null;
  if (data.order.serviceType === 'training' && !data.order.resultDeliveredAt) {
    const targetsResult = await listCertificateScanTargets(prisma, session, id);
    if (targetsResult.ok) {
      certificateScansPanel = (
        <CertificateScansPanel orderId={id} targets={targetsResult.targets} />
      );
    }
  }

  // Этап 11 PR-2 (ФТ-15.6): цепочка обращение → лид → сделка → заказ.
  // Дочитывается одним запросом и только когда сделки включены — иначе крошка
  // вела бы на выключенный флагом раздел.
  // Сотрудник без компании границы изоляции не имеет — деградируем в
  // «ничего», а не в «видно всё» (тот же принцип, что у sentinel-веток чата).
  const deal =
    isFeatureEnabled('deals_pipeline') && session.companyId
      ? await loadOrderDeal(prisma, id, { companyId: session.companyId })
      : null;
  const breadcrumbs = buildOrderBreadcrumbs({
    orderNumber: data.order.orderNumber,
    title: data.order.title,
    deal: deal
      ? {
          title: deal.title,
          lead: deal.lead
            ? {
                id: deal.lead.id,
                title: deal.lead.clientCompanyName,
                sourceRequest: deal.lead.sourceRequest,
              }
            : null,
        }
      : null,
  });

  return (
    <ManagerOrderDetailView
      statusPanel={statusPanel}
      breadcrumbs={breadcrumbs}
      data={data}
      backHref="/manager/orders"
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
      readinessPanel={readinessPanel}
      certificateScansPanel={certificateScansPanel}
      dealPanel={
        deal ? (
          <OrderDealPanel deal={deal} dealsHref="/manager/deals" leadHrefBase="/manager/leads" />
        ) : null
      }
    />
  );
}
