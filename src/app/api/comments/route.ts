import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireSession, forbiddenResponse } from '@/lib/auth/guard';
import { postOrderComment } from '@/lib/services/comments/post';

/**
 * POST /api/comments — комментарий к заказу (клиент↔менеджер, CLAUDE.md §5).
 *
 * Тонкий роут (§3): Zod проверяет только форму тела, вся доменная логика и
 * скоуп по ролям — в `postOrderComment`. Здесь остаётся лишь маппинг кода
 * результата в HTTP-ответ.
 *
 * Статусы:
 *   201 — комментарий от organization/manager;
 *   200 — историческая ветка (partner/admin) — расхождение статуса намеренное;
 *   400 — тело не JSON или не проходит схему;
 *   403 — вне скоупа ('Access denied') или отказ общего гарда ('Forbidden');
 *   404 — заказа нет.
 *
 * NB: message-строки ('Invalid request'/'Not found'/'Access denied') — контракт
 * COMMENT_ERROR_LABEL композера ленты (deal-activity-thread.tsx); при
 * переименовании обновить обе стороны.
 */

const commentSchema = z.object({
  orderId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(5000),
});

export async function POST(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = commentSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const result = await postOrderComment(prisma, s, parsed.data);

  if (!result.ok) {
    if (result.error === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.error === 'access_denied') return forbiddenResponse('Access denied');
    return forbiddenResponse();
  }

  return NextResponse.json(result.comment, { status: result.viewer === 'legacy' ? 200 : 201 });
}
