import { NextResponse } from 'next/server';
import { readFile, readMultipart } from '@/lib/api/multipart';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { uploadTaskResultFile } from '@/lib/services/tasks/result';
import { taskResultStatus } from '@/lib/api/taskResultStatus';

/**
 * Загрузка файла результата задачи (этап 5 ТЗ 13.10.2026, `У-299`, `Р-5-3`).
 *
 * Роут, а не server action: у server actions общий предел тела 25 МБ, и файл
 * больше предела отбросился бы до входа в действие — форма молчала бы (§11
 * правил проекта). Роут только мапит код сервиса в статус.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('internal_tasks');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const form = await readMultipart(req);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const file = await readFile(form, 'file');
  if (file === null) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const result = await uploadTaskResultFile(prisma, session, {
    taskId: id,
    file: {
      buffer: file.buffer,
      name: file.name,
      /* v8 ignore next -- file.type is always '' in test env (FormData re-parsing strips MIME); tested in e2e */
      declaredMimeType: file.type || 'application/octet-stream',
      size: file.size,
    },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: taskResultStatus(result.error) });
  }
  return NextResponse.json({ id: result.id }, { status: 201 });
}
