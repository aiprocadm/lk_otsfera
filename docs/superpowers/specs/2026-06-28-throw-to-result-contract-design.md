# Spec — Привести бросающие сервисы к Result-контракту (§3)

**Дата:** 2026-06-28
**Автор:** агент (по итогам whole-repo аудита 2026-06-28)
**Статус:** черновик → на ревью владельцу

## 1. Проблема

CLAUDE.md §3 требует, чтобы доменные функции в `src/lib/services/**` возвращали **стабильный Result**:

```ts
Promise<{ ok: true; ...data } | { ok: false; error: ErrorCode }>
```

где `error` — стабильная lowercase-строка, а route-handler **только мапит** код в HTTP-статус.

Ряд сервисов нарушает контракт: вместо Result они **бросают `Error`** (часто со строковым префиксом вроде `'NOT_FOUND: ...'`), а вызыватели (роуты / server-actions) ловят исключение и **матчат строку** (`err.message.startsWith('NOT_FOUND')`). Это:

- размазывает маппинг ошибок по роутам (хрупкий string-match вместо дискриминированного union);
- даёт расхождение в кодах (UPPER `NOT_FOUND` / lower `company_not_found` / префикс `VALIDATION: ...`);
- содержит как минимум один реальный баг: `manager/teamVisibility` server-action **не ловит** `company_not_found` → необработанный throw валит server-action;
- в `partner/rateOverride` PUT-роут вызывает сервис **без** обработки → бросок становится 500 вместо 4xx.

## 2. Цель и не-цели

**Цель:** привести перечисленные сервисы к §3 Result-контракту с нормализованными lowercase-кодами; роуты/server-actions — тонкий маппинг; локализация кодов — через `errorMessageRu`.

**Не-цели:**
- Никаких изменений бизнес-логики — меняется только **форма** контракта ошибок (throw → return), коды переименовываются 1:1.
- Не трогаем hex-миграцию и прочий отложенный долг.
- Не вводим общий «framework» обработки ошибок — следуем уже существующему паттерну `admin/users/mutations.ts`.

## 3. Охват (подтверждён владельцем)

Шесть сервисов:

1. `src/lib/services/partner/leads.ts` — `createLead`, `withdrawLead`
2. `src/lib/services/partner/rateOverride.ts` — `setOrgCommissionRate`, `clearOrgCommissionRate`
3. `src/lib/services/manager/teamVisibility.ts` — `setTeamVisibility`
4. `src/lib/services/organization/team.ts` — `inviteMember`, `updateMemberRole`, `deactivateMember`, `reactivateMember` (перенос boundary-catch из server-action **в сервис**)
5. `src/lib/services/enrollments/submit.ts` — `submitEnrollmentRequest`
6. `src/lib/services/commission/lifecycle.ts` — `approveStatement`, `markStatementPaid`

## 4. Подход — boundary-catch Result (эталон: `admin/users/mutations.ts`)

```ts
export async function doX(...): Promise<{ ok: true; ...} | { ok: false; error: XErrorCode }> {
  try {
    // валидация ДО транзакции может делать прямой `return { ok: false, error }`
    // ошибки ВНУТРИ $transaction — throw типизированного класса (C4: иначе частичный коммит)
    return { ok: true, ... };
  } catch (e) {
    if (e instanceof XError) return { ok: false, error: e.code };
    throw e; // неожиданное — ре-throw, не глотаем
  }
}
```

- Для функций **без** `$transaction` допускается прямой ранний `return { ok: false, error }` без throw/catch — проще и читаемее.
- Для функций с `$transaction` — типизированный класс ошибки + boundary-catch (инвариант C4).
- Неожиданные ошибки всегда ре-throw.

## 5. Нормализация кодов (§3 lowercase)

