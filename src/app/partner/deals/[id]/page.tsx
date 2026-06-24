import { notFound, redirect } from 'next/navigation';
import { BackLink } from '@/components/ui';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { getPartnerDealDetail } from '@/lib/services/partner/dealDetail';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { DealHeader } from '@/components/partner/deal-header';
import { DealAmounts } from '@/components/partner/deal-amounts';
import { DealTimeline } from '@/components/partner/deal-timeline';
import { DealComments } from '@/components/partner/deal-comments';
import { DocumentsList } from '@/components/partner/documents-list';
import { PartnerDocumentUploadForm } from '@/components/partner/partner-document-upload-form';
import { OrderItemsSection } from '@/components/training/order-items-section';

export default async function PartnerDealDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePartner();

  const { id } = await params;
  const deal = await getPartnerDealDetail(prisma, {
    dealId: id,
    partnerId: session.partnerId
  });

  if (!deal) notFound();

  if (deal.organization) {
    const accessible = await canPartnerAccessOrg(session, deal.organization.id);
    if (!accessible) redirect('/forbidden');
  }

  return (
    <div className='space-y-4'>
      <div className='text-sm'>
        <BackLink href='/partner/deals' label='Все заказы' />
      </div>

      <DealHeader deal={deal} />

      <div className='grid gap-4 md:grid-cols-3'>
        <div className='md:col-span-2 space-y-4'>
          <DealAmounts deal={deal} />

          <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
            <h2 className='text-sm font-semibold text-[#111111]'>
              Документы {deal.documents.length > 0 && (
                <span className='text-gray-400 font-normal'>({deal.documents.length})</span>
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

          <DealComments comments={deal.comments} orderId={deal.id} />
        </div>

        <div className='space-y-4'>
          <DealTimeline deal={deal} />
        </div>
      </div>
    </div>
  );
}
