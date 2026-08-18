import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { toggleReaction } from '@/lib/services/staffChat/messages';

const requireStaff = (session: Parameters<typeof requireRole>[0]) =>
  requireRole(session, ['admin', 'manager', 'leader']);

/** Форма входа; допустимость emoji ('invalid') проверяет сервис. */
const reactionBodySchema = z.object({
  messageId: z.string(),
  emoji: z.string(),
});

export const POST = withAuth(
  { feature: 'staff_chat', guard: requireStaff, body: reactionBodySchema },
  async ({ session, body }) => {
    const result = await toggleReaction(prisma, session, {
      messageId: body.messageId,
      emoji: body.emoji,
    });

    if (!result.ok) {
      const status =
        result.error === 'forbidden' ? 403 : result.error === 'message_not_found' ? 404 : 400; // 'invalid'
      return Response.json({ ok: false, error: result.error }, { status });
    }

    return Response.json({ ok: true, reacted: result.reacted });
  }
);
