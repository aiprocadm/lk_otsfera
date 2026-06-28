# throw→Result Contract — волна 2 — DONE

**Дата завершения:** 2026-06-28
**Branch:** `claude/throw-to-result-wave2` (от `main` после merge волны 1, PR #162)
**Head:** `879e8e6`
**Spec:** [2026-06-28-throw-to-result-wave2-design.md](../specs/2026-06-28-throw-to-result-wave2-design.md)
**Plan:** [2026-06-28-throw-to-result-wave2.md](2026-06-28-throw-to-result-wave2.md)

## Что отгружено

Восемь доменных сервисов приведены к §3 Result-контракту; роуты/server-actions стали тонкими мапперами `if (!res.ok) ...`. Поведение (HTTP-статусы, бизнес-логика) сохранено — менялась только **форма** контракта ошибок (throw → return) и нормализация кодов в lowercase.

### Task 1 — Локализация (`e064022`)
- `src/lib/errors/messages.ts`: +12 кодов (`email_taken`, `org_not_found`, `user_not_found`, `role_conflict`, `already_assigned`, `invalid_status`, `partner_not_found`, `period_overlap`, `duplicate_slug`, `duplicate_email`, `admin_role_via_ui`, `role_transition_forbidden`). Последние три закрыли существующий localization-gap `admin/users` (функции уже Result, строк не было).

### Phase 1 — Flavor 1 (bare `Error` → Result, Pattern A)
- **partner/team** (`a76bc49`): `inviteMember`, `assignOrgs`, `deactivateMember`. Роуты POST/PUT/DELETE убрали `err.message.startsWith(...)`. Снят мёртвый 404-арм в PUT (`assignOrgs` не имеет `not_found`-пути).
- **manager/leadLifecycle** (`528b7d0`): `assignLead`/`setLeadStatus`/`promoteLead`/`rejectLead`; `loadLead` → `Lead | null`. Роут PATCH убрал `mapError`.
- **commission/statement** (`9c7ae38`): `calculateStatementForPartner` — два pre-tx throw (`partner_not_found`, `period_overlap`). Внутренний P2002-catch в tx **не тронут**. POST-роут добавил маппинг `partner_not_found`→404. Обновлены воркер `calculate-monthly-commissions` и `prisma/seed.ts`.
- **enrollments/lifecycle** (`bb5a1c8`): `approveEnrollment`/`rejectEnrollment`/`markProvisioned`; `loadRequest` → `… | null`. Роут PATCH убрал `mapError`.

### Phase 2 — Flavor 2 (boundary-catch в сервис)
- **manager/status** (`5400d36`): `transitionOrderStatus` (все throw до tx → Pattern A). Удалён класс `ManagerStatusError`, убран `instanceof`-catch из server-action.
- **manager/invite** (`756dcb5`): `createAndAssignManager` (throws внутри tx → Pattern B, boundary-catch в сервисе). Убраны `instanceof`-catch из **двух** server-actions (`admin/manager.ts`, `manager/team.ts`). `deactivateAssignment`/`reactivateAssignment` уже были Result — не тронуты.
- **admin/organizations** (`9a359d5`): `updateOrganization` (Pattern B). Убран `mapErr` из server-action.
- **admin/partners** (`879e8e6`): `updatePartner`/`deactivatePartner`/`reactivatePartner`/`createPartnerWithAdmin` (Pattern B). Убран `mapErr` из server-action.

## Уже-compliant — НЕ трогали (подтверждено)
- `admin/users/mutations.ts` — все 4 функции уже возвращали Result через boundary-catch (эталон волны 1). Долг был только локализация (закрыт в Task 1).
- `manager/invite.{deactivate,reactivate}Assignment` — уже Result.
- `oneCSync/*` — инфраструктурные адаптеры, легитимно бросают (вне §3-контракта).

## Проверка состояния (Task 10)

```
npm run typecheck        # 0 errors
npm run lint             # 0 warnings / 0 errors
npm run test:unit        # 314 файлов, 3328 passed, 3 skipped, 0 failed
npx vitest --mode=integration (partner/team, commission/statement+corrections, manager/invite)
                         # 4 файла, 40 passed (live PG)
npm run build            # (волна 1) — для волны 2 не запускался отдельно; статика не менялась
```

Grep остаточных UPPER-кодов по затронутым сервисам/роутам — пусто.

## Метрики
- **Коммитов:** 10 (1 docs + 1 локализация + 8 сервисов)
- **Diff vs main:** 48 файлов, ~1005 insertions / ~705 deletions
- **Новых RU-кодов:** 12

## Сознательные решения (не баги)
1. **`partner/team.LAST_ADMIN` → `last_admin_protected`** (переиспользование существующего кода + RU-строки, а не новый `last_admin`).
2. **Тесты «rethrows unknown errors»** оставлены как propagation-тесты: тонкий роут больше не ловит — неожиданный reject просто пробрасывается. Stale-описания «mapError branch[0]» переименованы в «propagates».
3. **Интеграционные хелперы** (`calcOk` в `services.commission.statement.test.ts`) — узкое сужение Result в happy-path, чтобы не плодить `if (!r.ok) throw` на каждый сайт.
4. **`worker/calculate-monthly-commissions`**: `partner_not_found` (теоретически невозможен — партнёр берётся из существующих платежей) пишется в `errors[]` и батч продолжается (§3 graceful degrade).

## Что осталось вне охвата
- Полный `npm run test:coverage` (100%-гейт) — L3/ручной, требует полного прогона; запускается перед релизом владельцем.
- UI-слои (`*.tsx`) — не затрагивались (контракт ошибок — серверный).
