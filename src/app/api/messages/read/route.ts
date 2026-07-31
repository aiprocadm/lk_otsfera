import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { prisma } from '@/lib/db/prisma';
import { markRead } from '@/lib/services/chat/threads';

/** Форма входа; доступ к треду проверяет сервис. */
const readBodySchema = z.object({
  threadId: z.string(),
});

export const POST = withAuth(
  { feature: 'chat', body: readBodySchema },
  async ({ session, body }) => {
    const result = await markRead(prisma, session, body.threadId);
    if (!result.ok) {
      return Response.json(
        { ok: false, error: result.error },
        { status: result.error === 'forbidden' ? 403 : 404 }
      );
    }

    return Response.json({ ok: true });
  }
);
