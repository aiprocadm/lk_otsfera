import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { assignOrgs, deactivateMember } from '@/lib/services/partner/team';

const assignSchema = z.object({
  assignedOrgIds: z.array(z.string())
});

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const { userId } = await ctx.params;
  const parsed = assignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await assignOrgs(prisma, {
      partnerId: admin.value.partnerId,
      userId,
      assignedOrgIds: parsed.data.assignedOrgIds
    });

    await prisma.auditLog.create({
      data: {
        action: 'partner_member_scope_changed',
        entity: 'partner_user',
        entityId: updated.id,
        userId: session.sub,
        meta: {
          partnerId: admin.value.partnerId,
          targetUserId: userId,
          assignedOrgIds: parsed.data.assignedOrgIds
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.startsWith('ORG_OUT_OF_SCOPE')) return NextResponse.json({ error: 'ORG_OUT_OF_SCOPE' }, { status: 422 });
    if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const { userId } = await ctx.params;

  try {
    const deactivated = await deactivateMember(prisma, { partnerId: admin.value.partnerId, userId });

    await prisma.auditLog.create({
      data: {
        action: 'partner_member_deactivated',
        entity: 'partner_user',
        entityId: deactivated.id,
        userId: session.sub,
        meta: {
          partnerId: admin.value.partnerId,
          targetUserId: userId
        }
      }
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.startsWith('LAST_ADMIN')) return NextResponse.json({ error: 'LAST_ADMIN' }, { status: 409 });
    if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    throw err;
  }
}
