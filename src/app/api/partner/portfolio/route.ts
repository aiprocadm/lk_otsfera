import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { listPortfolio } from '@/lib/services/partner/portfolio';

const DEFAULT_TAKE = 20;
const MAX_TAKE = 100;

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partner = requirePartner(session);
  if (!partner.ok) return partner.response;

  const sp = new URL(req.url).searchParams;
  const take = Math.min(parsePositiveInt(sp.get('take'), DEFAULT_TAKE), MAX_TAKE);
  const skip = parsePositiveInt(sp.get('skip'), 0);
  const search = sp.get('search') ?? undefined;

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const result = await listPortfolio(prisma, {
    partnerId: partner.value.partnerId,
    scopeOrgIds: scope,
    search,
    take,
    skip
  });

  return NextResponse.json(result);
}
