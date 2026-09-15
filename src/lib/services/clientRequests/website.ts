import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getSettingValue } from '@/lib/config/integrationSettings';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';
import { isRateLimited } from '@/lib/rateLimit';
import { secretEquals } from '@/lib/security/secretCompare';
import { notifyManagersClientRequestSubmitted } from './notify';

/**
 * Приём заявки с сайта otsfera.ru (`У-211`, спека этапа 3 §3.8).
 *
 * Единственная дверь в кабинет без сессии, поэтому защит несколько, и каждая
 * закрывает свой случай:
 *
 * - **токен** `X-Site-Token` — подтверждает, что заявка пришла с нашего сайта,
 *   а не от того, кто нашёл адрес;
 * - **домен** (`Origin`) — чтобы токен, утёкший из разметки, нельзя было
 *   использовать с чужой страницы;
 * - **частота** — 10 обращений в минуту с адреса: столько человек не отправит,
 *   а перебор захлебнётся;
 * - **ловушка для ботов** (скрытое поле) — заполнено, значит это робот:
 *   отвечаем «принято» и НЕ пишем ничего. Отказ подсказал бы, как обойти;
 * - **размер тела** — 16 КБ: форма из шести полей столько не весит.
 *
 * ПДн формы (имя, телефон, почта) в журналы не попадают — только факт приёма.
 */

/** Предел тела запроса: шесть коротких полей вмещаются с большим запасом. */
export const WEBSITE_FORM_MAX_BYTES = 16 * 1024;

/** Сколько заявок с одного адреса принимаем в минуту. */
const RATE_LIMIT = { windowMs: 60_000, max: 10 };

/** За какое время повторная такая же заявка считается случайным дублем. */
const DUPLICATE_WINDOW_MS = 60_000;

/** Сколько доменов можно указать в настройке (`В-3-6`). */
export const MAX_ALLOWED_ORIGINS = 5;

/** Та же грубая проверка адреса, что и в форме кабинета. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FormSchema = z.object({
  companyName: z.string().trim().min(1).max(300),
  contactName: z.string().trim().min(1).max(200),
  contactPhone: z.string().trim().max(50).optional(),
  // Формат проверяем, как и в форме кабинета: «не почта» в карточке означает,
  // что менеджер не сможет ответить, а поймёт это только через день.
  contactEmail: z.string().trim().max(200).regex(EMAIL_RE).optional().or(z.literal('')),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().max(4000).optional(),
  /** Согласие на обработку персональных данных — без него заявку не принимаем. */
  consent: z.literal(true),
  /**
   * Ловушка для ботов: поле спрятано стилями, человек его не видит и не
   * заполняет. Робот заполняет все поля подряд — и выдаёт себя.
   */
  website: z.string().max(200).optional(),
});

export type SubmitWebsiteRequestResult =
  | { ok: true; created: boolean }
  | {
      ok: false;
      /**
       * `rejected` — общий отказ для «приём выключен», «чужой токен» и «чужой
       * домен». Коды намеренно НЕ различаются: разный ответ на неверный токен
       * и на верный токен с чужой страницы означал бы «токен ты угадал» —
       * и проверка домена, заведённая как раз на случай утечки токена из
       * разметки сайта, сама подсказывала бы подбирающему. Что именно не
       * сошлось, видно в журнале.
       */
      error: 'rejected' | 'rate_limited' | 'too_large' | 'validation';
    };

/** Разбор списка доменов из настройки: по строкам или через запятую. */
export function parseAllowedOrigins(raw: string | null): string[] {
  if (!raw) return [];
  return (
    raw
      .split(/[\s,;]+/)
      // Домен сравнивается с заголовком браузера, а тот всегда в нижнем
      // регистре: без приведения `https://OtSfera.ru` в настройке молча
      // перестал бы совпадать, и форма отказывала бы без видимой причины.
      .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
      .filter(Boolean)
      .slice(0, MAX_ALLOWED_ORIGINS)
  );
}

export type SubmitWebsiteRequestArgs = {
  token: string | null;
  origin: string | null;
  /** IP посетителя — ключ ограничения частоты. */
  ip: string;
  /** Размер тела запроса в байтах (роут считает его до разбора). */
  bodyBytes: number;
  payload: unknown;
};

