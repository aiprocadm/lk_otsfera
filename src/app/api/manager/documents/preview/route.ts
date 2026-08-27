import { jsonError } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { issueInputSchema, toGenerateArgs } from '@/lib/documents/issueInput';
import { previewOrderDocument } from '@/lib/services/documents/generate';

/**
 * Предпросмотр документа до выпуска (`У-147`).
 *
 * Роут тонкий: флаг → сессия → роль → форма входа → сервис. Номер не
 * резервируется, файл никуда не сохраняется — это ровно тот PDF, который
 * получится при выпуске, но пока никому не отправленный.
 *
 * Отдельный роут, а не серверное действие: действие возвращает JSON, а здесь
 * нужен сам файл (`application/pdf`), чтобы показать его человеку в окне.
 */
function mapErr(code: string): number {
  if (code === 'forbidden') return 403;
  if (code === 'not_found' || code === 'no_organization') return 404;
  return 400;
}

export const POST = withAuth(
  {
    feature: 'document_generation',
    guard: (session) => requireRole(session, ['manager', 'leader', 'admin']),
    body: issueInputSchema,
  },
  async ({ session, body }) => {
    const res = await previewOrderDocument(prisma, session, toGenerateArgs(body));
    if (!res.ok) return jsonError(res.error, mapErr(res.error));
    return new Response(new Uint8Array(res.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        // inline: предпросмотр показывают, а не скачивают.
        'Content-Disposition': 'inline; filename="preview.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  }
);
