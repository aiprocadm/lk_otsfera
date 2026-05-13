import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canReadDocument, forbiddenResponse } from '@/lib/auth/policy';
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';

const MIN_TTL = 60;
const MAX_TTL = 300;
const DEFAULT_TTL = 120;

function resolveTtl(queryTtl?: string | null) {
  const envTtl = Number(process.env.DOCUMENT_SIGNED_URL_TTL_SEC ?? DEFAULT_TTL);
  const requested = queryTtl ? Number(queryTtl) : envTtl;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, Number.isFinite(requested) ? requested : DEFAULT_TTL));
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const doc = await prisma.document.findUnique({ where: { id: params.id }, include: { order: { select: { companyId: true } } } });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await canReadDocument(s, doc))) return forbiddenResponse('You do not have access to this document');

  const ttl = resolveTtl(new URL(_req.url).searchParams.get('ttl'));
  const { data, error } = await supabaseAdmin.storage.from(documentBucket).createSignedUrl(doc.path, ttl);

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create signed URL' }, { status: 500 });
  }

  await prisma.auditLog.create({
    data: {
      action: 'document_download_signed_url',
      entity: 'document',
      entityId: doc.id,
      userId: s.sub,
      meta: { ttl }
    }
  });

  return NextResponse.json({ downloadUrl: data.signedUrl, expiresInSec: ttl, fileName: doc.name });
}
