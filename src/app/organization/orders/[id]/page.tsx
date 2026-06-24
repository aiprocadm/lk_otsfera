import { BackLink } from '@/components/ui';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { canSeeOrder } from '@/lib/auth/organizationPolicy';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgOrderHeader } from '@/components/organization/org-order-header';
import { OrgOrderAmounts } from '@/components/organization/org-order-amounts';
import { OrgOrderTimeline } from '@/components/organization/org-order-timeline';
import { OrgPaymentsList } from '@/components/organization/org-payments-list';
import { DocumentsList } from '@/components/partner/documents-list';
import { DealComments } from '@/components/partner/deal-comments';
import { OrganizationDocumentUploadForm } from '@/components/organization/organization-document-upload-form';
import { OrderItemsSection } from '@/components/training/order-items-section';
import type { DealCommentRow } from '@/lib/services/partner/dealDetail';
import { getOrgOrder } from '@/lib/services/organization/orders';

type Params = { id: string };
type SearchParams = { org?: string };

export default async function OrganizationOrderDetailPage({
  params,
  searchParams
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgPageContext(sp);

  const order = await getOrgOrder(prisma, ctx.activeOrgId, id);
  if (!order) notFound();

  // Defense-in-depth: even though the service already scoped by orgId,
  // re-check via canSeeOrder so a future refactor to the service can't
  // accidentally widen the trust boundary.
  if (!canSeeOrder(ctx.session, { organizationId: order.organizationId })) {
    notFound();
  }

  const commentRows = await prisma.comment.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { name: true } } }
  });
  const comments: DealCommentRow[] = commentRows.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    authorName: c.author.name
  }));

  const backHref = sp.org
    ? `/organization/orders?org=${encodeURIComponent(sp.org)}`
    : '/organization/orders';

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-4'>
        <div className='text-sm'>
          <BackLink href={backHref} label='Все заказы' />
        </div>

        <OrgOrderHeader order={order} />

        <div className='grid gap-4 md:grid-cols-3'>
          <div className='md:col-span-2 space-y-4'>
            <OrgOrderAmounts order={order} />

            <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
              <h2 className='text-sm font-semibold text-[#111111]'>
                Документы{' '}
                {order.documents.length > 0 && (
                  <span className='text-gray-400 font-normal'>({order.documents.length})</span>
                )}
              </h2>
              <DocumentsList
                rows={order.documents}
                downloadEndpointBase='/api/organization/documents'
                downloadEndpointQuery={
                  sp.org ? `?org=${encodeURIComponent(sp.org)}` : ''
                }
              />
              <OrganizationDocumentUploadForm organizationId={ctx.activeOrgId} orderId={order.id} />
            </div>

            <OrgPaymentsList payments={order.payments} />

            <OrderItemsSection
              orderId={order.id}
              canEdit={false}
              items={order.items}
              directions={[]}
              students={[]}
            />

            <DealComments comments={comments} orderId={order.id} />
          </div>

          <div className='space-y-4'>
            <OrgOrderTimeline order={order} />
          </div>
        </div>
      </div>
    </OrgAppShell>
  );
}

