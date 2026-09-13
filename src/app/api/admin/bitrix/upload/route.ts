import { NextResponse } from 'next/server';
import { readFiles, readMultipart } from '@/lib/api/multipart';
import { requireAdmin } from '@/lib/auth/requireRole';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { storeBitrixUploads } from '@/lib/services/bitrix/upload';

/**
 * `POST /api/admin/bitrix/upload` — приём выгрузок Битрикс24 (`У-189` file).
 * Файловый роут, а не server action: на действиях стоит общий `bodySizeLimit`,
 * и файл больше него отбрасывается молча (§11 CLAUDE.md). Роут только
 * читает форму и мапит код сервиса в статус; проверки размера, расширения и
 * шапки — в `storeBitrixUploads`.
 */
const STATUS: Record<string, number> = {
  no_files: 400,
  too_many_files: 400,
  too_large: 413,
  invalid_mime: 415,
  file_unreadable: 422,
  storage: 502,
};

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('bitrix_migration');
  if (disabled) return disabled;
  await requireAdmin();

  const fd = await readMultipart(req);
  if (!fd) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const files = await readFiles(fd, 'files');

  const result = await storeBitrixUploads(files);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.file !== undefined ? { file: result.file } : {}) },
      { status: STATUS[result.error] ?? 400 }
    );
  }
  return NextResponse.json({ ok: true, files: result.files });
}
