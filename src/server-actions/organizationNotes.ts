'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { NOTE_BODY_MAX } from '@/lib/services/organizationNotes/policy';
import {
  addOrganizationNote,
  editOrganizationNote,
  pinOrganizationNote,
  removeOrganizationNote,
  type NoteMutationResult,
} from '@/lib/services/organizationNotes/mutate';

/**
 * Тонкие адаптеры над сервисом внутренних заметок (этап 1 ТЗ 12.09.2026,
 * `У-183`, спека §3.6): форма — zod, роль и скоуп — сервис (клиентский контур
 * получает `not_found`, менеджер не удаляет). Заметки не гейтятся флагом
 * `contacts`: они живут во вкладке карточки организации (PR-3). После записи
 * перечитываются карточки трёх кабинетов ЦО.
 */

const IdSchema = z.string().min(1).max(64);
type Validation = { ok: false; error: 'validation' };

function revalidateOrgCard(organizationId: string): void {
  for (const cabinet of ['manager', 'leader', 'admin']) {
    revalidatePath(`/${cabinet}/organizations/${organizationId}`);
  }
}

const AddSchema = z.object({
  organizationId: IdSchema,
  // Предел сервиса — по обрезанному тексту; здесь только защита от гигантского тела.
  body: z.string().max(NOTE_BODY_MAX * 2),
});

export async function addOrganizationNoteAction(input: {
  organizationId: string;
  body: string;
}): Promise<NoteMutationResult | Validation> {
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const result = await addOrganizationNote(prisma, session, parsed.data);
  if (result.ok) revalidateOrgCard(parsed.data.organizationId);
  return result;
}

const EditSchema = z.object({
  noteId: IdSchema,
  organizationId: IdSchema,
  body: z.string().max(NOTE_BODY_MAX * 2),
});

export async function editOrganizationNoteAction(input: {
  noteId: string;
  organizationId: string;
  body: string;
}): Promise<NoteMutationResult | Validation> {
  const parsed = EditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const result = await editOrganizationNote(prisma, session, {
    noteId: parsed.data.noteId,
    body: parsed.data.body,
  });
  if (result.ok) revalidateOrgCard(parsed.data.organizationId);
  return result;
}

const RemoveSchema = z.object({ noteId: IdSchema, organizationId: IdSchema });

export async function removeOrganizationNoteAction(input: {
  noteId: string;
  organizationId: string;
}): Promise<NoteMutationResult | Validation> {
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const result = await removeOrganizationNote(prisma, session, { noteId: parsed.data.noteId });
  if (result.ok) revalidateOrgCard(parsed.data.organizationId);
  return result;
}

const PinSchema = z.object({ noteId: IdSchema, organizationId: IdSchema, pinned: z.boolean() });

export async function pinOrganizationNoteAction(input: {
  noteId: string;
  organizationId: string;
  pinned: boolean;
}): Promise<NoteMutationResult | Validation> {
  const parsed = PinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const result = await pinOrganizationNote(prisma, session, {
    noteId: parsed.data.noteId,
    pinned: parsed.data.pinned,
  });
  if (result.ok) revalidateOrgCard(parsed.data.organizationId);
  return result;
}
