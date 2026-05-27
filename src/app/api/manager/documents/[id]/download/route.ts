import { NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getDocumentForDownload } from '@/lib/services/manager/documents';
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
import { recordAudit } from '@/lib/auth/audit';

/**
 * GET /api/manager/documents/[id]/download
 *
 * Returns a 302 redirect to a short-lived Supabase Storage signed URL when
 * the manager has visibility on the document's parent order (three-way RBAC
 * via managerDocumentScopeFilter — per-order managerId, per-org assignment,
 * or historical comments) and the document is not infected.
 *
 * Status semantics (matches Phase 7 org route):
 *   - 404: document missing OR out-of-scope (silent; no existence leak)
 *   - 410: document quarantined by ClamAV (scanStatus === 'infected')
 *   - 502: Supabase signing failed
 *   - 302: success
 */

const SIGNED_URL_TTL_SEC = 600;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = crypto.randomUUID();
  const session = await requireManager();
  const { id } = await params;

  const result = await getDocumentForDownload(prisma, session, id);

  if (!result.ok) {
    if (result.error === 'not_found') {
      return new Response(null, { status: 404 });
    }
    // infected
    return new Response('Document quarantined', { status: 410 });
  }

  const { data, error } = await supabaseAdmin.storage
    .from(documentBucket)
    .createSignedUrl(result.path, SIGNED_URL_TTL_SEC);

  if (error || !data?.signedUrl) {
    console.error('Failed to create manager document signed URL', {
      correlationId,
      documentId: id,
      storageBucket: documentBucket,
      storagePath: result.path,
      ttl: SIGNED_URL_TTL_SEC,
      providerError: error?.message ?? 'Missing signed URL from provider'
    });
    return new Response('Storage error', { status: 502 });
  }

  await recordAudit(prisma, {
    action: 'document_download_signed_url',
    entity: 'document',
    entityId: id,
    userId: session.sub,
    after: { ttl: SIGNED_URL_TTL_SEC, viewer: 'manager' }
  });

  return Response.redirect(data.signedUrl, 302);
}
