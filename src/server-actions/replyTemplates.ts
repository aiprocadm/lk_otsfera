'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import {
  deleteReplyTemplate,
  saveReplyTemplate,
  type DeleteReplyTemplateResult,
  type SaveReplyTemplateResult,
} from '@/lib/services/replyTemplates/crud';

/**
 * Действия раздела «Шаблоны ответов» (`У-208`).
 *
 * Тонкие адаптеры: право раздела — здесь (`requireSettingsSection` текстом в
 * теле каждого действия, требование стража `server-actions.session-guard`),
 * форма входа — zod, вся работа и скоуп компании — в сервисе.
 *
 * Кабинет приходит от вызывающего экрана: раздел зеркальный (admin и leader),
 * и право проверяется для того кабинета, в котором человек работает.
 */

type Validation = { ok: false; error: 'validation' };

const CabinetSchema = z.enum(['admin', 'leader']);

const SaveSchema = z.object({
  id: z.string().min(1).max(64).nullable(),
  title: z.string().max(400),
  body: z.string().max(20_000),
  channels: z.array(z.string().max(32)).max(10),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(-1000).max(1000),
  cabinet: CabinetSchema.optional(),
});

export async function saveReplyTemplateAction(input: {
  id: string | null;
  title: string;
  body: string;
  channels: string[];
  isActive: boolean;
  sortOrder: number;
  cabinet?: 'admin' | 'leader';
}): Promise<SaveReplyTemplateResult | Validation> {
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireSettingsSection(
    'catalogs.replyTemplates',
    parsed.data.cabinet ?? 'admin'
  );
  const result = await saveReplyTemplate(prisma, session, {
    id: parsed.data.id,
    title: parsed.data.title,
    body: parsed.data.body,
    channels: parsed.data.channels,
    isActive: parsed.data.isActive,
    sortOrder: parsed.data.sortOrder,
  });
  if (result.ok) {
    revalidatePath('/admin/settings/catalogs/reply-templates');
    revalidatePath('/leader/settings/catalogs/reply-templates');
  }
  return result;
}

const DeleteSchema = z.object({
  id: z.string().min(1).max(64),
  cabinet: CabinetSchema.optional(),
});

export async function deleteReplyTemplateAction(input: {
  id: string;
  cabinet?: 'admin' | 'leader';
}): Promise<DeleteReplyTemplateResult | Validation> {
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireSettingsSection(
    'catalogs.replyTemplates',
    parsed.data.cabinet ?? 'admin'
  );
  const result = await deleteReplyTemplate(prisma, session, parsed.data.id);
  if (result.ok) {
    revalidatePath('/admin/settings/catalogs/reply-templates');
    revalidatePath('/leader/settings/catalogs/reply-templates');
  }
  return result;
}
