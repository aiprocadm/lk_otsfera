import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = requirePartnerAdmin(session);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  if (!body?.periodFrom || !body?.periodTo) {
    return NextResponse.json({ error: 'periodFrom and periodTo are required' }, { status: 400 });
  }

  const periodFrom = new Date(body.periodFrom);
  const periodTo = new Date(body.periodTo);
  if (isNaN(periodFrom.getTime()) || isNaN(periodTo.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }
  if (periodFrom >= periodTo) {
    return NextResponse.json({ error: 'periodFrom must be before periodTo' }, { status: 400 });
  }

  const { partnerId, sub } = guard.value;
  try {
    const result = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom,
      periodTo,
      calculatedByUserId: sub,
      // C-05: manual entry accepts arbitrary ranges → guard against overlap.
      rejectOverlap: true
    });

    return NextResponse.json(
      { statement: result.statement, itemCount: result.itemCount, isNew: result.isNew },
      { status: result.isNew ? 201 : 200 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.startsWith('PERIOD_OVERLAP')) return NextResponse.json({ error: msg }, { status: 409 });
    throw err;
  }
}
