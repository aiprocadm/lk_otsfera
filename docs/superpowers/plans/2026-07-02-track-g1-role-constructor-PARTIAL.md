# Track G1 — Конструктор ролей — PARTIAL close-out

**Дата:** 2026-07-02
**Plan:** [2026-07-02-track-g1-role-constructor.md](2026-07-02-track-g1-role-constructor.md) · **Spec:** [../specs/2026-07-02-track-g1-role-constructor-design.md](../specs/2026-07-02-track-g1-role-constructor-design.md)
**Branch:** `claude/mystifying-raman-96e2e5`

## Статус фаз

| Фаза | Что | Статус |
|---|---|---|
| **PR-1 · G1.1** | Модель `AccessProfile` + `ScopeLevel` + `User.accessProfileId`; barrel `accessProfile.ts` (`can`/`orderWhereForLevel`/схемы/loader) | ✅ код + unit-тесты; ⏳ **миграция не применена** (нет живого Postgres в этом worktree) |
| **PR-1 · G1.2** | `SessionPayload.accessProfile` + Zod; загрузка профиля в JWT при логине; profile-first резолверы (`managerOrderScope/DocumentScope/OrgScope/canSeeOrder`); threads-уровень в messages | ✅ код + unit-тесты (регресс зелёный) |
| **PR-1 · G1.3** | Реальный gate `see_commission` в `getManagerFinanceOverview` через `can()` | ✅ код + unit-тесты |
| **PR-1 · G1.5** | Пример-роли (Оператор/Специалист по ОТ/Продажник) — unit-проверка резолвинга; integration (DB round-trip + scoping + gate) | ✅ unit + **integration прогнан против Postgres** (5/5) |
| **PR-2 · G1.4** | UI конструктора (сервис CRUD + server-actions + `/leader/roles`,`/admin/roles` + nav + флаг) | ⛔ **не начато** (следующий PR) |

## Что отгружено (PR-1 бэкенд)

**Инвариант «наслоение».** Профиль — override из сессии; при `accessProfileId=null` резолверы падают в legacy `teamMode`-путь **байт-в-байт**. Публичные сигнатуры резолверов не менялись → ~15 call-site'ов не тронуты → регресс C/F/teammode/finance зелёный. Company-floor (C8) держится во всех profile-ветках (`companyId ?? NO_COMPANY_SENTINEL`).

**Gate `see_commission`.** `can(session,'see_commission')` заменил `unscoped || isManagerLeader`; для no-profile сессий тождественно старому (регресс зелёный), для профилей — default-deny; флаг и грантит (не-leader со флагом видит), и рестриктит (leader-профиль без флага не видит).

### Код
- `prisma/schema.prisma` — enum `ScopeLevel`, model `AccessProfile`, `User.accessProfileId`, `Company.accessProfiles`.
- `prisma/migrations/20260702130000_access_profile/migration.sql` — аддитивная/обратимая.
- `src/lib/auth/accessProfile.ts` — **новый** barrel (типы, Zod, `can`, `orderWhereForLevel`, `toSessionAccessProfile`, `NO_COMPANY_SENTINEL`).
- `src/lib/auth/jwt.ts` — `accessProfile` в `SessionPayload` + `sessionPayloadSchema`.
- `src/app/api/auth/login/route.ts` — денормализация профиля в токен (manager-ветка).
- `src/lib/auth/managerPolicy.ts` — profile-first `managerOrderScope`/`managerDocumentScope`/`managerOrgScope`/`canSeeOrder`; `NO_COMPANY_SENTINEL` вынесен в `accessProfile.ts`.
- `src/lib/services/manager/messages.ts` — тред-охват из `threads`-уровня.
- `src/lib/services/manager/finance.ts` — `see_commission` gate через `can()`.

### Тесты (unit, зелёные)
- `auth.accessProfile.unit.test.ts` (14) — `can`/`orderWhereForLevel`/схемы/loader.
- `auth.managerPolicy.profile.unit.test.ts` (17) — резолверы под профиль + **no-profile ≡ legacy** + company-floor.
- `auth.accessProfile.exampleRoles.unit.test.ts` (6) — G1.5 пример-роли резолвятся.
- `services.manager.finance.test.ts` (+2) — profiled leader без флага скрыт; не-leader с флагом видит.
- `auth.login.manager.test.ts` (+2) — денормализация профиля / omit при `accessProfileId=null`.

### Тесты (integration, написаны — прогнать против Postgres)
- `services.manager.scope.profile.integration.test.ts` — модель round-trip, `assigned` vs `all` реальные выборки, `see_commission` gate.

## Проверка состояния

```
npm run typecheck                    # 0 errors
npm run lint                         # 0 warnings / 0 errors
npm run test:unit                    # 335 files / 3587 passed, 3 skipped
prisma migrate deploy                # все 43 миграции применены (вкл. 20260702130000_access_profile), 0 drift
integration (против Postgres):       # 126 passed
  · services.manager.scope.profile.integration (новый)   5/5
  · c3.idor-cross-access (регресс)                        12/12
  · f.list-cross-tenant (регресс)                         9/9
  · 10 core manager-domain файлов (orders/documents/organizations/
    messages/dashboard/finance/counterparties/policy/customFields/
    doc-channel), все no-profile → legacy-путь               100/100
```
Поднят worktree-scoped Docker Postgres (`mystifying-raman-96e2e5-db-1`, порт 5432) + host-facing `.env` (gitignored). Прогнан целевой surface (весь код, затронутый изменением); нетронутые домены (partner/org/commission/1c/worker) не прогонялись — они не импортируют изменённый код.

## ⏳ Осталось
1. **(опц.) Полный `npm run gate` / весь `test:integration`** — целевой surface уже зелёный; полный прогон — belt-and-suspenders. Внимание: локальный db держит порт 5432 — `npm run gate` (свой ephemeral db) конфликтнёт; сначала `docker compose down` или `npm run gate:down`.
2. **PR-2 (G1.4 UI)** — отдельный PR по плану.

## Заметки окружения
- Worktree пришёл с пустым `node_modules` — выполнен `npm ci` + `npm run prisma:generate` (Prisma 5.22; `npx prisma` тянет несовместимый v7 — использовать локальный бинарь/скрипты).
