import { NextResponse } from 'next/server';
import { requireAdmin, requireSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { listDirections, createDirection } from '@/lib/services/training';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const res = await listDirections(prisma, adminGuard.value, { includeInactive: true });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapErr(res.error) });
  return NextResponse.json({ directions: res.directions });
}

export async function POST(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const body = await req.json();
  const res = await createDirection(prisma, adminGuard.value, {
    name: body.name,
    slug: body.slug,
    sortOrder: body.sortOrder,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapErr(res.error) });
  return NextResponse.json({ direction: res.direction }, { status: 201 });
}
