# Track G1 (P2) — Конструктор ролей (AccessProfile)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.
> **Design:** [2026-07-02-track-g1-role-constructor-design.md](../specs/2026-07-02-track-g1-role-constructor-design.md).

**Goal:** Права как данные — `AccessProfile` (матрица охватов own/assigned/all по 6 типам объектов + capability-флаги), привязка `User → профиль`, резолвинг охватов из профиля (наслоение поверх legacy `teamMode`, регресс зелёный), реальный gate `see_commission`, UI конструктора.

**Инвариант:** профиль — override из сессии; нет профиля → сегодняшнее `teamMode`-поведение байт-в-байт. Company-scope (C8) — жёсткий пол поверх любого профиля. Сигнатуры резолверов не меняются.

**Tech:** Next.js 15 · TS strict · Prisma 5 + PostgreSQL · Vitest. Result-контракт (§3 CLAUDE.md). Аддитивные обратимые миграции.

---

## File Structure

**Schema / migrations**
- `prisma/schema.prisma` — enum `ScopeLevel`; model `AccessProfile`; `User.accessProfileId` + relation; `Company.accessProfiles`.
- `prisma/migrations/<ts>_access_profile/` — G1.1.

**Code (new)**
- `src/lib/auth/accessProfile.ts` — типы (`ScopeLevel`/`AccessObjectType`/`Capability`/`SessionAccessProfile`), Zod-схемы, `can()`, `orderWhereForLevel()`.
- `src/lib/services/access/profiles.ts` — CRUD + assign (PR-2).
- `src/server-actions/access/profiles.ts` — server-actions (PR-2).
- `src/app/leader/roles/page.tsx`, `src/app/admin/roles/page.tsx` — страницы (PR-2).
- `src/components/access/role-editor.tsx` — презентационный редактор (PR-2).

**Code (modified)**
- `src/lib/auth/jwt.ts` — `SessionPayload.accessProfile` + Zod-ветка.
- `src/app/api/auth/login/route.ts` — загрузка профиля в токен.
- `src/lib/auth/managerPolicy.ts` — profile-first в `managerOrderScope`/`managerDocumentScope`/`managerOrgScope`/`canSeeOrder`.
- `src/lib/services/manager/finance.ts` — `see_commission` gate через `can()`.
- `src/lib/services/manager/messages.ts` — `threads`-уровень (PR-1, лёгкая правка).
- `src/lib/navigation/cabinet.ts`, `src/lib/featureFlags.ts` — nav + флаг `role_constructor` (PR-2).

**Tests (new)**
- `src/__tests__/auth.accessProfile.unit.test.ts` — `can()`, `orderWhereForLevel`, схемы.
- `src/__tests__/auth.managerPolicy.profile.unit.test.ts` — резолверы под профиль + no-profile→legacy эквивалентность + company-floor.
- `src/__tests__/services.access.profiles.integration.test.ts` — CRUD/assign/company-scope/аудит/IDOR (PR-2 сервис-слой).
- `src/__tests__/services.manager.scope.profile.integration.test.ts` — end-to-end scope + `see_commission` gate под профилем; G1.5 пример-роли.

---

## PR-1 — Backend (G1.1–G1.3, G1.5)

### G1.1 — Модель прав как данные

#### Task 1: Prisma — enum + model + связь
**Files:** `prisma/schema.prisma`; миграция `access_profile`.

- [ ] **Step 1:** Добавить enum `ScopeLevel { own assigned all }`.
- [ ] **Step 2:** Добавить model `AccessProfile` (см. spec §3.1): `companyId`+relation `onDelete: Cascade`, `name`, 6×`ScopeLevel @default(all)`, `capabilities String[]`, `@@unique([companyId, name])`, `@@index([companyId])`.
- [ ] **Step 3:** `User.accessProfileId String?` + `accessProfile AccessProfile? @relation(fields:[accessProfileId], references:[id])`; на `AccessProfile` — `users User[]`; на `Company` — `accessProfiles AccessProfile[]`.
- [ ] **Step 4:** Миграция (SQL: `CREATE TYPE "ScopeLevel" …`; `CREATE TABLE "AccessProfile" …` с дефолтами `'all'`; `ALTER TABLE "User" ADD COLUMN "accessProfileId" TEXT` + FK). Аддитивно, nullable → существующие строки `null` = legacy. Обратимо (drop table/column/type).
- [ ] **Step 5:** `npm run prisma:generate`, `npm run typecheck`. Commit `feat(access): AccessProfile model + ScopeLevel enum [G1.1]`.

#### Task 2: Барьерный модуль типов `accessProfile.ts`
**Files:** create `src/lib/auth/accessProfile.ts`; test `auth.accessProfile.unit.test.ts`.

