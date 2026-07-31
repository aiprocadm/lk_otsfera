import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireAdmin } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { listDirections, createDirection } from '@/lib/services/training';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

export const GET = withAuth({ guard: requireAdmin }, async ({ session }) => {
  const res = await listDirections(prisma, session, { includeInactive: true });
  if (!res.ok) return jsonError(res.error, mapErr(res.error));
  return NextResponse.json({ directions: res.directions });
});

/** Форма входа; доменная валидация (пустое имя → `validation`) — в сервисе. */
const createBodySchema = z.object({
  name: z.string(),
  slug: z.string().optional(),
  sortOrder: z.number().optional(),
});

export const POST = withAuth(
  { guard: requireAdmin, body: createBodySchema },
  async ({ session, body }) => {
    const res = await createDirection(prisma, session, body);
    if (!res.ok) return jsonError(res.error, mapErr(res.error));
    return NextResponse.json({ direction: res.direction }, { status: 201 });
  }
);
