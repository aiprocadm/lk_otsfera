import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireAdmin } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { updateDirection, deactivateDirection } from '@/lib/services/training';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

/** Форма патча; доменная валидация (пустое имя → `validation`) — в сервисе. */
const patchBodySchema = z.object({
  name: z.string().optional(),
  sortOrder: z.number().optional(),
});

export const PATCH = withAuth(
  { guard: requireAdmin, body: patchBodySchema },
  async ({ session, body, params }) => {
    const { id } = await params;
    const res = await updateDirection(prisma, session, { id, ...body });
    if (!res.ok) return jsonError(res.error, mapErr(res.error));
    return NextResponse.json({ direction: res.direction });
  }
);

export const DELETE = withAuth({ guard: requireAdmin }, async ({ session, params }) => {
  const { id } = await params;
  const res = await deactivateDirection(prisma, session, { id });
  if (!res.ok) return jsonError(res.error, mapErr(res.error));
  return NextResponse.json({ direction: res.direction });
});