- [ ] **Step 1 (failing test):** для `can()` и `orderWhereForLevel()` и Zod-схем (см. ниже полный список кейсов). Run → FAIL (module missing).
- [ ] **Step 2 (implement):** типы `ScopeLevel`/`AccessObjectType`/`Capability`/`SessionAccessProfile`; `CAPABILITIES`, `capabilitySchema`, `scopeLevelSchema`, `sessionAccessProfileSchema`; `orderWhereForLevel(session, level)` (company-floor AND, см. spec §5); `can(session, cap)` (admin→true; profiled→includes; no-profile→`see_commission`⟺`isManagerLeader`, прочие→false).
- [ ] **Step 3:** Run → PASS. `typecheck`, `lint`. Commit `feat(access): accessProfile types + can() + orderWhereForLevel [G1.1]`.

**Unit-кейсы (Task 2):**
- `can(admin, any)` = true (даже без профиля).
- `can(no-profile leader, 'see_commission')` = true; `can(no-profile plain manager, 'see_commission')` = false; `can(no-profile *, 'export')` = false.
- `can(profiled {caps:['see_commission']}, 'see_commission')` = true; `can(profiled {caps:[]}, 'see_commission')` = false; `can(profiled leader-built {caps:[]}, 'see_commission')` = false (профиль перекрывает leader).
- `orderWhereForLevel(s,'all')` = `{companyId}`; `'own'` = `{AND:[{companyId},{managerId:sub}]}`; `'assigned'` = `{AND:[{companyId},{organizationId:{in:managedOrgIds}}]}`; `companyId=null` → sentinel.
- `sessionAccessProfileSchema` парсит валидный/реджектит мусорный `capabilities`/`scope`.

---

### G1.2 — Права в сессии + резолвинг

#### Task 3: `SessionPayload.accessProfile` + Zod
**Files:** `src/lib/auth/jwt.ts`.

- [ ] Добавить `accessProfile?: SessionAccessProfile | null` в `SessionPayload`; ветку в `sessionPayloadSchema` (`sessionAccessProfileSchema.nullish()`), импорт из `accessProfile.ts`. Осторожно с циклом импортов (типы в `accessProfile.ts` не должны импортировать `jwt.ts` значения — только тип `SessionPayload` через `import type`, либо `can()`/`orderWhereForLevel` принимают узкий структурный тип). `typecheck`. Commit `feat(access): accessProfile claim in session [G1.2]`.

#### Task 4: Загрузка профиля в токен при логине
**Files:** `src/app/api/auth/login/route.ts`; integration `services.manager.scope.profile.integration.test.ts` (частично — через реальный логин-хелпер, или unit на выделенный loader).

- [ ] Вынести денормализацию в чистый helper `toSessionAccessProfile(row)` в `accessProfile.ts` (маппит `ordersScope→orders` и т.д., `capabilities` фильтрует через `capabilitySchema`).
- [ ] В login-route, в блоке `user.role === 'manager'`: если `user.accessProfileId` — `prisma.accessProfile.findUnique(...)` → `toSessionAccessProfile` → добавить `accessProfile` в `signToken(...)` спред-паттерном (`...(accessProfile !== undefined ? { accessProfile } : {})`). `typecheck`, `lint`. Commit `feat(access): load AccessProfile into JWT at login [G1.2]`.

#### Task 5: Profile-first резолверы в `managerPolicy.ts`
**Files:** `src/lib/auth/managerPolicy.ts`; test `auth.managerPolicy.profile.unit.test.ts`.

- [ ] **Step 1 (failing test):** сессия С профилем → `managerOrderScope`/`managerDocumentScope`/`managerOrgScope`/`canSeeOrder` дают ожидаемый where под каждый уровень + company-floor; сессия БЕЗ профиля → **идентично** legacy (сравнить с прямым вызовом legacy-ветки при обоих `teamMode`). Run → FAIL.
- [ ] **Step 2 (implement):** `managerOrderScope`/`managerDocumentScope`/`managerOrgScope`/`canSeeOrder` читают `session.accessProfile?.<type>` первым, teamMode-fallback вторым (см. spec §5). Импорт `orderWhereForLevel` из `accessProfile.ts`. Сигнатуры не меняются → call-site'ы не трогаем.
- [ ] **Step 3:** Run → PASS. Прогнать **регресс**: `f.list-cross-tenant`, `c3.idor-cross-access`, `auth.requireRole.teammode` — зелёные без правок. `typecheck`, `lint`. Commit `feat(access): profile-first scope resolvers (legacy teamMode fallback) [G1.2]`.

#### Task 6: `threads`-уровень в messages
**Files:** `src/lib/services/manager/messages.ts`.

- [ ] `listManagerMessages` строит order-where из `threads`-уровня профиля (если есть), иначе `managerOrderScope(session, teamMode)`. Малая правка + кейс в integration-тесте. Commit `feat(access): thread scope honors profile threads level [G1.2]`.

---

### G1.3 — Gate `see_commission`

#### Task 7: Заменить commission-gate на `can()`
**Files:** `src/lib/services/manager/finance.ts`; integration `services.manager.scope.profile.integration.test.ts`.

