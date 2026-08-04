import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, routeParams } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireFieldsAdmin } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { updateStatusDefinition, deleteStatusDefinition } from '@/lib/services/orderStatuses';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

/** Форма патча; доменная валидация (system_protected и т.п.) — в сервисе. */
const patchBodySchema = z.object({
  label: z.string().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withAuth(
  { guard: requireFieldsAdmin, body: patchBodySchema },
  async ({ session, body, params }) => {
    // Next.js всегда даёт сегмент [id] для этого файла роута; withAuth типизирует
    // params как Record<string,string>, которая под noUncheckedIndexedAccess сужение теряет.
    const { id } = await routeParams<{ id: string }>(params);
    // exactOptionalPropertyTypes: патч сервиса различает «ключа нет» и «ключ = undefined».
    const res = await updateStatusDefinition(prisma, session, id, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    });
    if (!res.ok) return jsonError(res.error, mapErr(res.error));
    return NextResponse.json({ definition: res.definition });
  }
);

export const DELETE = withAuth({ guard: requireFieldsAdmin }, async ({ session, params }) => {
  // Next.js всегда даёт сегмент [id] для этого файла роута; withAuth типизирует
  // params как Record<string,string>, которая под noUncheckedIndexedAccess сужение теряет.
  const { id } = await routeParams<{ id: string }>(params);
  const res = await deleteStatusDefinition(prisma, session, id);
  if (!res.ok) return jsonError(res.error, mapErr(res.error));
  return NextResponse.json({ ok: true });
});
