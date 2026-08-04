# src/lib/auth — сессии, гарды, политики доступа

## Карта модулей

- [jwt.ts](jwt.ts) — подпись/проверка JWT, типы `Role`, `SessionPayload`, bridge-payload студента.
- [session.ts](session.ts) — чтение сессии из cookie (`getSession`).
- [access.ts](access.ts) — `protectedPrefixes`: какая роль в какой кабинет (читает middleware).
- [guard.ts](guard.ts) — гарды **для API-роутов**: возвращают `{ ok, value } | { ok, response }`
  (401/403 как `Response`). Используются внутри `withAuth` из `src/lib/api`.
- [requireRole.ts](requireRole.ts) — гарды **для страниц/server-actions**: `redirect('/login' | '/forbidden')`
  вместо Response. Их авторизацию в `withAuth` не заворачивать (CLAUDE.md §3).
- [policy.ts](policy.ts) — объектные проверки (`canReadOrder`, `canReadDocument`, partner-scope);
  для admin — Model A: `return true` (управление через `/admin/*`-зеркало, не через чужие кабинеты).
- [managerPolicy.ts](managerPolicy.ts) — менеджерский scope: `managedOrgIds`, `canSeeOrder`,
  `manager*ScopeFilter`.
- [organizationPolicy.ts](organizationPolicy.ts), [orgContext.ts](orgContext.ts) — scope организации по membership.
- [audit.ts](audit.ts) — запись audit log (без секретов).

## Когда какой стиль гарда

- API route handler → `guard.ts` (вернуть `result.response` при `!ok`), обычно через `withAuth`.
- Server component / page / server-action → `requireRole.ts` (redirect-стиль).

## Инвариант C8 (CLAUDE.md §4)

Менеджерский scope mode-aware: при `Company.managerTeamVisibility=ON` граница — компания,
при OFF — per-manager. `teamMode` обязателен на всех manager read/guard-сайтах — его пропуск
молча сужает scope (typecheck не ловит). Cross-company изоляция держится в обоих режимах.
