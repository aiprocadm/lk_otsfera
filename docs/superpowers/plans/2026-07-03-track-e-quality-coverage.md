# Track E — Сквозное качество и покрытие — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (или executing-plans). Шаги — чекбоксы `- [ ]`. Трек **тестовый**: прод-поведение не меняем. Настоящий баг → **отдельный** коммит `fix(...)`, не в куче с тестами.

**Goal:** Закрыть пробелы качества поверх закрытых A–G: (E2) единый именованный security-набор инвариантов, (E3) сквозные E2E критических путей, (E1) добор покрытия + фаза-2 (render-харнесс + logic-хвост), (E4) детерминизм/отсутствие сети + стабильные снапшоты, (E5) отчёт. Всё держит `npm run gate` и `npm run test:coverage`.

**Architecture:** Vitest self-partitioning — файл считается integration ⟺ содержит `new PrismaClient(` → гоняется в `test:integration` → в `gate`. Значит «security-набор в gate» = сделать новые инварианты integration-tier + манифест-гардрейл (никакой CI-обвязки). E2E-пути — integration-тесты с замоканными внешними адаптерами. Фаза-2 — jsdom + @testing-library поверх node-only vitest через per-file `// @vitest-environment jsdom`.

**Tech Stack:** Next.js 15 · Prisma 5 + PostgreSQL (live localhost:5432) · Vitest 2.1 (`@vitest/coverage-v8`) · Playwright · jsdom + @testing-library/react (добавляется в E1).

---

## Окружение (решения владельца, 2026-07-03)

- **Тест-БД:** живой локальный Postgres `127.0.0.1:5432/cabinet`; worktree `ecstatic-maxwell-48210e` провижится (`npm ci` + `.env` из соседнего клона + `prisma generate`), верификация здесь.
- **Фаза-2:** render-харнесс (jsdom + @testing-library/react) + logic-хвост (React-хуки + email `.tsx` + `useFormAction`) до 100% с гейтом на эти globs; остаток `components/**` + `app/**/*.tsx` — фаза-3 (задокументировать).
- `gate` Docker-путь заблокирован конфликтом порта 5432 (host PG занимает порт) → авторитетная проверка = `test:integration` + `test:coverage` против живого PG; `gate` пробуем, при блоке фиксируем причину в E5.

---

## Карта пробелов (валидирована explore-агентом + существованием файлов)

| ID | Область | Вердикт | Действие |
|---|---|---|---|
| c3 | IDOR Order/Document/Payment/CommissionStatement | ✅ покрыто | ре-верификация |
| — | IDOR Task (внутр.), Organization by-id | ✅ покрыто (`services.tasks.isolation`, `services.organizationCard.integration`) | ре-верификация |
| **E2-A** | IDOR Lead cross-partner (by-id + list) | ⚠️ enforced, untested | **новый тест** |
| c1 | Сокрытие комиссии в org-кабинете (статик) | ✅ покрыто | ре-верификация |
| **E2-B** | IDOR + сериализатор partner↔partner (finance/statements/xlsx/pdf) | ⚠️ guard-only | **новый тест** |
| E2 | Сокрытие внутреннего у student | ✅ moot (только bridge-token) | зафиксировать |
| **E2-C** | Внутренний `Comment` не утекает клиенту (list/detail) | ⚠️ только create-time | **новый тест** (сначала верифицировать нюанс org-comment) |
| **E2-D** | Манифест security-набора (единая точка + анти-удаление) | — | **новый гардрейл** |
| c2/f/accessProfile | multirole, company-scope, профили own/assigned/all | ✅ покрыто | ре-верификация |
| **E3-a** | Order lifecycle new→assign→waiting_client→complete(all)→reopen | ❌ missing | **новый E2E** |
| **E3-e** | 1С payment-import идемпотентность | ❌ missing | **новый E2E** |
| **E3-c** | Commission calc→approve→XLSX (override › историч. › дефолт; refund carry) | ⚠️ piecewise | **новый E2E** |
| **E3-d** | Notifications fan-out (email всегда + opt-in + идемпотентность) | ⚠️ piecewise | **новый E2E** |
| **E3-b** | Funnel lead→стадии→промоут в Order | ⚠️ piecewise | **новый E2E** |
| accessProfile | assigned/all end-to-end | ✅ покрыто (`services.manager.leads.scope.integration`) | ре-верификация |
| **E1** | phase-1 100% логика | ✅ держится | сохранить |
| **E1** | phase-2 (UI/hooks-хвост) | ⏸ нет харнесса | харнесс + logic-хвост |
| **E4** | детерминизм / без сети / снапшоты | mostly clean; `hooks.useThreadPolling` под аудит | sweep |

