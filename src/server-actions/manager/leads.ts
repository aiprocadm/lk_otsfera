'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { pushLeadToOneC } from '@/lib/services/manager/leadPush';
import {
  createOrganizationFromLead,
  type CreateOrgFromLeadResult,
} from '@/lib/services/leads/toOrganization';

const PushSchema = z.object({ leadId: z.string().min(1).max(64) });

export type PushLeadToOneCActionResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'not_found' | 'already_pushed' | 'queue_unavailable' };

/**
 * B3: ручная отправка лида в 1С. Тонкий адаптер: форма входа (zod →
 * `validation`), гард роли и ревалидация карточки — здесь; чтение лида,
 * идемпотентность и постановка джобы — в `pushLeadToOneC`
 * (src/lib/services/manager/leadPush.ts).
 */
export async function pushLeadToOneCAction(input: {
  leadId: string;
}): Promise<PushLeadToOneCActionResult> {
  const parsed = PushSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();

  const result = await pushLeadToOneC(prisma, session, { leadId: parsed.data.leadId });
  if (!result.ok) return result;

  revalidatePath(`/manager/leads/${parsed.data.leadId}`);
  return { ok: true };
}

const OrgFromLeadSchema = z.object({
  leadId: z.string().min(1).max(64),
  name: z.string().max(300).optional(),
  inn: z.string().max(20).optional(),
  kpp: z.string().max(20).optional(),
});

export type CreateOrgFromLeadActionResult =
  CreateOrgFromLeadResult | { ok: false; error: 'validation' };

/**
 * `У-161` (этап 7) — «Создать организацию из лида» с переносом выпущенных
 * предложений. Тонкий адаптер: форма входа, гард роли и обновление ДВУХ
 * страниц; всё правило — в сервисе.
 *
 * Обновляется и карточка лида, и карточка новой организации: бумаги переехали,
 * и оба экрана показывают их по-разному. Забудь второй адрес — человек
 * перейдёт по ссылке и увидит пустую вкладку «Документы».
 */
export async function createOrgFromLeadAction(input: {
  leadId: string;
  name?: string;
  inn?: string;
  kpp?: string;
}): Promise<CreateOrgFromLeadActionResult> {
  const parsed = OrgFromLeadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();
  const result = await createOrganizationFromLead(prisma, session, parsed.data);
  if (!result.ok) return result;

  revalidatePath(`/manager/leads/${parsed.data.leadId}`);
  revalidatePath(`/manager/organizations/${result.organizationId}`);
  return result;
}
