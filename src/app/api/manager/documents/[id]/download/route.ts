import { type NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getDocumentForDownload } from '@/lib/services/manager/documents';
import { getObjectStorage } from '@/lib/storage';
import { recordAudit } from '@/lib/auth/audit';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';

/**
 * POST /api/manager/documents/[id]/download
 *
 * Returns a JSON body { downloadUrl, expiresInSec, fileName } with a
 * short-lived object-storage signed URL when the manager has visibility on
 * the document's parent order (three-way RBAC via managerDocumentScopeFilter —
 * per-order managerId, per-org assignment, or historical comments) and the
 * document is not infected.
 *
 * Uses POST + JSON to match the DocumentsList component caller (same contract
 * as the org and generic download routes, which it navigates client-side).
 * There are no GET-style callers.
 *
 * Status semantics (matches Phase 7 org route):
 *   - 404: document missing OR out-of-scope (silent; no existence leak)
 *   - 410: document quarantined by ClamAV (scanStatus === 'infected')
 *   - 502: object-storage signing failed
 *   - 200: success (JSON with signed URL)
 */

const SIGNED_URL_TTL_SEC = 600;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

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

  let signedUrl: string;
  try {
    // `У-154`: имя файла для клиента, а не ключ хранилища — иначе в папке
    // «Загрузки» лежит россыпь одинаковых `invoice-v1-…pdf`.
    signedUrl = await getObjectStorage().createSignedUrl(result.path, SIGNED_URL_TTL_SEC, {
      download: result.downloadName,
    });
  } catch (error) {
    log.error('Failed to create manager document signed URL', {
      correlationId,
      documentId: id,
      storagePath: result.path,
      ttl: SIGNED_URL_TTL_SEC,
      providerError: error instanceof Error ? error.message : String(error),
    });
    return new Response('Storage error', { status: 502 });
  }

  await recordAudit(prisma, {
    action: 'document_download_signed_url',
    entity: 'document',
    entityId: id,
    userId: session.sub,
    after: { ttl: SIGNED_URL_TTL_SEC, viewer: 'manager' },
  });

  return Response.json({
    downloadUrl: signedUrl,
    expiresInSec: SIGNED_URL_TTL_SEC,
    fileName: result.downloadName,
  });
}