---

## E2 — Единый security-набор (порядок работы #2: делаем первым)

Существующие `c1/c2/c3/f/f4` **оставляем** (уже в gate). Добавляем 3 инварианта-гэпа + манифест. Naming: новые файлы `security.*` (discoverability), существующие не переименовываем (churn/конфликты).

### Task E2-A: `security.idor-lead.integration.test.ts`

**Files:** Create `src/__tests__/security.idor-lead.integration.test.ts`. Читать для контракта: `src/lib/services/partner/leads.ts` (`getLead`, `withdrawLead`), `src/app/api/partner/leads/[id]/route.ts`, `src/lib/services/manager/leads.ts` (scope).

- [ ] **Шаг 1 — фикстуры (beforeAll):** 2 тенанта. Partner A (+ orgA + leadA, `partnerId=A`), Partner B (+ orgB + leadB). `const STAMP = Date.now()` только для уникальности имён; ассерты — на детерминированных id/датах.
- [ ] **Шаг 2 — service IDOR:** `getLead(prisma,{leadId:leadA, partnerId:B})` → `null`; positive: `partnerId:A` → `leadA`. `withdrawLead` cross-partner → `not_found`/`null` без мутации (проверить статус после).
- [ ] **Шаг 3 — list-level:** список лидов партнёра B не содержит `leadA` (и наоборот); positive control — свой лид присутствует.
- [ ] **Шаг 4 — manager cross-company:** менеджер компании B (scope) не видит лид компании A (если у lead есть companyId/organizationId-привязка) — через `src/lib/services/manager/leads.ts`.
- [ ] **Шаг 5 — cleanup (afterAll)** + `$disconnect`.
- [ ] **Verify:** `npx vitest run --mode=integration src/__tests__/security.idor-lead.integration.test.ts` — PASS. Adversarial: временно ослабить фильтр `partnerId` в копии проверки → тест должен ПАДАТЬ (доказать, что не vacuous).

### Task E2-B: `security.partner-commission-idor.integration.test.ts`

**Files:** Create `src/__tests__/security.partner-commission-idor.integration.test.ts`. Контракт: `src/app/api/partner/finance/route.ts`, `.../finance/statements/[id]/route.ts`, `.../statements/[id]/xlsx/route.ts`, `.../pdf/route.ts` (проверить точные пути), `src/lib/services/partner/finance.ts`.

- [ ] **Шаг 1 — фикстуры:** Partner A со стейтментом+items; Partner B без доступа к A.
- [ ] **Шаг 2 — route-level IDOR:** GET statements/[stmtA] / xlsx / pdf в сессии партнёра B → 404 (не 200, тело не отдаётся). Мок `getSession` → B.
- [ ] **Шаг 3 — сериализатор-контракт (позитивная сессия A):** GET `/api/partner/finance` и `/statements/[id]` для A → JSON содержит ТОЛЬКО свою комиссию; `JSON.stringify(body)` **не** содержит запрещённых токенов внутренней кухни: `cost`, `себестоим`, `kpi` менеджера, `managerId`, внутренний `Comment`, ставка/комиссия ЧУЖОГО партнёра. (Свою `rate`/`commission` — можно; это его данные.)
- [ ] **Шаг 4 — Verify** + adversarial (подмешать чужой токен в мок-ответ → тест падает).

### 🔴 НАЙДЕННЫЙ БАГ (E2-C investigation, 2026-07-03) — cross-tenant утечка комментариев партнёру

