import { readFile, readMultipart } from '@/lib/api/multipart';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { sendDialogAttachment } from '@/lib/services/messengers/attachment';

/**
 * POST /api/manager/messengers/[id]/attachment — сотрудник прикладывает файл
 * к диалогу (`У-204`).
 *
 * Именно роут, а не server action: на действиях форм стоит общий предел тела
 * 25 МБ (`next.config.mjs`), и файл больше него отбрасывается ДО входа в
 * действие — форма молчит, хотя обещала 50 МБ (CLAUDE.md §11).
 *
 * Роут тонкий: разбирает форму и переводит код сервиса в статус. Вся
 * проверка, скоуп и запись — в `sendDialogAttachment`; отправка клиенту
 * происходит позже, когда файл пройдёт антивирус.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const off = notFoundIfDisabled('inbound_messaging');
  if (off) return off;

  const session = await requireManager();
  const { id } = await params;

  const form = await readMultipart(req);
  if (!form) return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const file = await readFile(form, 'file');
  if (!file) return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const result = await sendDialogAttachment(prisma, session, {
    dialogId: id,
    file: { name: file.name, size: file.size, mimeType: file.type, buffer: file.buffer },
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden'
        ? 403
        : result.error === 'not_found'
          ? 404
          : result.error === 'too_large'
            ? 413
            : result.error === 'invalid_mime'
              ? 415
              : result.error === 'channel_no_attachments'
                ? 422
                : 500;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, messageId: result.messageId }, { status: 201 });
}
