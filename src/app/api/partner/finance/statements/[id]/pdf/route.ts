import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { getServerClient, documentBucket } from '@/lib/storage/supabase';
import { notFoundIfDisabled } from '@/lib/featureFlags';

const SIGNED_URL_TTL = 600; // 10 minutes

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('commission_pdf');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = requirePartner(session);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const statement = await prisma.commissionStatement.findFirst({
    where: { id, partnerId: guard.value.partnerId },
    select: { pdfPath: true }
  });

  if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!statement.pdfPath) {
    return NextResponse.json({ error: 'PDF not yet generated' }, { status: 404 });
  }

  const { data, error } = await getServerClient()
    .storage.from(documentBucket)
    .createSignedUrl(statement.pdfPath, SIGNED_URL_TTL, { download: true });

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Storage failure' }, { status: 502 });
  }

  return NextResponse.redirect(data.signedUrl, 307);
}
