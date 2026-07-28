import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { getDealActivity } from '@/lib/services/manager/dealActivity';
import { listDirections } from '@/lib/services/training';
import { getValuesForEntity } from '@/lib/services/customFields';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';
import { GenerateDocumentsPanel } from '@/components/manager/generate-documents-panel';
import { listMissingRequisites, type MissingRequisite } from '@/lib/documents/requisites-check';
import { getOrderReadiness } from '@/lib/services/manager/orderDelivery';
import { OrderReadinessPanel } from '@/components/manager/order-readiness-panel';
import { listCertificateScanTargets } from '@/lib/services/manager/certificateScans';
import { CertificateScansPanel } from '@/components/manager/certificate-scans-panel';
import { buildOrderBreadcrumbs } from '@/lib/navigation/breadcrumbs';

export default async function ManagerOrderDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManager();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();

  const [directionsResult, students, customFieldsResult, activity] = await Promise.all([
    listDirections(prisma, session),
    prisma.student.findMany({
      where: { organizationId: data.order.organizationId ?? undefined },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' }
    }),
    getValuesForEntity(prisma, 'order', id),
    getDealActivity(prisma, session, id, { view: 'all' })
  ]);
  const directions = directionsResult.ok ? directionsResult.directions : [];
  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];
  const activityItems = activity.ok ? activity.items : [];
  const inboundEnabled = isFeatureEnabled('inbound_messaging');
  const telephonyEnabled = isFeatureEnabled('telephony_mango');

  // Этап 8 (ФТ-9.4/9.5): панель генерации счёта/акта — за флагом; данные собирает страница.
  let generatePanel: React.ReactNode = null;
  if (isFeatureEnabled('document_generation') && data.order.organizationId && data.order.companyId) {
    const REQ = {
      name: true, legalName: true, inn: true, kpp: true, legalAddress: true, bankName: true,
      bankAccount: true, corrAccount: true, bic: true, signerName: true, signerPosition: true
    } as const;
    const [company, organization, invoiceCount] = await Promise.all([
      prisma.company.findUnique({ where: { id: data.order.companyId }, select: REQ }),
      prisma.organization.findUnique({ where: { id: data.order.organizationId }, select: REQ }),
      prisma.document.groupBy({
        by: ['type'],
        where: { orderId: id, type: { in: ['invoice', 'contract'] }, generatedBy: 'system' },
        _count: { _all: true }
      })
    ]);
    const missing: MissingRequisite[] =
      company && organization ? listMissingRequisites(company, organization) : [];
    const generatedTypes = new Set(invoiceCount.map((row) => row.type));
    generatePanel = (
      <GenerateDocumentsPanel
        orderId={id}
        missing={missing}
        hasInvoice={generatedTypes.has('invoice')}
        hasContract={generatedTypes.has('contract')}
      />
    );
  }

  // Этап 12 (Модуль 5, ФТ-5.1/5.2): готовность к передаче + кнопка передачи.
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
  const deal = isFeatureEnabled('deals_pipeline')
    ? await prisma.deal.findUnique({
        where: { orderId: id },
        select: {
          title: true,
          lead: {
            select: {
              id: true,
              clientCompanyName: true,
              sourceRequest: { select: { id: true, subject: true } }
            }
          }
        }
      })
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
                sourceRequest: deal.lead.sourceRequest
              }
            : null
        }
      : null
  });

  return (
    <ManagerOrderDetailView
      breadcrumbs={breadcrumbs}
      data={data}
      backHref='/manager/orders'
      directions={directions}
      students={students}
      customFields={customFields}
      activityItems={activityItems}
      inboundEnabled={inboundEnabled}
      telephonyEnabled={telephonyEnabled}
      generatePanel={generatePanel}
      readinessPanel={readinessPanel}
      certificateScansPanel={certificateScansPanel}
    />
  );
}