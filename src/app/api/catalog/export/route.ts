import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessSettingsSection } from '@/lib/auth/settingsAccess';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';
import { listCatalogItems } from '@/lib/services/admin/catalogItems';
import { renderCatalogXlsx } from '@/lib/services/admin/catalogXlsx';

/**
 * Экспорт каталога услуг компании в Excel (`У-137`).
 *
 * Два гарда: **право раздела** `catalogs.priceList` (ревью PR-2: роут был
 * единственным входом в данные раздела мимо default-deny профиля — руководитель
 * с профилем без `settings.catalogs.manage` не видел экран, но скачивал
 * выгрузку) и **граница компании** в сервисе (админ — любая, руководитель —
 * только своя). Выгружаются и неактивные позиции: экспорт — резервная копия
 * каталога, а не витрина. Лимит — общий для выгрузок (10 000) со сноской в
 * файле; молчаливое усечение — дефект (§15).
 */
const PRICE_LIST_SECTION = SETTINGS_SECTIONS.find((s) => s.id === 'catalogs.priceList')!;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessSettingsSection(session, PRICE_LIST_SECTION)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const companyId = req.nextUrl.searchParams.get('company') ?? session.companyId ?? '';
  if (!companyId) return NextResponse.json({ error: 'company_required' }, { status: 400 });

  const res = await listCatalogItems(prisma, session, {
    companyId,
    includeInactive: true,
    limit: EXPORT_ROW_LIMIT,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 403 });

  const buf = await renderCatalogXlsx(res.items, res.total);
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="catalog.xlsx"',
    },
  });
}
