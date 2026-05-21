import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ orgId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partner = requirePartner(session);
  if (!partner.ok) return partner.response;

  const { orgId } = await ctx.params;

  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const card = await getOrgCard(prisma, { orgId, partnerId: partner.value.partnerId });
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(card);
}
