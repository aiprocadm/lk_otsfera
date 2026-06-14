import type { PrismaClient, Lead, LeadStatus, Order } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Manager-side lead lifecycle (T3). Leads are a shared team queue (any manager may
 * claim/process — owner decision 2026-06-14), so these mutations are not org-scoped;
 * RBAC is `requireManager` at the route. Throw-based with prefixed messages mapped
 * to HTTP by the route, matching commission/lifecycle.ts and partner/leads.ts.
 *
 * Transitions: new → in_review → qualified (and one step back), then a dedicated
 * promote (→ promoted_to_order, creates the order) or reject (→ rejected). `promote`
 * and `reject` are NOT reachable via setLeadStatus.
 */

// Allowed manual status moves (excludes terminal promote/reject — those are actions).
const ALLOWED_STATUS: Record<string, LeadStatus[]> = {
  new: ['in_review'],
  in_review: ['new', 'qualified'],
  qualified: ['in_review']
};

async function loadLead(prisma: PrismaClient, leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, partnerId: true, organizationId: true, subject: true, estimatedAmount: true, promotedOrderId: true }
  });
  if (!lead) throw new Error('NOT_FOUND: lead');
  return lead;
}

/** Claim/assign a lead to a manager. From `new`, also advances to `in_review`. */
export async function assignLead(
  prisma: PrismaClient,
  args: { leadId: string; managerId: string; assignToUserId?: string }
): Promise<Lead> {
  const lead = await loadLead(prisma, args.leadId);
  if (lead.status === 'promoted_to_order' || lead.status === 'rejected') {
    throw new Error(`LIFECYCLE_VIOLATION: cannot assign a ${lead.status} lead`);
  }
  const assignee = args.assignToUserId ?? args.managerId;
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { assignedManagerId: assignee, ...(lead.status === 'new' ? { status: 'in_review' as LeadStatus } : {}) }
  });
  await recordAudit(prisma, {
    userId: args.managerId, action: 'lead_assigned', entity: 'lead', entityId: lead.id,
    after: { assignedManagerId: assignee, status: updated.status }
  });
  return updated;
}

/** Move a lead between non-terminal statuses (new/in_review/qualified). */
export async function setLeadStatus(
  prisma: PrismaClient,
  args: { leadId: string; managerId: string; status: LeadStatus }
): Promise<Lead> {
  const lead = await loadLead(prisma, args.leadId);
  const allowed = ALLOWED_STATUS[lead.status] ?? [];
  if (!allowed.includes(args.status)) {
    throw new Error(`LIFECYCLE_VIOLATION: cannot move lead from ${lead.status} to ${args.status}`);
  }
  const updated = await prisma.lead.update({ where: { id: lead.id }, data: { status: args.status } });
  await recordAudit(prisma, {
    userId: args.managerId, action: 'lead_status_changed', entity: 'lead', entityId: lead.id,
    after: { from: lead.status, to: args.status }
  });
  return updated;
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
): Promise<{ order: Order; lead: Lead }> {
  const lead = await loadLead(prisma, args.leadId);
  if (lead.status === 'promoted_to_order' || lead.promotedOrderId) {
    throw new Error('LIFECYCLE_VIOLATION: lead already promoted');
  }
  if (lead.status === 'rejected') {
    throw new Error('LIFECYCLE_VIOLATION: cannot promote a rejected lead');
  }
  if (!lead.organizationId) {
    throw new Error('LIFECYCLE_VIOLATION: lead has no organization — link one before promotion');
  }
  const org = await prisma.organization.findUnique({ where: { id: lead.organizationId }, select: { companyId: true } });
  const companyId = org?.companyId;
  if (!companyId) {
    throw new Error('LIFECYCLE_VIOLATION: lead organization has no company');
  }
  const organizationId = lead.organizationId;

  const { order, updatedLead } = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        title: lead.subject,
        companyId,
        organizationId,
        partnerId: lead.partnerId,
        managerId: args.managerId,
        totalAmount: lead.estimatedAmount ?? 0,
        executionStatus: 'pending',
        financialStatus: 'not_billed'
      }
    });
    const updatedLead = await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'promoted_to_order', promotedOrderId: order.id }
    });
    return { order, updatedLead };
  });

  await recordAudit(prisma, {
    userId: args.managerId, action: 'lead_promoted_to_order', entity: 'lead', entityId: lead.id,
    after: { orderId: order.id, organizationId: lead.organizationId }
  });
  return { order, lead: updatedLead };
}

/** Reject a lead (manager-side). Not allowed once promoted. */
export async function rejectLead(
  prisma: PrismaClient,
  args: { leadId: string; managerId: string; reason: string }
): Promise<Lead> {
  const lead = await loadLead(prisma, args.leadId);
  if (lead.status === 'promoted_to_order') throw new Error('LIFECYCLE_VIOLATION: cannot reject a promoted lead');
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { status: 'rejected', rejectedReason: args.reason.trim() || 'Отклонён менеджером' }
  });
  await recordAudit(prisma, {
    userId: args.managerId, action: 'lead_rejected', entity: 'lead', entityId: lead.id,
    after: { reason: updated.rejectedReason }
  });
  return updated;
}
