import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { markStaffRead } from '@/lib/services/staffChat/conversations';

const requireStaff = (session: Parameters<typeof requireRole>[0]) =>
  requireRole(session, ['admin', 'manager']);

/** Форма входа; доступ к разговору проверяет сервис. */
const readBodySchema = z.object({
  conversationId: z.string(),
});

export const POST = withAuth(
  { feature: 'staff_chat', guard: requireStaff, body: readBodySchema },
  async ({ session, body }) => {
    const result = await markStaffRead(prisma, session, { conversationId: body.conversationId });

    if (!result.ok) {
      const status = result.error === 'forbidden' ? 403 : 404;
      return Response.json({ ok: false, error: result.error }, { status });
    }

    return Response.json({ ok: true });
  }
);
