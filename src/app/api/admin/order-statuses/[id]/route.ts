import { NextResponse } from 'next/server';
import { requireFieldsAdmin, requireSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { updateStatusDefinition, deleteStatusDefinition } from '@/lib/services/orderStatuses';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const guard = requireFieldsAdmin(sessionResult.value);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const body = await req.json();
  const res = await updateStatusDefinition(prisma, guard.value, id, {
    label: body.label,
    sortOrder: body.sortOrder,
    isActive: body.isActive,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapErr(res.error) });
  return NextResponse.json({ definition: res.definition });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const guard = requireFieldsAdmin(sessionResult.value);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const res = await deleteStatusDefinition(prisma, guard.value, id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapErr(res.error) });
  return NextResponse.json({ ok: true });
}
