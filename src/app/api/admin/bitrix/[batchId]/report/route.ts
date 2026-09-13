import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/auth/audit';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';
import { recordPiiAccess } from '@/lib/pii/record';
import { getObjectStorage } from '@/lib/storage';

/**
 * `GET /api/admin/bitrix/<пакет>/report` — отчёт сверки переноса (`У-198`).
 *
 * Файл отдаётся подписанной ссылкой, а не телом ответа: так же, как все
 * документы проекта (§10). В отчёте лежат имена и телефоны перенесённых
 * контактов, поэтому скачивание — это чтение ПДн: пишем событие в журнал
 * доступа (§25.7) и отдельную строку аудита.
 */
const SIGNED_URL_TTL = 600;

type Params = { params: Promise<{ batchId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('bitrix_migration');
  if (disabled) return disabled;
  // Тот же гард, что у действий раздела: одной роли мало. У администратора
  // с профилем доступа, где «Интеграции» закрыты, кнопок нет — и прямая
  // ссылка на отчёт с ПДн тоже не должна работать (§4, defense-in-depth).
  const session = await requireSettingsSection('integrations.bitrix', 'admin');

  const { batchId } = await params;
  const batch = await prisma.bitrixImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, companyId: true, reportPath: true },
  });
  // Чужая компания — «нет такого пакета»: существование чужих пакетов не наше
  // дело. Отчёт ещё не собран — тот же ответ: отличать эти два случая наружу
  // незачем, а экран и так знает, когда кнопка неактивна.
  if (!batch || batch.companyId !== session.companyId || !batch.reportPath) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await recordPiiAccess(prisma, {
    session,
    context: 'bitrix_report',
    subjectIds: [batch.id],
  });

  let signedUrl: string;
  try {
    signedUrl = await getObjectStorage().createSignedUrl(batch.reportPath, SIGNED_URL_TTL, {
      download: true,
    });
  } catch (error) {
    log.error('[admin/bitrix/report] подписанная ссылка не выдана', {
      batchId,
      providerError: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'storage' }, { status: 502 });
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'bitrix_import_report_downloaded',
    entity: 'bitrix_import_batch',
    entityId: batch.id,
    after: { ttl: SIGNED_URL_TTL },
  });

  return NextResponse.redirect(signedUrl, 307);
}
