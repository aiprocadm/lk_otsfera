import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { sendStaffMessage, listStaffMessages } from '@/lib/services/staffChat/messages';

const requireStaff = (session: Parameters<typeof requireRole>[0]) =>
  requireRole(session, ['admin', 'manager']);

export const GET = withAuth(
  { feature: 'staff_chat', guard: requireStaff },
  async ({ req, session }) => {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get('conversationId');
    if (!conversationId) {
      return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
    }
    const after = url.searchParams.get('after') ?? undefined;

    const result = await listStaffMessages(prisma, session, {
      conversationId,
      ...(after ? { after } : {}),
    });

    if (!result.ok) {
      const status = result.error === 'forbidden' ? 403 : 404;
      return Response.json({ ok: false, error: result.error }, { status });
    }

    return Response.json({ ok: true, rows: result.rows });
  }
);

/** Форма входа; лимиты/пустое тело/доступ к разговору проверяет сервис. */
const postBodySchema = z.object({
  conversationId: z.string(),
  body: z.string(),
  attachmentPath: z.string().optional(),
  attachmentName: z.string().optional(),
  attachmentMime: z.string().optional(),
});

export const POST = withAuth(
  { feature: 'staff_chat', guard: requireStaff, body: postBodySchema },
  async ({ session, body }) => {
    const result = await sendStaffMessage(prisma, session, {
      conversationId: body.conversationId,
      body: body.body,
      // exactOptionalPropertyTypes: сервис различает «ключа нет» и «ключ = undefined».
      ...(body.attachmentPath !== undefined ? { attachmentPath: body.attachmentPath } : {}),
      ...(body.attachmentName !== undefined ? { attachmentName: body.attachmentName } : {}),
      ...(body.attachmentMime !== undefined ? { attachmentMime: body.attachmentMime } : {}),
    });

    if (!result.ok) {
      const status =
        result.error === 'forbidden'
          ? 403
          : result.error === 'conversation_not_found'
            ? 404
            : result.error === 'too_large'
              ? 413
              : 400; // 'empty_body'
      return Response.json({ ok: false, error: result.error }, { status });
    }

    return Response.json({ ok: true, messageId: result.messageId }, { status: 201 });
  }
);
