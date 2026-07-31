import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { getClientRequestAttachmentDownloadUrl } from '@/lib/services/clientRequests/attachments';
import { log } from '@/lib/logging';

/**
 * POST → { downloadUrl } (presigned, TTL 300 сек). INFECTED → 410 Gone —
 * карантин антивируса это другой сигнал, чем 404 (CLAUDE.md §10).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const disabled = notFoundIfDisabled('client_requests');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { attachmentId } = await params;
  try {
    const result = await getClientRequestAttachmentDownloadUrl(prisma, session, { attachmentId });
    if (!result.ok) {
      if (result.error === 'NOT_FOUND') {
        return NextResponse.json({ error: result.message }, { status: 404 });
      }
      if (result.error === 'INFECTED') {
        return NextResponse.json(
          {
            code: 'INFECTED',
            error: result.message,
            scanReason: result.meta?.scanReason ?? undefined,
          },
          { status: 410 }
        );
      }
      return NextResponse.json({ error: result.message }, { status: 500 });
    }
    return NextResponse.json({
      downloadUrl: result.url,
      name: result.name,
      mimeType: result.mimeType,
    });
  } catch (err) {
    log.error('[client-requests/attachments] download failed unexpectedly', { attachmentId, err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
