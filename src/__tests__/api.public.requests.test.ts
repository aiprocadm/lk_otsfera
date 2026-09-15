/**
 * Unit-тесты `POST /api/public/requests` (этап 3, `У-211`).
 *
 * Роут тонкий: считает размер тела, достаёт заголовки и переводит код сервиса
 * в HTTP-статус. Проверяем перевод кодов, разбор адреса посетителя и то, что
 * наружу не вываливаются внутренние подробности — это единственный адрес
 * кабинета без сессии.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { submitWebsiteRequest } = vi.hoisted(() => ({ submitWebsiteRequest: vi.fn() }));
vi.mock('@/lib/services/clientRequests/website', () => ({
  submitWebsiteRequest,
  WEBSITE_FORM_MAX_BYTES: 16 * 1024,
}));

const { logError, logWarn, logInfo } = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  log: { error: logError, warn: logWarn, info: logInfo, debug: vi.fn() },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/public/requests/route';

// ─── helpers ──────────────────────────────────────────────────────────────────

const FORM = {
  companyName: 'ООО Ромашка',
  contactName: 'Иван Иванов',
  contactPhone: '+7 900 000-00-00',
  subject: 'Обучение',
  consent: true,
};

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://app.local/api/public/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Что сервис получил последним вызовом. */
function lastArgs(): Record<string, unknown> {
  return submitWebsiteRequest.mock.calls[submitWebsiteRequest.mock.calls.length - 1][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  submitWebsiteRequest.mockResolvedValue({ ok: true, created: true });
});

// ─── коды отказа ──────────────────────────────────────────────────────────────

describe('POST /api/public/requests — коды отказа', () => {
  it('413, если тело больше 16 КБ: сервис даже не зовётся', async () => {
    const huge = { ...FORM, body: 'я'.repeat(20_000) };

    const res = await POST(req(huge));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: 'too_large' });
    expect(submitWebsiteRequest).not.toHaveBeenCalled();
  });

  it('422, если тело — не JSON', async () => {
    const res = await POST(req('{это не json'));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: 'validation' });
    expect(submitWebsiteRequest).not.toHaveBeenCalled();
  });

  it('пустое тело — не «не JSON», а пустая форма: сервису уходит null', async () => {
    // `JSON.parse('')` бросает, поэтому пустое тело разбирать нельзя вовсе.
    // Ответ при этом обычный «проверьте поля», а не 500.
    submitWebsiteRequest.mockResolvedValue({ ok: false, error: 'validation' });

    const res = await POST(req(''));

    expect(res.status).toBe(422);
    expect(lastArgs().payload).toBeNull();
    expect(lastArgs().bodyBytes).toBe(0);
  });

  it('401 при неверном токене', async () => {
    submitWebsiteRequest.mockResolvedValue({ ok: false, error: 'rejected' });

    const res = await POST(req(FORM, { 'x-site-token': 'wrong' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'rejected' });
  });

  it('401, когда приём заявок выключен — тот же статус, что и у плохого токена', async () => {
    submitWebsiteRequest.mockResolvedValue({ ok: false, error: 'rejected' });

    const res = await POST(req(FORM));

    expect(res.status).toBe(401);
  });

  it('401 при чужом домене — тот же ответ, что и при плохом токене', async () => {
    submitWebsiteRequest.mockResolvedValue({ ok: false, error: 'rejected' });

    const res = await POST(req(FORM, { origin: 'https://evil.example' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'rejected' });
  });

  it('429 при превышении частоты', async () => {
    submitWebsiteRequest.mockResolvedValue({ ok: false, error: 'rate_limited' });

    const res = await POST(req(FORM));

    expect(res.status).toBe(429);
  });

  it('413, если о размере сказал сервис, а не роут', async () => {
    submitWebsiteRequest.mockResolvedValue({ ok: false, error: 'too_large' });

    expect((await POST(req(FORM))).status).toBe(413);
  });

  it('422 при непройденной форме', async () => {
    submitWebsiteRequest.mockResolvedValue({ ok: false, error: 'validation' });

    expect((await POST(req(FORM))).status).toBe(422);
  });

  it('по коду ответа НЕ видно, какая из проверок доступа сработала', async () => {
    // Выключенный приём, чужой токен и чужой домен приходят из сервиса одним
    // кодом `rejected` и отдают наружу одинаковый ответ: разные коды были бы
    // готовой подсказкой для подбора («403 — значит токен угадан»).
    const map: Record<string, number> = {};
    for (const error of ['rejected', 'rate_limited', 'too_large', 'validation']) {
      submitWebsiteRequest.mockResolvedValue({ ok: false, error });
      map[error] = (await POST(req(FORM))).status;
    }

    expect(map).toEqual({ rejected: 401, rate_limited: 429, too_large: 413, validation: 422 });
  });
});

// ─── успех и ловушка ──────────────────────────────────────────────────────────

