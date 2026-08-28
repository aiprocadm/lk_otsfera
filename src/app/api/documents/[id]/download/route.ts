import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/guard';
import { forbiddenResponse } from '@/lib/auth/policy';
import { getObjectStorage } from '@/lib/storage';
import { recordAudit } from '@/lib/auth/audit';
import { getDocumentForSignedDownload } from '@/lib/services/documents/download';
import { markDocumentViewed } from '@/lib/services/documents/viewMarks';
import { log } from '@/lib/logging';

const MIN_TTL = 60;
const MAX_TTL = 300;
const DEFAULT_TTL = 120;

function resolveTtl(queryTtl?: string | null) {
  const envTtl = Number(process.env.DOCUMENT_SIGNED_URL_TTL_SEC ?? DEFAULT_TTL);
  const requested = queryTtl ? Number(queryTtl) : envTtl;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, Number.isFinite(requested) ? requested : DEFAULT_TTL));
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = crypto.randomUUID();
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  const { id } = await params;
  const doc = await getDocumentForSignedDownload(prisma, s, id);
  if (!doc.ok) {
    if (doc.error === 'not_found')
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (doc.error === 'forbidden')
      return forbiddenResponse('You do not have access to this document');
    return NextResponse.json(
      {
        code: 'INFECTED',
        message: 'Document was quarantined by malware scan',
        scanReason: doc.scanReason ?? undefined,
      },
      { status: 410 }
    );
  }

  const ttl = resolveTtl(new URL(_req.url).searchParams.get('ttl'));
  let signedUrl: string;
  try {
    // `У-154`: имя файла для клиента, а не ключ хранилища — иначе в папке
    // «Загрузки» лежит россыпь одинаковых `invoice-v1-…pdf`.
    signedUrl = await getObjectStorage().createSignedUrl(doc.path, ttl, {
      download: doc.downloadName,
    });
  } catch (error) {
    log.error('Failed to create document signed URL', {
      correlationId,
      documentId: doc.id,
      storagePath: doc.path,
      ttl,
      providerError: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to create document download link', correlationId },
      { status: 502 }
    );
  }

  await recordAudit(prisma, {
    action: 'document_download_signed_url',
    entity: 'document',
    entityId: doc.id,
    userId: s.sub,
    after: { ttl },
  });
  // Этап 3 PR-2 (ФТ-6.6): скачивание гасит бейдж «новый» (best-effort внутри).
  await markDocumentViewed(prisma, { documentId: doc.id, userId: s.sub });

  return NextResponse.json({ downloadUrl: signedUrl, expiresInSec: ttl, fileName: doc.downloadName });
}