**Разрешение нюанса:** `Comment` в этом коде — НЕ «внутренний» канал, а **разговор клиент↔менеджер по заказу**: org/partner/manager все пишут (`POST /api/comments`) и читают его; менеджерский пост шлёт `notifyOrgUsers(manager_replied)`. Модель `Comment` не имеет флага internal/external. → Формулировка CLAUDE.md §3.4 «Comment внутренние, скрыты от клиентов» **не соответствует коду**. Реальный инвариант к защите — **cross-tenant/cross-owner изоляция** комментариев, а не «клиент не видит Comment».

**Баг (подтверждён, reachable):** [`src/components/partner/org-comments-tab.tsx:14`](../../../src/components/partner/org-comments-tab.tsx) — `where: { order: { companyId: org.companyId } }`. `Company` = юрлицо-**продавец** (общее для ВСЕХ клиентов). Значит партнёр на `/partner/portfolio/[orgId]?tab=comments` видит комментарии **всех заказов всех организаций и всех партнёров** этой компании-продавца. Соседние вкладки той же страницы (`EmployeesTab`, `HistoryTab`) правильно скоупятся `organizationId: orgId`. Единственный сайт (sweep по `companyId` в partner-контуре чист: `orgCard.ts:39`/`orgDocuments.ts:38` доп.-пиннятся `partnerId`).

**Fix (отдельный `fix(security):` коммит, НЕ в куче с тестами):** `where: { order: { organizationId: orgId } }`, убрать лишний `org.companyId`-lookup (ветка «Нет данных» уходит; пустой список ловит существующий `comments.length === 0`).

### Task E2-C-FIX: `fix(security)` — org-comments-tab scope

**Files:** Modify `src/components/partner/org-comments-tab.tsx`.
- [ ] **Шаг 1 (RED):** написать интеграционный регресс в `security.idor-comments.integration.test.ts` (см. Task E2-C ниже): партнёр P1 (orgA) не видит комментарий заказа orgB той же компании. Прогнать → **падает** на текущем коде (доказать утечку).
- [ ] **Шаг 2 (FIX):** заменить фильтр на `organizationId: orgId`; удалить companyId-lookup.
- [ ] **Шаг 3 (GREEN):** регресс зелёный; positive control (P1 видит комментарий своего orgA-заказа) держится.
- [ ] **Шаг 4:** `fix(security): scope partner org-comments tab to organization, not seller company` — отдельный коммит.

### Task E2-C: `security.idor-comments.integration.test.ts`

**Files:** Create `src/__tests__/security.idor-comments.integration.test.ts`. Контракт: `org-comments-tab.tsx`, `organization/dashboard.ts:185` (уже корректно `order:{organizationId}`), `app/organization/orders/[id]/page.tsx:44` (own-order, same-tenant).

- [ ] **Шаг 1 — cross-tenant (регресс к багу):** 2 организации orgA/orgB под ОДНОЙ компанией-продавцом; заказ+Comment в каждой. Партнёр orgA НЕ видит комментарий заказа orgB (после fix — зелёно; до fix — красно). Symmetry + positive control (свой виден).
- [ ] **Шаг 2 — same-tenant sanity:** org видит комментарии ТОЛЬКО своих заказов (`app/organization/orders/[id]` scope), не чужих.
- [ ] **Шаг 3 — статик-гардрейл:** ни один клиентский comment-read не скоупится по `companyId` (продавец) вместо `organizationId`/`partnerId` — grep-guard, чтобы регресс не вернулся.
- [ ] **Шаг 4 — Verify** + adversarial (вернуть `companyId` → падает).

> **Примечание для владельца:** обновить CLAUDE.md §3.4 — заменить неверное «Comment внутренние/скрыты от клиентов» на реальную модель (Comment = разговор клиент↔менеджер; инвариант = cross-tenant изоляция). Сделать после подтверждения владельцем (правка контракта-документа).

### Task E2-D: `security.suite.manifest.test.ts`

**Files:** Create `src/__tests__/security.suite.manifest.test.ts` (unit — статик, без Prisma).

