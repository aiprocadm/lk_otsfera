import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { getPartnerOrderDetail } from '@/lib/services/partner/orderDetail';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { PartnerOrderHeader } from '@/components/partner/order-header';
import { OrderAmounts } from '@/components/partner/order-amounts';
import { OrderTimeline } from '@/components/partner/order-timeline';
import { OrderComments } from '@/components/partner/order-comments';
import { DocumentsList } from '@/components/partner/documents-list';
import { PartnerDocumentUploadForm } from '@/components/partner/partner-document-upload-form';
import { OrderItemsSection } from '@/components/training/order-items-section';
import { OrderCustomFields } from '@/components/orders/order-custom-fields';
import { getValuesForEntity } from '@/lib/services/customFields';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

export default async function PartnerDealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePartner();

  const { id } = await params;
  const deal = await getPartnerOrderDetail(prisma, {
    orderId: id,
    partnerId: session.partnerId,
  });

  if (!deal) notFound();

  const customFieldsResult = await getValuesForEntity(prisma, session, 'order', deal.id);
  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];

  if (deal.organization) {
    const accessible = await canPartnerAccessOrg(session, deal.organization.id);
    if (!accessible) redirect('/forbidden');
  }

  return (
    <div className="space-y-4">
      <div className="text-sm">
        {/* `У-72`: полный путь до экрана вместо одиночного «назад». */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs('partner', '/partner/orders', [
            { label: deal.orderNumber ? `Заказ №${deal.orderNumber}` : deal.title },
          ])}
        />
      </div>

      <PartnerOrderHeader deal={deal} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          <OrderAmounts deal={deal} />

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#111111]">
              Документы{' '}
              {deal.documents.length > 0 && (
                <span className="text-gray-400 font-normal">({deal.documents.length})</span>
              )}
            </h2>
            <DocumentsList rows={deal.documents} />
            <PartnerDocumentUploadForm orderId={id} />
          </div>

          <OrderItemsSection
            orderId={deal.id}
            canEdit={false}
            items={deal.items}
            directions={[]}
            students={[]}
          />

          <OrderCustomFields fields={customFields} orderId={deal.id} editable={false} />

          <OrderComments comments={deal.comments} orderId={deal.id} />
        </div>

        <div className="space-y-4">
          <OrderTimeline deal={deal} />
        </div>
      </div>
    </div>
  );
}
