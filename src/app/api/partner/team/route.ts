import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { listTeam, inviteMember } from '@/lib/services/partner/team';
import { recordAudit } from '@/lib/auth/audit';

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
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const result = await inviteMember(prisma, {
    partnerId: admin.value.partnerId,
    ...parsed.data
  });
  if (!result.ok) {
    const status = result.error === 'email_taken' ? 409 : 422;
    return NextResponse.json({ error: result.error }, { status });
  }

  await recordAudit(prisma, {
    action: 'partner_member_invited',
    entity: 'partner_user',
    entityId: result.partnerUser.id,
    userId: session.sub,
    after: {
      partnerId: admin.value.partnerId,
      invitedUserId: result.user.id,
      email: parsed.data.email,
      roleInPartner: parsed.data.roleInPartner,
      assignedOrgIds: parsed.data.assignedOrgIds,
    },
  });

  return NextResponse.json(
    { userId: result.user.id, partnerUserId: result.partnerUser.id },
    { status: 201 }
  );
}
