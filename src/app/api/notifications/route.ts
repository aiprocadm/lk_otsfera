import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';
// Task C1 (parity): per-role scope вынесен в сервис — общий для этого роута
// и GET /api/notifications/unread. Аудит A1: чтение и отметка прочтения тоже
// уехали в сервис (`inbox`), роут остался маппингом. Поведение байт-в-байт.
import { listNotifications, markNotificationsRead } from '@/lib/services/notifications/inbox';

const patchSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    ids: z.array(z.string().min(1).max(64)).max(100).optional(),
    isRead: z.boolean().optional(),
  })
  .refine((d) => d.id || (d.ids && d.ids.length > 0), {
    message: 'id or ids required',
  });

export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.value;

  const roleResult = requireRole(session, ['admin', 'manager', 'partner', 'organization']);
  if (!roleResult.ok) return roleResult.response;

  const result = await listNotifications(prisma, session);

  return NextResponse.json(result.notifications);
}

export async function PATCH(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.value;

  const roleResult = requireRole(session, ['admin', 'manager', 'partner', 'organization']);
  if (!roleResult.ok) return roleResult.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
  }

  const { id, ids, isRead = true } = parsed.data;
  // Schema refine guarantees ids is non-empty when id is absent; ids! safe to assert non-null here
  const result = await markNotificationsRead(
    prisma,
    session,
    id ? { id, isRead } : { ids: ids!, isRead }
  );

  return NextResponse.json(result.updated);
}
