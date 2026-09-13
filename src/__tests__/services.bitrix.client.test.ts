import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBitrixClient } from '@/lib/services/bitrix/client';
import { BitrixSourceError } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-189`, `У-199`): REST-клиент Битрикс24 без сети.
 * Транспорт подменяется опцией `transport`, часы — `now`, паузы — `sleep`:
 * ограничитель и повторы проверяются по числам, а не по секундомеру. В
 * ошибках не должно быть URL вебхука — там токен портала.
 */

type ClientOptions = Parameters<typeof createBitrixClient>[0];
type Transport = NonNullable<ClientOptions['transport']>;

const BASE = 'https://demo.bitrix24.ru/rest/1/secret-token/';

const ok = (body: unknown) => ({ status: 200, body });
const limitHit = { status: 503, body: { error: 'QUERY_LIMIT_EXCEEDED' } };

/** Часы теста: `sleep` двигает время вперёд, чтобы слоты ограничителя освобождались. */
function clock(advanceOnSleep = true) {
  let t = 0;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      if (advanceOnSleep) t += ms;
    }),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function makeClient(transport: Transport, extra: Partial<ClientOptions> = {}) {
  const c = clock();
  const client = createBitrixClient({
    webhookUrl: BASE,
    transport,
    now: c.now,
    sleep: c.sleep,
    retries: 0,
    ...extra,
  });
  return { client, clock: c };
}

/** Ошибка вызова как объект: код, текст и отсутствие секрета в тексте. */
async function failure(p: Promise<unknown>): Promise<BitrixSourceError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(BitrixSourceError);
    const e = err as BitrixSourceError;
    expect(e.message).not.toContain('secret-token');
    expect(e.message).not.toContain('https://');
    return e;
  }
  throw new Error('ожидалась ошибка');
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('call — адрес, параметры, разбор ответа', () => {
  it('POST на <вебхук>/<метод> с параметрами и сигналом отмены', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({ result: { ID: '1' } }));
    const { client } = makeClient(transport);
    const res = await client.call('profile', { a: 1 });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, params, signal] = transport.mock.calls[0];
    expect(url).toBe(`${BASE}profile`);
    expect(params).toEqual({ a: 1 });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(res).toEqual({ result: { ID: '1' }, next: null, total: null });
  });

  it('вебхук без хвостового слэша — слэш добавляется', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({}));
    const { client } = makeClient(transport, { webhookUrl: BASE.slice(0, -1) });
    await client.call('profile');
    expect(transport.mock.calls[0][0]).toBe(`${BASE}profile`);
  });

  it('без параметров уходит пустой объект', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({}));
    const { client } = makeClient(transport);
    await client.call('profile');
    expect(transport.mock.calls[0][1]).toEqual({});
  });

  it('next/total: число и цифровая строка → число, прочее → null', async () => {
    const cases: [unknown, unknown, number | null, number | null][] = [
      [50, 120, 50, 120],
      ['50', '120', 50, 120],
      [undefined, undefined, null, null],
      ['abc', '1.5', null, null],
      [Number.NaN, Number.POSITIVE_INFINITY, null, null],
      [true, {}, null, null],
    ];
    for (const [next, total, expNext, expTotal] of cases) {
      const transport = vi.fn<Transport>().mockResolvedValue(ok({ result: [], next, total }));
      const { client } = makeClient(transport);
      expect(await client.call('x')).toEqual({ result: [], next: expNext, total: expTotal });
    }
  });

  it('тело null или не объект при 200 — результат undefined, без ошибки', async () => {
    for (const body of [null, 'text', 7]) {
      const transport = vi.fn<Transport>().mockResolvedValue(ok(body));
      const { client } = makeClient(transport);
      expect(await client.call('x')).toEqual({ result: undefined, next: null, total: null });
    }
  });
});

describe('ограничитель частоты (token bucket по часам now)', () => {
  it('2 запроса в секунду по умолчанию: подряд идущие вызовы ждут по 500 мс', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({}));
    const { client, clock: c } = makeClient(transport);
    await client.call('a');
    await client.call('b');
    await client.call('c');
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 500]);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('ratePerSecond задаёт интервал слота', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({}));
    const { client, clock: c } = makeClient(transport, { ratePerSecond: 4 });
    await client.call('a');
    await client.call('b');
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([250]);
  });

  it('если между вызовами прошло время — ждать не нужно', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({}));
    const { client, clock: c } = makeClient(transport);
    await client.call('a');
    c.advance(5000);
    await client.call('b');
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it('если часы не сдвинулись после паузы, слот всё равно уезжает вперёд (нет всплеска)', async () => {
    const c = clock(false);
    const transport = vi.fn<Transport>().mockResolvedValue(ok({}));
    const client = createBitrixClient({
      webhookUrl: BASE,
      transport,
      now: c.now,
      sleep: c.sleep,
      retries: 0,
    });
    await client.call('a');
    await client.call('b');
    await client.call('c');
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });
});

describe('повторы: лимит и сетевые ошибки', () => {
  it('503 QUERY_LIMIT_EXCEEDED трижды, потом 200 → успех с паузами 1, 2, 4 с', async () => {
    const transport = vi
      .fn<Transport>()
      .mockResolvedValueOnce(limitHit)
      .mockResolvedValueOnce(limitHit)
      .mockResolvedValueOnce(limitHit)
      .mockResolvedValueOnce(ok({ result: 'готово' }));
    const { client, clock: c } = makeClient(transport, { retries: 3 });
    expect((await client.call('x')).result).toBe('готово');
    expect(transport).toHaveBeenCalledTimes(4);
    // Паузы повторов; ограничитель не добавляет своих — часы уже ушли вперёд.
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('лимит на всех попытках → ошибка limit после последней', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(limitHit);
    const { client, clock: c } = makeClient(transport, { retries: 3 });
    const err = await failure(client.call('x'));
    expect(err.code).toBe('limit');
    expect(err.message).toBe('Битрикс24 ограничил частоту запросов');
    expect(transport).toHaveBeenCalledTimes(4);
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('retries: 0 → лимит без повторов и без пауз', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(limitHit);
    const { client, clock: c } = makeClient(transport);
    expect((await failure(client.call('x'))).code).toBe('limit');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it('сетевая ошибка дважды, потом ответ → успех; текст исходной ошибки наружу не идёт', async () => {
    const transport = vi
      .fn<Transport>()
      .mockRejectedValueOnce(new Error(`ECONNRESET ${BASE}profile`))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(ok({ result: 1 }));
    const { client, clock: c } = makeClient(transport, { retries: 2 });
    expect((await client.call('profile')).result).toBe(1);
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it('сеть недоступна на всех попытках → network с общим текстом', async () => {
    const transport = vi.fn<Transport>().mockRejectedValue(new Error(`ENOTFOUND ${BASE}`));
    const { client } = makeClient(transport, { retries: 1 });
    const err = await failure(client.call('x'));
    expect(err.code).toBe('network');
    expect(err.message).toBe('Битрикс24 недоступен: сетевая ошибка');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('транспорт отверг не-Error значением → тоже network', async () => {
    const transport = vi.fn<Transport>().mockRejectedValue('strange');
    const { client } = makeClient(transport);
    expect((await failure(client.call('x'))).code).toBe('network');
  });

  it('auth и api не повторяются: одна попытка, без пауз', async () => {
    for (const raw of [
      { status: 401, body: null },
      { status: 500, body: null },
    ]) {
      const transport = vi.fn<Transport>().mockResolvedValue(raw);
      const { client, clock: c } = makeClient(transport, { retries: 3 });
      await failure(client.call('x'));
      expect(transport).toHaveBeenCalledTimes(1);
      expect(c.sleep).not.toHaveBeenCalled();
    }
  });

  it('retries: -1 (ни одной попытки) → «неизвестная ошибка», транспорт не зовётся', async () => {
    // Комментарий в коде называет этот выход недостижимым — он достижим при
    // отрицательном retries; закрепляем, чтобы поведение не менялось молча.
    const transport = vi.fn<Transport>();
    const { client } = makeClient(transport, { retries: -1 });
    const err = await failure(client.call('x'));
    expect(err.code).toBe('api');
    expect(err.message).toBe('Битрикс24: неизвестная ошибка');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('таймаут через AbortController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** Транспорт, который «висит», пока его не отменят сигналом — как настоящий fetch. */
  const hanging: Transport = (_url, _params, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });

  it('нет ответа за timeoutMs → ошибка timeout с секундами в тексте', async () => {
    const { client } = makeClient(hanging, { timeoutMs: 2000 });
    const p = client.call('profile');
    const caught = failure(p);
    await vi.advanceTimersByTimeAsync(2000);
    const err = await caught;
    expect(err.code).toBe('timeout');
    expect(err.message).toBe('Битрикс24 не ответил за 2 с');
  });

  it('таймаут повторяется как сетевая ошибка: вторая попытка успевает', async () => {
    const transport = vi
      .fn<Transport>()
      .mockImplementationOnce(hanging)
      .mockResolvedValueOnce(ok({ result: 'успел' }));
    const { client, clock: c } = makeClient(transport, { timeoutMs: 1000, retries: 1 });
    const p = client.call('profile');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).result).toBe('успел');
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000]);
  });

  it('ответ до срока — таймер снимается, сигнал не срабатывает', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({ result: 1 }));
    const { client } = makeClient(transport, { timeoutMs: 30_000 });
    await client.call('profile');
    expect(vi.getTimerCount()).toBe(0);
    expect(transport.mock.calls[0][2].aborted).toBe(false);
  });
});

describe('классификация ответов — стабильные коды без URL', () => {
  const cases: {
    title: string;
    raw: { status: number; body: unknown };
    code: string;
    message: string;
  }[] = [
    {
      title: 'HTTP 401 без тела → auth',
      raw: { status: 401, body: null },
      code: 'auth',
      message: 'Битрикс24 отклонил вебхук',
    },
    {
      title: 'HTTP 403 с INVALID_CREDENTIALS → auth с кодом',
      raw: { status: 403, body: { error: 'INVALID_CREDENTIALS', error_description: 'bad' } },
      code: 'auth',
      message: 'Битрикс24 отклонил вебхук (INVALID_CREDENTIALS)',
    },
    {
      title: 'INVALID_CREDENTIALS при 200 → auth',
      raw: { status: 200, body: { error: 'INVALID_CREDENTIALS' } },
      code: 'auth',
      message: 'Битрикс24 отклонил вебхук (INVALID_CREDENTIALS)',
    },
    {
      title: 'insufficient_scope → auth (не хватает прав вебхука)',
      raw: { status: 400, body: { error: 'insufficient_scope' } },
      code: 'auth',
      message: 'Битрикс24 отклонил вебхук (insufficient_scope)',
    },
    {
      title: 'HTTP 500 без тела → api с номером статуса',
      raw: { status: 500, body: null },
      code: 'api',
      message: 'Битрикс24 ответил ошибкой HTTP 500',
    },
    {
      title: 'HTTP 400 с кодом и описанием → api: код и описание',
      raw: { status: 400, body: { error: 'ERROR_ARGUMENT', error_description: 'Wrong filter' } },
      code: 'api',
      message: 'Битрикс24 ответил ошибкой ERROR_ARGUMENT: Wrong filter',
    },
    {
      title: 'error в теле при 200 → api по коду',
      raw: { status: 200, body: { error: 'ERROR_METHOD_NOT_FOUND' } },
      code: 'api',
      message: 'Битрикс24 ответил ошибкой ERROR_METHOD_NOT_FOUND',
    },
    {
      title: 'описание не строка → игнорируется',
      raw: { status: 200, body: { error: 'X', error_description: 7 } },
      code: 'api',
      message: 'Битрикс24 ответил ошибкой X',
    },
    {
      title: 'HTTP 503 без QUERY_LIMIT_EXCEEDED → обычная api, не лимит',
      raw: { status: 503, body: { error: 'MAINTENANCE' } },
      code: 'api',
      message: 'Битрикс24 ответил ошибкой MAINTENANCE',
    },
    {
      title: 'HTTP 404 с текстовым телом → api HTTP 404',
      raw: { status: 404, body: 'not found' },
      code: 'api',
      message: 'Битрикс24 ответил ошибкой HTTP 404',
    },
    {
      title: 'HTTP 503 + QUERY_LIMIT_EXCEEDED → limit',
      raw: limitHit,
      code: 'limit',
      message: 'Битрикс24 ограничил частоту запросов',
    },
  ];

  for (const c of cases) {
    it(c.title, async () => {
      const transport = vi.fn<Transport>().mockResolvedValue(c.raw);
      const { client } = makeClient(transport);
      const err = await failure(client.call('x'));
      expect(err.code).toBe(c.code);
      expect(err.message).toBe(c.message);
    });
  }

  it('error не строкой при 200 — не ошибка, результат читается', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({ error: 42, result: 'ok' }));
    const { client } = makeClient(transport);
    expect((await client.call('x')).result).toBe('ok');
  });
});

describe('list — страницы start/next', () => {
  it('идёт по next, пока сервер его отдаёт; параметры сохраняются', async () => {
    const transport = vi.fn<Transport>(async (_url, params) => {
      const start = (params as { start: number }).start;
      if (start === 0) return ok({ result: [{ ID: 'a' }, { ID: 'b' }], next: 2, total: 3 });
      return ok({ result: [{ ID: 'c' }], total: 3 });
    });
    const { client } = makeClient(transport);
    const rows: unknown[] = [];
    for await (const row of client.list('crm.company.list', { filter: { X: 1 } })) rows.push(row);
    expect(rows).toEqual([{ ID: 'a' }, { ID: 'b' }, { ID: 'c' }]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][1]).toEqual({ filter: { X: 1 }, start: 0 });
    expect(transport.mock.calls[1][1]).toEqual({ filter: { X: 1 }, start: 2 });
  });

  it('next строкой тоже понимается', async () => {
    const transport = vi
      .fn<Transport>()
      .mockResolvedValueOnce(ok({ result: [{ ID: 'a' }], next: '1' }))
      .mockResolvedValueOnce(ok({ result: [{ ID: 'b' }] }));
    const { client } = makeClient(transport);
    const rows: unknown[] = [];
    for await (const row of client.list('m')) rows.push(row);
    expect(rows).toHaveLength(2);
    expect(transport.mock.calls[1][1]).toEqual({ start: 1 });
  });

  it('next есть, а записей нет → останавливаемся (защита от бесконечного цикла)', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({ result: [], next: 50 }));
    const { client } = makeClient(transport);
    const rows: unknown[] = [];
    for await (const row of client.list('m')) rows.push(row);
    expect(rows).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('result не массив → пусто, один запрос', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(ok({ result: { ID: '1' }, next: 50 }));
    const { client } = makeClient(transport);
    const rows: unknown[] = [];
    for await (const row of client.list('m')) rows.push(row);
    expect(rows).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('ошибка страницы всплывает из итератора', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue({ status: 401, body: null });
    const { client } = makeClient(transport);
    const iterate = async () => {
      for await (const row of client.list('m')) void row;
    };
    expect((await failure(iterate())).code).toBe('auth');
  });
});

describe('batch — пакеты по 50 команд с halt: 0', () => {
  it('120 команд → 3 запроса (50/50/20), результаты склеиваются по ключам', async () => {
    const transport = vi.fn<Transport>(async (_url, params) => {
      const cmd = (params as { cmd: Record<string, string> }).cmd;
      const result = Object.fromEntries(Object.keys(cmd).map((k) => [k, `ответ ${k}`]));
      return ok({ result: { result, result_error: {} } });
    });
    const { client } = makeClient(transport);
    const commands = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [`c${i}`, `crm.company.get?id=${i}`])
    );
    const out = await client.batch(commands);
    expect(Object.keys(out)).toHaveLength(120);
    expect(out.c0).toBe('ответ c0');
    expect(out.c119).toBe('ответ c119');
    expect(transport).toHaveBeenCalledTimes(3);
    const sizes = transport.mock.calls.map(
      ([, params]) => Object.keys((params as { cmd: Record<string, string> }).cmd).length
    );
    expect(sizes).toEqual([50, 50, 20]);
    for (const [url, params] of transport.mock.calls) {
      expect(url).toBe(`${BASE}batch`);
      expect((params as { halt: number }).halt).toBe(0);
    }
    expect((transport.mock.calls[0][1] as { cmd: Record<string, string> }).cmd.c0).toBe(
      'crm.company.get?id=0'
    );
  });

  it('ответ без result.result → пусто по этому пакету, без падения', async () => {
    const transport = vi
      .fn<Transport>()
      .mockResolvedValueOnce(ok({ result: {} }))
      .mockResolvedValueOnce(ok({}));
    const { client } = makeClient(transport);
    const commands = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'profile']));
    expect(await client.batch(commands)).toEqual({});
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('пустой набор команд → пусто без единого запроса', async () => {
    const transport = vi.fn<Transport>();
    const { client } = makeClient(transport);
    expect(await client.batch({})).toEqual({});
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('значения по умолчанию: fetch-транспорт, Date.now, setTimeout, 3 повтора', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function stubFetch(json: () => Promise<unknown>, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({ status, json });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('без transport зовётся fetch: POST, JSON-тело, заголовки, сигнал', async () => {
    const fetchMock = stubFetch(async () => ({ result: { ID: '7' }, next: 50, total: 99 }));
    const client = createBitrixClient({ webhookUrl: BASE });
    const res = await client.call('profile', { q: 'x' });
    expect(res).toEqual({ result: { ID: '7' }, next: 50, total: 99 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}profile`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(init.body).toBe(JSON.stringify({ q: 'x' }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('тело не JSON → body null → статус решает: 200 без результата, 500 → api', async () => {
    stubFetch(async () => {
      throw new SyntaxError('Unexpected token <');
    });
    const client = createBitrixClient({ webhookUrl: BASE });
    expect(await client.call('profile')).toEqual({ result: undefined, next: null, total: null });

    stubFetch(async () => {
      throw new SyntaxError('Unexpected token <');
    }, 500);
    const err = await failure(createBitrixClient({ webhookUrl: BASE }).call('profile'));
    expect(err.code).toBe('api');
    expect(err.message).toBe('Битрикс24 ответил ошибкой HTTP 500');
  });

  it('пауза ограничителя по умолчанию — настоящий setTimeout на 500 мс', async () => {
    const fetchMock = stubFetch(async () => ({ result: 1 }));
    const client = createBitrixClient({ webhookUrl: BASE });
    await client.call('a');
    const second = client.call('b');
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('по умолчанию 3 повтора: лимит → 4 запроса с паузами 1+2+4 с', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(limitHit);
    const client = createBitrixClient({ webhookUrl: BASE, transport });
    const caught = failure(client.call('x'));
    await vi.advanceTimersByTimeAsync(7000);
    expect((await caught).code).toBe('limit');
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('таймаут по умолчанию — 30 секунд', async () => {
    const hanging: Transport = (_url, _params, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    const client = createBitrixClient({ webhookUrl: BASE, transport: hanging, retries: 0 });
    const caught = failure(client.call('x'));
    await vi.advanceTimersByTimeAsync(29_999);
    // Ещё висит — переключаемся на реальный ответ ниже нельзя, просто дожимаем таймер.
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err.code).toBe('timeout');
    expect(err.message).toBe('Битрикс24 не ответил за 30 с');
  });
});
