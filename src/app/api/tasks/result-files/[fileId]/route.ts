import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { deleteTaskResultFile, getTaskResultFileUrl } from '@/lib/services/tasks/result';
import { taskResultStatus } from '@/lib/api/taskResultStatus';

/**
 * Файл результата задачи (этап 5 ТЗ 13.10.2026, `У-299`): скачать и удалить.
 *
 * Скачивание — 302 на временную ссылку хранилища (§10: файл через приложение
 * не отдаём); заражённый — 410 Gone, а не 404: это разные сигналы.
 */
type Params = { params: Promise<{ fileId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('internal_tasks');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fileId } = await params;
  const result = await getTaskResultFileUrl(prisma, session, { fileId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: taskResultStatus(result.error) });
  }
  return NextResponse.redirect(result.url, 302);
}

export async function DELETE(_req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('internal_tasks');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fileId } = await params;
  const result = await deleteTaskResultFile(prisma, session, { fileId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: taskResultStatus(result.error) });
  }
  return NextResponse.json({ ok: true });
}
