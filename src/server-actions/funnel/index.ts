'use server';

import { revalidatePath } from 'next/cache';
import type { LeadStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { moveFunnelLead, type MoveFunnelLeadError } from '@/lib/services/funnel/board';
import {
  createFunnelStage,
  updateFunnelStage,
  deleteFunnelStage,
  type FunnelStageInput,
  type FunnelStageErrorCode
} from '@/lib/services/access/funnelStages';

/**
 * Трек G2.5 — server-actions воронки. Move-карточки доступен любому менеджеру:
 * сервис энфорсит staff-гейт admin|manager (board.ts isStaff) + leads-scope
 * через canSeeLead; стадии-CRUD — сервис гейтит admin|leader. Поэтому здесь
 * достаточно requireSession().
 */

type ActionResult<E extends string> = { ok: true } | { ok: false; error: E };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function revalidate(): void {
  revalidatePath('/leader/funnel');
  revalidatePath('/manager/funnel');
}

export async function moveFunnelLeadAction(fd: FormData): Promise<ActionResult<MoveFunnelLeadError>> {
  const session = await requireSession();
  const leadId = str(fd, 'leadId');
  const toStageId = str(fd, 'toStageId');
  if (!leadId || !toStageId) return { ok: false, error: 'not_found' };
  const res = await moveFunnelLead(prisma, session, { leadId, toStageId, reason: str(fd, 'reason') || undefined });
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

function stageInput(fd: FormData): FunnelStageInput {
  return {
    name: str(fd, 'name'),
    position: Number(str(fd, 'position') || 0),
    statusAnchor: (str(fd, 'statusAnchor') || 'new') as LeadStatus,
    color: str(fd, 'color') || null,
    isTerminal: fd.get('isTerminal') === 'on' || str(fd, 'isTerminal') === 'true'
  };
}

export async function createFunnelStageAction(fd: FormData): Promise<ActionResult<FunnelStageErrorCode> & { id?: string }> {
  const session = await requireSession();
  const res = await createFunnelStage(prisma, session, stageInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true, id: res.id };
}

export async function updateFunnelStageAction(fd: FormData): Promise<ActionResult<FunnelStageErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateFunnelStage(prisma, session, id, stageInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function deleteFunnelStageAction(fd: FormData): Promise<ActionResult<FunnelStageErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await deleteFunnelStage(prisma, session, id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}
