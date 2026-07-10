import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { getLeadAttachmentDownloadUrl } from '@/lib/services/partner/leadAttachments';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';

function scopeOf(session: { assignedOrgIds?: string[] }): string[] | undefined {
  const arr = session.assignedOrgIds ?? [];
  return arr.length > 0 ? arr : undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const disabled = notFoundIfDisabled('partner_leads');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult.response;

  const { attachmentId } = await params;
  try {
    const result = await getLeadAttachmentDownloadUrl(prisma, {
      attachmentId,
      partnerId: partnerResult.value.partnerId,
      scopeOrgIds: scopeOf(session)
    });
    if (!result.ok) {
      if (result.error === 'NOT_FOUND') {
        return NextResponse.json({ error: result.message }, { status: 404 });
      }
      if (result.error === 'INFECTED') {
        return NextResponse.json(
          {
            code: 'INFECTED',
            error: result.message,
            scanReason: result.meta?.scanReason ?? undefined
          },
          { status: 410 }
        );
      }
      return NextResponse.json({ error: result.message }, { status: 500 });
    }
    return NextResponse.redirect(result.url, 307);
  } catch (err) {
    log.error('[partner/leads/attachments] download failed unexpectedly', { attachmentId, err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
