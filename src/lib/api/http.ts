/**
 * Фаза 4 «эталонного репозитория»: единая обвязка HTTP-роутов.
 *
 * Контракт ошибок НЕ меняется: тело остаётся `{ error: '<code>' }` (стабильные
 * коды из сервисного Result-типа, CLAUDE.md §3) — фронт разбирает именно эту
 * форму. Новое здесь:
 *  - `x-request-id` на каждом ответе (корреляция с логами);
 *  - разбор входа через Zod ДО вызова сервиса: кривой JSON/форма → 400
 *    `{ error: 'invalid_request' }` вместо 500;
 *  - необработанный throw → 500 `{ error: 'internal' }` без стектрейса наружу.
 *
 * Расширение формата (`message`/`details`) — отдельным решением заказчика:
 * это изменение контракта для всех клиентов (см. REPO_AUDIT.md §11).
 */
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { log } from '@/lib/logging';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Request-id: берём входящий (прокси/edge) или генерируем свой. */
export function resolveRequestId(req: Request): string {
  return req.headers.get(REQUEST_ID_HEADER) ?? randomUUID();
}

export function withRequestId<T extends Response>(res: T, requestId: string): T {
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

/** Единый ответ об ошибке: `{ error: code }` (+доп. поля) со статусом. */
export function jsonError(
  code: string,
  status: number,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: code, ...extra }, { status });
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * JSON-тело по Zod-схеме. Кривой JSON или несоответствие схеме → 400
 * `invalid_request`. Коды доменной валидации (например `validation` с
 * `messages`) остаются за сервисом — здесь только контроль формы.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S
): Promise<ParseResult<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: jsonError('invalid_request', 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: jsonError('invalid_request', 400) };
  }
  return { ok: true, data: parsed.data };
}

/** Query-параметры по Zod-схеме (объект из searchParams; повторы — последним значением). */
export function parseQuery<S extends z.ZodTypeAny>(
  req: Request,
  schema: S
): ParseResult<z.infer<S>> {
  const sp = new URL(req.url).searchParams;
  const obj: Record<string, string> = {};
  sp.forEach((value, key) => {
    obj[key] = value;
  });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    return { ok: false, response: jsonError('invalid_request', 400) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Общий try/catch роута: необработанное исключение логируется со своим
 * request-id, наружу уходит 500 `{ error: 'internal' }` без деталей.
 */
export async function guardedRoute(
  req: Request,
  handler: (requestId: string) => Promise<Response>
): Promise<Response> {
  const requestId = resolveRequestId(req);
  try {
    const res = await handler(requestId);
    return withRequestId(res, requestId);
  } catch (err) {
    log.error('[api] unhandled route error', { requestId, err });
    return withRequestId(jsonError('internal', 500), requestId);
  }
}
