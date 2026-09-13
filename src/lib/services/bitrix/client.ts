import { BitrixSourceError } from './source';

/**
 * REST-клиент Битрикс24 поверх входящего вебхука (`У-189`).
 *
 * Что здесь и почему:
 * - **ограничитель 2 запроса в секунду** на портал (лимит облака) — token
 *   bucket по часам `now`, чтобы тесты шли на фейковых таймерах;
 * - **повторы**: HTTP 503 с `error: QUERY_LIMIT_EXCEEDED` и сетевые ошибки —
 *   три попытки с паузой 1, 2, 4 с (рекомендация документации Битрикса);
 * - **таймаут** 30 с через `AbortController`;
 * - **пагинация** списков `start`/`next` по 50 записей;
 * - **`batch`** до 50 команд за один запрос, `halt: 0`.
 *
 * Транспорт — единственное место с `fetch`; в тестах подменяется моком.
 * В ошибках нет URL: в нём токен (`У-199`).
 */

export type BitrixRawResponse = {
  status: number;
  body: unknown;
};

export type BitrixTransport = (
  url: string,
  params: unknown,
  signal: AbortSignal
) => Promise<BitrixRawResponse>;

export type BitrixCallResult = {
  result: unknown;
  next: number | null;
  total: number | null;
};

export type BitrixClientOptions = {
  webhookUrl: string;
  transport?: BitrixTransport | undefined;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Запросов в секунду; лимит облачного Битрикса — 2. */
  ratePerSecond?: number | undefined;
  timeoutMs?: number | undefined;
  retries?: number | undefined;
};

export type BitrixClient = {
  call(method: string, params?: Record<string, unknown>): Promise<BitrixCallResult>;
  /** Страницы списка по 50: отдаёт записи по одной, пока сервер возвращает `next`. */
  list(method: string, params?: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
  /** Пакет команд: ключ → результат. Больше 50 — режется на несколько запросов. */
  batch(commands: Record<string, string>): Promise<Record<string, unknown>>;
};

export const BITRIX_PAGE_SIZE = 50;
export const BITRIX_BATCH_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RATE = 2;

export const fetchTransport: BitrixTransport = async (url, params, signal) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(params ?? {}),
    signal,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

function errorCodeOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const err = (body as { error?: unknown }).error;
  return typeof err === 'string' ? err : null;
}

function errorDescriptionOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const d = (body as { error_description?: unknown }).error_description;
  return typeof d === 'string' ? d : '';
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
}

/** Разбор ответа Битрикса в стабильную ошибку без URL. */
function classify(res: BitrixRawResponse): BitrixSourceError | null {
  const code = errorCodeOf(res.body);
  if (res.status === 503 && code === 'QUERY_LIMIT_EXCEEDED') {
    return new BitrixSourceError('limit', 'Битрикс24 ограничил частоту запросов');
  }
  if (
    res.status === 401 ||
    res.status === 403 ||
    code === 'INVALID_CREDENTIALS' ||
    code === 'insufficient_scope'
  ) {
    return new BitrixSourceError('auth', `Битрикс24 отклонил вебхук${code ? ` (${code})` : ''}`);
  }
  if (res.status >= 400 || code) {
    const description = errorDescriptionOf(res.body);
    return new BitrixSourceError(
      'api',
      `Битрикс24 ответил ошибкой${code ? ` ${code}` : ` HTTP ${res.status}`}${description ? `: ${description}` : ''}`
    );
  }
  return null;
}

export function createBitrixClient(options: BitrixClientOptions): BitrixClient {
  const base = options.webhookUrl.endsWith('/') ? options.webhookUrl : `${options.webhookUrl}/`;
  const transport = options.transport ?? fetchTransport;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rate = options.ratePerSecond ?? DEFAULT_RATE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const interval = 1000 / rate;

  // Token bucket на один слот: следующий запрос не раньше, чем через `interval`
  // после предыдущего. Простая очередь, потому что вызовы идут последовательно.
  let nextAllowedAt = 0;
  async function throttle(): Promise<void> {
    const t = now();
    if (t < nextAllowedAt) await sleep(nextAllowedAt - t);
    nextAllowedAt = Math.max(now(), nextAllowedAt) + interval;
  }

  async function once(method: string, params: Record<string, unknown>): Promise<BitrixRawResponse> {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await transport(`${base}${method}`, params, controller.signal);
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new BitrixSourceError(
        aborted ? 'timeout' : 'network',
        aborted
          ? `Битрикс24 не ответил за ${Math.round(timeoutMs / 1000)} с`
          : 'Битрикс24 недоступен: сетевая ошибка'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function call(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<BitrixCallResult> {
    let lastError: BitrixSourceError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res: BitrixRawResponse;
      try {
        res = await once(method, params);
      } catch (err) {
        lastError = err as BitrixSourceError;
        // Сетевая ошибка и таймаут — повторяем; исчерпали попытки — наружу.
        if (attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw lastError;
      }
      const failure = classify(res);
      if (!failure) {
        const body = res.body as { result?: unknown; next?: unknown; total?: unknown } | null;
        return {
          result: body?.result,
          next: toInt(body?.next),
          total: toInt(body?.total),
        };
      }
      lastError = failure;
      if (failure.code === 'limit' && attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw failure;
    }
    // Недостижимо: цикл либо вернул результат, либо бросил. Оставлено ради типов.
    throw lastError ?? new BitrixSourceError('api', 'Битрикс24: неизвестная ошибка');
  }

  async function* list(
    method: string,
    params: Record<string, unknown> = {}
  ): AsyncIterable<Record<string, unknown>> {
    let start = 0;
    for (;;) {
      const page = await call(method, { ...params, start });
      const rows = Array.isArray(page.result) ? (page.result as Record<string, unknown>[]) : [];
      for (const row of rows) yield row;
      if (page.next === null || rows.length === 0) return;
      start = page.next;
    }
  }

  async function batch(commands: Record<string, string>): Promise<Record<string, unknown>> {
    const entries = Object.entries(commands);
    const out: Record<string, unknown> = {};
    for (let i = 0; i < entries.length; i += BITRIX_BATCH_LIMIT) {
      const chunk = Object.fromEntries(entries.slice(i, i + BITRIX_BATCH_LIMIT));
      const res = await call('batch', { halt: 0, cmd: chunk });
      const result = res.result as { result?: Record<string, unknown> } | undefined;
      Object.assign(out, result?.result ?? {});
    }
    return out;
  }

  return { call, list, batch };
}
