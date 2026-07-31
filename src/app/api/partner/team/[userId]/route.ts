import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { assignOrgs, deactivateMember } from '@/lib/services/partner/team';
import { recordAudit } from '@/lib/auth/audit';

const assignSchema = z.object({
  assignedOrgIds: z.array(z.string()),
});

export async function PUT(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const { userId } = await ctx.params;
  const parsed = assignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const res = await assignOrgs(prisma, {
    partnerId: admin.value.partnerId,
    userId,
    assignedOrgIds: parsed.data.assignedOrgIds,
  });
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 422 });
  }

  await recordAudit(prisma, {
    action: 'partner_member_scope_changed',
    entity: 'partner_user',
    entityId: res.partnerUser.id,
    userId: session.sub,
    after: {
      partnerId: admin.value.partnerId,
      targetUserId: userId,
      assignedOrgIds: parsed.data.assignedOrgIds,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const { userId } = await ctx.params;

  const res = await deactivateMember(prisma, { partnerId: admin.value.partnerId, userId });
  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: res.error }, { status });
  }

  await recordAudit(prisma, {
    action: 'partner_member_deactivated',
    entity: 'partner_user',
    entityId: res.partnerUser.id,
    userId: session.sub,
    after: {
      partnerId: admin.value.partnerId,
      targetUserId: userId,
    },
  });

  return new NextResponse(null, { status: 204 });
}
