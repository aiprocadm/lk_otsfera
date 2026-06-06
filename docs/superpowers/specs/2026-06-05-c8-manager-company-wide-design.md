# C8: менеджерский кабинет → company-wide видимость + роль руководителя — design

**Дата:** 2026-06-05 · **Статус:** согласовано (mixed-mode toggle + полный leader-хаб + default OFF — выбор пользователя) · **Трек:** C / **C8** из [completion-roadmap](2026-06-02-completion-roadmap.md) · **Тип:** **поведение-меняющий RBAC** + новая роль (НЕ move-only).

Аналог-предшественник: [C1 org finance + leader](2026-06-04-organization-finance-hub-design.md) (PR #89) — оттуда наследуем паттерн под-роли (`roleInOrg` String, JWT-producer, privesc-граница). По роадмапу C8 идёт сразу после Чата v1 (шаг 2), т.к. чат вводит командную модель видимости.

---

## 1. Цель и не-цели

**Цель.** Перевести видимость менеджера с жёсткого per-manager скоупинга на **переключаемый** company-wide режим и ввести под-роль `leader` (руководитель).

- **Видимость — mixed mode.** Новый флаг `Company.managerTeamVisibility`. ON → любой менеджер компании видит ВСЕ заказы/документы/комментарии/дашборд/организации/студентов своей компании. OFF → сегодняшний 3-way OR. Флип — решением leader/admin в рантайме.
- **Роль `leader`.** Два полномочия (выбор пользователя): (1) флип переключателя видимости, (2) управление ростером (назначать/инвайтить/деактивировать менеджеров на организациях).
- **Сдвиг границы изоляции.** Defense-in-depth линия переезжает с «менеджер ↔ менеджер» на **«компания ↔ компания»**: новый инвариант — менеджер НИКОГДА не видит заказы чужой компании, в любом режиме.

**Не-цели (явно вне объёма):**
- **НЕ глобальная** видимость через все компании — строго в пределах `session.companyId`. «Company-wide» = `{ companyId: session.companyId }`, а не «все заказы в системе».
- **НЕ меняем notification-таргетинг.** `notifications/manager.ts` остаётся scoped. Видимость ≠ рассылка: company-wide режим даёт «могу зайти и посмотреть», но НЕ «пингуют по каждому заказу компании». Иначе включение режима = спам всем менеджерам.
- **НЕ даём** leader'у переназначение заказов, финансовые агрегаты, отдельный team-дашборд (пользователь эти опции не выбрал — YAGNI).
- **НЕ env-флаг.** DB-переключатель (default OFF) и есть инструмент staged rollout. Новый `FeatureFlag` не добавляем.
- **leader НЕ выдаёт роль leader** — только admin (privesc-граница, как `requires_admin` в C1).

---

## 2. Ключевые решения

1. **Mixed mode через поле на `Company`.** `Company.managerTeamVisibility Boolean @default(false)`. Едет на уже существующем company-партиционировании (`User.companyId` 105, `Order.companyId` 424 — required, `Organization.companyId`). Никакой новой settings-таблицы. Гранулярность **per-company**: одно-компанийный деплой ⇒ фактически глобальный тумблер; мульти-компани ⇒ корректная изоляция per company.

2. **Default OFF (опт-ин).** Shipping C8 **ничего не меняет** в поведении, пока leader/admin не включит. Согласуется с формулировкой «включается по решению руководителя или админа» и с безопасным staged rollout.

3. **Флаг читается СВЕЖИМ на запрос, НЕ зашивается в JWT.** Обоснование безопасности: выключение режима должно **мгновенно** ограничивать доступ. JWT живёт 7 дней — если зашить флаг в токен, то «выключил, но менеджеры ещё неделю видят всё до перелогина» = security-лаг на самой чувствительной операции. Цена решения — один индексированный read `Company` на менеджерский запрос (мемоизируем per-request). Это приемлемо.

4. **Политика остаётся pure-функциями + параметр `teamMode`.** Не превращаем `managerPolicy` в async-с-БД. Вместо этого: чистые функции принимают `teamMode: boolean`, один резолвер выбирает ветку; единственный DB-read изолирован в хелпере `getCompanyTeamVisibility(prisma, companyId)`. Сервис читает флаг один раз сверху и прокидывает. Тестируемо без Postgres (unit), как сегодня.

5. **Роль leader: `User.managerRole String?`** (`null` = обычный менеджер, `'leader'` = руководитель). Additive-миграция. У менеджеров нет membership-таблицы (они — `User` с `role='manager'` + строки `OrganizationManager`), поэтому под-роль живёт прямо на `User`, в отличие от `OrganizationUser.roleInOrg`. В JWT добавляем `managerRole`; `companyId` **уже** эмитится ([login/route.ts:133](../../../src/app/api/auth/login/route.ts)).

6. **Полный leader-хаб `/manager/team`** (toggle + roster). Roster переиспользует существующие admin-сервисы [`manager/invite.ts`](../../../src/lib/services/manager/invite.ts) и [`manager/team.ts`](../../../src/lib/services/manager/team.ts) (сегодня обслуживают `/admin/organizations/[id]`), открытые теперь leader'у. Admin выдаёт роль `leader` из admin-кабинета.

7. **Notification fan-out остаётся scoped** (решение-следствие не-цели). Инвариант-тест [`notifications.invariant.test.ts`](../../../src/__tests__/notifications.invariant.test.ts) переосмысляется: «кого уведомляем» по-прежнему = assigned + org-managers, не «вся компания».

8. **Аудит на каждую привилегированную мутацию** (CLAUDE.md §12): флип видимости и выдача/снятие роли пишут `AuditLog` (`action/entity/entityId/userId/meta{from,to}`).

---

## 3. Дизайн по компонентам

### 3.1 Схема + миграция (additive, безопасная)
```prisma
model Company { … managerTeamVisibility Boolean @default(false) }
model User    { … managerRole String? }   // null | 'leader'
```
Новая миграция через `prisma migrate` (+`prisma:generate`). Backfill не нужен (дефолты). Применённые миграции не править (CLAUDE.md §11).

### 3.2 JWT (login + тип)
- [`jwt.ts`](../../../src/lib/auth/jwt.ts): `SessionPayload += managerRole?: ManagerRole | null`, `type ManagerRole = 'leader'`.
- [`login/route.ts`](../../../src/app/api/auth/login/route.ts) ветка `if (user.role === 'manager')` (122–128): выбрать `managerRole`, добавить `...(managerRole ? { managerRole } : {})` в `signToken`. **Gotcha C1** (предупреждение прямо рядом, строки 112–113): не схлопнуть значение при маппинге, иначе роль молча мертва на весь срок токена. Покрыть regression-тестом (как C1).

### 3.3 `managerPolicy.ts` — mode-aware (единственная точка решения)
Новые/изменённые:
- `companyWideOrderFilter(session) → { companyId: session.companyId ?? '\0' }` (нет companyId ⇒ deny-all, fail-safe).
- `managerOrderScope(session, teamMode) → teamMode ? companyWide : <текущий 3-way>`. Сегодняшний `managerOrderScopeFilter` остаётся как OFF-ветка.
- `canSeeOrder(session, order, teamMode)`: при `teamMode` ⇒ `order.companyId === session.companyId`; иначе текущая логика. Тип аргумента += `companyId`; вызывающие добавляют `companyId` в `select`.
- Аналогично document/org/students-фильтры: company-wide ветка = `{ companyId }` вместо `{ … in managedOrgIds }`.
- `isManagerLeader(session) → session.managerRole === 'leader'`.
- `getCompanyTeamVisibility(prisma, companyId): Promise<boolean>` — единственный DB-read (узкий select `managerTeamVisibility`), per-request memo.

### 3.4 Fan-out (вызывающие — читают флаг, зовут резолвер)
Списочные reads: [orders.ts:47](../../../src/lib/services/manager/orders.ts), [messages.ts:59](../../../src/lib/services/manager/messages.ts), dashboard [kpis:22](../../../src/lib/services/manager/dashboard/kpis.ts)/[attention:33](../../../src/lib/services/manager/dashboard/attention.ts)/[events:25](../../../src/lib/services/manager/dashboard/events.ts), [documents.ts:55](../../../src/lib/services/manager/documents.ts), [organizations.ts:39](../../../src/lib/services/manager/organizations.ts), [students.ts:48](../../../src/lib/services/manager/students.ts), [api/notifications/route.ts:28](../../../src/app/api/notifications/route.ts).
Point-checks (`canSee*`): [orders.ts:111](../../../src/lib/services/manager/orders.ts), [documents.ts:122](../../../src/lib/services/manager/documents.ts), [uploads.ts:130](../../../src/lib/services/manager/uploads.ts), [status.ts:63](../../../src/lib/services/manager/status.ts), [organizations.ts:63](../../../src/lib/services/manager/organizations.ts), [requireRole.ts:78,110](../../../src/lib/auth/requireRole.ts), [policy.ts:32,70](../../../src/lib/auth/policy.ts), [api/comments/route.ts:121](../../../src/app/api/comments/route.ts).
Паттерн на каждый: `const teamMode = await getCompanyTeamVisibility(prisma, session.companyId)` сверху → передать в резолвер/`canSee*`.

### 3.5 Leader-хаб `/manager/team` (новый, leader-gated)
- Guard `requireManagerLeader()` в [`requireRole.ts`](../../../src/lib/auth/requireRole.ts) (по образцу `requireOrganizationAdminOrLeader`).
- Toggle видимости → server-action `setTeamVisibility(on)` (leader|admin, audited).
- Roster: список менеджеров компании + назначения; assign/invite/deactivate переиспользуют `invite.ts`/`team.ts` (расширить гейт с admin-only до admin|leader). Sibling-паттерн (CLAUDE.md §4) — компоненты `manager-team-*`.
- Навигация: пункт «Команда» в [`navigation/cabinet.ts`](../../../src/lib/navigation/cabinet.ts), виден только leader.
- Middleware `/manager` уже режет по `role='manager'`; leader-sub-gate — на уровне route/page (как org-leader; defense-in-depth принцип #6).

### 3.6 Admin выдаёт роль leader
- В admin user-management — контрол set/clear `managerRole`. Server-action `setManagerRole(userId, role)`, **admin-only**, audited. Privesc-инвариант: leader НЕ может вызвать.

### 3.7 Аудит
`manager.team_visibility.set` (entity `Company`, meta `{from,to}`); `manager.role.set` (entity `User`, meta `{from,to}`).

---

## 4. Тестовая стратегия (defense-in-depth, перепрошивка)

- **Unit `auth.managerPolicy`:** `teamMode=false` ⇒ сегодняшний 3-way (регресс не двинулся); `teamMode=true` ⇒ `{ companyId }`-фильтр; **cross-company deny** в обоих режимах; `isManagerLeader`.
- **Integration (rewrite)** [`auth.policy.manager-refactor`](../../../src/__tests__/auth.policy.manager-refactor.test.ts) + `services.manager.{orders,documents,messages,dashboard,organizations,students}`: каждый сценарий в двух режимах. OFF — текущая per-manager изоляция держится. ON — менеджер видит ВСЕ заказы своей компании, но **по-прежнему НЕ видит заказы другой компании** (новая линия). Нужен фикстур со 2-й компанией.
- **Новые тесты:** toggle-мутация (флип + audit-строка); role-grant privesc (non-admin/leader ⇒ forbidden); guard `requireManagerLeader`.
- **Notifications:** зафиксировать, что таргетинг остаётся scoped даже при ON (видимость не расширяет рассылку).
- **Гейты:** `typecheck` + `lint` (вкл. eslint `no-restricted-imports` из C3) + `test:unit` + `test:integration` (L2.5 gate) + `build` + субагент-ревью RBAC-инвариантов.

---

## 5. Риски и крайние случаи

- **`companyId` пуст у менеджера** ⇒ company-wide фильтр `{ companyId: '\0' }` не матчит ничего (`Order.companyId` required) ⇒ deny-all. Fail-safe (а не fail-open), но фича не работает — это конфиг-ошибка. Добавить guard/проверку сидов; отметить в close-out.
- **Notification spam** — снят decoupling'ом (решение 7): рассылка остаётся scoped.
- **Stale toggle** — снят чтением свежего флага (решение 3), не из JWT.
- **Privesc** — только admin выдаёт `leader`; leader не само-promote. Покрыто тестом.
- **Историческая comments-ветка** в point-checks при ON не нужна, но безвредна; ключевое — селекты вызывающих должны включать `companyId` (иначе `canSeeOrder` при ON не сможет сравнить).
- **Три точки RBAC** (CLAUDE.md §4) — все mode-aware; cross-company — новая защитная линия в service-слое.
- **Миграция** additive, без backfill; не править применённые (CLAUDE.md §11).

---

## 6. Открытые вопросы

Минимальные. Гранулярность (per-company), default (OFF), freshness (per-request), объём UI (полный leader-хаб) и полномочия leader (toggle + roster) — закрыты в Q&A. Кеширование company-флага — per-request memo (не кросс-запросное), чтобы флип был мгновенным.
