# src/lib/api — стандартная обвязка route-handler'ов

## Модули

- [withAuth.ts](withAuth.ts) — композиция пролога роута:
  feature-флаг (`404`, существование не раскрываем) → сессия → guard из
  [`@/lib/auth/guard`](../auth/guard.ts) → Zod-тело → обработчик.
- [http.ts](http.ts) — низкоуровневые помощники: `parseJsonBody` / `parseQuery` (кривой вход →
  400 `invalid_request`), `jsonError`, `guardedRoute` (перехват необработанного throw → 500
  `internal`), `x-request-id` в каждом ответе.

## Когда что

- Новый API-роут → `withAuth({ feature?, guard?, body? }, handler)`.
  Эталон — [api/admin/custom-fields/route.ts](../../app/api/admin/custom-fields/route.ts).
- Роут с redirect-стилевыми гардами из [`requireRole.ts`](../auth/requireRole.ts) —
  их в `withAuth` **не заворачивать**; брать `parseJsonBody`/`jsonError` напрямую.

## Правила

- **Zod в роуте проверяет только форму входа** (типы/обязательность полей). Доменная валидация
  и коды ошибок — за сервисом ([src/lib/services/README.md](../services/README.md)).
- Роут только мапит `error`-код сервиса в HTTP-статус — бизнес-логики в роуте нет.
- Scope по данным (companyId/membership/policy) — обязанность сервиса; `withAuth` его не подменяет
  (defense-in-depth, CLAUDE.md §4).
