import type { PrismaClient, Lead, LeadStatus, Order } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';
import { getInitialStatusId } from '@/lib/services/orderStatuses';

/**
 * Manager-side lead lifecycle (T3). Leads are a shared team queue (any manager may
 * claim/process — owner decision 2026-06-14), so these mutations are not org-scoped;
 * RBAC is `requireManager` at the route. Return the §3 Result contract; the route
 * maps error codes to HTTP, matching commission/lifecycle.ts.
 *
 * Transitions: new → in_review → qualified (and one step back), then a dedicated
 * promote (→ promoted_to_order, creates the order) or reject (→ rejected). `promote`
 * and `reject` are NOT reachable via setLeadStatus.
 */

// Allowed manual status moves (excludes terminal promote/reject — those are actions).
const ALLOWED_STATUS: Record<string, LeadStatus[]> = {
  new: ['in_review'],
  in_review: ['new', 'qualified'],
  qualified: ['in_review'],
};

async function loadLead(prisma: PrismaClient, leadId: string) {
  return prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      status: true,
      partnerId: true,
      organizationId: true,
      clientCompanyName: true,
      subject: true,
      estimatedAmount: true,
      promotedOrderId: true,
    },
  });
}

// Generic по union кодов ошибок: `invalid_manager` возможен только в assignLead
// (проверка кандидата при передаче лида) и не «протекает» в setLeadStatus/rejectLead.
type LeadResult<E extends string = 'not_found' | 'lifecycle_violation'> =
  { ok: true; lead: Lead } | { ok: false; error: E };

/**
 * Claim/assign a lead to a manager. From `new`, also advances to `in_review`.
 * B1 (parity): handing over to ANOTHER user requires an existing, active user
 * with role='manager' → otherwise `invalid_manager`. No company check on
 * purpose — leads are a shared team queue (owner decision 2026-06-14 above).
 */
export async function assignLead(
  prisma: PrismaClient,
  args: { leadId: string; managerId: string; assignToUserId?: string }
): Promise<LeadResult<'not_found' | 'lifecycle_violation' | 'invalid_manager'>> {
  const lead = await loadLead(prisma, args.leadId);
  if (!lead) return { ok: false, error: 'not_found' };
  if (lead.status === 'promoted_to_order' || lead.status === 'rejected') {
    return { ok: false, error: 'lifecycle_violation' };
  }
  const assignee = args.assignToUserId ?? args.managerId;
  if (assignee !== args.managerId) {
    const candidate = await prisma.user.findUnique({
      where: { id: assignee },
      select: { role: true, isActive: true },
    });
    if (!candidate || candidate.role !== 'manager' || !candidate.isActive) {
      return { ok: false, error: 'invalid_manager' };
    }
  }
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      assignedManagerId: assignee,
      ...(lead.status === 'new' ? { status: 'in_review' as LeadStatus } : {}),
    },
  });
  await recordAudit(prisma, {
    userId: args.managerId,
    action: 'lead_assigned',
    entity: 'lead',
    entityId: lead.id,
    after: { assignedManagerId: assignee, status: updated.status },
  });
  return { ok: true, lead: updated };
}

/** Move a lead between non-terminal statuses (new/in_review/qualified). */
export async function setLeadStatus(
  prisma: PrismaClient,
  args: { leadId: string; managerId: string; status: LeadStatus }
): Promise<LeadResult> {
  const lead = await loadLead(prisma, args.leadId);
  if (!lead) return { ok: false, error: 'not_found' };
  const allowed = ALLOWED_STATUS[lead.status] ?? [];
  if (!allowed.includes(args.status)) {
    return { ok: false, error: 'lifecycle_violation' };
  }
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { status: args.status },
  });
  await recordAudit(prisma, {
    userId: args.managerId,
    action: 'lead_status_changed',
    entity: 'lead',
    entityId: lead.id,
    after: { from: lead.status, to: args.status },
  });
  return { ok: true, lead: updated };
}

/**
 * Promote a lead to a cabinet-local Order (owner decision: local order, not a 1C
 * round-trip). Requires the lead to be linked to an organization — Order.companyId
 * and Order.organizationId are NOT NULL, so an org-less (new-client) lead cannot be
 * converted until an organization exists. externalId stays null, so the 1C sync
 * (upsert by externalId) never touches this order.
 */
export async function promoteLead(
  prisma: PrismaClient,
  args: { leadId: string; managerId: string }
): Promise<
  { ok: true; order: Order; lead: Lead } | { ok: false; error: 'not_found' | 'lifecycle_violation' }
> {
  const lead = await loadLead(prisma, args.leadId);
  if (!lead) return { ok: false, error: 'not_found' };
  if (lead.status === 'promoted_to_order' || lead.promotedOrderId) {
    return { ok: false, error: 'lifecycle_violation' };
  }
  if (lead.status === 'rejected') {
    return { ok: false, error: 'lifecycle_violation' };
  }
  if (!lead.organizationId) {
    return { ok: false, error: 'lifecycle_violation' };
  }
  const org = await prisma.organization.findUnique({
    where: { id: lead.organizationId },
    select: { companyId: true },
  });
  const companyId = org?.companyId;
  if (!companyId) {
    return { ok: false, error: 'lifecycle_violation' };
  }
  const organizationId = lead.organizationId;

  const { order, updatedLead } = await prisma.$transaction(async (tx) => {
    // §10 ТЗ v0.5: новая заявка получает рабочий статус из справочника.
    const initialStatusId = await getInitialStatusId(tx);
    const order = await tx.order.create({
      data: {
        statusId: initialStatusId,
        title: lead.subject,
        companyId,
        organizationId,
        partnerId: lead.partnerId,
        managerId: args.managerId,
        totalAmount: lead.estimatedAmount ?? 0,
        executionStatus: 'pending',
        financialStatus: 'not_billed',
      },
    });
    const updatedLead = await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'promoted_to_order', promotedOrderId: order.id },
    });
    return { order, updatedLead };
  });

  await recordAudit(prisma, {
    userId: args.managerId,
    action: 'lead_promoted_to_order',
    entity: 'lead',
    entityId: lead.id,
    after: { orderId: order.id, organizationId: lead.organizationId },
  });
  return { ok: true, order, lead: updatedLead };
}

/** Reject a lead (manager-side). Not allowed once promoted. */
export async function rejectLead(
  prisma: PrismaClient,
  args: { leadId: string; managerId: string; reason: string }
): Promise<LeadResult> {
  const lead = await loadLead(prisma, args.leadId);
  if (!lead) return { ok: false, error: 'not_found' };
  if (lead.status === 'promoted_to_order') return { ok: false, error: 'lifecycle_violation' };
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { status: 'rejected', rejectedReason: args.reason.trim() || 'Отклонён менеджером' },
  });
  await recordAudit(prisma, {
    userId: args.managerId,
    action: 'lead_rejected',
    entity: 'lead',
    entityId: lead.id,
    after: { reason: updated.rejectedReason },
  });
  return { ok: true, lead: updated };
}