- [ ] **Шаг 1:** массив `SECURITY_INVARIANTS` = [`c1.*`, `c2.*`, `c3.*`, `f.list-cross-tenant`, `f4.*`, `security.idor-lead`, `security.partner-commission-idor`, `security.internal-comments-hiding`, `security.redirect`]. Ассерт: каждый файл существует.
- [ ] **Шаг 2:** для integration-инвариантов — исходник содержит `new PrismaClient(` (доказательство, что попадёт в `test:integration`/`gate`); для статических — помечены как unit-guardrail. Тест **падает**, если инвариант удалён/переименован → единая именованная точка набора.
- [ ] **Шаг 3 — Verify:** `npx vitest run src/__tests__/security.suite.manifest.test.ts`.

**Блок-верификация E2:** `npm run test:integration` + затронутые unit зелёные; ре-прогон c1/c2/c3/f/f4.

---

## E3 — Сквозные E2E критических путей

Все — `*.integration.test.ts`, внешние системы замоканы (Resend/Telegram/Max/S3/ClamAV/СДО/1С). Детерминированные даты.

### Task E3-a: `e2e.order-lifecycle.integration.test.ts`
Контракт: `src/lib/services/manager/orderLifecycle.ts` (state machine + completion guard), server-actions статусов, self-assign.
- [ ] create → авто-тред создан; assign/self-assign (self-assign закреплённой за другим → отказ); `waiting_client` c причиной; **completion заблокирован**, пока не выполнены все условия (сканы/бухгалтерия/удостоверения) → ошибка валидации; выполнить условия → `completed`; **reopen** `completed→in_progress` разрешён и логируется (`AuditLog`). Verify + adversarial (снять одно условие → complete падает).

### Task E3-b: `e2e.funnel-promotion.integration.test.ts`
Контракт: `src/lib/services/funnel/board.ts` (`moveFunnelLead`, `promoteLeadToOrder`).
- [ ] lead new→in_review→qualified (легальные переходы; нелегальный → отказ) → promoted_to_order с organizationId → создан `Order`, `lead.promotedOrderId` связан, статус terminal. Verify.

### Task E3-c: `e2e.commission-lifecycle.integration.test.ts`
Контракт: `commission/{calculator,rateResolve,statement,lifecycle}.ts`, `worker/processors/generate-commission-xlsx.ts`, `f4.org-rate-history`.
- [ ] Платежи (вкл. refund) за месяц → расчёт: приоритет ставки **org-override › историч.@paidAt › дефолт партнёра**; approve; XLSX — строки (Организация·Дата·Назначение·Сумма·Комиссия) + итог. Refund после выплаченной комиссии → перенос минусом в следующий период (`CommissionCorrection` carry-over). Идемпотентность пересчёта (партиал-уникальный индекс). Verify + adversarial (сдвинуть `paidAt` → другая историч. ставка).

### Task E3-d: `e2e.notifications-delivery.integration.test.ts`
Контракт: `src/lib/notifications/**` (dispatch, `channels/preferences.ts`), `worker/processors` dispatch, `notificationJobId`.
- [ ] Событие → **email всегда** + opt-in каналы по `notificationChannels` пользователя (Telegram off → пропущен, email отправлен); все транспорты замоканы. Идемпотентность: повторный dispatch того же jobId → без дублей. Verify.

### Task E3-e: `e2e.payment-import-idempotency.integration.test.ts`
Контракт: `src/lib/services/import/**` (Card51 parser), `Payment.externalId @unique`, sync-payments.
- [ ] Импорт файла Card51 → создаются `Payment`; повторный импорт того же файла → **без дублей** (externalId dedup); не-клиентские строки (не корр-счёт 62) отфильтрованы; несопоставленные → очередь, не теряются. Verify + adversarial (второй импорт с изменённой суммой той же externalId → поведение зафиксировано).

**Блок-верификация E3:** `npm run test:integration` зелёный.

---

## E1 — Аудит покрытия + фаза-2

### Task E1-a: базовая цифра
- [ ] `npm run test:coverage` (живой PG) → зафиксировать before-summary (lines/branches/func/stmt по логическим глобам + текущие 0%-хвосты). Сохранить в E5.

