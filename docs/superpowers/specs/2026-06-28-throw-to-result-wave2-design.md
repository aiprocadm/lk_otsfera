# Spec — throw→Result контракт, волна 2 (§3)

**Дата:** 2026-06-28
**Автор:** агент (продолжение аудита 2026-06-28; волна 1 — `2026-06-28-throw-to-result-contract-design.md`)
**Статус:** черновик → исполняется (scope подтверждён пользователем: «вторая волна throw→Result»)

## 1. Проблема

Волна 1 привела 6 сервисов к §3 Result-контракту. Whole-repo аудит выявил ещё восемь доменных сервисов в `src/lib/services/**`, чьи **публичные функции бросают `Error`** вместо возврата Result. Это тот же долг, что и в волне 1:

- **Хрупкий string-match в роутах.** `partner/team`, `manager/leadLifecycle`, `commission/statement`, `enrollments/lifecycle` бросают **bare `Error('CODE: ...')`**, а роуты матчат `err.message.startsWith('CODE')`. Любая правка текста сообщения молча ломает маппинг статуса.
- **Boundary-catch размазан по server-actions.** `manager/invite.createAndAssignManager`, `manager/status`, `admin/partners`, `admin/organizations` бросают типизированный класс ошибки, который ловит **server-action** через `instanceof`. Контракт де-факто Result на границе action, но **сама доменная функция нарушает §3** (бросает, а не возвращает). Эталон правильной формы — `organization/team.ts` (волна 1, Task 7) и `admin/users/mutations.ts` (уже compliant): boundary-catch живёт **в сервисе**.

## 2. Цель и не-цели

**Цель:** привести восемь сервисов к §3; роуты/server-actions — тонкий маппинг `if (!res.ok) ...`; новые коды локализованы через `errorMessageRu`.

**Не-цели:**
- Бизнес-логика не меняется — только **форма** контракта (throw → return), коды нормализуются 1:1 в lowercase.
- Не вводим общий error-framework — следуем паттерну волны 1.
- Не трогаем `oneCSync/*` адаптеры (инфраструктура: HTTP/конфиг-ошибки легитимно бросают, это не доменный Result-контракт).

## 3. Охват

### Уже compliant — НЕ трогаем (только подтверждаем)
- `admin/users/mutations.ts` — все 4 функции уже оборачивают throw в boundary-catch и возвращают Result. **Долг — только локализация** трёх кодов (см. §6).
- `manager/invite.ts` — `deactivateAssignment`, `reactivateAssignment` уже возвращают Result.

### Flavor 1 — bare `Error` → Result (Pattern A; высший приоритет)
Все броски **до** `$transaction` → прямой `return { ok: false, error }`.

1. `partner/team.ts` — `inviteMember`, `assignOrgs`, `deactivateMember`
2. `manager/leadLifecycle.ts` — `assignLead`, `setLeadStatus`, `promoteLead`, `rejectLead`
3. `commission/statement.ts` — `calculateStatementForPartner`
4. `enrollments/lifecycle.ts` — `approveEnrollment`, `rejectEnrollment`, `markProvisioned`

### Flavor 2 — перенос boundary-catch в сервис (Pattern B)
Типизированный класс уже есть; убрать `instanceof`-catch из server-action, вернуть Result из сервиса.

5. `manager/invite.ts` — `createAndAssignManager` (бросает `ManagerInviteError` внутри `$transaction`)
6. `manager/status.ts` — `transitionOrderStatus` (бросает `ManagerStatusError` до tx; можно Pattern A)
7. `admin/partners.ts` — `updatePartner`, `deactivatePartner`, `reactivatePartner`, `createPartnerWithAdmin` (бросает `AdminPartnerError` внутри `$transaction`)
8. `admin/organizations.ts` — `updateOrganization` (бросает `AdminOrgError` внутри `$transaction`)

## 4. Подход (эталоны: `admin/users/mutations.ts`, волна-1 `organization/team.ts`)

**Pattern A** — проверки до транзакции → прямой `return { ok: false, error }`.

**Pattern B** — typed error class + boundary-catch в самой функции:
```ts
export async function doX(...): Promise<{ ok: true; ... } | { ok: false; error: XCode }> {
  try {
    return { ok: true, ...(await prisma.$transaction(async (tx) => { /* throws XError */ })) };
  } catch (e) {
    if (e instanceof XError) return { ok: false, error: e.code };
    throw e; // неожиданное — ре-throw
  }
}
```
Неожиданные ошибки всегда ре-throw, никогда не глотаем.

## 5. Нормализация кодов (§3 lowercase)

