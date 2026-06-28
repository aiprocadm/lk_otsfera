import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';

const payloadSchema = z.object({
  rate: z.union([z.number().gt(0).lt(1), z.null()]),
  reason: z.string().min(1).max(500)
});

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ orgId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const { orgId } = await ctx.params;
  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parseResult = payloadSchema.safeParse(await req.json().catch(() => null));
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { rate, reason } = parseResult.data;
  const partnerId = admin.value.partnerId;

  const res = rate === null
    ? await clearOrgCommissionRate(prisma, { organizationId: orgId, partnerId, reason, changedByUserId: session.sub })
    : await setOrgCommissionRate(prisma, { organizationId: orgId, partnerId, newRate: rate, reason, changedByUserId: session.sub });
  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : 422;
    return NextResponse.json({ error: res.error }, { status });
  }
  return new NextResponse(null, { status: 204 });
}