| Сервис / функция | Было → Стало | HTTP |
|---|---|---|
| `partner/leads.createLead` | `ORG_OUT_OF_SCOPE` → `org_out_of_scope` | 422 |
| `partner/leads.withdrawLead` | `NOT_FOUND`→`not_found`; `ALREADY_REJECTED`→`already_rejected`; `ALREADY_PROMOTED`→`already_promoted` | 404 / 409 / 409 |
| `partner/rateOverride.setOrgCommissionRate` | `RATE_OUT_OF_RANGE`→`rate_out_of_range`; `NOT_FOUND`→`not_found` | 422 / 404 |
| `partner/rateOverride.clearOrgCommissionRate` | `NOT_FOUND`→`not_found` | 404 |
| `manager/teamVisibility.setTeamVisibility` | `company_not_found` (уже lower) | — (server-action → `{ok:false,error}`) |
| `organization/team.*` | коды уже lower (`requires_admin`, `already_member`, `last_admin_protected`, `self_action_forbidden`, `not_found`) | server-action map |
| `enrollments/submit.submitEnrollmentRequest` | `FORBIDDEN`→`forbidden`; `VALIDATION`→`validation` | 403 / 400 |
| `commission/lifecycle.approveStatement` | `NOT_FOUND`→`not_found`; `LIFECYCLE_VIOLATION`→`lifecycle_violation` | 404 / 409 |
| `commission/lifecycle.markStatementPaid` | `FORBIDDEN`→`forbidden`; `NOT_FOUND`→`not_found`; `LIFECYCLE_VIOLATION`→`lifecycle_violation` | 403 / 404 / 409 |

## 6. Локализация

В `src/lib/errors/messages.ts` добавить недостающие коды: `org_out_of_scope`, `already_rejected`, `already_promoted`, `rate_out_of_range`, `company_not_found`, `requires_admin`, `already_member`, `last_admin_protected`, `self_action_forbidden`, `lifecycle_violation`. (`forbidden` / `not_found` / `validation` уже есть.)

## 7. Изменения вызывателей

- **Роуты** (`src/app/api/**`): убрать `try/catch` + `err.message.startsWith(...)`; заменить на `if (!res.ok) return NextResponse.json({ error: res.error }, { status: map(res.error) })`. Эталон тонкого роута — `manager/documents/[id]/upload/route.ts`.
  - `partner/leads/route.ts`, `partner/leads/[id]/route.ts`
  - `partner/portfolio/[orgId]/rate/route.ts` (**добавить** маппинг — сейчас его нет)
  - `enrollments/route.ts`
  - `partner/finance/statements/[id]/route.ts`
- **Server-actions** (`src/server-actions/**`):
  - `organization/team.ts` — убрать try/catch + `instanceof OrgMemberError`; возвращать `res` напрямую.
  - `manager/teamVisibility.ts` — обрабатывать `{ ok: false, error: 'company_not_found' }` (фикс бага необработанного throw); сохранить существующий session-level guard `no_company`.
  - `admin/organizations.ts` (`setOrgRateOverrideAction`) — уже мапит на `not_found`/`rate_out_of_range`; упростить под Result.

## 8. Тестовая стратегия

- **Сервис-тесты**: заменить `.rejects.toThrow(/CODE/)` / `.rejects.toMatchObject({ code })` на `expect(res).toEqual({ ok: false, error: '<code>' })`; happy-path по-прежнему проверяет side-effects (Prisma state + audit).
- **Роут / server-action тесты**: обновить ожидаемые коды/статусы под нормализованные значения.
- **Добавить** недостающий тест для `enrollments/submit` (сейчас теста нет).
- Coverage-гейт §6 (100% per-glob на `services/**`, `app/api/**`, `server-actions/**`) держать: новые ветки Result покрываются.

## 9. Порядок реализации

Посервисно, каждый сервис **атомарно** (сервис → его роуты/server-actions → его тесты → `typecheck`):

1. `partner/rateOverride` — самый изолированный, server-action уже ждёт целевые коды → используем как образец.
2. `partner/leads`
3. `enrollments/submit` (+ новый тест)
4. `manager/teamVisibility` (фикс бага)
5. `commission/lifecycle`
6. `organization/team` (перенос boundary-catch в сервис — самый объёмный)

Финал: полный `npm run test:unit` + `typecheck` + `lint`. Integration (live PG) — где затронуты сервисы с БД (rateOverride, leads, team, lifecycle, enrollments) прогнать `npm run test:integration` перед PR.

## 10. Риски

- **Каскад изменений тестов**: переименование кодов задевает много ассертов. Митигация — посервисная атомарность + `typecheck` после каждого.
- **`organization/team`**: перенос catch в сервис меняет два слоя; тесты сервиса (assert на throw) и server-action (assert на Result) оба правятся.
- **Конфликт с PR #161**: оба PR трогают `messages.ts` аддитивно — тривиальный merge-conflict, разрешается объединением словаря.

## 11. Открытые вопросы

Нет (охват, нормализация кодов и судьба `organization/team` подтверждены владельцем).
