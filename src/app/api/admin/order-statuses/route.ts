import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireFieldsAdmin } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { createStatusDefinition } from '@/lib/services/orderStatuses';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

/**
 * Схема — только ФОРМА входа. Доменная валидация (формат key, дубликаты)
 * остаётся в сервисе. `anchor` намеренно не принимается из формы: якоря
 * раздаёт система, заказчик привязывать статус к событию не может (спека §4.1) —
 * Zod по умолчанию отбрасывает неописанные ключи.
 */
const createBodySchema = z.object({
  key: z.string(),
  label: z.string(),
  sortOrder: z.number().optional(),
  isTerminal: z.boolean().optional(),
});

export const POST = withAuth(
  { guard: requireFieldsAdmin, body: createBodySchema },
  async ({ session, body }) => {
    const res = await createStatusDefinition(prisma, session, body);
    if (!res.ok) return jsonError(res.error, mapErr(res.error));
    return NextResponse.json({ definition: res.definition }, { status: 201 });
  }
);
