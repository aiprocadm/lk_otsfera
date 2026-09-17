import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { getObjectStorage } from '@/lib/storage';
import { getPartnerMaterialForDownload } from '@/lib/services/partnerMaterials/partner';
import { log } from '@/lib/logging';

/** Подписанная ссылка живёт 10 минут — как у документов (§10 CLAUDE.md). */
const SIGNED_URL_TTL_SEC = 600;

/**
 * `POST /api/partner/materials/[id]/download` (`У-237`): подписанная ссылка на
 * файл материала. Право и аудит «кто скачал» — в сервисе; роут мапит коды.
 * Только роль партнёра: у сотрудников материалы лежат в хабе.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'partner' || !session.partnerId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const res = await getPartnerMaterialForDownload(prisma, session, id);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.error === 'no_file' ? 409 : 404 });
  }
  try {
    const downloadUrl = await getObjectStorage().createSignedUrl(res.path, SIGNED_URL_TTL_SEC, {
      download: res.fileName,
    });
    return NextResponse.json({ downloadUrl });
  } catch (error) {
    log.error('[partner/materials] signed url failed', {
      materialId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'storage' }, { status: 502 });
  }
}
