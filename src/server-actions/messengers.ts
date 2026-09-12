'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { MESSENGER_CHANNELS } from '@/lib/services/messengers/channels';
import {
  sendDialogMessage,
  DIALOG_MESSAGE_MAX,
  type SendDialogMessageResult,
} from '@/lib/services/messengers/send';
import { bindDialog, type BindDialogResult } from '@/lib/services/messengers/bind';
import { setDialogStatus, type SetDialogStatusResult } from '@/lib/services/messengers/status';
import { startDialog, type StartDialogResult } from '@/lib/services/messengers/start';

/**
 * Тонкие адаптеры над сервисами диалогов (спека 2026-09-12 §4): флаг и гард
 * роли — здесь, форма входа — zod, весь скоуп и запись — в сервисах.
 * `inbound_messaging` — поведенческий флаг (Р-М-4): выключен → `forbidden`,
 * как у server-actions календаря.
 */

const DialogIdSchema = z.string().min(1).max(64);

type Validation = { ok: false; error: 'validation' };
type Disabled = { ok: false; error: 'forbidden' };

function disabled(): Disabled | null {
  return isFeatureEnabled('inbound_messaging') ? null : { ok: false, error: 'forbidden' };
}

function revalidateDialog(dialogId: string): void {
  revalidatePath('/manager/messengers');
  revalidatePath(`/manager/messengers/${dialogId}`);
}

const SendSchema = z.object({
  dialogId: DialogIdSchema,
  // Предел сервиса — по обрезанному тексту; здесь только защита от гигантского тела.
  text: z.string().max(DIALOG_MESSAGE_MAX * 2),
});

export async function sendDialogMessageAction(input: {
  dialogId: string;
  text: string;
}): Promise<SendDialogMessageResult | Validation> {
  const off = disabled();
  if (off) return off;
  const parsed = SendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireManager();
  const result = await sendDialogMessage(prisma, session, parsed.data);
  // Неудачная отправка тоже попадает в историю — ленту надо перечитать.
  if (result.ok || result.error === 'reply_failed') revalidateDialog(parsed.data.dialogId);
  return result;
}

const BindSchema = z.object({
  dialogId: DialogIdSchema,
  organizationId: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64).optional(),
});

export async function bindDialogAction(input: {
  dialogId: string;
  organizationId: string;
  contactId?: string;
}): Promise<BindDialogResult | Validation> {
  const off = disabled();
  if (off) return off;
  const parsed = BindSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireManager();
  const result = await bindDialog(prisma, session, {
    dialogId: parsed.data.dialogId,
    organizationId: parsed.data.organizationId,
    ...(parsed.data.contactId ? { contactId: parsed.data.contactId } : {}),
  });
  if (result.ok) {
    revalidateDialog(parsed.data.dialogId);
    // Привязка закрывает письма собеседника и в очереди триажа.
    revalidatePath('/manager/inbox');
    revalidatePath('/manager/intake');
  }
  return result;
}

const StatusSchema = z.object({
  dialogId: DialogIdSchema,
  status: z.enum(['open', 'closed']),
});

export async function setDialogStatusAction(input: {
  dialogId: string;
  status: 'open' | 'closed';
}): Promise<SetDialogStatusResult | Validation | Disabled> {
  const off = disabled();
  if (off) return off;
  const parsed = StatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireManager();
  const result = await setDialogStatus(prisma, session, parsed.data);
  if (result.ok && result.changed) revalidateDialog(parsed.data.dialogId);
  return result;
}

const StartSchema = z.object({
  kind: z.enum(['user', 'contact']),
  id: z.string().min(1).max(64),
  channel: z.enum(MESSENGER_CHANNELS),
});

export async function startDialogAction(input: {
  kind: 'user' | 'contact';
  id: string;
  channel: string;
}): Promise<StartDialogResult | Validation> {
  const off = disabled();
  if (off) return off;
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireManager();
  const result = await startDialog(prisma, session, parsed.data);
  if (result.ok) revalidatePath('/manager/messengers');
  return result;
}
