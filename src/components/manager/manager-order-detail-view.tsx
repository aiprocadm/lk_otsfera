import React from 'react';
import type { TrainingDirection } from '@prisma/client';
import { BackLink, Breadcrumbs } from '@/components/ui';
import type { Crumb } from '@/lib/navigation/breadcrumbs';
import { ManagerOrderHeader } from '@/components/manager/manager-order-header';
import { ClaimOrderButton } from '@/components/manager/claim-order-button';
import { ManagerOrderAmounts } from '@/components/manager/manager-order-amounts';
import { ManagerOrderTimeline } from '@/components/manager/manager-order-timeline';
import { OrderLifecyclePanel } from '@/components/manager/order-lifecycle-panel';
import {
  OrderStatusPanel,
  type OrderStatusPanelProps,
} from '@/components/orders/order-status-panel';
import { ManagerPaymentsList } from '@/components/manager/manager-payments-list';
import { DocumentsList } from '@/components/partner/documents-list';
import { OrderItemsSection } from '@/components/training/order-items-section';
import { OrderCustomFields } from '@/components/orders/order-custom-fields';
import { DealActivityThread } from '@/components/manager/deal-activity/deal-activity-thread';
import type { ManagerOrderDetailData } from '@/lib/services/manager/orderDetail';
import type { FieldWithValue } from '@/lib/services/customFields';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';

type Student = { id: string; name: string; email: string };

export function ManagerOrderDetailView({
  data,
  backHref,
  directions,
  students,
  customFields = [],
  activityItems = [],
  inboundEnabled = false,
  telephonyEnabled = false,
  generatePanel = null,
  readinessPanel = null,
  certificateScansPanel = null,
  statusPanel = null,
  breadcrumbs = [],
}: {
  data: ManagerOrderDetailData;
  backHref: string;
  directions: TrainingDirection[];
  students: Student[];
  customFields?: FieldWithValue[];
  activityItems?: ActivityItem[];
  inboundEnabled?: boolean;
  telephonyEnabled?: boolean;
  /** Этап 8 (PR-2): панель «Сформировать документы» (страница собирает данные). */
  generatePanel?: React.ReactNode;
  /** §10 ТЗ v0.5: данные панели рабочего статуса (страница считает их сервером). */
  statusPanel?: Omit<OrderStatusPanelProps, 'orderId'> | null;
  /** Этап 12 (ФТ-5.1/5.2): блок «Готовность к передаче». */
  readinessPanel?: React.ReactNode;
  /** Этап 12 PR-2 (ФТ-5.3): массовая загрузка сканов удостоверений (только обучение). */
  certificateScansPanel?: React.ReactNode;
  /** Этап 11 PR-2 (ФТ-15.6): цепочка обращение → лид → сделка → заказ. */
  breadcrumbs?: Crumb[];
}) {
  const { order, auditEntries, documentRows, items } = data;

  return (
    <div className="space-y-4">
      {breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <div className="text-sm">
        <BackLink href={backHref} label="Все заказы" />
      </div>

      <ManagerOrderHeader order={order} />

      {/* A2 (§5.3 self-assign): сам компонент скрывается при managerId != null. */}
      <ClaimOrderButton orderId={order.id} managerId={order.managerId} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          <ManagerOrderAmounts order={order} />

          {readinessPanel}
          {certificateScansPanel}
          {generatePanel}

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#111111]">
              Документы{' '}
              {documentRows.length > 0 && (
                <span className="text-gray-400 font-normal">({documentRows.length})</span>
              )}
            </h2>
            <DocumentsList rows={documentRows} downloadEndpointBase="/api/manager/documents" />
          </div>

          <ManagerPaymentsList payments={order.payments} />

          <OrderItemsSection
            orderId={order.id}
            canEdit
            items={items}
            directions={directions}
            students={students}
          />

          <OrderCustomFields fields={customFields} orderId={order.id} editable={true} />

          <DealActivityThread
            orderId={order.id}
            items={activityItems}
            inboundEnabled={inboundEnabled}
            telephonyEnabled={telephonyEnabled}
          />
        </div>

        <div className="space-y-4">
          <ManagerOrderTimeline order={order} auditEntries={auditEntries} />
          {/* §10 ТЗ v0.5, решение заказчика Q3: операционный статус
              (`executionStatus`) убран из интерфейса — у заявки один видимый
              статус, из справочника. Само поле осталось в базе ради
              совместимости и внутренних выборок. */}
          {statusPanel && <OrderStatusPanel orderId={order.id} {...statusPanel} />}
          <OrderLifecyclePanel
            orderId={order.id}
            accountingSigned={order.accountingSignedAt != null}
            returnReason={order.returnReason}
          />
        </div>
      </div>
    </div>
  );
}