### Task E1-b: render-харнесс (фаза-2 tooling)
- [ ] devDeps: `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom` (опц.), `jsdom`. `npm ci` воспроизводимость (обновить lock).
- [ ] Механизм env: per-file `// @vitest-environment jsdom` в новых `.tsx`-тестах (не менять глобальный `environment: 'node'`, чтобы не тормозить весь прогон). Проверить, что integration/PrismaClient-тесты остаются node.

### Task E1-c: logic-хвост до 100%
- [ ] Покрыть `src/lib/ui/useFormAction.ts`, `src/hooks/*` (не покрытые), `src/lib/email/**/*.tsx` + `send.tsx` (render-снапшот/строки). Убрать соответствующие пути из `exclude` в `vitest.config.ts`, добавить в per-glob threshold (или расширить `src/lib/**/!(*.tsx)` → включить эти `.tsx`). Оставшиеся `components/**`, `app/**/*.tsx` — **фаза-3**, задокументировать в close-out.
- [ ] Поднять пороги где безопасно; каждое `/* v8 ignore */` — с причиной. Обновить CLAUDE.md §6 при смене границ.

**Блок-верификация E1:** `npm run test:coverage` → rc=0 (пороги держатся, включая новые globs).

---

## E4 — Детерминизм и отсутствие сети

- [ ] **Network sweep:** grep по `src/__tests__` на `fetch(`, `new S3Client`, `new Resend`, `nodemailer`, реальные http. Единственный легитимный сетевой — `storage.s3.integration.test.ts` (skipIf по env). Проверить `hooks.useThreadPolling.test.ts` — если реальный fetch, замокать.
- [ ] **Адаптеры замоканы:** Resend/Telegram/Max/S3/ClamAV/СДО(bridge)/1С — по каноничным паттернам (`vi.mock` / DI-seam / fake-adapter). WhatsApp/Wazzup — **не реализован** в проде → тестов нет (зафиксировать в E5, не выдумывать).
- [ ] **Детерминизм:** фиксированные даты в ассертах (STAMP — только для уникальности имён); сид детерминированный; без зависимости от порядка файлов (`fileParallelism:false` уже есть).
- [ ] **Playwright:** снапшоты для admin/manager/partner/organization/student/**leader** без ошибок гидрации. Проверить наличие спеков всех шести; leader/student отсутствуют → добавить `manager-leader-*`/`*-student-*` спеки + `--update-snapshots` бейзлайны. (Требует dev + seed — согласовать с владельцем при прогоне.)

---

## E5 — Отчёт (close-out)
- [ ] Рядом с планом `2026-07-03-track-e-quality-coverage-DONE.md`: coverage до/после, список закрытых пробелов (E2-A/B/C/D, E3-a…e), задокументированные оставшиеся исключения (фаза-3, WhatsApp, leader/student снапшоты если отложены), подтверждение зелёного `test:coverage` + `test:integration` (+ статус `gate`).

---

## Self-Review (spec-coverage чек against ТЗ §17 E1–E5 + критерии приёмки)

- **E1** порог держится + фаза-2 (харнесс+logic-хвост) → Tasks E1-a…c. Полный UI-100% осознанно отложен в фазу-3 (решение владельца). ✅
- **E2** IDOR на **всех** ресурсах (Order/Doc/Payment/Statement/Lead/Task/org) + сокрытие внутреннего (org/partner/student серализаторы) + company-scope + multirole + профили → c1/c2/c3/f/f4 (ре-верификация) + E2-A/B/C + манифест E2-D; набор в gate через integration-tier. ✅
- **E3** заявка / воронка→заказ / комиссия+экспорт / уведомления / 1С / профили → E3-a…e + ре-верификация профилей. ✅
- **E4** без сети + флаки + снапшоты 6 кабинетов → E4. ✅
- **E5** отчёт → E5. ✅
- **Ограничения:** прод-поведение не меняем; баг → `fix(...)` отдельно (явный риск в E2-C: org-comment нюанс). Пороги не понижаем. ✅

**Type/naming consistency:** новые файлы — `security.*`/`e2e.*` + `.integration.test.ts` там, где нужен PrismaClient (иначе не попадут в gate). Fixture-паттерн — как в `c3`/`f` (2 тенанта, positive control, symmetry, cleanup+$disconnect).
