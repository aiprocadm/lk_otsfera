import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { getDialogAttachmentUrl } from '@/lib/services/messengers/attachment';

/**
 * GET /api/manager/messengers/[id]/attachment/[messageId] — скачать вложение
 * переписки (`У-204`).
 *
 * Отдаём не файл, а 302 на подписанную ссылку хранилища на 600 секунд
 * (CLAUDE.md §10: приложение файлы через себя не проксирует).
 *
 * Коды говорят разное, и различать их важно: `410` — файл заражён и заперт
 * навсегда, `409` — проверка ещё идёт и ссылка оживёт сама, `404` — такого
 * вложения нет или оно из чужого диалога.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const off = notFoundIfDisabled('inbound_messaging');
  if (off) return off;

  const session = await requireManager();
  const { id, messageId } = await params;

  const result = await getDialogAttachmentUrl(prisma, session, { dialogId: id, messageId });

  if (!result.ok) {
    const status =
      result.error === 'forbidden'
        ? 403
        : result.error === 'not_ready'
          ? 409
          : result.error === 'infected'
            ? 410
            : result.error === 'storage'
              ? 502
              : 404;
    return new Response(null, { status });
  }

  return Response.redirect(result.url, 302);
}
