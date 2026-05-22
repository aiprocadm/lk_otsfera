import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import {
  deleteLeadAttachment,
  LeadAttachmentError
} from '@/lib/services/partner/leadAttachments';

function scopeOf(session: { assignedOrgIds?: string[] }): string[] | undefined {
  const arr = session.assignedOrgIds ?? [];
  return arr.length > 0 ? arr : undefined;
}

function mapErrorToResponse(err: unknown): Response {
  if (err instanceof LeadAttachmentError) {
    switch (err.code) {
      case 'NOT_FOUND':
        return NextResponse.json({ error: err.message }, { status: 404 });
      case 'FORBIDDEN':
      case 'LEAD_NOT_EDITABLE':
        return NextResponse.json({ error: err.message }, { status: 403 });
      default:
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult.response;

  const { attachmentId } = await params;
  try {
    await deleteLeadAttachment(prisma, {
      attachmentId,
      partnerId: partnerResult.value.partnerId,
      scopeOrgIds: scopeOf(session),
      session
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
