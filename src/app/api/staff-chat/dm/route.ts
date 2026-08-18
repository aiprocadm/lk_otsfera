import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { openDm } from '@/lib/services/staffChat/conversations';

const requireStaff = (session: Parameters<typeof requireRole>[0]) =>
  requireRole(session, ['admin', 'manager', 'leader']);

/** Форма входа; существование/доступность собеседника проверяет сервис. */
const dmBodySchema = z.object({
  targetUserId: z.string(),
});

export const POST = withAuth(
  { feature: 'staff_chat', guard: requireStaff, body: dmBodySchema },
  async ({ session, body }) => {
    const result = await openDm(prisma, session, { targetUserId: body.targetUserId });

    if (!result.ok) {
      const status = result.error === 'forbidden' ? 403 : 404; // 'target_not_found'
      return Response.json({ ok: false, error: result.error }, { status });
    }

    return Response.json({ ok: true, conversationId: result.conversationId }, { status: 201 });
  }
);
