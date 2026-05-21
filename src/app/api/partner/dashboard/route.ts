import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { kpis, attention, recentEvents } from '@/lib/services/partner/dashboard';

const EVENT_LIMIT = 10;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partner = requirePartner(session);
  if (!partner.ok) return partner.response;

  const scope = {
    partnerId: partner.value.partnerId,
    scopeOrgIds: session.assignedOrgIds ?? []
  };

  const [k, a, events] = await Promise.all([
    kpis(prisma, scope),
    attention(prisma, scope),
    recentEvents(prisma, scope, EVENT_LIMIT)
  ]);

  return NextResponse.json({ kpis: k, attention: a, events });
}
