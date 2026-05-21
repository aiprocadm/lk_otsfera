import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { listTeam, inviteMember } from '@/lib/services/partner/team';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  roleInPartner: z.enum(['admin', 'manager']),
  assignedOrgIds: z.array(z.string()).default([])
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const team = await listTeam(prisma, admin.value.partnerId);
  return NextResponse.json(team);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const parsed = inviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await inviteMember(prisma, {
      partnerId: admin.value.partnerId,
      ...parsed.data
    });

    await prisma.auditLog.create({
      data: {
        action: 'partner_member_invited',
        entity: 'partner_user',
        entityId: result.partnerUser.id,
        userId: session.sub,
        meta: {
          partnerId: admin.value.partnerId,
          invitedUserId: result.user.id,
          email: parsed.data.email,
          roleInPartner: parsed.data.roleInPartner,
          assignedOrgIds: parsed.data.assignedOrgIds
        }
      }
    });

    return NextResponse.json(
      { userId: result.user.id, partnerUserId: result.partnerUser.id },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.startsWith('EMAIL_TAKEN')) return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });
    if (msg.startsWith('ORG_OUT_OF_SCOPE')) return NextResponse.json({ error: 'ORG_OUT_OF_SCOPE' }, { status: 422 });
    throw err;
  }
}
