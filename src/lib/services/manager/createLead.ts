import type { Lead, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { validateClientRequestInput } from '@/lib/services/clientRequests/submit';

export type CreateLeadByStaffInput = {
  companyName?: string | null;
  inn?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  subject?: string | null;
  notes?: string | null;
  organizationId?: string | null;
};

export type CreateLeadByStaffResult =
  { ok: true; lead: Lead } | { ok: false; error: 'forbidden' | 'validation'; messages?: string[] };

/**
 * Ручное создание лида сотрудником (этап 5, ФТ-1.6; source=manual). Только
 * manager (включая leader) и admin — партнёрское создание лидов запрещено
 * (ФТ-1.5). Организация (если указана) — из компании менеджера (C8);
 * admin — любая.
 */
export async function createLeadByStaff(
  prisma: PrismaClient,
  session: SessionPayload,
  input: CreateLeadByStaffInput
): Promise<CreateLeadByStaffResult> {
  if (session.role !== 'manager' && session.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  const validated = validateClientRequestInput(input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };

  const organizationId = input.organizationId?.trim() || null;
  if (organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { companyId: true },
    });
    if (!org) return { ok: false, error: 'validation', messages: ['Организация не найдена'] };
    if (session.role === 'manager' && (!session.companyId || org.companyId !== session.companyId)) {
      return { ok: false, error: 'forbidden' };
    }
  }

  const v = validated.values;
  const lead = await prisma.lead.create({
    data: {
      source: 'manual',
      partnerId: null,
      organizationId,
      createdByUserId: session.sub,
      clientCompanyName: v.companyName,
      clientInn: v.inn,
      clientContactName: v.contactName,
      clientContactPhone: v.contactPhone,
      clientContactEmail: v.contactEmail,
      subject: v.subject,
      notes: input.notes?.trim() || null,
      status: 'new',
    },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'lead_created_manual',
    entity: 'lead',
    entityId: lead.id,
    after: { organizationId, source: 'manual' },
  });

  return { ok: true, lead };
}
