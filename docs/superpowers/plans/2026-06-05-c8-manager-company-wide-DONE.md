# C8: менеджерский кабинет → company-wide видимость + роль руководителя — CLOSE-OUT

**Дата отгрузки:** 2026-06-06 · **Статус:** DONE · **Ветка:** `claude/c8-manager-company-wide` · **Трек:** C / **C8** (последний из «прямых» C-доработок, см. [completion-roadmap](../specs/2026-06-02-completion-roadmap.md)).

Парные документы: [spec](../specs/2026-06-05-c8-manager-company-wide-design.md) (что планировали + почему), [plan](2026-06-05-c8-manager-company-wide.md) (как). Этот close-out — что отгрузили.

---

## Что отгружено

Менеджерская видимость стала **переключаемой**: новый флаг `Company.managerTeamVisibility` (Boolean, **default OFF**) при ON открывает любому менеджеру компании все заказы/документы/комментарии/дашборд/организации/студентов **своей** компании; при OFF — сегодняшний 3-way скоуп без изменений. Флаг читается **свежим на каждый запрос** (`getCompanyTeamVisibility`), не из JWT — выключение ограничивает мгновенно. Добавлена под-роль `leader` (`User.managerRole`) с двумя полномочиями: флип переключателя + управление ростером (через leader-хаб `/manager/team`). Роль выдаёт только admin.

**Граница изоляции переехала** «менеджер↔менеджер» → **«компания↔компания»**: новый defense-in-depth инвариант — менеджер никогда не видит чужую компанию, в любом режиме.

### Поверхность (44 файла, +3364/−83)
- **Схема:** `Company.managerTeamVisibility Boolean @default(false)`, `User.managerRole String?` (additive-миграция `20260605233344_c8_manager_company_wide`).
- **JWT:** `SessionPayload.managerRole`; producer в [login/route.ts](../../../src/app/api/auth/login/route.ts) эмитит его с сохранением `'leader'` (gotcha C1).
- **Политика-ядро** [managerPolicy.ts](../../../src/lib/auth/managerPolicy.ts): `companyWideOrderFilter`, резолверы `managerOrderScope`/`managerDocumentScope`/`managerOrgScope`, `isManagerLeader`, `getCompanyTeamVisibility`; `canSeeOrder`/`canSeeDocument` получили `teamMode`.
- **Fan-out (mode-aware):** orders, documents(+download), messages, dashboard kpis/attention/events, organizations(list+detail), students, uploads(write), status(write); guards `requireManagerForOrg/Order`; `policy.ts` (canReadOrder/canAccessOrganization); `/api/comments` manager-ветка.
- **Leader backend:** guard `requireManagerLeader`; сервис+action `setTeamVisibility` (audited); admin-only `setManagerRole` (audited, privesc-граница); leader ростер-actions (reuse `invite.ts` + company-check `orgInLeaderCompany`).
- **UI:** `/manager/team` (toggle + ростер), admin-контрол роли на `/admin/users/[id]`, leader-only пункт «Команда» в навигации (через `app-shell.tsx`).

### Намеренно НЕ тронуто (decoupling «видимость ≠ таргетинг»)
- [notifications/manager.ts](../../../src/lib/notifications/manager.ts) (fan-out) и [api/notifications/route.ts](../../../src/app/api/notifications/route.ts) (лента) остаются scoped — включение тоггла НЕ рассылает спам всем менеджерам. Единственный прямой `managerOrderScopeFilter(` вне политики — `api/notifications/route.ts:28` (по дизайну).

---

## Верификация (гейты — все зелёные)

| Гейт | Результат |
|---|---|
| `npm run typecheck` | clean (на каждом из 20 кода-коммитов) |
| `npm run lint` | clean |
| `npm run build` | PASS — 63 роута, `/manager/team` присутствует |
| `npm run test:unit` | **1127** passed (139 файлов; +24 новых: политика mode-aware + toggle/role сервисы + authz server-actions) |
| Manager integration (live PG) | **87** passed (services.manager.* + auth.policy.manager-refactor 13, вкл. **cross-company isolation**) |
| Финальное RBAC-ревью (opus, adversarial) | ✅ APPROVED — все 8 инвариантов PASS, 0 critical |

**Ключевой инвариант доказан тестом:** [auth.policy.manager-refactor.test.ts](../../../src/__tests__/auth.policy.manager-refactor.test.ts) — менеджер компании A с `managerTeamVisibility=true` и пустым `managedOrgIds` видит чужой-орг заказ СВОЕЙ компании, но `canReadOrder` чужой компании → `false`.

---

## Гочи и уроки

1. **`companyId=null` → degrade-to-scoped, не deny-all.** `getCompanyTeamVisibility(null)` возвращает `false`, поэтому менеджер без компании никогда не попадает в company-wide ветку — остаётся на scoped-модели (а не белый экран). Мягче, чем опасался спек.
2. **Silent teamMode-default — главный риск fan-out.** `canSeeOrder(s, order)` без 3-го арга **typecheck-зелёный**, но молча scoped. Поймать может только grep/ревью, не tsc. Проверено grep'ом: все 7 manager-вызовов передают `teamMode`.
3. **JWT-producer gotcha (как C1):** забыть прокинуть `managerRole` в `signToken` = фича молча мертва на 7 дней. Покрыто regression-тестом в [auth.login.manager.test.ts](../../../src/__tests__/auth.login.manager.test.ts).
4. **Notifications scoped намеренно** — иначе ON = спам. Инвариант-тест notifications переосмыслен (видимость не расширяет рассылку).
5. **Ревью нашло пробел:** privesc-гарды (requireManagerLeader / requireAdmin на role-grant / orgInLeaderCompany) были корректны, но БЕЗ автотестов — ровно класс регрессий, который флагнул C1. Добавлены authz-тесты server-actions (forbidden_org company-boundary + guard-rejection).
6. **`prisma migrate dev` на host-PG** (cabinet:5432) сработал без shadow-DB проблем; `npm run gate` НЕ использовался (конфликт с host :5432, см. C5-урок) — integration гонялся напрямую `test:integration` против host.

---

## Остаётся (operator / staged rollout)

- **Default OFF** ⇒ ship поведенчески нейтрален: ничего не меняется, пока leader/admin не включит тоггл. Это и есть инструмент staged rollout (env-флаг не добавляли).
- **Браузерный smoke** не выполнен автоматически: требует `FEATURE_MANAGER_CABINET=1` (opt-in, default OFF) + seed leader-менеджера + логин. Логика доказана unit+integration+ревью; ручной smoke на staging — за оператором при включении.
- **Merge:** PR в `main` (как C3–C5, мердж между сессиями).

**Roadmap C-трек после C8:** остаются C6 (продуктовые решения + security-хвост — ждёт ваших решений) и C7 (staged rollout org+manager кабинетов — ops/runbook).
