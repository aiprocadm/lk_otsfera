import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { parseKpiMonth } from '@/lib/kpi/period';
import { buildReportXlsx } from '@/lib/reports/export';
import { canRunReport, isReportKey, reportByKey } from '@/lib/reports/registry';

/**
 * Выгрузка отчёта в Excel (`У-244`, `У-249`, этап 7).
 *
 * Маршрут ничего про отчёты не знает: берёт запись из реестра, проверяет право
 * и отдаёт файл. Бизнес-логика — в реестре и сервисах (§3, тонкий роут).
 *
 * Порядок проверок важен: **право проверяется до выборки**. Рядовой менеджер
 * получает 403 и не успевает прочитать ни строки — пустой файл он принял бы за
 * «данных нет».
 */
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string }> }
): Promise<Response> {
  notFoundIfDisabled('leader_analytics');

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key } = await params;
  if (!isReportKey(key)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const report = reportByKey(key);

  if (!canRunReport(report, session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  // Компанию выбирает только администратор: у остальных она из сессии, и чужой
  // идентификатор в адресе ничего не меняет.
  const requested = url.searchParams.get('company');
  const companyId = session.role === 'admin' && requested ? requested : (session.companyId ?? '');
  if (!companyId) return NextResponse.json({ error: 'company_required' }, { status: 400 });

  const { year, month } = parseKpiMonth(url.searchParams.get('month') ?? undefined);
  const olderThanDays = Number(url.searchParams.get('older')) || 0;

  const built = await buildReportXlsx(report, {
    prisma,
    session,
    companyId,
    year,
    month,
    olderThanDays,
  });

  if (!built.ok) {
    return NextResponse.json(
      {
        error: 'too_many',
        message: `В отчёте ${built.total} строк — это больше предела в ${built.limit}. Выберите более узкий период.`,
      },
      { status: 413 }
    );
  }

  return new NextResponse(new Uint8Array(built.buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${built.fileName}"`,
    },
  });
}
