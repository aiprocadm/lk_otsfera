'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import {
  bindInboundMessage,
  type BindInboundMessageArgs,
  type BindInboundMessageResult,
} from '@/lib/services/inbound/bind';
import {
  sendInboundReply,
  type SendInboundReplyArgs,
  type SendInboundReplyResult,
} from '@/lib/services/inbound/sendReply';
import { archiveInboundMessage, restoreInboundMessage } from '@/lib/services/inbound/archive';

export type { BindInboundMessageArgs, BindInboundMessageResult };
export type ReplyInboundArgs = SendInboundReplyArgs;
export type ReplyInboundResult = SendInboundReplyResult;

/**
 * Тонкий адаптер над `bindInboundMessage` (src/lib/services/inbound/bind.ts):
 * гард роли здесь, весь скоуп (C8 + teamMode) и запись — в сервисе.
 */
export async function bindInboundMessageAction(
  args: BindInboundMessageArgs
): Promise<BindInboundMessageResult> {
  const session = await requireManager();
  return bindInboundMessage(prisma, session, args);
}

/**
 * Тонкий адаптер над `sendInboundReply` (src/lib/services/inbound/sendReply.ts):
 * отправка ответа в канал + зеркало в тред + аудит/лог живут в сервисе.
 */
export async function replyInboundAction(args: ReplyInboundArgs): Promise<ReplyInboundResult> {
  const session = await requireManager();
  return sendInboundReply(prisma, session, args);
}

const ArchiveInboundSchema = z.object({ inboundMessageId: z.string().min(1).max(64) });

export type ArchiveInboundResult =
  { ok: true } | { ok: false; error: 'validation' | 'forbidden' | 'not_found' };

/**
 * Архивация обращения (E2). Форма входа — здесь (zod → `validation`), скоуп и
 * запись — в `archiveInboundMessage`. Идемпотентный повтор (`changed: false`)
 * не ревалидирует страницу: ничего не изменилось.
 */
export async function archiveInboundMessageAction(input: {
  inboundMessageId: string;
}): Promise<ArchiveInboundResult> {
  const parsed = ArchiveInboundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();

  const result = await archiveInboundMessage(prisma, session, {
    inboundMessageId: parsed.data.inboundMessageId,
  });
  if (!result.ok) return result;

  if (result.changed) revalidatePath('/manager/inbox');
  return { ok: true };
}

/** Восстановление обращения из архива (E2) — см. `restoreInboundMessage`. */
export async function restoreInboundMessageAction(input: {
  inboundMessageId: string;
}): Promise<ArchiveInboundResult> {
  const parsed = ArchiveInboundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();

  const result = await restoreInboundMessage(prisma, session, {
    inboundMessageId: parsed.data.inboundMessageId,
  });
  if (!result.ok) return result;

  revalidatePath('/manager/inbox');
  return { ok: true };
}
