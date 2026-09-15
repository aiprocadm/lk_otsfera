/**
 * Unit-тесты `src/lib/services/clientRequests/website.ts` (этап 3, `У-211`).
 *
 * `submitWebsiteRequest` — единственная дверь в кабинет без сессии, поэтому
 * проверяется каждая защита по отдельности и их порядок: выключатель, токен,
 * домен, размер тела, частота, ловушка для ботов, форма. Отдельно — что при
 * любом отказе в базу ничего не пишется.
 *
 * `parseAllowedOrigins` — чистый разбор списка доменов из настройки.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettingValue } = vi.hoisted(() => ({ getSettingValue: vi.fn() }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValue }));

const { isRateLimited } = vi.hoisted(() => ({ isRateLimited: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited }));

// `У-217`: этап раскатывается флагом `comm_center`. В тестах приёма он включён —
// иначе каждая проверка упиралась бы в отказ по флагу и мы проверяли бы флаг, а
// не сами правила приёма. Отдельный тест «флаг выключен → отказ» ниже.
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => true) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { notifyManagersClientRequestSubmitted } = vi.hoisted(() => ({
  notifyManagersClientRequestSubmitted: vi.fn(),
}));
vi.mock('@/lib/services/clientRequests/notify', () => ({
  notifyManagersClientRequestSubmitted,
  notifySubmitterClientRequestStatus: vi.fn(),
}));

const { logInfo, logWarn, logError } = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  log: { info: logInfo, warn: logWarn, error: logError, debug: vi.fn() },
}));

// Сравнение секретов оставляем НАСТОЯЩИМ (constant-time), но оборачиваем
// шпионом: требование `У-211` — сверять токен именно им, а не `===`.
const secret = vi.hoisted(() => ({
  real: null as null | ((a: string | null | undefined, b: string) => boolean),
  spy: vi.fn(),
}));
vi.mock('@/lib/security/secretCompare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/secretCompare')>();
  secret.real = actual.secretEquals;
  return { secretEquals: secret.spy };
});

import {
  MAX_ALLOWED_ORIGINS,
  parseAllowedOrigins,
  submitWebsiteRequest,
  WEBSITE_FORM_MAX_BYTES,
} from '@/lib/services/clientRequests/website';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TOKEN = 'a'.repeat(64);

/** Настройки раздела «Сайт»: по умолчанию приём включён, доменов нет. */
function settings(over: Partial<Record<string, string | null>> = {}) {
  const values: Record<string, string | null> = {
    'site.enabled': 'true',
    'site.formToken': TOKEN,
    'site.allowedOrigins': null,
    'site.defaultManagerId': null,
    ...over,
  };
  getSettingValue.mockImplementation(async (_prisma: unknown, key: string) => values[key] ?? null);
}

function db() {
  const create = vi
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'R1',
      ...data,
    }));
  // Защита от дублей ищет такую же заявку за последнюю минуту; по умолчанию
  // повторов нет.
  const findFirst = vi.fn().mockResolvedValue(null);
  return { prisma: { clientRequest: { create, findFirst } } as never, create, findFirst };
}

const FORM = {
  companyName: 'ООО Ромашка',
  contactName: 'Иван Иванов',
  contactPhone: '+7 900 000-00-00',
  subject: 'Обучение по охране труда',
  consent: true as const,
};

function args(over: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    origin: 'https://otsfera.ru',
    ip: '203.0.113.7',
    bodyBytes: 400,
    payload: { ...FORM },
    ...over,
  } as Parameters<typeof submitWebsiteRequest>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  secret.spy.mockImplementation((a: string | null | undefined, b: string) => secret.real!(a, b));
  isRateLimited.mockResolvedValue(false);
  notifyManagersClientRequestSubmitted.mockResolvedValue(undefined);
  settings();
});

// ─── выключатель приёма ───────────────────────────────────────────────────────

