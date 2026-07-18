import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { getObjectStorage } from '@/lib/storage';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';

const SIGNED_URL_TTL = 600;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('commission_xlsx');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Model A: admin скачивает отчёт из /admin-зеркала без partnerId-скоупа
  // (та же admin-ветка, что у markPaid в ../route.ts); партнёр — только свои.
  let partnerScope: { partnerId: string } | undefined;
  if (session.role !== 'admin') {
    const guard = requirePartner(session);
    if (!guard.ok) return guard.response;
    partnerScope = { partnerId: guard.value.partnerId };
  }

  const { id } = await params;
  const statement = await prisma.commissionStatement.findFirst({
    where: { id, ...partnerScope },
    select: { xlsxPath: true }
  });

  if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!statement.xlsxPath) {
    return NextResponse.json({ error: 'XLSX not yet generated' }, { status: 404 });
  }

  let signedUrl: string;
  try {
    signedUrl = await getObjectStorage().createSignedUrl(statement.xlsxPath, SIGNED_URL_TTL, {
      download: true
    });
  } catch (error) {
    log.error('[partner/finance/statements] failed to create XLSX signed URL', {
      statementId: id,
      providerError: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Storage failure' }, { status: 502 });
  }

  return NextResponse.redirect(signedUrl, 307);
}
