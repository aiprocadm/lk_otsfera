import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { parseJsonBody } from '@/lib/api/http';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';

/**
 * Схема — только ФОРМА входа. Доменные проверки (валидность/порядок дат,
 * overlap периодов) остаются ниже/в сервисе — их коды и сообщения стабильны.
 *
 * NB: роут намеренно НЕ на withAuth — регресс api.partner.finance.test.ts
 * закрепляет, что неожиданный throw сервиса пробрасывается наружу
 * (`rejects.toThrow`), а guardedRoute превратил бы его в 500 `internal`.
 */
const bodySchema = z.object({
  periodFrom: z.string(),
  periodTo: z.string(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = requirePartnerAdmin(session);
  if (!guard.ok) return guard.response;

  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  if (!parsed.data.periodFrom || !parsed.data.periodTo) {
    return NextResponse.json({ error: 'periodFrom and periodTo are required' }, { status: 400 });
  }

  const periodFrom = new Date(parsed.data.periodFrom);
  const periodTo = new Date(parsed.data.periodTo);
  if (isNaN(periodFrom.getTime()) || isNaN(periodTo.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }
  if (periodFrom >= periodTo) {
    return NextResponse.json({ error: 'periodFrom must be before periodTo' }, { status: 400 });
  }

  const { partnerId, sub } = guard.value;
  const result = await calculateStatementForPartner(prisma, {
    partnerId,
    periodFrom,
    periodTo,
    calculatedByUserId: sub,
    // C-05: manual entry accepts arbitrary ranges → guard against overlap.
    rejectOverlap: true,
  });
  if (!result.ok) {
    const status = result.error === 'partner_not_found' ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(
    { statement: result.statement, itemCount: result.itemCount, isNew: result.isNew },
    { status: result.isNew ? 201 : 200 }
  );
}
