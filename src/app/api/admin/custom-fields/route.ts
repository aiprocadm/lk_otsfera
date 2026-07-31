import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireFieldsAdmin } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { createDefinition } from '@/lib/services/customFields';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

/**
 * Схема — только ФОРМА входа (типы полей). Доменная валидация (допустимые
 * entityType/fieldType, уникальность key и т.п.) остаётся в сервисе —
 * его коды ошибок стабильны и не подменяются кодом invalid_request.
 */
const createBodySchema = z.object({
  entityType: z.string(),
  key: z.string(),
  label: z.string(),
  fieldType: z.string(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().optional(),
  helpText: z.string().nullish(),
  visibleToRoles: z.array(z.string()).optional(),
  editableByRoles: z.array(z.string()).optional(),
});

export const POST = withAuth(
  { guard: requireFieldsAdmin, body: createBodySchema },
  async ({ session, body }) => {
    const res = await createDefinition(prisma, session, {
      ...body,
      // fieldType валидируется сервисом (isCustomFieldType) — здесь только форма.
      fieldType: body.fieldType as Parameters<typeof createDefinition>[2]['fieldType'],
    });
    if (!res.ok) return jsonError(res.error, mapErr(res.error));
    return NextResponse.json({ definition: res.definition }, { status: 201 });
  }
);
