/**
 * Композиция стандартного пролога роута (фаза 4):
 *   feature-флаг → сессия → роль/гард → Zod-тело → обработчик,
 * плюс request-id и перехват необработанных исключений (см. http.ts).
 *
 * Скоуп по данным (companyId/membership/policy) остаётся обязанностью
 * СЕРВИСА (defense-in-depth, CLAUDE.md §4) — wrapper его не подменяет.
 *
 * Эталон использования — src/app/api/admin/custom-fields/route.ts.
 */
import type { z } from 'zod';
import { requireSession } from '@/lib/auth/guard';
import type { SessionPayload } from '@/lib/auth/jwt';
import { type FeatureFlag, notFoundIfDisabled } from '@/lib/featureFlags';
import { guardedRoute, parseJsonBody } from './http';

type GuardResult = { ok: true; value: SessionPayload } | { ok: false; response: Response };

type RouteContext = { params: Promise<Record<string, string>> };

type HandlerCtx<TBody> = {
  req: Request;
  session: SessionPayload;
  body: TBody;
  params: Promise<Record<string, string>>;
  requestId: string;
};

type WithAuthOpts<S extends z.ZodTypeAny | undefined> = {
  /** Роут виден только при включённом флаге (иначе 404 — существование не раскрываем). */
  feature?: FeatureFlag;
  /** Проверка прав поверх сессии: guard из @/lib/auth/guard (requireAdmin, requireFieldsAdmin, …). */
  guard?: (session: SessionPayload) => GuardResult;
  /** Zod-схема JSON-тела; кривой вход → 400 invalid_request до вызова сервиса. */
  body?: S;
};

export function withAuth<S extends z.ZodTypeAny | undefined = undefined>(
  opts: WithAuthOpts<S>,
  handler: (ctx: HandlerCtx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<Response>
): (req: Request, ctx?: RouteContext) => Promise<Response> {
  return (req, ctx) =>
    guardedRoute(req, async (requestId) => {
      if (opts.feature) {
        const disabled = notFoundIfDisabled(opts.feature);
        if (disabled) return disabled;
      }

      const sessionResult = await requireSession();
      if (!sessionResult.ok) return sessionResult.response;

      let session = sessionResult.value;
      if (opts.guard) {
        const guardResult = opts.guard(session);
        if (!guardResult.ok) return guardResult.response;
        session = guardResult.value;
      }

      let body: unknown;
      if (opts.body) {
        const parsed = await parseJsonBody(req, opts.body);
        if (!parsed.ok) return parsed.response;
        body = parsed.data;
      }

      return handler({
        req,
        session,
        body: body as S extends z.ZodTypeAny ? z.infer<S> : undefined,
        // В юнит-тестах роут зовут без второго аргумента — параметров тогда нет.
        params: ctx?.params ?? Promise.resolve({}),
        requestId,
      });
    });
}
