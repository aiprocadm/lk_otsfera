import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Админ-вьюер состояний алертов (модель AlertState): строки пишет воркер
 * monitoring.evaluateAlerts каждые 5 минут (src/lib/jobs/scheduling.ts);
 * здесь — только чтение для секции «Алерты» на /admin/health.
 */

/** Строка алерта — все поля модели AlertState. */
export type AlertStateRow = {
  key: string;
  status: string; // 'firing' | 'resolved'
  severity: string; // 'warning' | 'critical'
  message: string;
  value: number | null;
  firstSeenAt: Date;
  lastNotifiedAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
};

export type ListAlertStatesResult =
  | { ok: true; alerts: AlertStateRow[] }
  | { ok: false; error: 'forbidden' };

/**
 * Последние состояния алертов для /admin/health. Firing-алерты первыми
 * ('firing' < 'resolved' лексикографически при status asc), внутри статуса —
 * свежие изменения сверху; cap 100 строк (операторский обзор, не пагинация).
 */
export async function listAlertStates(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ListAlertStatesResult> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };

  const alerts = await prisma.alertState.findMany({
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: 100,
  });

  return { ok: true, alerts };
}
