import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { dateString, parseQuery } from '@/lib/api/http';
import { getFinanceKpis, listStatements } from '@/lib/services/partner/finance';

const MAX_TAKE = 100;

/**
 * Форма строки запроса (хотфикс №41). Раньше `skip`/`take` читались через
 * `parseInt`, даты — через `new Date`, `status` — как есть: `?skip=abc`
 * давал `NaN`, `?from=вчера` — `Invalid Date`, `?status=weird` — чужое
 * значение enum, и всё это роняло роут в 500 уже внутри Prisma. Умолчания и
 * потолок `take` прежние: 0 / 20 / не больше 100.
 */
const querySchema = z.object({
  status: z.enum(['draft', 'approved', 'paid', 'superseded']).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce
    .number()
    .int()
    .min(0)
    .default(20)
    .transform((n) => Math.min(n, MAX_TAKE)),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const partner = requirePartner(session);
  if (!partner.ok) return partner.response;

  const { partnerId } = partner.value;
  const parsed = parseQuery(request, querySchema);
  if (!parsed.ok) return parsed.response;
  const { status, from, to, skip, take } = parsed.data;

  const [kpis, statements] = await Promise.all([
    getFinanceKpis(prisma, partnerId),
    listStatements(prisma, {
      partnerId,
      // exactOptionalPropertyTypes: ListStatementsOptions различают «ключа нет» и «ключ = undefined».
      ...(status !== undefined ? { status } : {}),
      ...(from ? { from: new Date(from) } : {}),
      ...(to ? { to: new Date(to) } : {}),
      skip,
      take,
    }),
  ]);

  return NextResponse.json({ kpis, statements });
}