| Сервис / функция | Было → Стало | HTTP |
|---|---|---|
| `partner/team.inviteMember` | `ORG_OUT_OF_SCOPE`→`org_out_of_scope`; `EMAIL_TAKEN`→`email_taken` | 422 / 409 |
| `partner/team.assignOrgs` | `ORG_OUT_OF_SCOPE`→`org_out_of_scope` | 422 |
| `partner/team.deactivateMember` | `NOT_FOUND`→`not_found`; `LAST_ADMIN`→`last_admin_protected` (reuse) | 404 / 409 |
| `manager/leadLifecycle.*` | `NOT_FOUND`→`not_found`; `LIFECYCLE_VIOLATION`→`lifecycle_violation` | 404 / 409 |
| `commission/statement.calculate…` | `PARTNER_NOT_FOUND`→`partner_not_found`; `PERIOD_OVERLAP`→`period_overlap` | 404 / 409 |
| `enrollments/lifecycle.*` | `NOT_FOUND`→`not_found`; `LIFECYCLE_VIOLATION`→`lifecycle_violation`; `VALIDATION`→`validation` (reuse) | 404 / 409 / 400 |
| `manager/invite.createAndAssignManager` | коды уже lower (`org_not_found`, `user_not_found`, `role_conflict`, `already_assigned`) | server-action map |
| `manager/status.transitionOrderStatus` | коды уже lower (`invalid_status`, `forbidden`, `not_found`) | server-action map |
| `admin/partners.*` | коды уже lower (`not_found`, `duplicate_slug`, `duplicate_email`, `forbidden`) | server-action map |
| `admin/organizations.updateOrganization` | коды уже lower (`not_found`, `forbidden`) | server-action map |

**Решение по `LAST_ADMIN`:** переиспользуем существующий `last_admin_protected` (есть RU-строка). Текущий caller матчит `.startsWith('LAST_ADMIN')` → переписываем на Result, так что рефактор вызывателя обязателен.

## 6. Локализация — добавить в `src/lib/errors/messages.ts`

Отсутствующие коды (12):

```ts
  email_taken: 'Пользователь с такой почтой уже зарегистрирован.',
  org_not_found: 'Организация не найдена.',
  user_not_found: 'Пользователь не найден.',
  role_conflict: 'Роль пользователя конфликтует с этим действием.',
  already_assigned: 'Пользователь уже назначен на эту организацию.',
  invalid_status: 'Недопустимый статус.',
  partner_not_found: 'Партнёр не найден.',
  period_overlap: 'Период пересекается с существующей ведомостью.',
  duplicate_slug: 'Партнёр с таким URL-идентификатором уже существует.',
  duplicate_email: 'Пользователь с такой почтой уже существует.',
  admin_role_via_ui: 'Роль администратора не выдаётся через интерфейс.',
  role_transition_forbidden: 'Такой переход роли запрещён.'
```

(`admin_role_via_ui`, `role_transition_forbidden`, `duplicate_email` закрывают существующий localization-gap `admin/users` — функции уже Result, но строк не было.)

## 7. Изменения вызывателей

- **Роуты** (`src/app/api/**`): убрать `try/catch` + `err.message.startsWith(...)`; `if (!res.ok) return NextResponse.json({ error: res.error }, { status: map(res.error) })`.
  - `partner/team/route.ts`, `partner/team/[userId]/route.ts`
  - `manager/leads/[id]/route.ts` (убрать локальный `mapError`)
  - `partner/finance/statements/route.ts` (POST — добавить маппинг `partner_not_found`→404)
  - `enrollments/[id]/route.ts` (убрать локальный `mapError`)
- **Server-actions** (`src/server-actions/**`): убрать `instanceof XError`-catch, возвращать `res` напрямую.
  - `admin/manager.ts` (createAndAssignManager), `manager/transitionOrderStatus.ts`, `admin/partners.ts`, `admin/organizations.ts`

## 8. Тестовая стратегия

- Сервис-тесты: `.rejects.toThrow(/CODE/)` → `expect(res).toEqual({ ok: false, error: '<code>' })`; happy-path читает `res.<field>` + `res.ok`.
- Роут/server-action тесты: обновить коды/статусы под нормализацию; mock'и сервисов резолвят Result (`mockResolvedValue({ ok: false, error })`) вместо `mockRejectedValue`.
- Coverage-гейт §6 (100% per-glob) держать — новые Result-ветки покрываются.
- Integration (live PG) по затронутым сервисам прогнать перед PR.

## 9. Порядок (посервисно, атомарно: сервис → вызыватели → тесты → typecheck)

**Phase 1 (Flavor 1):** локализация → `partner/team` → `manager/leadLifecycle` → `commission/statement` → `enrollments/lifecycle`.
**Phase 2 (Flavor 2):** `manager/status` → `manager/invite` → `admin/organizations` → `admin/partners`.
**Финал:** `npm run test:unit` + `typecheck` + `lint`; integration где затронут PG.

## 10. Риски

- **Каскад тестов** — переименование кодов задевает много ассертов; митигация — посервисная атомарность + typecheck после каждого.
- **`commission/statement`** имеет внутренний catch P2002 (unique-violation) внутри tx — не трогать его; конвертировать только два pre-tx throw в pre-tx return.
- **Flavor 2 двухслойный** (сервис assert на throw → на Result; server-action assert на Result уже есть) — оба слоя тестов правятся.

## 11. Открытые вопросы

Нет — scope подтверждён выбором пользователя; нормализация и эталоны взяты из волны 1.