describe('submitWebsiteRequest — приём выключен', () => {
  it('этап выключен флагом `comm_center`: отказ тем же безликим кодом', async () => {
    // `У-217`: снаружи не должно быть видно, ЧЕМ закрыта дверь — флагом,
    // выключенным приёмом или чужим токеном. Разные ответы подсказывали бы
    // подбирающему, что пробовать дальше.
    isFeatureEnabled.mockReturnValueOnce(false);
    settings({ 'site.enabled': 'true' });
    const { prisma, create } = db();

    const res = await submitWebsiteRequest(prisma, args());

    expect(res).toEqual({ ok: false, error: 'rejected' });
    expect(create).not.toHaveBeenCalled();
  });

  it('site.enabled = false: отказ «disabled» даже с верным токеном, в базу ничего не пишем', async () => {
    settings({ 'site.enabled': 'false' });
    const { prisma, create } = db();

    const res = await submitWebsiteRequest(prisma, args());

    expect(res).toEqual({ ok: false, error: 'rejected' });
    expect(create).not.toHaveBeenCalled();
  });

  it('site.enabled не задан вовсе: тоже «disabled»', async () => {
    settings({ 'site.enabled': null });
    const { prisma, create } = db();

    expect(await submitWebsiteRequest(prisma, args())).toEqual({ ok: false, error: 'rejected' });
    expect(create).not.toHaveBeenCalled();
  });

  it('значение с пробелами и в верхнем регистре считается включённым', async () => {
    settings({ 'site.enabled': '  TRUE  ' });
    const { prisma, create } = db();

    expect(await submitWebsiteRequest(prisma, args())).toEqual({ ok: true, created: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('токен не выпущен: «disabled», а не «bad_token» — форма ещё не настроена', async () => {
    settings({ 'site.formToken': '   ' });
    const { prisma, create } = db();

    expect(await submitWebsiteRequest(prisma, args())).toEqual({ ok: false, error: 'rejected' });
    expect(create).not.toHaveBeenCalled();
  });
});

// ─── токен ────────────────────────────────────────────────────────────────────

describe('submitWebsiteRequest — токен формы', () => {
  it('чужой токен: «bad_token», сверка идёт через secretEquals', async () => {
    const { prisma, create } = db();

    const res = await submitWebsiteRequest(prisma, args({ token: 'b'.repeat(64) }));

    expect(res).toEqual({ ok: false, error: 'rejected' });
    expect(secret.spy).toHaveBeenCalledWith('b'.repeat(64), TOKEN);
    expect(create).not.toHaveBeenCalled();
  });

  it('токен не передан: «bad_token»', async () => {
    const { prisma, create } = db();

    expect(await submitWebsiteRequest(prisma, args({ token: null }))).toEqual({
      ok: false,
      error: 'rejected',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('хвостовые пробелы в сохранённом токене не мешают совпадению', async () => {
    settings({ 'site.formToken': `  ${TOKEN}  ` });
    const { prisma } = db();

    expect(await submitWebsiteRequest(prisma, args())).toEqual({ ok: true, created: true });
    expect(secret.spy).toHaveBeenCalledWith(TOKEN, TOKEN);
  });
});

// ─── домены ───────────────────────────────────────────────────────────────────

describe('submitWebsiteRequest — список разрешённых доменов', () => {
  it('домен не в списке: «bad_origin»', async () => {
    settings({ 'site.allowedOrigins': 'https://otsfera.ru' });
    const { prisma, create } = db();

    expect(await submitWebsiteRequest(prisma, args({ origin: 'https://evil.example' }))).toEqual({
      ok: false,
      error: 'rejected',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('список задан, а заголовка Origin нет: «bad_origin»', async () => {
    settings({ 'site.allowedOrigins': 'https://otsfera.ru' });
    const { prisma } = db();

    expect(await submitWebsiteRequest(prisma, args({ origin: null }))).toEqual({
      ok: false,
      error: 'rejected',
    });
  });

  it('список пуст: принимаем с любого домена — форму заводят до переезда сайта', async () => {
    settings({ 'site.allowedOrigins': '   ' });
    const { prisma, create } = db();

    expect(await submitWebsiteRequest(prisma, args({ origin: 'https://kto-to.example' }))).toEqual({
      ok: true,
      created: true,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('хвостовой слэш и в заголовке, и в настройке совпадению не мешает', async () => {
    settings({ 'site.allowedOrigins': 'https://otsfera.ru/' });
    const { prisma } = db();

    expect(await submitWebsiteRequest(prisma, args({ origin: 'https://otsfera.ru//' }))).toEqual({
      ok: true,
      created: true,
    });
  });

  it('совпадение по любой строке списка, а не только по первой', async () => {
    settings({ 'site.allowedOrigins': 'https://a.example\nhttps://otsfera.ru' });
    const { prisma } = db();

    expect(await submitWebsiteRequest(prisma, args({ origin: 'https://otsfera.ru' }))).toEqual({
      ok: true,
      created: true,
    });
  });

  it('регистр домена не важен: «OTSFERA.ru» и «otsfera.ru» — один сайт', async () => {
    // Браузер присылает Origin в нижнем регистре, а администратор мог записать
    // настройку как угодно: без приведения форма молча перестала бы работать.
    settings({ 'site.allowedOrigins': 'https://OtSfera.RU' });
    const { prisma } = db();
    expect(await submitWebsiteRequest(prisma, args({ origin: 'https://otsfera.ru' }))).toEqual({
      ok: true,
      created: true,
    });
  });

  it('больше 16 КБ: «too_large», запроса на создание в базу нет', async () => {
    const { prisma, create } = db();

    const res = await submitWebsiteRequest(prisma, args({ bodyBytes: WEBSITE_FORM_MAX_BYTES + 1 }));

    expect(res).toEqual({ ok: false, error: 'too_large' });
    expect(create).not.toHaveBeenCalled();
    expect(notifyManagersClientRequestSubmitted).not.toHaveBeenCalled();
  });

  it('ровно 16 КБ — ещё принимаем', async () => {
    const { prisma } = db();

    expect(await submitWebsiteRequest(prisma, args({ bodyBytes: WEBSITE_FORM_MAX_BYTES }))).toEqual(
      { ok: true, created: true }
    );
  });
});

// ─── частота ──────────────────────────────────────────────────────────────────

describe('submitWebsiteRequest — ограничение частоты', () => {
  it('превышение: «rate_limited», ключ считается по адресу посетителя', async () => {
    isRateLimited.mockResolvedValue(true);
    const { prisma, create } = db();

    expect(await submitWebsiteRequest(prisma, args({ ip: '198.51.100.9' }))).toEqual({
      ok: false,
      error: 'rate_limited',
    });
    expect(isRateLimited).toHaveBeenCalledWith('site-form:198.51.100.9', {
      windowMs: 60_000,
      max: 10,
    });
    expect(create).not.toHaveBeenCalled();
  });
});

// ─── ловушка для ботов ────────────────────────────────────────────────────────

describe('submitWebsiteRequest — ловушка для ботов', () => {
  it('скрытое поле заполнено: ответ как при успехе, но в базе ничего нет', async () => {
    const { prisma, create } = db();

    const res = await submitWebsiteRequest(
      prisma,
      args({ payload: { ...FORM, website: 'https://spam.example' } })
    );

    expect(res).toEqual({ ok: true, created: false });
    expect(create).not.toHaveBeenCalled();
    expect(notifyManagersClientRequestSubmitted).not.toHaveBeenCalled();
  });

  it('в журнал попадает только факт срабатывания, без полей формы', async () => {
    const { prisma } = db();

    await submitWebsiteRequest(prisma, args({ payload: { ...FORM, website: 'x' } }));

    expect(logInfo).toHaveBeenCalledWith('[clientRequests/website] honeypot triggered');
    const logged = JSON.stringify(logInfo.mock.calls);
    expect(logged).not.toContain('Иван Иванов');
    expect(logged).not.toContain('+7 900 000-00-00');
  });

  it('скрытое поле из одних пробелов ловушкой не считается', async () => {
    const { prisma, create } = db();

    expect(
      await submitWebsiteRequest(prisma, args({ payload: { ...FORM, website: '   ' } }))
    ).toEqual({ ok: true, created: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

// ─── форма ────────────────────────────────────────────────────────────────────

describe('submitWebsiteRequest — проверка формы', () => {
  it('ни телефона, ни почты: «validation»', async () => {
    const { prisma, create } = db();
    const payload = { ...FORM, contactPhone: '   ' };

    expect(await submitWebsiteRequest(prisma, args({ payload }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('согласия на обработку ПДн нет: «validation»', async () => {
    const { prisma, create } = db();

    expect(
      await submitWebsiteRequest(prisma, args({ payload: { ...FORM, consent: false } }))
    ).toEqual({ ok: false, error: 'validation' });
    expect(create).not.toHaveBeenCalled();
  });

  it('пустое название компании: «validation»', async () => {
    const { prisma } = db();

    expect(
      await submitWebsiteRequest(prisma, args({ payload: { ...FORM, companyName: '  ' } }))
    ).toEqual({ ok: false, error: 'validation' });
  });

  it('тело вообще не объект: «validation»', async () => {
    const { prisma } = db();

    expect(await submitWebsiteRequest(prisma, args({ payload: null }))).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('только почта, без телефона — достаточно', async () => {
    const { prisma, create } = db();
    const payload = { ...FORM, contactPhone: undefined, contactEmail: 'i@example.com' };

    expect(await submitWebsiteRequest(prisma, args({ payload }))).toEqual({
      ok: true,
      created: true,
    });
    expect(create.mock.calls[0][0].data.contactEmail).toBe('i@example.com');
  });

  it('«не почта» в поле адреса отвергается — иначе менеджеру некуда отвечать', async () => {
    const { prisma, create } = db();
    const payload = { ...FORM, contactPhone: undefined, contactEmail: 'не почта' };
    expect(await submitWebsiteRequest(prisma, args({ payload }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('создаёт обращение с источником «website» и БЕЗ автора', async () => {
    const { prisma, create } = db();

    const res = await submitWebsiteRequest(prisma, args());

    expect(res).toEqual({ ok: true, created: true });
    const data = create.mock.calls[0][0].data;
    expect(data.source).toBe('website');
    expect(data).not.toHaveProperty('submittedByUserId');
    expect(data).not.toHaveProperty('organizationId');
    expect(data).not.toHaveProperty('partnerId');
    expect(data.companyName).toBe('ООО Ромашка');
    expect(data.contactName).toBe('Иван Иванов');
    expect(data.subject).toBe('Обучение по охране труда');
  });

  it('пустые необязательные поля в запись не попадают', async () => {
    const { prisma, create } = db();
    // Почта здесь опущена целиком: строка из пробелов адресом не является и
    // теперь отвергается проверкой формата (связь остаётся по телефону).
    const payload = { ...FORM, contactEmail: undefined, body: '   ' };

    await submitWebsiteRequest(prisma, args({ payload }));

    const data = create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('contactEmail');
    expect(data).not.toHaveProperty('body');
    expect(data.contactPhone).toBe('+7 900 000-00-00');
  });

  it('сообщение сохраняется обрезанным по краям', async () => {
    const { prisma, create } = db();

    await submitWebsiteRequest(prisma, args({ payload: { ...FORM, body: '  нужен курс  ' } }));

    expect(create.mock.calls[0][0].data.body).toBe('нужен курс');
  });

  it('менеджерам уходит уведомление о созданной заявке', async () => {
    const { prisma } = db();

    await submitWebsiteRequest(prisma, args());

    expect(notifyManagersClientRequestSubmitted).toHaveBeenCalledTimes(1);
    expect(notifyManagersClientRequestSubmitted.mock.calls[0][1]).toMatchObject({
      id: 'R1',
      source: 'website',
    });
  });

  it('ПДн посетителя не попадают в журналы', async () => {
    const { prisma } = db();

    await submitWebsiteRequest(prisma, args({ payload: { ...FORM, contactEmail: 'i@e.com' } }));

    const logged = JSON.stringify([logInfo.mock.calls, logWarn.mock.calls, logError.mock.calls]);
    expect(logged).not.toContain('Иван Иванов');
    expect(logged).not.toContain('i@e.com');
    expect(logged).not.toContain('+7 900 000-00-00');
  });
});

// ─── порядок защит: что он выдаёт наружу ──────────────────────────────────────

describe('submitWebsiteRequest — порядок проверок', () => {
  it('по коду отказа НЕ видно, угадан ли токен: ответ один и тот же', async () => {
    settings({ 'site.allowedOrigins': 'https://otsfera.ru' });
    const { prisma } = db();
    const foreign = { origin: 'https://evil.example' };

    // Запрос с чужой страницы отвечает одинаково и при верном, и при неверном
    // токене. Иначе разный ответ означал бы «токен угадан», и проверка домена
    // сама подсказывала бы подбирающему.
    const wrongToken = await submitWebsiteRequest(
      prisma,
      args({ ...foreign, token: 'b'.repeat(64) })
    );
    const rightToken = await submitWebsiteRequest(prisma, args({ ...foreign }));

    expect(wrongToken).toEqual({ ok: false, error: 'rejected' });
    expect(rightToken).toEqual({ ok: false, error: 'rejected' });
  });

  it('подбор токена сдерживается: частота проверяется ДО токена', async () => {
    // Если счётчик стоит после токена, неудачная попытка его не расходует, и
    // перебирать можно бесконечно. Поэтому ограничение — первое.
    const { prisma } = db();
    isRateLimited.mockResolvedValueOnce(true);
    expect(await submitWebsiteRequest(prisma, args({ token: 'guess' }))).toEqual({
      ok: false,
      error: 'rate_limited',
    });
    expect(isRateLimited).toHaveBeenCalledWith('site-form:203.0.113.7', {
      windowMs: 60_000,
      max: 10,
    });
  });

  it('повтор той же заявки за минуту дубль не создаёт', async () => {
    // Двойной клик по кнопке, повтор запроса браузером или ретрай сети давали
    // менеджеру две одинаковые карточки, и лимит 10/мин этого не ловит.
    const { prisma, create, findFirst } = db();
    findFirst.mockResolvedValueOnce({ id: 'R0' });

    expect(await submitWebsiteRequest(prisma, args())).toEqual({ ok: true, created: false });
    expect(create).not.toHaveBeenCalled();
  });
});

// ─── parseAllowedOrigins ──────────────────────────────────────────────────────

describe('parseAllowedOrigins', () => {
  it('пусто и null дают пустой список', () => {
    expect(parseAllowedOrigins(null)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('   ')).toEqual([]);
  });

  it('разбирает по строкам, запятым и точкам с запятой', () => {
    expect(parseAllowedOrigins('https://a.ru\nhttps://b.ru, https://c.ru; https://d.ru')).toEqual([
      'https://a.ru',
      'https://b.ru',
      'https://c.ru',
      'https://d.ru',
    ]);
  });

  it('снимает хвостовые слэши', () => {
    expect(parseAllowedOrigins('https://a.ru/ https://b.ru///')).toEqual([
      'https://a.ru',
      'https://b.ru',
    ]);
  });

  it('берёт не больше пяти доменов', () => {
    const many = Array.from({ length: 9 }, (_, i) => `https://s${i}.ru`).join('\n');
    const parsed = parseAllowedOrigins(many);
    expect(parsed).toHaveLength(MAX_ALLOWED_ORIGINS);
    expect(parsed[0]).toBe('https://s0.ru');
    expect(parsed[4]).toBe('https://s4.ru');
  });
});
