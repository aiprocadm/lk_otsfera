import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeParams } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { prisma } from '@/lib/db/prisma';
import { requirePartner, requirePartnerAdmin } from '@/lib/auth/guard';
import { approveStatement, markStatementPaid } from '@/lib/services/commission/lifecycle';
import { getStatementWithItems } from '@/lib/services/partner/finance';

export const GET = withAuth({ guard: requirePartner }, async ({ session, params }) => {
  // Next.js всегда даёт сегмент [id] для этого файла роута; withAuth типизирует
  // params как Record<string,string>, которая под noUncheckedIndexedAccess сужение теряет.
  const { id } = await routeParams<{ id: string }>(params);
  // requirePartner гарантирует partnerId; тип withAuth сужение не переносит.
  const statement = await getStatementWithItems(prisma, id, session.partnerId as string);
  if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ statement });
});

/**
 * Схема — только ФОРМА входа. Допустимость action и права на неё
 * (partner-admin для approve, платформенный admin для markPaid) — ниже:
 * гард зависит от action, поэтому в opts.guard его не вынести.
 */
const patchBodySchema = z.object({
  action: z.string(),
});

export const PATCH = withAuth({ body: patchBodySchema }, async ({ session, body, params }) => {
  // Next.js всегда даёт сегмент [id] для этого файла роута; withAuth типизирует
  // params как Record<string,string>, которая под noUncheckedIndexedAccess сужение теряет.
  const { id } = await routeParams<{ id: string }>(params);
  const { action } = body;

  if (action === 'approve') {
    const guard = requirePartnerAdmin(session);
    if (!guard.ok) return guard.response;

    const res = await approveStatement(prisma, {
      statementId: id,
      partnerId: guard.value.partnerId,
      approvedByUserId: guard.value.sub,
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
      paidByUserId: session.sub,
    });
    if (!res.ok) {
      const status = res.error === 'not_found' ? 404 : res.error === 'forbidden' ? 403 : 409;
      return NextResponse.json({ error: res.error }, { status });
    }
    return NextResponse.json({ statement: res.statement });
  }

  return NextResponse.json({ error: 'Invalid action. Use approve or markPaid' }, { status: 400 });
});
