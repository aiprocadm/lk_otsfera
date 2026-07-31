import { NextResponse } from 'next/server';
import { requireAdmin, requireSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { updateDirection, deactivateDirection } from '@/lib/services/training';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const { id } = await ctx.params;
  const body = await req.json();
  const res = await updateDirection(prisma, adminGuard.value, {
    id,
    name: body.name,
    sortOrder: body.sortOrder,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapErr(res.error) });
  return NextResponse.json({ direction: res.direction });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const { id } = await ctx.params;
  const res = await deactivateDirection(prisma, adminGuard.value, { id });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapErr(res.error) });
  return NextResponse.json({ direction: res.direction });
}
