import Link from 'next/link';
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
          <Link href={backHref} className='text-gray-500 hover:text-[#F97316]'>
            ← Все заказы
          </Link>
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
              <DocumentsList rows={order.documents} />
            </div>

            <OrgPaymentsList payments={order.payments} />

            <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-2'>
              <h2 className='text-sm font-semibold text-[#111111]'>Комментарии</h2>
              <p className='text-sm text-gray-500'>
                {order.commentsCount > 0
                  ? `${order.commentsCount} ${pluralizeComments(order.commentsCount)} — будут видны здесь в Phase 7.4`
                  : 'Комментарии скоро появятся в этой секции (Phase 7.4).'}
              </p>
            </div>
          </div>

          <div className='space-y-4'>
            <OrgOrderTimeline order={order} />
          </div>
        </div>
      </div>
    </OrgAppShell>
  );
}

function pluralizeComments(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'комментарий';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'комментария';
  return 'комментариев';
}
