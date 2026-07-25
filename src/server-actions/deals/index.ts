'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { moveDeal, type MoveDealError } from '@/lib/services/deals/board';
import { createDeal, updateDeal, type DealInput } from '@/lib/services/deals/crud';
import {
  listDealStages,
  createDealStage,
  updateDealStage,
  deleteDealStage,
  type DealStageInput,
  type DealStageErrorCode
} from '@/lib/services/access/dealStages';
import type { DealStageView } from '@/lib/services/deals/stages';
import type { DealStatus } from '@prisma/client';

/**
 * Этап 6 (PR-1) — server-actions канбана сделок (клон funnel/index.ts).
 * Move/CRUD сделок доступен любому менеджеру: сервис энфорсит staff-гейт +
 * PR-1-скоуп (менеджер own, лидер/админ company); стадии-CRUD — сервис гейтит
 * admin | manager-leader. Поэтому здесь достаточно requireSession().
 */

type ActionResult<E extends string> = { ok: true } | { ok: false; error: E; messages?: string[] };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function revalidate(): void {
  revalidatePath('/manager/deals');
  revalidatePath('/leader/deals');
}

export async function moveDealAction(fd: FormData): Promise<ActionResult<MoveDealError>> {
  const session = await requireSession();
  const dealId = str(fd, 'dealId');
  const toStageId = str(fd, 'toStageId');
  if (!dealId || !toStageId) return { ok: false, error: 'not_found' };
  const res = await moveDeal(prisma, session, { dealId, toStageId, lostReason: str(fd, 'lostReason') || undefined });
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

function dealInput(fd: FormData): DealInput {
  return {
    title: str(fd, 'title'),
    amount: str(fd, 'amount') || null,
    organizationId: str(fd, 'organizationId') || null,
    managerId: str(fd, 'managerId') || null,
    expectedCloseAt: str(fd, 'expectedCloseAt') || null
  };
}

export async function createDealAction(
  fd: FormData
): Promise<ActionResult<'forbidden' | 'not_found' | 'validation'> & { id?: string }> {
  const session = await requireSession();
  const res = await createDeal(prisma, session, dealInput(fd));
  if (!res.ok) return { ok: false, error: res.error, messages: res.messages };
  revalidate();
  return { ok: true, id: res.deal.id };
}

export async function updateDealAction(fd: FormData): Promise<ActionResult<'forbidden' | 'not_found' | 'validation'>> {
  const session = await requireSession();
  const dealId = str(fd, 'id');
  if (!dealId) return { ok: false, error: 'not_found' };
  const res = await updateDeal(prisma, session, { dealId, ...dealInput(fd) });
  if (!res.ok) return { ok: false, error: res.error, messages: res.messages };
  revalidate();
  return { ok: true };
}

export async function listDealStagesAction(): Promise<
  { ok: true; rows: DealStageView[] } | { ok: false; error: DealStageErrorCode }
> {
  const session = await requireSession();
  return listDealStages(prisma, session);
}

function stageInput(fd: FormData): DealStageInput {
  return {
    name: str(fd, 'name'),
    position: Number(str(fd, 'position') || 0),
    statusAnchor: (str(fd, 'statusAnchor') || 'open') as DealStatus,
    color: str(fd, 'color') || null,
    isTerminal: fd.get('isTerminal') === 'on' || str(fd, 'isTerminal') === 'true'
  };
}

export async function createDealStageAction(fd: FormData): Promise<ActionResult<DealStageErrorCode> & { id?: string }> {
  const session = await requireSession();
  const res = await createDealStage(prisma, session, stageInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true, id: res.id };
}

export async function updateDealStageAction(fd: FormData): Promise<ActionResult<DealStageErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateDealStage(prisma, session, id, stageInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function deleteDealStageAction(fd: FormData): Promise<ActionResult<DealStageErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await deleteDealStage(prisma, session, id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}
