import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { createGroupChat, listConversations } from '@/lib/services/staffChat/conversations';

const requireStaff = (session: Parameters<typeof requireRole>[0]) =>
  requireRole(session, ['admin', 'manager', 'leader']);

export const GET = withAuth({ feature: 'staff_chat', guard: requireStaff }, async ({ session }) => {
  const result = await listConversations(prisma, session);
  return Response.json({ ok: true, rows: result.rows });
});

/** Форма входа; права и состав участников проверяет сервис (`У-315`). */
const groupBodySchema = z.object({
  title: z.string(),
  participantIds: z.array(z.string()),
});

const GROUP_ERROR_STATUS = { forbidden: 403, validation: 400, target_not_found: 404 } as const;

export const POST = withAuth(
  { feature: 'staff_chat', guard: requireStaff, body: groupBodySchema },
  async ({ session, body }) => {
    const result = await createGroupChat(prisma, session, body);
    if (!result.ok) {
      return Response.json(
        { ok: false, error: result.error },
        { status: GROUP_ERROR_STATUS[result.error] }
      );
    }
    return Response.json({ ok: true, conversationId: result.conversationId }, { status: 201 });
  }
);
