import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import {
  deleteLeadAttachment,
  type LeadAttachmentFailure
} from '@/lib/services/partner/leadAttachments';
import { notFoundIfDisabled } from '@/lib/featureFlags';

function scopeOf(session: { assignedOrgIds?: string[] }): string[] | undefined {
  const arr = session.assignedOrgIds ?? [];
  return arr.length > 0 ? arr : undefined;
}

function mapFailureToResponse(f: LeadAttachmentFailure): Response {
  switch (f.error) {
    case 'NOT_FOUND':
      return NextResponse.json({ error: f.message }, { status: 404 });
    case 'FORBIDDEN':
    case 'LEAD_NOT_EDITABLE':
      return NextResponse.json({ error: f.message }, { status: 403 });
    default:
      return NextResponse.json({ error: f.message }, { status: 500 });
  }
}

export async function DELETE(
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
    const result = await deleteLeadAttachment(prisma, {
      attachmentId,
      partnerId: partnerResult.value.partnerId,
      scopeOrgIds: scopeOf(session),
      session
    });
    if (!result.ok) return mapFailureToResponse(result);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[partner/leads/attachments] delete failed unexpectedly', { attachmentId, err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
