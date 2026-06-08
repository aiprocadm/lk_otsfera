import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { importScope } from './scope';
import { planImport } from './plan-import';
import { mapPaymentRow } from './payment-mapper';
import type { ImportCounts, OrgFileRow, OrderFileRow, PaymentFileRow } from './types';

type Rows = { orgs: OrgFileRow[]; orders: OrderFileRow[]; payments: PaymentFileRow[] };

export async function commitImport(
  prisma: PrismaClient,
  session: SessionPayload,
  rows: Rows,
): Promise<{ applied: ImportCounts; skipped: { orgs: unknown[]; orders: unknown[]; payments: unknown[] } }> {
  const scope = importScope(session);

  const [orgs, partners] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, inn: true } }),
    prisma.partner.findMany({ select: { id: true, inn: true } }),
  ]);

  const orgIdByInn = new Map(orgs.filter((o) => o.inn).map((o) => [o.inn as string, o.id]));
  const partnerIdByInn = new Map(
    partners.filter((p) => p.inn).map((p) => [p.inn as string, p.id]),
  );

  const plan = planImport(rows, { orgIdByInn, partnerIdByInn }, scope);

  const applied: ImportCounts = {
    orgsCreated: 0,
    orgsUpdated: 0,
    orgsStandalone: 0,
    ordersUpserted: 0,
    paymentsUpserted: 0,
  };

  // Build index sets from the plan's skipped arrays (avoids O(n²) reference equality)
  const skippedOrgInn = new Set(plan.skipped.orgs.map((s) => rows.orgs[s.rowIndex].inn));
  const skippedOrderIdx = new Set(plan.skipped.orders.map((s) => s.rowIndex));
  const skippedPaymentIdx = new Set(plan.skipped.payments.map((s) => s.rowIndex));

  await prisma.$transaction(async (tx) => {
    // --- Orgs ---
    for (const o of rows.orgs) {
      if (skippedOrgInn.has(o.inn)) continue;

      const partnerId = o.partnerInn ? (partnerIdByInn.get(o.partnerInn) ?? null) : null;
      const existing = orgIdByInn.get(o.inn);

      const up = await tx.organization.upsert({
        where: { inn: o.inn },
        create: {
          name: o.name,
          inn: o.inn,
          partnerId,
          companyId: session.companyId ?? null,
        },
        update: { name: o.name, partnerId },
        select: { id: true },
      });

      // Keep the in-memory map fresh so subsequent order/payment rows can resolve INN→id
      orgIdByInn.set(o.inn, up.id);

      if (existing) {
        applied.orgsUpdated++;
      } else {
        applied.orgsCreated++;
      }
      if (!partnerId) applied.orgsStandalone++;
    }

    // --- Orders ---
    for (let i = 0; i < rows.orders.length; i++) {
      if (skippedOrderIdx.has(i)) continue;

      const ord = rows.orders[i];
      const orgId = orgIdByInn.get(ord.orgInn);
      if (!orgId) continue;

      // companyId is required (NOT NULL) on Order. Use session.companyId when available.
      // If null (edge case — session without companyId), fall back to orgId solely to
      // satisfy the NOT NULL constraint.
      // TODO tenancy: confirm against sample — session.companyId should always be set for
      // manager/admin sessions; if it can be null in production, a proper tenancy resolver is needed.
      const companyId = session.companyId ?? orgId;

      await tx.order.upsert({
        where: { externalId: ord.externalId },
        create: {
          externalId: ord.externalId,
          orderNumber: ord.orderNumber,
          title: ord.orderNumber ?? ord.externalId, // required field, no default
          organizationId: orgId,
          companyId,
          totalAmount: ord.totalAmount,
          paidAmount: ord.paidAmount,
          // Fields with schema defaults (listed explicitly for clarity):
          // status: 'new', executionStatus: 'pending', financialStatus: 'not_billed',
          // vatIncluded: true
        },
        update: {
          totalAmount: ord.totalAmount,
          paidAmount: ord.paidAmount,
          organizationId: orgId,
        },
        select: { id: true },
      });

      applied.ordersUpserted++;
    }

    // --- Payments ---
    for (let i = 0; i < rows.payments.length; i++) {
      if (skippedPaymentIdx.has(i)) continue;

      const pay = rows.payments[i];
      const orgId = orgIdByInn.get(pay.orgInn);
      if (!orgId) continue;

      const data = mapPaymentRow(pay, orgId);
      await tx.payment.upsert({
        where: { externalId: pay.externalId },
        create: data,
        update: data,
      });

      applied.paymentsUpserted++;
    }
  });

  // Fire-and-forget audit log — failures must not block the main commit path
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'one_c_import.commit',
    entity: 'one_c_import',
    entityId: session.companyId ?? session.sub,
    after: {
      applied,
      skipped: {
        orgs: plan.skipped.orgs.length,
        orders: plan.skipped.orders.length,
        payments: plan.skipped.payments.length,
      },
    },
  });

  return { applied, skipped: plan.skipped };
}
