import React from 'react';
import { redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { canSeeOrder } from '@/lib/auth/organizationPolicy';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgOrderHeader } from '@/components/organization/org-order-header';
import { OrgOrderAmounts } from '@/components/organization/org-order-amounts';
import { OrgOrderTimeline } from '@/components/organization/org-order-timeline';
import { OrgPaymentsList } from '@/components/organization/org-payments-list';
import { DocumentsList } from '@/components/partner/documents-list';
import { OrderComments } from '@/components/partner/order-comments';
import { OrganizationDocumentUploadForm } from '@/components/organization/organization-document-upload-form';
import { OrderItemsSection } from '@/components/training/order-items-section';
import { OrderCustomFields } from '@/components/orders/order-custom-fields';
import { getOrgOrder, listOrgOrderComments } from '@/lib/services/organization/orders';
import { orgOrderScope } from '@/lib/services/organization/memberScope';
import { getValuesForEntity } from '@/lib/services/customFields';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { missingObjectHref } from '@/lib/navigation/missingObject';

type Params = { id: string };
type SearchParams = { org?: string };

export default async function OrganizationOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgPageContext(sp);

  // Список раздела с активной организацией: и для крошек, и для ответа
  // «объект недоступен» — человек остаётся в той организации, где был.
  const listHref = sp.org
    ? `/organization/orders?org=${encodeURIComponent(sp.org)}`
    : '/organization/orders';

  // `У-232` (спека §3.7): удалённый или чужой заказ → список раздела с плашкой
  // «объект недоступен», а не 404. Ответ один для обоих случаев (§4).
  // `У-236`: карточка сужается тем же скоупом, что и список.
  const scope = await orgOrderScope(prisma, ctx.session, ctx.activeOrgId);
  const order = await getOrgOrder(prisma, ctx.activeOrgId, id, scope);
  if (!order) redirect(missingObjectHref(listHref));

  // Defense-in-depth: even though the service already scoped by orgId,
  // re-check via canSeeOrder so a future refactor to the service can't
  // accidentally widen the trust boundary.
  if (
    !canSeeOrder(
      ctx.session,
      { organizationId: order.organizationId, ownedByViewer: order.ownedByViewer },
      scope !== null
    )
  ) {
    redirect(missingObjectHref(listHref));
  }

  const [comments, customFieldsResult] = await Promise.all([
    listOrgOrderComments(prisma, order.id),
    getValuesForEntity(prisma, ctx.session, 'order', order.id),
  ]);
  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];

  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-4">
        {/* `У-72`: крошки вместо одиночной ссылки «назад» — человек видит и
            раздел, и где он внутри него. */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs(
            'organization',
            '/organization/orders',
            [{ label: order.orderNumber ? `Заказ №${order.orderNumber}` : 'Заказ' }],
            { sectionHref: listHref }
          )}
        />

        <OrgOrderHeader order={order} />

        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            <OrgOrderAmounts order={order} />

            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[#111111]">
                Документы{' '}
                {order.documents.length > 0 && (
                  <span className="text-gray-400 font-normal">({order.documents.length})</span>
                )}
              </h2>
              <DocumentsList
                rows={order.documents}
                downloadEndpointBase="/api/organization/documents"
                downloadEndpointQuery={sp.org ? `?org=${encodeURIComponent(sp.org)}` : ''}
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

            <OrderCustomFields fields={customFields} orderId={order.id} editable={false} />

            <OrderComments comments={comments} orderId={order.id} />
          </div>

          <div className="space-y-4">
            <OrgOrderTimeline order={order} />
          </div>
        </div>
      </div>
    </OrgAppShell>
  );
}
