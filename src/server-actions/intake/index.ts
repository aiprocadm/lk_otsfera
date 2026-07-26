'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  claimEnrollment,
  claimInbound,
  claimCall,
  closeCallIntake,
  type IntakeClaimError
} from '@/lib/services/intake/claim';
import {
  createLeadFromInbound,
  createLeadFromCall,
  type ConvertSourceInput
} from '@/lib/services/intake/convert';
import { takeInTriage } from '@/lib/services/clientRequests/triage';

/**
 * Этап 7 (ФТ-8.2) — server-actions «Входящих в работу». Тонкие адаптеры (§3):
 * сервисы энфорсят гейты/скоупы. ClientRequest-claim переиспользует takeInTriage.
 */

type ActionResult<E extends string> = { ok: true } | { ok: false; error: E };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function revalidate(): void {
  revalidatePath('/manager/intake');
  revalidatePath('/leader/intake');
  revalidatePath('/admin/intake');
}

export type IntakeClaimActionError = IntakeClaimError | 'validation';

export async function claimIntakeAction(fd: FormData): Promise<ActionResult<IntakeClaimActionError>> {
  const session = await requireSession();
  const type = str(fd, 'type');
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };

  let res: { ok: true } | { ok: false; error: IntakeClaimActionError };
  if (type === 'client_request') {
    const r = await takeInTriage(prisma, session, { id });
    // lifecycle_violation здесь = «уже взято/разобрано» — маппим в already_assigned для единого UX.
    res = r.ok ? { ok: true } : { ok: false, error: r.error === 'lifecycle_violation' ? 'already_assigned' : r.error };
  } else if (type === 'enrollment') {
    res = await claimEnrollment(prisma, session, { id });
  } else if (type === 'inbound') {
    res = await claimInbound(prisma, session, { id });
  } else if (type === 'call') {
    res = await claimCall(prisma, session, { id });
  } else {
    return { ok: false, error: 'validation' };
  }

  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function closeCallIntakeAction(fd: FormData): Promise<ActionResult<IntakeClaimError | 'validation'>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await closeCallIntake(prisma, session, { id });
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

function convertInput(fd: FormData): ConvertSourceInput {
  return {
    companyName: str(fd, 'companyName') || null,
    inn: str(fd, 'inn') || null,
    contactName: str(fd, 'contactName') || null,
    contactPhone: str(fd, 'contactPhone') || null,
    contactEmail: str(fd, 'contactEmail') || null,
    subject: str(fd, 'subject') || null,
    notes: str(fd, 'notes') || null
  };
}

export type ConvertActionResult =
  | { ok: true; leadId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'already_converted' | 'validation'; messages?: string[] };

export async function createLeadFromInboundAction(fd: FormData): Promise<ConvertActionResult> {
  const session = await requireSession();
  const inboundId = str(fd, 'sourceId');
  if (!inboundId) return { ok: false, error: 'validation' };
  const res = await createLeadFromInbound(prisma, session, { inboundId, input: convertInput(fd) });
  if (!res.ok) return { ok: false, error: res.error, messages: res.messages };
  revalidate();
  revalidatePath('/manager/inbox');
  return { ok: true, leadId: res.lead.id };
}

export async function createLeadFromCallAction(fd: FormData): Promise<ConvertActionResult> {
  const session = await requireSession();
  const callId = str(fd, 'sourceId');
  if (!callId) return { ok: false, error: 'validation' };
  const res = await createLeadFromCall(prisma, session, { callId, input: convertInput(fd) });
  if (!res.ok) return { ok: false, error: res.error, messages: res.messages };
  revalidate();
  revalidatePath('/manager/calls');
  return { ok: true, leadId: res.lead.id };
}