describe('POST /api/public/requests — успех и ловушка для ботов', () => {
  it('201 и {ok:true} при успешном приёме', async () => {
    const res = await POST(req(FORM));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('ловушка отвечает ровно тем же, что и успех: робот отличить не может', async () => {
    submitWebsiteRequest.mockResolvedValue({ ok: true, created: true });
    const okRes = await POST(req(FORM));
    const okBody = await okRes.json();

    submitWebsiteRequest.mockResolvedValue({ ok: true, created: false });
    const trapRes = await POST(req({ ...FORM, website: 'https://spam.example' }));
    const trapBody = await trapRes.json();

    expect(trapRes.status).toBe(okRes.status);
    expect(trapRes.status).toBe(201);
    expect(trapBody).toEqual(okBody);
    // Признака `created` в ответе нет вовсе — иначе ловушка выдавала бы себя.
    expect(trapBody).not.toHaveProperty('created');
  });
});

// ─── сбой сервиса ─────────────────────────────────────────────────────────────

describe('POST /api/public/requests — сбой', () => {
  it('500 и запись в журнал, если сервис бросил исключение', async () => {
    submitWebsiteRequest.mockRejectedValue(new Error('база недоступна'));

    const res = await POST(req(FORM));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'internal' });
    // В журнал уходит только ВИД ошибки: её текст у ошибок базы содержит
    // аргументы запроса, то есть телефон и почту посетителя.
    expect(logError).toHaveBeenCalledWith('[api/public/requests] failed', {
      errorName: 'Error',
    });
  });

  it('внутренняя подробность наружу не уходит', async () => {
    submitWebsiteRequest.mockRejectedValue(new Error('relation "ClientRequest" does not exist'));

    const res = await POST(req(FORM));

    expect(JSON.stringify(await res.json())).not.toContain('ClientRequest');
  });

  it('не-Error тоже переживаем, а не падаем', async () => {
    submitWebsiteRequest.mockRejectedValue('строка вместо ошибки');

    const res = await POST(req(FORM));

    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledWith('[api/public/requests] failed', {
      errorName: 'string',
    });
  });

  it('текст ошибки в журнал НЕ попадает — вместе с ПДн внутри него', async () => {
    // Ошибки базы печатают в сообщении аргументы запроса: здесь это телефон
    // посетителя. Сам сервис ПДн не логирует, и роут не должен протащить их
    // через чужое сообщение.
    submitWebsiteRequest.mockRejectedValue(
      new Error('Invalid `prisma.clientRequest.create()`: contactPhone: "+7 900 000-00-00"')
    );

    await POST(req(FORM));

    expect(JSON.stringify(logError.mock.calls)).not.toContain('+7 900 000-00-00');
  });
});

// ─── что роут передаёт сервису ────────────────────────────────────────────────

describe('POST /api/public/requests — заголовки и адрес посетителя', () => {
  it('адрес берётся из x-forwarded-for — первый в цепочке', async () => {
    await POST(req(FORM, { 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1, 10.0.0.2' }));

    expect(lastArgs().ip).toBe('203.0.113.7');
  });

  it('без x-forwarded-for берётся x-real-ip', async () => {
    await POST(req(FORM, { 'x-real-ip': '198.51.100.4' }));

    expect(lastArgs().ip).toBe('198.51.100.4');
  });

  it('x-forwarded-for важнее x-real-ip', async () => {
    await POST(req(FORM, { 'x-forwarded-for': '203.0.113.1', 'x-real-ip': '198.51.100.4' }));

    expect(lastArgs().ip).toBe('203.0.113.1');
  });

  it('заголовков адреса нет вовсе — ключ «unknown», а не пустая строка', async () => {
    await POST(req(FORM));

    expect(lastArgs().ip).toBe('unknown');
  });

  it('токен и домен передаются сервису, размер тела считается в байтах', async () => {
    await POST(req(FORM, { 'x-site-token': 'tok-123', origin: 'https://otsfera.ru' }));

    const a = lastArgs();
    expect(a.token).toBe('tok-123');
    expect(a.origin).toBe('https://otsfera.ru');
    expect(a.bodyBytes).toBe(Buffer.byteLength(JSON.stringify(FORM), 'utf8'));
    expect(a.payload).toEqual(FORM);
  });

  it('заголовков токена и домена нет — сервису уходит null, а не undefined', async () => {
    await POST(req(FORM));

    expect(lastArgs().token).toBeNull();
    expect(lastArgs().origin).toBeNull();
  });

  it('ДЕФЕКТ (в отчёт): адрес берётся из заголовка без проверки — его подделывает кто угодно', async () => {
    // `x-forwarded-for` приходит от клиента и ничем не подтверждён. Меняя его
    // на каждом запросе, счётчик частоты обходится полностью.
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      await POST(req(FORM, { 'x-forwarded-for': ip }));
    }

    expect(submitWebsiteRequest.mock.calls.map((c: any) => c[1].ip)).toEqual([
      '1.1.1.1',
      '2.2.2.2',
      '3.3.3.3',
    ]);
  });
});
