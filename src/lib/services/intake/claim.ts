import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canTriageClientRequests } from '@/lib/services/clientRequests/policy';
import { isInboundMessageInScope } from '@/lib/services/inbound/scope';

/**
 * Этап 7 (ФТ-8.2) — «Взять в работу» для источников Intake, по образцу
 * `claimOrder` (manager/distribution.ts): staff-гейт + scope ДО мутации,
 * `already_assigned` при чужом ответственном, идемпотентность при своём,
 * аудит. ClientRequest здесь нет — его claim это существующий `takeInTriage`.
 */

export type IntakeClaimError = 'forbidden' | 'not_found' | 'already_assigned' | 'lifecycle_violation';
export type IntakeClaimResult = { ok: true; changed: boolean } | { ok: false; error: IntakeClaimError };

// Гейт триажа Intake един для всех источников: manager|admin (лидер = manager).
function staffGate(session: SessionPayload): boolean {
  return canTriageClientRequests(session);
}

export async function claimEnrollment(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<IntakeClaimResult> {
  if (!staffGate(session)) return { ok: false, error: 'forbidden' };
  const row = await prisma.enrollmentRequest.findUnique({
    where: { id: args.id },
    select: { id: true, status: true, claimedByUserId: true }
  });
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'pending') return { ok: false, error: 'lifecycle_violation' };
  if (row.claimedByUserId && row.claimedByUserId !== session.sub) return { ok: false, error: 'already_assigned' };
  if (row.claimedByUserId === session.sub) return { ok: true, changed: false };

  await prisma.enrollmentRequest.update({
    where: { id: row.id },
    data: { claimedByUserId: session.sub, claimedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'intake_claimed',
    entity: 'enrollment_request',
    entityId: row.id
  });
  return { ok: true, changed: true };
}

export async function claimInbound(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<IntakeClaimResult> {
  if (!staffGate(session)) return { ok: false, error: 'forbidden' };
  const row = await prisma.inboundMessage.findUnique({
    where: { id: args.id },
    select: { id: true, status: true, companyId: true, claimedByUserId: true }
  });
  if (!row || !isInboundMessageInScope(session, row)) return { ok: false, error: 'not_found' };
  if (row.status !== 'unresolved') return { ok: false, error: 'lifecycle_violation' };
  if (row.claimedByUserId && row.claimedByUserId !== session.sub) return { ok: false, error: 'already_assigned' };
  if (row.claimedByUserId === session.sub) return { ok: true, changed: false };

  await prisma.inboundMessage.update({
    where: { id: row.id },
    data: { claimedByUserId: session.sub, claimedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'intake_claimed',
    entity: 'inbound_message',
    entityId: row.id
  });
  return { ok: true, changed: true };
}

// Scope звонка — зеркало listCalls: своя компания ∪ общая корзина (companyId null).
function isCallInScope(session: SessionPayload, call: { companyId: string | null }): boolean {
  return call.companyId === null || (call.companyId != null && call.companyId === session.companyId);
}

export async function claimCall(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<IntakeClaimResult> {
  if (!staffGate(session)) return { ok: false, error: 'forbidden' };
  const row = await prisma.call.findUnique({
    where: { id: args.id },
    select: { id: true, companyId: true, claimedByUserId: true, intakeClosedAt: true }
  });
  if (!row || !isCallInScope(session, row)) return { ok: false, error: 'not_found' };
  if (row.intakeClosedAt) return { ok: false, error: 'lifecycle_violation' };
  if (row.claimedByUserId && row.claimedByUserId !== session.sub) return { ok: false, error: 'already_assigned' };
  if (row.claimedByUserId === session.sub) return { ok: true, changed: false };

  await prisma.call.update({
    where: { id: row.id },
    data: { claimedByUserId: session.sub, claimedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'intake_claimed',
    entity: 'call',
    entityId: row.id
  });
  return { ok: true, changed: true };
}

/** «Закрыть» нецелевой/спам-звонок — звонок покидает Intake (решение §10-1 спеки). */
export async function closeCallIntake(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<IntakeClaimResult> {
  if (!staffGate(session)) return { ok: false, error: 'forbidden' };
  const row = await prisma.call.findUnique({
    where: { id: args.id },
    select: { id: true, companyId: true, intakeClosedAt: true }
  });
  if (!row || !isCallInScope(session, row)) return { ok: false, error: 'not_found' };
  if (row.intakeClosedAt) return { ok: true, changed: false };

  await prisma.call.update({
    where: { id: row.id },
    data: { intakeClosedAt: new Date(), intakeClosedById: session.sub }
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'intake_call_closed',
    entity: 'call',
    entityId: row.id
  });
  return { ok: true, changed: true };
}
