import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';

const DEFAULT_TAKE = 20;
const MAX_TAKE = 100;

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  const roleResult = requireRole(s, ['admin', 'organization', 'partner', 'manager']);
  if (!roleResult.ok) return roleResult.response;

  const searchParams = new URL(req.url).searchParams;
  const take = Math.min(parsePositiveInt(searchParams.get('take'), DEFAULT_TAKE), MAX_TAKE);
  const skip = parsePositiveInt(searchParams.get('skip'), 0);

  const where =
    s.role === 'admin'
      ? {}
      : s.role === 'organization' && s.organizationId
        ? { company: { organizations: { some: { id: s.organizationId } } } }
        : s.role === 'partner' && s.partnerId
          ? { company: { organizations: { some: { partnerId: s.partnerId } } } }
          : { company: { organizations: { some: { organizationUsers: { some: { userId: s.sub, isActive: true } } } } } };

  const orders = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip });
  return NextResponse.json(orders);
}
