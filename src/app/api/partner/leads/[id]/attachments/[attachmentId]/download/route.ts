import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import {
  getLeadAttachmentDownloadUrl,
  LeadAttachmentError
} from '@/lib/services/partner/leadAttachments';

function scopeOf(session: { assignedOrgIds?: string[] }): string[] | undefined {
  const arr = session.assignedOrgIds ?? [];
  return arr.length > 0 ? arr : undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult.response;

  const { attachmentId } = await params;
  try {
    const { url } = await getLeadAttachmentDownloadUrl(prisma, {
      attachmentId,
      partnerId: partnerResult.value.partnerId,
      scopeOrgIds: scopeOf(session)
    });
    return NextResponse.redirect(url, 307);
  } catch (err) {
    if (err instanceof LeadAttachmentError) {
      if (err.code === 'NOT_FOUND') {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
