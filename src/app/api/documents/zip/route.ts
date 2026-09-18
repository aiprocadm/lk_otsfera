import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { zipSkippedSummaryRu } from '@/lib/documents/zipSummary';
import { buildDocumentsZip, parseDocumentIds, ZIP_MAX_FILES } from '@/lib/services/documents/zip';

/**
 * `GET /api/documents/zip?ids=a,b,c` — скачать выбранные документы одним
 * архивом (`У-252`, этап 8).
 *
 * Дверь одна на все роли, как у одиночного скачивания
 * (`/api/documents/[id]/download`): скоуп держит сервис, проверяя КАЖДЫЙ
 * документ тем же гейтом (`Р-Э8-3`). Отдельные двери по кабинетам означали бы
 * пять наборов правил доступа к одному и тому же.
 *
 * Роут тонкий (§3): сессия → сервис → файл или отказ. Отказ по пределу — 413 с
 * числами и подсказкой, что сделать (`Р-Э8-4`); молча срезанный архив человек
 * принял бы за полный.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ids = parseDocumentIds(new URL(req.url).searchParams.get('ids'));
  const res = await buildDocumentsZip(prisma, session, ids);

  if (!res.ok) {
    if (res.error === 'too_many_files') {
      return NextResponse.json(
        {
          error: res.error,
          message: `Выбрано ${res.requested} документов — это больше предела в ${res.limit}. Снимите лишние галочки.`,
        },
        { status: 413 }
      );
    }
    if (res.error === 'too_large') {
      const mb = Math.ceil(res.bytes / (1024 * 1024));
      const limitMb = Math.round(res.limit / (1024 * 1024));
      return NextResponse.json(
        {
          error: res.error,
          message: `Выбранные документы весят ${mb} МБ — это больше предела в ${limitMb} МБ. Скачайте их двумя частями.`,
        },
        { status: 413 }
      );
    }
    if (res.error === 'no_ids') {
      return NextResponse.json(
        { error: res.error, message: 'Не выбрано ни одного документа.' },
        { status: 400 }
      );
    }
    // `empty`: документы выбраны, но ни один не годится — чужие, в карантине
    // или ещё на проверке. Говорим, сколько и почему, а не «ничего не найдено».
    return NextResponse.json(
      {
        error: res.error,
        message: `Ни один из выбранных документов в архив не вошёл (${zipSkippedSummaryRu(res.skipped)}).`,
      },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(res.zip), {
    headers: {
      'content-type': 'application/zip',
      // Имя архива русское, поэтому кодируем: иначе часть браузеров сохранит
      // файл под именем из знаков вопроса.
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(res.fileName)}`,
      'x-documents-count': String(res.included),
      'x-documents-limit': String(ZIP_MAX_FILES),
      // Числами, а не русской фразой: значения заголовков ходят в латинице, и
      // кириллица в них либо теряется, либо роняет ответ. Фразу соберёт экран
      // той же функцией `zipSkippedSummaryRu` — источник остаётся один.
      'x-documents-skipped': JSON.stringify(res.skipped),
    },
  });
}
