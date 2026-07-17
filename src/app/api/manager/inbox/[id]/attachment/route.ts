import { NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getObjectStorage } from '@/lib/storage';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { isInboundMessageInScope } from '@/lib/services/inbound/scope';

/**
 * GET /api/manager/inbox/[id]/attachment
 *
 * Returns a 302 redirect to a short-lived object-storage signed URL for an
 * inbound message's attachment. Mirrors the call-recording route's
 * 404/410/302 shape (`calls/[id]/recording`), but the scope check follows
 * `listInbox` (C8): a manager may download attachments of their OWN
 * company's bound messages PLUS the shared "unresolved" triage queue
 * (companyId=null), and NEVER another company's bound messages. Out-of-scope
 * is 404, not 403 — existence must not leak cross-tenant.
 *
 * Per CLAUDE.md §10, `infected` returns 410 Gone (not 404) — it is a distinct
 * signal ("это разные сигналы"). By the time we reach the scan-status guard
 * the caller has already passed the scope check, so a 410 only reveals that
 * an attachment VISIBLE TO THEM is quarantined, leaking nothing cross-tenant.
 * Other not-clean states (pending/none/error) are simply not downloadable
 * yet and return 404.
 *
 * Status semantics:
 *   - 404: flag disabled, message missing, out-of-scope (other company's
 *     bound message), no attachment, or scanStatus in pending/none/error
 *   - 410: attachment quarantined by ClamAV (scanStatus === 'infected')
 *   - 302: success
 */

const SIGNED_URL_TTL_SEC = 600;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const disabled = notFoundIfDisabled('inbound_messaging');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;

  const msg = await prisma.inboundMessage.findUnique({
    where: { id },
    select: {
      companyId: true,
      status: true,
      attachmentPath: true,
      attachmentName: true,
      scanStatus: true,
    },
  });

  if (!msg) {
    return new Response(null, { status: 404 });
  }

  // C8 scope — shared module (scope.ts), the in-memory equivalent of
  // listInbox's `inboxScopeWhere`; see its JSDoc for the sentinel rationale.
  if (!isInboundMessageInScope(session, msg)) {
    return new Response(null, { status: 404 });
  }

  if (!msg.attachmentPath) {
    return new Response(null, { status: 404 });
  }

  if (msg.scanStatus === 'infected') {
    return new Response('Attachment quarantined', { status: 410 });
  }

  if (msg.scanStatus !== 'clean') {
    // pending/none/error → not downloadable yet (distinct from quarantined)
    return new Response(null, { status: 404 });
  }

  const signedUrl = await getObjectStorage().createSignedUrl(msg.attachmentPath, SIGNED_URL_TTL_SEC, {
    download: msg.attachmentName ?? 'attachment',
  });

  return Response.redirect(signedUrl, 302);
}
