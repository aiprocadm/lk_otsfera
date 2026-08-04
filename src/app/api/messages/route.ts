import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { prisma } from '@/lib/db/prisma';
import { sendMessage, listMessages } from '@/lib/services/chat/messages';
import { deriveSide } from '@/lib/services/chat/policy';

/**
 * Схема — только ФОРМА входа (типы полей). Доменные проверки (валидный side,
 * доступ к заказу, лимиты) остаются в handler/сервисе — их коды стабильны.
 */
const postBodySchema = z.object({
  orderId: z.string(),
  body: z.string(),
  side: z.string().optional(),
  attachmentPath: z.string().optional(),
});

export const POST = withAuth(
  { feature: 'chat', body: postBodySchema },
  async ({ session: s, body }) => {
    // External role forces its side; team passes side explicitly via body.side.
    const side = deriveSide(s) ?? body.side;
    if (side !== 'org' && side !== 'partner') {
      return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
    }

    const result = await sendMessage(prisma, s, {
      orderId: body.orderId,
      side,
      body: body.body,
      // exactOptionalPropertyTypes: сервис различает «ключа нет» и «ключ = undefined».
      ...(body.attachmentPath !== undefined ? { attachmentPath: body.attachmentPath } : {}),
    });

    if (!result.ok) {
      const status =
        result.error === 'forbidden'
          ? 403
          : result.error === 'order_not_found'
            ? 404
            : result.error === 'too_large'
              ? 413
              : 400;
      return Response.json({ ok: false, error: result.error }, { status });
    }

    return Response.json({ ok: true, messageId: result.messageId }, { status: 201 });
  }
);

export const GET = withAuth({ feature: 'chat' }, async ({ req, session }) => {
  const url = new URL(req.url);
  const threadId = url.searchParams.get('threadId') ?? '';
  const after = url.searchParams.get('after') ?? undefined;

  const result = await listMessages(prisma, session, {
    threadId,
    ...(after ? { after } : {}),
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.error === 'forbidden' ? 403 : 404 }
    );
  }

  return Response.json({ ok: true, rows: result.rows });
});
