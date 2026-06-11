import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { requireOrganization } from '@/lib/auth/requireRole';
import { resolveActiveOrgId } from '@/lib/auth/orgContext';
import { getOrgDocumentForDownload } from '@/lib/services/organization/documents';
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
import { recordAudit } from '@/lib/auth/audit';
import { notFoundIfDisabled } from '@/lib/featureFlags';

const MIN_TTL = 60;
const MAX_TTL = 300;
const DEFAULT_TTL = 120;

function resolveTtl(queryTtl: string | null): number {
  const envTtl = Number(process.env.DOCUMENT_SIGNED_URL_TTL_SEC ?? DEFAULT_TTL);
  const requested = queryTtl ? Number(queryTtl) : envTtl;
  const safe = Number.isFinite(requested) ? requested : DEFAULT_TTL;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, safe));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('organization_cabinet');
  if (disabled) return disabled;

  const correlationId = crypto.randomUUID();
  const session = await requireOrganization();

  const url = new URL(req.url);
  const queryOrg = url.searchParams.get('org');
  const cookieStore = await cookies();
  const cookieOrg = cookieStore.get('org_ctx')?.value ?? null;

  const activeOrgId = resolveActiveOrgId(session, queryOrg, cookieOrg);
  const { id } = await params;

  const result = await getOrgDocumentForDownload(prisma, activeOrgId, id);

  if (!result.ok) {
    if (result.error === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(
      {
        code: 'INFECTED',
        message: 'Document was quarantined by malware scan',
        scanReason: result.scanReason ?? undefined
      },
      { status: 410 }
    );
  }

  const ttl = resolveTtl(url.searchParams.get('ttl'));
  const { data, error } = await supabaseAdmin.storage
    .from(documentBucket)
    .createSignedUrl(result.path, ttl);

  if (error || !data?.signedUrl) {
    console.error('Failed to create org document signed URL', {
      correlationId,
      documentId: id,
      storageBucket: documentBucket,
      storagePath: result.path,
      ttl,
      providerError: error?.message ?? 'Missing signed URL from provider'
    });
    return NextResponse.json(
      { error: 'Failed to create document download link', correlationId },
      { status: 502 }
    );
  }

  await recordAudit(prisma, {
    action: 'document_download_signed_url',
    entity: 'document',
    entityId: id,
    userId: session.sub,
    after: { ttl, viewer: 'organization', organizationId: activeOrgId }
  });

  return NextResponse.json({
    downloadUrl: data.signedUrl,
    expiresInSec: ttl,
    fileName: result.name
  });
}
