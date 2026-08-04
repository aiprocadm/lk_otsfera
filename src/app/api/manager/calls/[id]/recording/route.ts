import { type NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCallRecordingForDownload } from '@/lib/services/telephony/recording';
import { getObjectStorage } from '@/lib/storage';
import { notFoundIfDisabled } from '@/lib/featureFlags';

/**
 * GET /api/manager/calls/[id]/recording
 *
 * Returns a 302 redirect to a short-lived object-storage signed URL for a
 * call's recording. IDOR/company-scope is the load-bearing invariant here —
 * it is enforced by `getCallRecordingForDownload`, see its JSDoc for why any
 * ambiguity denies rather than defaulting open.
 *
 * Per CLAUDE.md §10, `infected` returns 410 Gone (not 404) — it is a distinct
 * signal ("это разные сигналы"). Mirrors the manager document download route's
 * 404/410/302 shape.
 *
 * Status semantics:
 *   - 404: flag disabled, call missing, out-of-scope (other company /
 *     unresolved / no session company), no recording, or scanStatus in
 *     pending/none/error
 *   - 410: recording quarantined by ClamAV (scanStatus === 'infected')
 *   - 302: success
 */

const SIGNED_URL_TTL_SEC = 600;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('telephony_mango');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;

  const recording = await getCallRecordingForDownload(prisma, session, id);

  if (!recording.ok) {
    if (recording.error === 'quarantined') {
      return new Response('Recording quarantined', { status: 410 });
    }
    return new Response(null, { status: 404 });
  }

  const signedUrl = await getObjectStorage().createSignedUrl(recording.path, SIGNED_URL_TTL_SEC, {
    download: 'recording.mp3',
  });

  return Response.redirect(signedUrl, 302);
}
