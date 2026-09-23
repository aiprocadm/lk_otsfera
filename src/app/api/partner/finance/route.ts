import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { dateString, parseQuery } from '@/lib/api/http';
import { getFinanceKpis, listStatements } from '@/lib/services/partner/finance';
import { moscowDayRange, moscowRangeFilter } from '@/lib/dates/calendar';

const MAX_TAKE = 100;

/** День из поля даты — «ГГГГ-ММ-ДД». */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Граница «с/по». День, которого нет в календаре («2026-02-30»), — 400:
 * `Date.parse` его пропускает и молча переносит на 2 марта.
 */
const periodEdge = dateString.refine((s) => !ISO_DAY.test(s.trim()) || moscowDayRange(s) !== null, {
  message: 'invalid date',
});

/**
 * Границы выборки ведомостей по началу периода (прогон сопровождения №36,
 * `Р-М-2`).
 *
 * Было `new Date(from)` / `new Date(to)` и `lte`: «2026-08-01» — это 00:00 по
 * Гринвичу, а ведомость за август начинается в московскую полночь 1 августа
 * (31.07 21:00 UTC, `startOfMoscowMonth`). Фильтр «с 01.08 по 31.08» не
 * находил ведомость за август вовсе. Теперь:
 *  - день «ГГГГ-ММ-ДД» — московские сутки, как на экранах администратора
 *    (`moscowRangeFilter`): «с» — с 00:00 МСК, «по» — до 00:00 МСК следующего
 *    дня, не включая;
 *  - полный момент ISO («2026-08-01T00:00:00+03:00») — прежний контракт API:
 *    сам момент, «по» включительно. Сервис режет верх строго (`lt`), поэтому
 *    берём следующую миллисекунду — точность колонки.
 */
function periodBounds(
  from: string | undefined,
  to: string | undefined
): { from?: Date; to?: Date } {
  const days = moscowRangeFilter(from, to);
  const gte = days.gte ?? (from ? new Date(from) : undefined);
  const lt = days.lt ?? (to ? new Date(Date.parse(to) + 1) : undefined);
  return { ...(gte ? { from: gte } : {}), ...(lt ? { to: lt } : {}) };
}

/**
 * Форма строки запроса (хотфикс №41). Раньше `skip`/`take` читались через
 * `parseInt`, даты — через `new Date`, `status` — как есть: `?skip=abc`
 * давал `NaN`, `?from=вчера` — `Invalid Date`, `?status=weird` — чужое
 * значение enum, и всё это роняло роут в 500 уже внутри Prisma. Умолчания и
 * потолок `take` прежние: 0 / 20 / не больше 100.
 */
const querySchema = z.object({
  status: z.enum(['draft', 'approved', 'paid', 'superseded']).optional(),
  from: periodEdge.optional(),
  to: periodEdge.optional(),
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
      ...periodBounds(from, to),
      skip,
      take,
    }),
  ]);

  return NextResponse.json({ kpis, statements });
}
