import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, routeParams } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireFieldsAdmin } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { updateDefinition, deactivateDefinition } from '@/lib/services/customFields';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

/** Форма патча; доменная валидация значений — в сервисе (см. POST-роут). */
const patchBodySchema = z.object({
  label: z.string().optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  helpText: z.string().nullish(),
  visibleToRoles: z.array(z.string()).optional(),
  editableByRoles: z.array(z.string()).optional(),
});

export const PATCH = withAuth(
  { guard: requireFieldsAdmin, body: patchBodySchema },
  async ({ session, body, params }) => {
    // Next.js всегда даёт сегмент [id] для этого файла роута; withAuth типизирует
    // params как Record<string,string>, которая под noUncheckedIndexedAccess сужение теряет.
    const { id } = await routeParams<{ id: string }>(params);
    // exactOptionalPropertyTypes: патч сервиса различает «ключа нет» и «ключ = undefined»,
    // поэтому не передаём ключи, которых не было в теле запроса.
    const res = await updateDefinition(prisma, session, id, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.options !== undefined ? { options: body.options } : {}),
      ...(body.required !== undefined ? { required: body.required } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
      ...(body.visibleToRoles !== undefined ? { visibleToRoles: body.visibleToRoles } : {}),
      ...(body.editableByRoles !== undefined ? { editableByRoles: body.editableByRoles } : {}),
    });
    if (!res.ok) return jsonError(res.error, mapErr(res.error));
    return NextResponse.json({ definition: res.definition });
  }
);

export const DELETE = withAuth({ guard: requireFieldsAdmin }, async ({ session, params }) => {
  // Next.js всегда даёт сегмент [id] для этого файла роута; withAuth типизирует
  // params как Record<string,string>, которая под noUncheckedIndexedAccess сужение теряет.
  const { id } = await routeParams<{ id: string }>(params);
  const res = await deactivateDefinition(prisma, session, id);
  if (!res.ok) return jsonError(res.error, mapErr(res.error));
  return NextResponse.json({ definition: res.definition });
});
