import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { listTeam, inviteMember } from '@/lib/services/partner/team';
import { recordAudit } from '@/lib/auth/audit';
import { sendPartnerInviteEmail } from '@/lib/email/send';
import { log } from '@/lib/logging';

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

  // ФТ-10.1: письмо-приглашение best-effort — сбой/отключённый email не ломает
  // приглашение, ссылка возвращается для фолбэка «Скопировать» в форме.
  let emailStatus: 'sent' | 'skipped' = 'skipped';
  try {
    const partner = await prisma.partner.findUnique({
      where: { id: admin.value.partnerId },
      select: { name: true }
    });
    const sent = await sendPartnerInviteEmail({
      to: parsed.data.email,
      partnerName: partner?.name ?? 'партнёр',
      roleLabel: parsed.data.roleInPartner === 'admin' ? 'администратор' : 'менеджер',
      inviteUrl: result.inviteUrl,
      invitedByName: session.name ?? undefined
    });
    if (sent.status === 'sent') emailStatus = 'sent';
  } catch (e) {
    log.warn('[partner/team] send invite email failed', e);
  }

  return NextResponse.json(
    {
      userId: result.user.id,
      partnerUserId: result.partnerUser.id,
      inviteUrl: result.inviteUrl,
      emailStatus
    },
    { status: 201 }
  );
}