- [ ] **Step 1 (failing test):** профилированная leader-сессия без `see_commission` → `getManagerFinanceOverview().canSeeCommission === false` и `sections[].commission === null`; профилированная с `see_commission` → true и commission посчитан; no-profile leader → true (регресс); no-profile plain manager → false (регресс); admin → true. Run → FAIL.
- [ ] **Step 2 (implement):** `const canSeeCommission = can(session, 'see_commission');` (импорт из `accessProfile.ts`), убрать локальный `unscoped || isManagerLeader`. `unscoped` для org-scope (`where: unscoped ? undefined : …`) оставить как есть (это admin-ветка выборки, не commission-gate).
- [ ] **Step 3:** Run → PASS. Прогнать регресс `services.manager.finance.test.ts` — зелёный. `typecheck`, `lint`. Commit `feat(access): see_commission capability gate on finance overview [G1.3]`.

---

### G1.5 — Примерные роли

#### Task 8: Пример-роли собираются и работают
**Files:** integration `services.manager.scope.profile.integration.test.ts` (+ при необходимости хелпер сида профилей).

- [ ] Тест: создать (через сервис G1.1/PR-2 `createAccessProfile`, либо напрямую `prisma.accessProfile.create` если PR-2 ещё не готов) три профиля (spec §8): «Оператор заявок», «Специалист по ОТ», «Менеджер по продажам». Назначить менеджеру, залогинить (или собрать сессию с `accessProfile`), проверить:
  - «Оператор»/«Специалист»: `orders/documents/threads = assigned` → выборки только по `managedOrgIds`; `see_commission` off → комиссия скрыта.
  - «Специалист»: видит закреплённые орги, не видит чужие (company-floor + assigned).
  - «Менеджер по продажам»: `leads = all` хранится (enforcement — G2; проверяем поле профиля).
- [ ] Commit `test(access): example roles assembled via constructor [G1.5]`.

**PR-1 verification:** `npm run typecheck` · `npm run lint` · `npm run test:unit` · (живой Postgres) `npm run test:integration` · `npx prisma migrate status`.

---

## PR-2 — UI конструктора (G1.4)

#### Task 9: Сервис CRUD профилей
**Files:** create `src/lib/services/access/profiles.ts`; integration `services.access.profiles.integration.test.ts`.

- [ ] Result-контракт: `listAccessProfiles(prisma, session)`, `createAccessProfile`, `updateAccessProfile`, `deleteAccessProfile`, `assignUserProfile(prisma, session, {userId, profileId|null})`. Все company-scoped: профиль/user должны быть в `session.companyId`, иначе `not_found`/`forbidden`. Валидация имени (непустое, уникальность в компании → `name_taken`), охватов (`scopeLevelSchema`), флагов (`capabilitySchema`, дедуп). Аудит на каждую мутацию.
- [ ] **Tests:** create → читается; дубль имени → `name_taken`; cross-company профиль/user → `not_found` (IDOR); assign менеджеру своей компании ok, чужому → `not_found`; delete снимает профиль (или блокирует, если назначен — решить: `assignUserProfile(null)` перед delete, либо `SET NULL`). Аудит-строки. Commit `feat(access): AccessProfile CRUD + assign service [G1.4]`.

#### Task 10: Server-actions + страницы + nav + флаг
**Files:** `src/server-actions/access/profiles.ts`; `src/app/leader/roles/page.tsx`; `src/app/admin/roles/page.tsx`; `src/components/access/role-editor.tsx`; `src/lib/navigation/cabinet.ts`; `src/lib/featureFlags.ts`; `src/middleware.ts`.

- [ ] Server-actions (`requireManagerLeader` для leader, `requireAdmin` для admin) поверх сервиса; `revalidatePath`.
- [ ] Презентационный `role-editor.tsx` (UI-кит: `Select`×6, чекбоксы флагов, `Input` имя, `Dialog` подтверждения); принимает domain-agnostic props (sibling-pattern).
- [ ] Страницы `/leader/roles` и `/admin/roles` со списком + редактором + назначением; page-гард (canSee-чек) даже при middleware.
- [ ] Флаг `role_constructor` (opt-in) в `featureFlags.ts` (3 точки: middleware-префикс, nav, route/page). Nav-пункт в `cabinet.ts`. Commit `feat(access): role-constructor UI (leader+admin) [G1.4]`.

**PR-2 verification:** typecheck/lint/test; (опц.) Playwright visual для новых экранов — фаза 2.

---

## Self-Review checklist
- Наслоение (профиль-override, no-profile→legacy) — резолверы и `can()` сохраняют сигнатуры; call-site'ы не тронуты.
- Регресс C/F/teammode/finance зелёный **без изменений логики** (только добавленные кейсы).
- Company-floor (C8) во всех profile-ветках; `companyId=null`→sentinel deny.
- Миграция аддитивная/обратимая; дефолт `all` только на явных профилях; существующие менеджеры `null`.
- Default-deny по флагам для профилей; backward-compat для no-profile.
- Каждый шаг — тесты; coverage-порог для новых `lib/services/**`+`server-actions/**`+`api/**`.
- `leads` полное enforcement и `Department` — явно вне G1 (G2/позже), не молчим.

## Final verification
`npm run typecheck` · `npm run lint` · `npm run test` · (Postgres up) `npm run test:integration` / `npm run gate` · `npx prisma migrate status`.
