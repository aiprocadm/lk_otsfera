import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner, requirePartnerAdmin } from '@/lib/auth/guard';
import { approveStatement, markStatementPaid } from '@/lib/services/commission/lifecycle';
import { getStatementWithItems } from '@/lib/services/partner/finance';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = requirePartner(session);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const statement = await getStatementWithItems(prisma, id, guard.value.partnerId);
  if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ statement });
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === 'approve') {
    const guard = requirePartnerAdmin(session);
    if (!guard.ok) return guard.response;

    const res = await approveStatement(prisma, {
      statementId: id,
      partnerId: guard.value.partnerId,
      approvedByUserId: guard.value.sub
    });
    if (!res.ok) {
      const status = res.error === 'not_found' ? 404 : 409;
      return NextResponse.json({ error: res.error }, { status });
    }
    return NextResponse.json({ statement: res.statement });
  }

  if (action === 'markPaid') {
    if (session.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access only' }, { status: 403 });
    }
    const res = await markStatementPaid(prisma, {
      statementId: id,
      paidByUserId: session.sub
    });
    if (!res.ok) {
      const status = res.error === 'not_found' ? 404 : res.error === 'forbidden' ? 403 : 409;
      return NextResponse.json({ error: res.error }, { status });
    }
    return NextResponse.json({ statement: res.statement });
  }

  return NextResponse.json({ error: 'Invalid action. Use approve or markPaid' }, { status: 400 });
}