export async function submitWebsiteRequest(
  prisma: PrismaClient,
  args: SubmitWebsiteRequestArgs
): Promise<SubmitWebsiteRequestResult> {
  if (args.bodyBytes > WEBSITE_FORM_MAX_BYTES) return { ok: false, error: 'too_large' };

  // Частота проверяется ПЕРВОЙ — до токена и до похода в базу.
  //
  // Если поставить её после токена, неудачная попытка счётчик не расходует, и
  // подбор токена ничем не сдерживается: можно перебирать сколько угодно.
  // Заодно это отсекает наплыв запросов до чтения настроек.
  if (await isRateLimited(`site-form:${args.ip}`, RATE_LIMIT)) {
    return { ok: false, error: 'rate_limited' };
  }

  const [enabled, expectedToken, originsRaw] = await Promise.all([
    getSettingValue(prisma, 'site.enabled'),
    getSettingValue(prisma, 'site.formToken'),
    getSettingValue(prisma, 'site.allowedOrigins'),
  ]);

  // `У-217`: этап раскатывается флагом `comm_center`. Пока он выключен, адрес
  // отвечает тем же безликим отказом, что и при выключенном приёме: снаружи не
  // должно быть видно, чем именно закрыта дверь.
  if (!isFeatureEnabled('comm_center')) {
    log.info('[clientRequests/website] отказ: этап выключен флагом');
    return { ok: false, error: 'rejected' };
  }

  // Выключено — значит выключено: пока администратор не включил приём, адрес
  // ничего не принимает, даже с верным токеном.
  if ((enabled ?? '').trim().toLowerCase() !== 'true') {
    log.info('[clientRequests/website] отказ: приём выключен');
    return { ok: false, error: 'rejected' };
  }
  if (!expectedToken?.trim()) {
    log.info('[clientRequests/website] отказ: токен формы не выпущен');
    return { ok: false, error: 'rejected' };
  }

  if (!args.token || !secretEquals(args.token, expectedToken.trim())) {
    log.info('[clientRequests/website] отказ: неверный токен');
    return { ok: false, error: 'rejected' };
  }

  // Домен проверяем, только если он задан администратором: пустой список
  // означает «принимать с любого» — так форму можно завести до того, как
  // сайт переехал на нужный домен.
  const allowed = parseAllowedOrigins(originsRaw);
  if (allowed.length > 0) {
    const origin = (args.origin ?? '').trim().toLowerCase().replace(/\/+$/, '');
    if (!origin || !allowed.includes(origin)) {
      // В журнал — да, наружу — нет: отличие ответа сказало бы, что токен верен.
      log.info('[clientRequests/website] отказ: домен не в списке разрешённых');
      return { ok: false, error: 'rejected' };
    }
  }

  const parsed = FormSchema.safeParse(args.payload);
  if (!parsed.success) return { ok: false, error: 'validation' };

  // Ловушка сработала: отвечаем как при успехе, но ничего не записываем.
  // Сказать роботу правду — значит подсказать, какое поле надо оставить пустым.
  if (parsed.data.website?.trim()) {
    log.info('[clientRequests/website] honeypot triggered');
    return { ok: true, created: false };
  }

  // Хотя бы один способ связи: иначе заявку некому и некуда отвечать.
  const phone = parsed.data.contactPhone?.trim() || null;
  const email = parsed.data.contactEmail?.trim() || null;
  if (!phone && !email) return { ok: false, error: 'validation' };

  // Двойной клик по кнопке, повтор запроса браузером или ретрай сети дают
  // менеджеру две одинаковые карточки, и лимит 10/мин этого не ловит. Поэтому
  // ищем такую же заявку за последнюю минуту и отвечаем «принято», ничего не
  // создавая: посетителю видно то же самое, а в очереди — одна карточка.
  const justNow = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const duplicate = await prisma.clientRequest.findFirst({
    where: {
      source: 'website',
      companyName: parsed.data.companyName,
      contactName: parsed.data.contactName,
      subject: parsed.data.subject,
      createdAt: { gte: justNow },
    },
    select: { id: true },
  });
  if (duplicate) {
    log.info('[clientRequests/website] повтор той же заявки — не создаём дубль');
    return { ok: true, created: false };
  }

  const request = await prisma.clientRequest.create({
    data: {
      source: 'website',
      companyName: parsed.data.companyName,
      contactName: parsed.data.contactName,
      subject: parsed.data.subject,
      // exactOptionalPropertyTypes: Prisma различает «поля нет» и «поле = null»,
      // поэтому спред вместо `?? null`.
      ...(phone ? { contactPhone: phone } : {}),
      ...(email ? { contactEmail: email } : {}),
      ...(parsed.data.body?.trim() ? { body: parsed.data.body.trim() } : {}),
    },
  });

  // Записи в журнал аудита здесь НЕТ намеренно: аудит отвечает на вопрос «кто
  // из сотрудников это сделал», а заявку прислал посторонний с сайта — автора
  // в системе не существует. След остаётся в самой заявке (`source: website`
  // и время создания), а «кто взял в работу» появится при триаже.

  // Уведомление менеджерам — best-effort, как и у заявок из кабинетов: сбой
  // рассылки не должен отменять принятую заявку.
  await notifyManagersClientRequestSubmitted(prisma, request);

  return { ok: true, created: true };
}
