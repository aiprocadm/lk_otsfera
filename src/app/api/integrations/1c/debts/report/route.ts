import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessSettingsSection } from '@/lib/auth/settingsAccess';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { buildDebtsReport } from '@/lib/services/oneCSync/debtsReport';

/**
 * Отчёт «Расхождения по дебиторке» в Excel (`У-257`, этап 8).
 *
 * Дверь та же, что у пакета документов для 1С: право раздела `integrations.oneC`
 * (роут — вход в данные раздела мимо default-deny профиля). `logId` не задан —
 * берём последнюю сверку: чаще всего человек хочет именно её.
 *
 * Роут тонкий (§3): сессия → право → сервис → файл. Считать расхождения
 * заново здесь нельзя: файл разошёлся бы с тем, что показано в истории.
 */
const ONE_C_SECTION = SETTINGS_SECTIONS.find((s) => s.id === 'integrations.oneC')!;

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessSettingsSection(session, ONE_C_SECTION)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const logId = req.nextUrl.searchParams.get('logId') ?? undefined;
  const res = await buildDebtsReport(prisma, { logId });
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, message: 'Сверка дебиторки ещё не проводилась.' },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(res.buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Имя русское, поэтому кодируем: иначе часть браузеров сохранит файл
      // под именем из знаков вопроса.
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(res.fileName)}`,
      'x-debt-mismatches': String(res.mismatches),
    },
  });
}
