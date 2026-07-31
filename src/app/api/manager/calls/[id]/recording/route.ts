import { type NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getObjectStorage } from '@/lib/storage';
import { notFoundIfDisabled } from '@/lib/featureFlags';

/**
 * GET /api/manager/calls/[id]/recording
 *
 * Returns a 302 redirect to a short-lived object-storage signed URL for a
 * call's recording. IDOR/company-scope is the load-bearing invariant here —
 * a phone recording is sensitive, so ANY ambiguity (another company's call,
 * or a not-yet-resolved call with companyId=null) denies rather than
 * defaulting open. Mirrors the manager document download route's 404/410/302
 * shape.
 *
 * Per CLAUDE.md §10, `infected` returns 410 Gone (not 404) — it is a distinct
 * signal ("это разные сигналы"). By the time we reach the scan-status guard
 * the caller has already passed the company-scope check, so a 410 only
 * reveals that THEIR OWN company's recording is quarantined, leaking nothing
 * cross-tenant. Other not-clean states (pending/none/error) are simply not
 * downloadable yet and return 404.
 *
 * Status semantics:
 *   - 404: flag disabled, call missing, out-of-scope (other company /
 *     unresolved / no session company), no recording, or scanStatus in
 *     pending/none/error
 *   - 410: recording quarantined by ClamAV (scanStatus === 'infected')
 *   - 302: success
 */

const SIGNED_URL_TTL_SEC = 600;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const disabled = notFoundIfDisabled('telephony_mango');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;

  const call = await prisma.call.findUnique({
    where: { id },
    select: { companyId: true, recordingPath: true, recordingScanStatus: true },
  });

  if (!call) {
    return new Response(null, { status: 404 });
  }

  // IDOR/company-scope: deny cross-company AND unresolved (companyId null)
  // calls. A companyId-less session can never match here (session.companyId
  // would be null/undefined on both sides only if the call is also
  // unresolved, which is denied explicitly below).
  if (!call.companyId || !session.companyId || call.companyId !== session.companyId) {
    return new Response(null, { status: 404 });
  }

  if (!call.recordingPath) {
    return new Response(null, { status: 404 });
  }

  if (call.recordingScanStatus === 'infected') {
    return new Response('Recording quarantined', { status: 410 });
  }

  if (call.recordingScanStatus !== 'clean') {
    // pending/none/error → not downloadable yet (distinct from quarantined)
    return new Response(null, { status: 404 });
  }

  const signedUrl = await getObjectStorage().createSignedUrl(call.recordingPath, SIGNED_URL_TTL_SEC, {
    download: 'recording.mp3',
  });

  return Response.redirect(signedUrl, 302);
}
