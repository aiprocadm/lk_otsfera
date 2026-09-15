import { prisma } from '@/lib/db/prisma';
import { log } from '@/lib/logging';
import {
  submitWebsiteRequest,
  WEBSITE_FORM_MAX_BYTES,
} from '@/lib/services/clientRequests/website';

/**
 * POST /api/public/requests — заявка с формы на сайте otsfera.ru (`У-211`).
 *
 * **Единственный адрес кабинета, который работает без сессии.** Он объявлен
 * публичным в реестре `lib/api/publicRoutes.ts` с причиной — иначе список
 * открытых наружу дверей пополнялся бы молча (страж `security.public-api-routes`).
 *
 * Роут тонкий: считает размер тела, достаёт заголовки и переводит код сервиса
 * в статус. Все проверки — в `submitWebsiteRequest`.
 *
 * Коды отказа намеренно скупые и одинаково безликие: подробности («токен
 * верный, но домен чужой») подсказали бы, что подбирать дальше. Что именно
 * не сошлось — видно в журнале сервиса.
 */
export const dynamic = 'force-dynamic';

/** IP берём так же, как форма входа: за обратным прокси это `x-forwarded-for`. */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  // Тело читаем текстом: так узнаём фактический размер ДО разбора JSON и не
  // отдаём разборщику мегабайты.
  const raw = await req.text().catch(() => '');
  const bodyBytes = Buffer.byteLength(raw, 'utf8');

  if (bodyBytes > WEBSITE_FORM_MAX_BYTES) {
    return Response.json({ ok: false, error: 'too_large' }, { status: 413 });
  }

  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    return Response.json({ ok: false, error: 'validation' }, { status: 422 });
  }

  let result;
  try {
    result = await submitWebsiteRequest(prisma, {
      token: req.headers.get('x-site-token'),
      origin: req.headers.get('origin'),
      ip: clientIp(req),
      bodyBytes,
      payload,
    });
  } catch (error) {
    // Ни одно исключение не должно вывалиться наружу текстом: это публичный
    // адрес, и внутренние подробности из него читать нельзя.
    //
    // В журнал пишем ТОЛЬКО вид ошибки, без её текста: текст ошибки базы
    // содержит аргументы запроса — то есть телефон и почту посетителя. Это
    // тот же класс, что «ПДн не логируются» (§12), просто спрятанный внутри
    // чужого сообщения.
    log.error('[api/public/requests] failed', {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }

  if (!result.ok) {
    // `rejected` отвечает 401 и не различает причину: выключен приём, чужой
    // токен или чужой домен — снаружи это одно и то же «не принято». Иначе
    // 403 означало бы «токен верный», и проверка домена подсказывала бы
    // подбирающему ровно то, ради защиты от чего она заведена.
    const status =
      result.error === 'rejected'
        ? 401
        : result.error === 'rate_limited'
          ? 429
          : result.error === 'too_large'
            ? 413
            : 422;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  // Ловушка для ботов тоже отвечает «принято» (`created: false`): отказ
  // подсказал бы роботу, какое поле надо оставить пустым.
  return Response.json({ ok: true }, { status: 201 });
}
