'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import {
  assignManagerAsLeader,
  deactivateAssignmentAsLeader,
  type AssignManagerAsLeaderResult,
  type DeactivateAssignmentAsLeaderResult,
} from '@/lib/services/manager/leaderTeam';

function readForm(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

const assignSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('existing'),
    organizationId: z.string().min(1),
    email: z.string().email(),
  }),
  z.object({
    mode: z.literal('new'),
    organizationId: z.string().min(1),
    email: z.string().email(),
    name: z.string().max(200).optional(),
  }),
]);

export type LeaderAssignResult = AssignManagerAsLeaderResult | { ok: false; error: 'validation' };

export async function leaderAssignManagerAction(formData: FormData): Promise<LeaderAssignResult> {
  const parsed = assignSchema.safeParse({
    mode: readForm(formData, 'mode'),
    organizationId: readForm(formData, 'organizationId'),
    email: readForm(formData, 'email'),
    name: readForm(formData, 'name'),
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();

  // exactOptionalPropertyTypes: вход сервиса различает «ключа name нет» и «name = undefined».
  const input =
    parsed.data.mode === 'new'
      ? {
          mode: 'new' as const,
          organizationId: parsed.data.organizationId,
          email: parsed.data.email,
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        }
      : parsed.data;

  const result = await assignManagerAsLeader(prisma, session, input);
  if (!result.ok) return result;

  revalidatePath('/manager/team');
  return result;
}

const deactivateSchema = z.object({ assignmentId: z.string().min(1) });

export type LeaderDeactivateResult =
  DeactivateAssignmentAsLeaderResult | { ok: false; error: 'validation' };

export async function leaderDeactivateAssignmentAction(
  formData: FormData
): Promise<LeaderDeactivateResult> {
  const parsed = deactivateSchema.safeParse({ assignmentId: readForm(formData, 'assignmentId') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();

  const result = await deactivateAssignmentAsLeader(prisma, session, {
    assignmentId: parsed.data.assignmentId,
  });
  if (!result.ok) return result;

  revalidatePath('/manager/team');
  return { ok: true };
}
