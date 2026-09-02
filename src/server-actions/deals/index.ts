'use server';

import { revalidatePath } from 'next/cache';
import type { DealStatus } from '@prisma/client';
import { str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import {
  listDealProposals,
  type ProposalBlockResult,
} from '@/lib/services/documents/proposalBlocks';
import { requireSession } from '@/lib/auth/requireRole';
import { moveDeal, type MoveDealError } from '@/lib/services/deals/board';
import { createDeal, updateDeal, type DealInput } from '@/lib/services/deals/crud';
import {
  listDealStages,
  createDealStage,
  updateDealStage,
  deleteDealStage,
  type DealStageInput,
  type DealStageErrorCode,
} from '@/lib/services/access/dealStages';
import type { DealStageView } from '@/lib/services/deals/stages';
import { convertLeadToDeal, winDeal } from '@/lib/services/deals/convert';
import { addNoteToDeal, listDealNotes, type DealNoteRow } from '@/lib/services/deals/notes';

/**
 * Этап 6 (PR-1) — server-actions канбана сделок (клон funnel/index.ts).
 * Move/CRUD сделок доступен любому менеджеру: сервис энфорсит staff-гейт +
 * PR-1-скоуп (менеджер own, лидер/админ company); стадии-CRUD — сервис гейтит
 * admin | manager-leader. Поэтому здесь достаточно requireSession().
 */

type ActionResult<E extends string> =
  { ok: true } | { ok: false; error: E; messages?: string[] | undefined };

function revalidate(): void {
  revalidatePath('/manager/deals');
  revalidatePath('/leader/deals');
}

export async function moveDealAction(fd: FormData): Promise<ActionResult<MoveDealError>> {
  const session = await requireSession();
  const dealId = str(fd, 'dealId');
  const toStageId = str(fd, 'toStageId');
  if (!dealId || !toStageId) return { ok: false, error: 'not_found' };
  const lostReason = str(fd, 'lostReason') || undefined;
  // exactOptionalPropertyTypes: сервис различает «ключа нет» и «ключ = undefined».
  const res = await moveDeal(prisma, session, {
    dealId,
    toStageId,
    ...(lostReason !== undefined ? { lostReason } : {}),
  });
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
    expectedCloseAt: str(fd, 'expectedCloseAt') || null,
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

export async function updateDealAction(
  fd: FormData
): Promise<ActionResult<'forbidden' | 'not_found' | 'validation'>> {
  const session = await requireSession();
  const dealId = str(fd, 'id');
  if (!dealId) return { ok: false, error: 'not_found' };
  const res = await updateDeal(prisma, session, { dealId, ...dealInput(fd) });
  if (!res.ok) return { ok: false, error: res.error, messages: res.messages };
  revalidate();
  return { ok: true };
}

/**
 * Этап 6 PR-2 (ФТ-4.4) — конверсии и заметки. Сервисы энфорсят staff-гейт и
 * скоупы; здесь — только парсинг формы и revalidate затронутых страниц.
 */

export async function winDealAction(
  fd: FormData
): Promise<
  | { ok: true; orderId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'lifecycle_violation' | 'org_required' }
> {
  const session = await requireSession();
  const dealId = str(fd, 'dealId');
  if (!dealId) return { ok: false, error: 'not_found' };
  const toStageId = str(fd, 'toStageId') || undefined;
  // exactOptionalPropertyTypes: сервис различает «ключа нет» и «ключ = undefined».
  const res = await winDeal(prisma, session, {
    dealId,
    ...(toStageId !== undefined ? { toStageId } : {}),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  // Выигрыш меняет и лид-источник (если был), и создаёт заказ.
  revalidatePath('/manager/leads');
  revalidatePath('/manager/orders');
  return { ok: true, orderId: res.order.id };
}

export async function convertLeadToDealAction(
  fd: FormData
): Promise<
  | { ok: true; dealId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'lifecycle_violation' }
> {
  const session = await requireSession();
  const leadId = str(fd, 'leadId');
  if (!leadId) return { ok: false, error: 'not_found' };
  const res = await convertLeadToDeal(prisma, session, { leadId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  revalidatePath('/manager/leads');
  return { ok: true, dealId: res.deal.id };
}

export async function addDealNoteAction(
  fd: FormData
): Promise<ActionResult<'forbidden' | 'not_found' | 'invalid'>> {
  const session = await requireSession();
  const dealId = str(fd, 'dealId');
  if (!dealId) return { ok: false, error: 'not_found' };
  const res = await addNoteToDeal(prisma, session, { dealId, body: str(fd, 'body') });
  if (!res.ok) return { ok: false, error: res.error };
  // Заметки не влияют на доски — список перезагружается лениво в диалоге.
  return { ok: true };
}

export async function listDealNotesAction(
  dealId: string
): Promise<{ ok: true; rows: DealNoteRow[] } | { ok: false; error: 'forbidden' | 'not_found' }> {
  const session = await requireSession();
  return listDealNotes(prisma, session, { dealId });
}

/**
 * `У-166`: список коммерческих предложений сделки — лениво, по открытию
 * карточки. Грузить его для каждой карточки доски значило бы платить за то,
 * чего человек не открывал.
 */
export async function listDealProposalsAction(dealId: string): Promise<ProposalBlockResult> {
  const session = await requireSession();
  return listDealProposals(prisma, session, { dealId });
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
    isTerminal: fd.get('isTerminal') === 'on' || str(fd, 'isTerminal') === 'true',
  };
}

export async function createDealStageAction(
  fd: FormData
): Promise<ActionResult<DealStageErrorCode> & { id?: string }> {
  const session = await requireSession();
  const res = await createDealStage(prisma, session, stageInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true, id: res.id };
}

export async function updateDealStageAction(
  fd: FormData
): Promise<ActionResult<DealStageErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateDealStage(prisma, session, id, stageInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function deleteDealStageAction(
  fd: FormData
): Promise<ActionResult<DealStageErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await deleteDealStage(prisma, session, id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}
