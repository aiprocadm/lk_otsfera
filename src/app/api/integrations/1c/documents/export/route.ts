import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessSettingsSection } from '@/lib/auth/settingsAccess';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import {
  buildExportPackage,
  parseExportPackageFilter,
} from '@/lib/services/oneCSync/exportPackage';

/**
 * Скачать пакет документов для 1С (`У-173`): ZIP с `documents.xlsx` и
 * PDF-файлами. Адрес нейтральный — одна дверь для администратора и
 * руководителя (`/admin/*` пускает только admin).
 *
 * Два гарда, как у экспорта каталога: **право раздела** `integrations.oneC`
 * (роут — вход в данные раздела мимо default-deny профиля) и **граница
 * компании** в сервисе (админ — все, руководитель — своя). Фильтр — тот же,
 * что у экрана: ссылка «Скачать пакет» несёт query вкладки.
 */
const ONE_C_SECTION = SETTINGS_SECTIONS.find((s) => s.id === 'integrations.oneC')!;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessSettingsSection(session, ONE_C_SECTION)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const q = req.nextUrl.searchParams;
  const filter = parseExportPackageFilter({
    from: q.get('from') ?? undefined,
    to: q.get('to') ?? undefined,
    type: q.get('type') ?? undefined,
    oneCPushStatus: q.get('oneCPushStatus') ?? undefined,
  });
  const res = await buildExportPackage(prisma, session, filter);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error },
      { status: res.error === 'forbidden' ? 403 : 404 }
    );
  }
  return new NextResponse(new Uint8Array(res.zip), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${res.fileName}"`,
      'x-documents-count': String(res.count),
      'x-documents-skipped': String(res.skipped.length),
    },
  });
}
