import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { getStatementFilePath } from '@/lib/services/partner/finance';
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
  // Сам partnerId-фильтр применяет сервис, здесь — только гард роли.
  if (session.role !== 'admin') {
    const guard = requirePartner(session);
    if (!guard.ok) return guard.response;
  }

  const { id } = await params;
  const statement = await getStatementFilePath(prisma, session, { id, format: 'xlsx' });

  if (!statement.ok) {
    return NextResponse.json(
      { error: statement.error === 'not_found' ? 'Not found' : 'XLSX not yet generated' },
      { status: 404 }
    );
  }

  let signedUrl: string;
  try {
    signedUrl = await getObjectStorage().createSignedUrl(statement.path, SIGNED_URL_TTL, {
      download: true,
    });
  } catch (error) {
    log.error('[partner/finance/statements] failed to create XLSX signed URL', {
      statementId: id,
      providerError: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Storage failure' }, { status: 502 });
  }

  return NextResponse.redirect(signedUrl, 307);
}
