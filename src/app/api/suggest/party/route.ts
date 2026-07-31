import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/guard';
import { isRateLimited } from '@/lib/rateLimit';
import { suggestParty } from '@/lib/services/dadata/suggestParty';

/**
 * Серверный прокси подсказок организаций DaData (ФТ-13.2).
 *
 * Только для авторизованных (формы-потребители появятся на этапах 5/8/9).
 * Rate-limit — на пользователя. Ключ DaData не покидает сервер: наружу уходит
 * только нормализованный результат. Выключено/нет ключа/короткий запрос/ошибка
 * → пустой список (200), чтобы формы деградировали до ручного ввода.
 */

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const MIN_QUERY_LEN = 2;

export async function GET(req: Request): Promise<Response> {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.value;

  const limited = await isRateLimited(`suggest:party:${session.sub}`, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX,
  });
  if (limited) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const query = new URL(req.url).searchParams.get('query')?.trim() ?? '';
  if (query.length < MIN_QUERY_LEN) {
    return NextResponse.json({ suggestions: [] });
  }

  const suggestions = await suggestParty(prisma, query);
  return NextResponse.json({ suggestions });
}
