import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/guard';
import { canReadDocument, forbiddenResponse } from '@/lib/auth/policy';
import { getObjectStorage } from '@/lib/storage';
import { recordAudit } from '@/lib/auth/audit';
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
  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      path: true,
      name: true,
      scanStatus: true,
      scanReason: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      order: { select: { companyId: true } },
    },
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await canReadDocument(s, doc)))
    return forbiddenResponse('You do not have access to this document');
  if (doc.scanStatus === 'infected' && s.role !== 'admin') {
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
    signedUrl = await getObjectStorage().createSignedUrl(doc.path, ttl);
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

  return NextResponse.json({ downloadUrl: signedUrl, expiresInSec: ttl, fileName: doc.name });
}
