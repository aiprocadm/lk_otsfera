import { type NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getObjectStorage } from '@/lib/storage';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { getInboundAttachmentForDownload } from '@/lib/services/inbound/attachment';

/**
 * GET /api/manager/inbox/[id]/attachment
 *
 * Returns a 302 redirect to a short-lived object-storage signed URL for an
 * inbound message's attachment. Mirrors the call-recording route's
 * 404/410/302 shape (`calls/[id]/recording`); the C8 scope check lives in
 * `getInboundAttachmentForDownload` (see its JSDoc — out-of-scope is 404, not
 * 403, so existence never leaks cross-tenant).
 *
 * Per CLAUDE.md §10, `infected` returns 410 Gone (not 404) — it is a distinct
 * signal ("это разные сигналы").
 *
 * Status semantics:
 *   - 404: flag disabled, message missing, out-of-scope (other company's
 *     bound message), no attachment, or scanStatus in pending/none/error
 *   - 410: attachment quarantined by ClamAV (scanStatus === 'infected')
 *   - 302: success
 */

const SIGNED_URL_TTL_SEC = 600;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('inbound_messaging');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;

  const attachment = await getInboundAttachmentForDownload(prisma, session, id);

  if (!attachment.ok) {
    if (attachment.error === 'quarantined') {
      return new Response('Attachment quarantined', { status: 410 });
    }
    return new Response(null, { status: 404 });
  }

  const signedUrl = await getObjectStorage().createSignedUrl(attachment.path, SIGNED_URL_TTL_SEC, {
    download: attachment.downloadName,
  });

  return Response.redirect(signedUrl, 302);
}
