# CLAUDE.md — проектные правила для агентов

Этот файл — контракт между агентом и репозиторием `lk-otsfera`. Соблюдай его буквально; если правило кажется устаревшим, сначала спроси у пользователя, потом меняй.

## 1. Стек и команды

Next.js 15 (App Router) · React 19 · TypeScript 5 (strict) · Prisma 5 + PostgreSQL · S3-совместимое объектное хранилище · BullMQ + Redis · Vitest · Playwright.

| Команда | Когда использовать |
|---|---|
| `npm run dev` | Локальный dev-сервер на :3000 |
| `npm run worker:dev` | Отдельный процесс воркера (BullMQ); UI без него не падает, но фоновые задачи не выполняются |
| `npm run typecheck` | Перед коммитом — обязательно. Гоняет **два проекта**: боевой (`typecheck:src`) и тестовый (`typecheck:tests`, конфиг [src/__tests__/tsconfig.json](src/__tests__/tsconfig.json)) |
| `npm run lint` | Перед коммитом — обязательно |
| `npm test` | Все vitest'ы — unit + integration. **Запускаются последовательно по файлам** (см. §6) |
| `npm run test:unit` | Только unit-слой (без Postgres). Используется в pre-push hook |
| `npm run test:integration` | Только integration-слой. Требует живой Postgres |
| `npm run test:changed` | Vitest на изменённых файлах в unit-режиме (pre-commit) |
| `npm run e2e:visual` | Playwright visual regression; нужен seed + dev на :3000 |
| `npm run prisma:generate` | После любых правок `schema.prisma` |
| `npm run prisma:migrate` | Для локальных миграций |
| `npm run prisma:seed` | После reset базы |
| `npm run build` | Финальный pre-release чек |

Полный release-чеклист — в [README.md §Финальный release checklist](README.md).

## 2. Архитектура — слои и направление зависимостей

```
src/app/                ← UI (route groups + server components)
src/components/         ← клиентские/презентационные компоненты (по доменам)
src/server-actions/     ← мутации форм; тонкий адаптер над services
src/lib/services/       ← бизнес-логика; НЕ знает про Next/HTTP
src/lib/auth/           ← jwt, requireRole, requireManager, policy-модули
src/lib/jobs/           ← BullMQ конфиг очередей (queues.ts, scheduling.ts)
src/lib/storage/        ← S3 object-storage порт + адаптер (server-only)
src/lib/notifications/  ← notifyManagers/notifyOrgUsers + email-dispatch (barrel index.ts → core/org/manager)
src/lib/logging/        ← структурный логгер: log (pino, server/worker) + edgeLog + clientLog + scrub (ПДн)
src/lib/featureFlags.ts ← feature flag система
src/middleware.ts       ← auth + RBAC + feature-flag gate
src/worker/             ← отдельный процесс: 1С sync, scan, commission gen
prisma/                 ← schema + миграции (никогда не редактировать применённую миграцию)
docs/superpowers/       ← specs + plans (см. §8)
```

**Правило направления зависимостей**: `app → server-actions → services → lib`. Сервис не должен импортировать ничего из `app/`, `components/` или `server-actions/`. Если нужны Next-типы внутри сервиса — это знак, что вы кладёте логику не туда.

**Границы защищены механически (фаза 3)**: [.dependency-cruiser.cjs](.dependency-cruiser.cjs) — циклы, импорты вверх из `lib/**`, база из `components/**`, UI из `worker/**`, `mock-1c` из `src/**`. Проверка — `npm run boundaries`, входит в `verify` и CI; нарушение = красная сборка. Типы, нужные и lib, и компоненту, живут в lib (компонент реэкспортирует).

## 2b. Хаб «Настройки» — один реестр на всё (ТЗ 2026-08-04)

Служебно-конфигурационные разделы кабинетов сотрудников живут под
`/admin/settings` и `/leader/settings`. **Единственный источник правды —
[src/lib/navigation/settings.ts](src/lib/navigation/settings.ts)**: из него
выводятся карточки хаба, боковая навигация, хлебные крошки, проверка прав и
карта редиректов со старых адресов. Добавляешь раздел — правишь этот файл, а не
пять мест.

- **Страница раздела обязана звать `requireSettingsSection(id, cabinet)`**
  ([requireSettings.ts](src/lib/auth/requireSettings.ts)) вместо `requireAdmin`/
  `requireManagerLeader`. Гард проверяет право на КАЖДЫЙ запрос; скрытая
  карточка — это внешний вид, а не защита (§4, defense-in-depth).
- **Право раздела** — код из `SETTINGS_CAPABILITIES`
  ([accessProfileSchema.ts](src/lib/auth/accessProfileSchema.ts)). Правило
  наслоения: `accessProfileId = null` **или** профиль без единого
  `settings.*`-кода → прежнее поведение; профиль с размеченными кодами →
  default-deny. Не убирай вторую половину оговорки: без неё включение новой
  модели молча отнимает доступ у ранее заведённых профилей.
- **Старый адрес не удаляем** — он становится тонким шлюзом, который зовёт
  `redirectToSettingsHub('<старый путь>')` и при выключенном флаге рендерит
  прежнюю страницу на месте. Флаг раскатки — `settings_hub` (снимается после
  приёмки; тогда же 307 меняется на 308).
- **Журнал аудита показывает русские названия**
  ([lib/audit/labels.ts](src/lib/audit/labels.ts)), а в БД `action`/`entity`
  остаются машинными. Новое событие обязано попасть в `AUDIT_ACTIONS`
  ([lib/auth/audit.ts](src/lib/auth/audit.ts)) — иначе не соберётся — и
  получить название в словаре, иначе падает тест полноты.

## 3. Контракт сервисов — стабильный Result-тип

Все доменные функции в `src/lib/services/**` следуют сигнатуре:

```ts
function doX(
  prisma: PrismaClient,
  session: SessionPayload,
  args: XArgs
): Promise<{ ok: true; ...data } | { ok: false; error: ErrorCode }>;
```

- `error` — **стабильная строка** (`'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage' | …`). Не меняй существующие коды без миграции вызовов.
- Route-handler **только мапит** код в HTTP-статус. Никакой бизнес-логики в роуте: см. [src/app/api/manager/documents/[id]/upload/route.ts](src/app/api/manager/documents/[id]/upload/route.ts) как эталон тонкого роута.
- **Обвязка роутов (фаза 4)** — [src/lib/api/](src/lib/api/): `withAuth` (флаг → сессия → guard → Zod-тело; эталон [api/admin/custom-fields](src/app/api/admin/custom-fields/route.ts)) и `parseJsonBody`/`jsonError` для роутов с redirect-стилевыми гардами из `requireRole.ts` (их авторизацию в withAuth не заворачивать). Zod в роуте проверяет **только форму** входа; доменная валидация и коды — за сервисом. Кривой JSON/форма → 400 `invalid_request`; необработанный throw → 500 `internal` + `x-request-id` в каждом ответе.
- Failures должны **degrade gracefully**: queue enqueue / notification fan-out — логируем и проглатываем; они не должны блокировать основной путь.

## 4. RBAC — defense-in-depth обязателен

Защита в трёх местах, **не сокращай ни один**:

1. **Middleware** ([src/middleware.ts](src/middleware.ts)) — путь vs `protectedPrefixes` ([src/lib/auth/access.ts](src/lib/auth/access.ts)).
2. **Route / server-action** — `requireRole`, `requireManager` и т.п. из `src/lib/auth/`.
3. **Service layer** — фильтрация выборок по scope (например `canSeeOrder` из `managerPolicy`, `managedOrgIds`, аналоги для organization/partner). **Менеджерский scope mode-aware (C8):** при `Company.managerTeamVisibility=ON` граница изоляции — компания (`{ companyId: session.companyId }`), при OFF — 3-way per-manager. Флаг читается свежим через `getCompanyTeamVisibility(prisma, companyId)` и передаётся как `teamMode` в резолверы/`canSeeOrder`. **Пропуск аргумента `teamMode` = молча scoped** (typecheck не ловит) — все manager read/guard-сайты обязаны его прокидывать. Cross-company изоляция держится в обоих режимах. Уведомления (`notifications/manager.ts`, `api/notifications`) намеренно остаются scoped (видимость ≠ таргетинг).

**Admin-доступ (Model A):** admin управляет всем через **`/admin/*` зеркало + `policy.ts` (`return true`)**, а НЕ входом в чужие кабинеты. Единое правило: `protectedPrefixes` пускает в кабинет только его роль (`/manager`→manager, `/partner`→partner, `/organization`→organization); admin там не работает (page-гарды его бьют). Не добавляй admin в кабинетные префиксы «чтобы посмотреть» — это мёртвая дверь. Исключение — `/student` (намеренный shared-entry с жёстким серверным гейтом на выпуск токена).

Если добавляешь новую страницу в защищённый кабинет — на странице вызови canSee\*-чек, даже если middleware уже отрезает чужие роли. Это требование плана организационного кабинета (принцип #6).

**Sibling-pattern по ролям**: компонент, нужный сразу partner-у и organization-у, **не делай общим** «на всякий случай». Создавай две версии `partner-*`/`organization-*` (или `manager-*`), кроме случаев когда компонент **строго презентационный и принимает domain-agnostic тип**. Это сознательное решение: домены имеют тенденцию расходиться, и общий компонент быстро становится клубком условий.

## 5. Feature flags

Источник — [src/lib/featureFlags.ts](src/lib/featureFlags.ts). Семантика:

- **Opt-out по умолчанию** (включено, если env не выставлен в `0/false/off`): `partner_leads`, `commission_pdf`, `commission_xlsx`, `pwa_installer`, `pii_access_log` (§25.7, поведенческий: recordPiiAccess no-op + баннер /admin/pii-access; выключать только на время инцидента). (Флаги `one_c_sync`/`document_scan` удалены 2026-06-11: не имели ни одной точки чтения; рычаги 1С — `ONE_C_ADAPTER` + admin sync control center, скан не отключаем намеренно.)
- **Opt-in по умолчанию** (выключено, пока env не `1/true/on`): `organization_cabinet`, `manager_cabinet`, `chat`. Сделано для staged rollout.

Три точки чтения флага:
- middleware → 404 (после auth, чтобы не утекало существование префикса);
- `src/lib/navigation/cabinet.ts` → скрытие пункта меню;
- route handler → `requireFeature(flag)` (бросает `FeatureDisabledError`) или `notFoundIfDisabled(flag)`.

Не добавляй новый флаг без всех трёх точек.

**Поведенческие флаги — исключение из «трёх точек».** `max_channel`/`whatsapp_channel`/`notif_queue`/`staff_2fa` гейтят не route, а шаг/канал. Их точки чтения перечислены в комментарии флага в `featureFlags.ts`. Пример — `staff_2fa` (2FA сотрудников, спека 2026-07-11): читается в `api/auth/login` (выдать сессию или email-challenge для admin/manager/leader), `api/auth/2fa/{verify,resend}` (`notFoundIfDisabled` — не раскрываем механизм) и в секции «Коды восстановления» settings-страниц staff. Middleware/nav неприменимы. Pre-auth токен шага 2FA несёт `purpose:'2fa'` без `role` — `verifyToken`/`getSession` его отвергают (guard-тест `auth.jwt.2fa-pending`).

**Матрица гейтинга «Сообщения» (флаг `chat`) — не выравнивай в один флаг.** Страница `/messages` несёт два разных домена, смонтированных по-разному:
- **partner / organization** — team-chat **только** → гейт `chat` во всех 3 точках (middleware-префикс, nav-`flag: 'chat'`, page `if (!isFeatureEnabled('chat')) notFound()`). Route-handler `api/messages` тоже `notFoundIfDisabled('chat')`.
- **manager** — order-comments (**ungated, всегда видны**) + team-chat (только при `chat`). Nav-флаг пункта — `manager_cabinet`, НЕ `chat` (иначе при `chat=off` исчезнут комментарии). Чат-секция рендерится условно (`chatEnabled`).
- **admin** — chat-only, но **graceful** «Чат не включён» без флага в nav. Узаконенное internal-исключение (admin видит чат-оболочку всегда).
- `api/comments` намеренно БЕЗ флага — комментарии к заказам это до-`chat` фича, не часть домена chat. **`Comment` — это разговор клиент↔менеджер по заказу, а НЕ внутренняя заметка, скрытая от клиента.** Organization/partner и manager пишут и читают его через `POST /api/comments` ([route.ts](src/app/api/comments/route.ts)); ответ менеджера шлёт `notifyOrgUsers('manager_replied')`, комментарий клиента — `notifyManagers('comment_from_org')`. Реальный инвариант — **cross-tenant/scope-изоляция**, а не «невидимость для клиента»: каждая роль скоупится (org по membership, manager по `managerPolicy`, partner пришпилен к своим `partnerId`-заказам). Закреплено регрессом [security.idor-comments.integration.test.ts](src/__tests__/security.idor-comments.integration.test.ts) (партнёр orgA не видит комментарий заказа orgB той же компании-продавца).
Вывод: домен «комментарии к заказам» и домен «чат» не совпадают; гейтить страницу одним флагом нельзя.

**Видимость чата для менеджера — company-scoped (C8).** `canSeeThread`/`scopeWhere` пускают менеджера к тредам **только своей компании** (`order.companyId === session.companyId`; `companyId=null` → deny-all через sentinel), независимо от `managerTeamVisibility`. Admin видит всё (Model A). Не возвращай менеджерам `return {}` «команда видит всё» — это нарушает C8-инвариант cross-company изоляции.

## 6. Тесты — четырёхслойная дисциплина

Первая линия — локальные хуки + ручная команда; серверное зеркало — CI на GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)): на каждый PR и push в `main` гоняет `typecheck → lint (max-warnings=0) → test:unit` и `npm run gate` (с `GATE_SKIP_DOCKER=1` против Postgres service-контейнера) + `prisma migrate status`. CI вызывает те же npm-скрипты, что и хуки — не дублируй шаги в YAML. Слои:

| Слой | Триггер | Команда | Покрытие | Время |
|---|---|---|---|---|
| **L1** | `git commit` ([.husky/pre-commit](.husky/pre-commit)) | `npx lint-staged && npm run typecheck && npm run test:changed` | ESLint на staged-файлах + TS + vitest на затронутых unit-тестах | 5-15 сек (warm) |
| **L2** | `git push` ([.husky/pre-push](.husky/pre-push)) | `npm run test:unit` | Весь unit-слой (~600 файлов, ~5.6k тестов) | минуты (сильно зависит от кэша/нагрузки) |
| **L2.5** | `git push`, затрагивающий `prisma/`/`worker/`/`services/` ([scripts/gate-precheck.ts](scripts/gate-precheck.ts)) | `npm run gate` | Integration-слой против эфемерного Docker-Postgres | ~10+ мин |
| **L3** | Перед PR / релизом, вручную | `npm run test:integration` | Integration-слой (~115 файлов, ~900 тестов) — требует **живой Postgres** | ~10-20 мин |

Полный `test:coverage` (оба слоя + coverage-инструментация, см. ниже) на свободной машине — ~30 мин. **Не гонять `test:unit` и `gate` параллельно**: конкуренция за CPU даёт ложные hook/test-таймауты.

**`npm run gate` (L2.5)** — кроссплатформенный `tsx`-оркестратор ([scripts/gate.ts](scripts/gate.ts)): поднимает Docker-Postgres из [docker-compose.yml](docker-compose.yml), `prisma migrate deploy` + seed против host-facing `DATABASE_URL` (localhost; override через `GATE_DATABASE_URL`), затем `npm run test:integration`. Условно вызывается из `pre-push`; запускается и вручную перед PR. `npm run gate:down` останавливает контейнеры. Требует Docker; обход — `git push --no-verify`. Полнота покрытия воркера держится unit-тестом [worker.processor-coverage.guardrail.test.ts](src/__tests__/worker.processor-coverage.guardrail.test.ts) — падает, если у процессора нет интеграционного теста.

**Vitest** ([vitest.config.ts](vitest.config.ts)):

- **Mode partitioning**: `vitest --mode=unit` vs `--mode=integration`. Без `--mode` гонится всё (поведение `npm test` по умолчанию).
- Mode-разделение **самообнаруживается**: файл считается integration ⟺ его исходник содержит `new PrismaClient(`. Захардкоженного списка нет — добавление нового integration-теста ничего не требует.
- `fileParallelism: false` **намеренно**. Тесты делят живой Postgres и перекрываются по 1С fixture externalId. Не «оптимизируй» эту настройку обратно в true.
- Mock-паттерн: `const { x } = vi.hoisted(() => ({ x: vi.fn() }))` + `vi.mock('@/lib/...', () => ({ x }))`. См. [api.manager.documents.upload.test.ts](src/__tests__/api.manager.documents.upload.test.ts) как эталон.
- Тестовый env допускает `any` (см. eslint.config.mjs).

**Coverage-гейт 100% на логические слои (фаза 1).** `npm run test:coverage` (полный unit+integration прогон, провайдер `@vitest/coverage-v8`) держит **per-glob порог 100%** (lines/branches/functions/statements) на `src/lib/**/!(*.tsx)`, `src/server-actions/**`, `src/app/api/**`, `src/worker/**`, `src/middleware.ts`, `src/hooks/**`, `src/lib/email/**/*.tsx`, `src/components/**`, `src/app/**/*.tsx`. Это **L3/ручной** уровень: гейт требует живого Postgres (честная цифра по сервисам считается только с integration-слоем) и прогоняется перед PR/релизом, **не** в pre-commit/pre-push (полный прогон дорогой). Порог **намеренно снят в частичных режимах** (`--mode=unit`/`--mode=integration`): по отдельности они не покрывают весь denominator (integration-only файлы 0% под unit, и наоборот), поэтому `test:coverage:unit` не падает на пороге. Точечные исключения из denominator: фреймворк-шеллы Next, чисто типовые модули + barrel-реэкспорты, `worker/index.ts` (process-bootstrap). **Фаза 2 закрыта (трек E):** `lib/ui/useFormAction.ts` + `src/hooks/**` + `src/lib/email/**/*.tsx` под порогом (хуки — jsdom + `@testing-library` `renderHook`/`act`, per-file `// @vitest-environment jsdom`; email-шаблоны — `renderToStaticMarkup`; SSR-гарды `typeof document` внутри client-effect'ов — v8-ignore как мёртвый код, эффекты исполняются только на клиенте). Любое `/* v8 ignore */` обязано нести причину-комментарий. **Фаза 3 закрыта (UI-слои под порогом):** `src/components/**` (167 компонентов — гибрид `renderToString`/node для презентационных + jsdom + `@testing-library` для интерактива; диалоги — mock `HTMLDialogElement.prototype.showModal`/`close`, всегда-смонтированные скоупятся `dialog[open]` + `within()`; async server-компоненты — `await` + `renderToString`) и `src/app/**/*.tsx` (90 серверных `page.tsx` — helper [`renderServerComponent`](src/__tests__/helpers/renderServerComponent.tsx): async-страница вызывается напрямую с `params`/`searchParams` как Promise, вложенные async server-компоненты + `redirect`/`notFound`/сервисы/`prisma`/`featureFlags` мокаются на уровне модуля). **Весь `src/**`-denominator (кроме exclude) на честных 100%** — подтверждено end-to-end прогоном против живого Postgres 30.07.2026 (программа погашения долга: спека [coverage-debt-design](docs/superpowers/specs/2026-07-30-coverage-debt-design.md), close-out [coverage-debt-DONE](docs/superpowers/plans/2026-07-30-coverage-debt-DONE.md)). До программы гейт ни разу не прогонялся целиком и был красным (108 файлов); теперь пороги 100/100/100/100 по всем девяти наборам — **понижать только решением заказчика**. Мерить все четыре метрики (functions выпадали при проверке только statements/branches); пороги активны только в полном прогоне.

**Playwright** ([playwright.config.ts](playwright.config.ts)):

- Тесты делятся на **три проекта по префиксу файла**: `manager-*.spec.ts`, `organization-*.spec.ts`, остальное — partner.
- Каждый проект использует свой storageState (`playwright-report/.auth/{partner,organization,manager}.json`), сидируемый `auth.setup.ts`.
- Snapshot baselines — в `src/e2e/snapshots/<spec>-snapshots/`. Новые baselines генерируются `npm run e2e:visual:update`.
- Запуск **только локально и вручную** — `npm run e2e:visual`. Требует `npm run dev` + seed.

**Обход хука** (на свой страх и риск): `git commit --no-verify`. Используй редко и только если ты знаешь, что делаешь.

## 7. Worker и очереди

Воркер — отдельный процесс (`npm run worker:dev`). Очереди определены в [src/lib/jobs/queues.ts](src/lib/jobs/queues.ts) с retry/backoff:

```
attempts: 5, backoff: { type: 'exponential', delay: 1000 },
removeOnComplete: { count: 1000 }, removeOnFail: false
```

Не вырезай `removeOnFail: false` — это намеренно: failed jobs остаются для расследования.

Доступные очереди: `oneCSync.{pullOrders,pullPayments,pullDocuments,pullOrganizations,pushLead,reconcile}`, `docs.{generateCommissionPdf,generateCommissionXlsx,calculateMonthlyCommissions,scanDocument}`, `notifications.{dispatch,certificateExpiry,calendarReminder,taskDueSoon}`, `monitoring.{evaluateAlerts,slaEscalation}`, `inbound.email.poll`, `telephony.mango.{recording,backfill}` (полный список — [src/lib/jobs/queues.ts](src/lib/jobs/queues.ts), он первичен). (Очередь `emails.send` удалена 2026-07-10: не имела ни продьюсера, ни процессора — письма шлются inline через `src/lib/email/send.ts`; не добавляй её обратно без реальной постановки задач.)

## 8. Spec-first процесс

Любая нетривиальная фича идёт через `docs/superpowers/`:

1. **Spec** в [docs/superpowers/specs/](docs/superpowers/specs/) — дизайн, открытые вопросы, тестовая стратегия.
2. **Plan** в [docs/superpowers/plans/](docs/superpowers/plans/) — пошаговые задачи с `- [ ]` чекбоксами, обычно с annotation `REQUIRED SUB-SKILL: superpowers:subagent-driven-development`.
3. После завершения **рядом** с планом создаётся короткий close-out `<plan>-DONE.md` (см. эталон [partner-cabinet-phase4-DONE.md](docs/superpowers/plans/2026-05-22-partner-cabinet-phase4-DONE.md)) — план хранит «что планировали», close-out хранит «что отгрузили». Если работа отгружена частично, использовать суффикс `-PARTIAL.md` с явным блоком «Статус фаз» (см. эталон [admin-cabinet-mvp-PARTIAL.md](docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md)).

Перед началом крупной фичи всегда читай свежий plan для соседней роли (partner/organization/manager) — наследуй структуру и naming.

## 9. Accessibility (модалки)

Все модалки используют общий примитив [`Dialog`](src/components/ui/dialog.tsx) поверх нативного `<dialog>`. Браузер сам даёт focus-trap, Escape, inert-фон, top-layer и focus-restore; компонент мостит декларативный `open` к императивному `showModal()/close()` и применяет project-specific initial-focus.

Контракт `Dialog`:

- Props: `open`, `onClose`, `title`, `size?` (`sm|md|lg|xl`), `busy?`, `closeOnBackdrop?`, `error?`, `notice?`, `children`.
- **Initial-focus** (экспортируемая чистая `pickInitialFocus`, WAI-ARIA APG для форм-диалогов): первый form control → первый submit → первый focusable → сам `<dialog>` (fallback).
- `aria-labelledby` привязан к `title`; `role="dialog"`/`aria-modal` подразумеваются нативным `<dialog>` — **не** хардкодить их (eslint `no-restricted-syntax` это ловит).
- Два всегда-смонтированных aria-live региона: `error` → `role="alert"` (assertive), `notice` → `role="status"` (polite). Внутри-модальный фидбек идёт сюда; toast — для success после закрытия.
- Escape и backdrop-click уважают `busy` (не закрывают во время сабмита).

Не создавай сырой `<dialog>`/`role="dialog"` — используй примитив (guardrail `NO_HANDROLLED_MODAL` в [eslint.config.mjs](eslint.config.mjs)). Прочие презентационные примитивы — `Button`/`Input`/`Select`/`Textarea`/`Badge`/`Spinner`/`Field` в [src/components/ui/](src/components/ui/) (barrel `index.ts`); строки ошибок — через `errorMessageRu` ([src/lib/errors/messages.ts](src/lib/errors/messages.ts)); транзиентный фидбек — через `toast` ([src/lib/ui/toast.ts](src/lib/ui/toast.ts)).

## 10. Документы и Object Storage (S3)

- Bucket — `documents` (env `S3_BUCKET`).
- Скачивание — **через presigned URL** (S3) TTL 600 сек, 302-redirect. Никогда не отдавай файл напрямую через приложение.
- При upload — обязательно: MIME allow-list + size check (200 МБ), запись `Document` с правильным `direction`, enqueue `docs.scanDocument`, audit log, fan-out уведомления.
- ClamAV статусы: `pending → clean | infected`. Файлы с `infected` отдают **410 Gone**, не 404 — это разные сигналы (см. download-роуты).

## 11. Известные подводные камни

- **`src/app/api/manager/documents/`**: внутри только один сегмент `[id]`. Не создавай рядом `[orderId]`/`[documentId]` — Next.js упадёт со startup-ошибкой. Это исправленный ранее блокер.
- **`.github/workflows/ci.yml` — единственный workflow** (добавлен PR-серией укрепления, 2026-07): серверное зеркало лестницы хуков. Локальный гейтинг Husky остаётся первой линией; CI страхует от `--no-verify`. Новые workflow не добавляй без обсуждения; шаги CI не должны дрейфовать от npm-скриптов хуков.
- **Sibling-pages для документов**: org-кабинет не имеет API-роута upload (использует server-action), у manager-кабинета — есть API-роут. При синхронизации UX между ролями учти это асимметричное расхождение.
- **Vitest на холодном кэше**: первый запуск pre-commit может занять ~30-60 сек из-за `transform`/`prepare`. На втором коммите подряд — 5-10 сек. Не паникуй при первом долгом запуске.

## 12. Безопасность

- `JWT_SECRET` минимум **32 символа** — короче, и middleware редиректит на `/login` ([middleware.ts:14](src/middleware.ts)).
- Student bridge JWT передаёт **только** контрактные claims, перечисленные в [README.md §Student redirect](README.md). Не добавляй туда внутренние флаги или PII.
- Одноразовые bridge-коды **не логируются** даже в маскированной форме.
- Audit log — единственный канал для расследования: пиши `action`, `entity`, `entityId`, `userId`, опционально `after`. Не пиши секреты.
- **Журнал доступа к ПДн (§25.7)** — модель `PiiAccessEvent` + хелпер `recordPiiAccess` ([src/lib/pii/record.ts](src/lib/pii/record.ts)). Новое staff-чтение ПДн физлиц клиентского контура обязано зарегистрировать контекст в [src/lib/pii/contexts.ts](src/lib/pii/contexts.ts) и вызвать `recordPiiAccess` (guardrail `pii.capture-coverage`). `subjectIds` — только id строк; в `meta` запрещены сырые поисковые строки; содержимое журнала не выводится в pino-логи. Запись awaited + never-throws (fail-open §3, `log.error` на сбой).
- **Логирование — только через `@/lib/logging`** (`log` — server/worker; `@/lib/logging/edge` — middleware; `@/lib/logging/client` — 'use client'). Сырой `console.*` в `src/**` запрещён eslint-правилом `no-console`. В production логгер пишет pino-JSON и прогоняет контекст через `scrub()` (ПДн/секреты → `[REDACTED]`); в dev/test — console-passthrough с verbatim-аргументами (на этом держатся ~37 console-spy регрессов — формат сообщений не менять). Sentry (server/edge/worker) — no-op без `SENTRY_DSN`; события чистятся `scrubSentryEvent` (`sendDefaultPii: false`).

## 11b. Строгость TypeScript — два проекта (фаза 1b)

Включены: `strict`, `noImplicitOverride`, `verbatimModuleSyntax`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.

**`noUncheckedIndexedAccess` действует только на боевой код.** Тесты живут по
своему [src/__tests__/tsconfig.json](src/__tests__/tsconfig.json) (наследует
боевой, отключает один этот флаг). Причина: в бою флаг ловит реальные
обращения к отсутствующему элементу (75 мест), в тестах даёт 1212
срабатываний вида `calls[0][1]`, где индекс заведомо валиден. Корневой
конфиг исключает `src/__tests__`, вложенный подхватывается автоматически
(TS и typescript-eslint ищут ближайший `tsconfig.json` вверх по дереву).
Собственные ambient-объявления (`src/types/*.d.ts`) включены в оба проекта.

Практика по флагам:

- `exactOptionalPropertyTypes`: у **своих** типов, где «поля нет» == «поле
  undefined», расширяй объявление `x?: T | undefined`. Условный спред
  `...(v !== undefined ? { v } : {})` — только там, где получатель различает
  отсутствие и undefined: **аргументы Prisma** (`where`/`update`), внешние SDK,
  JWT-claims, `updatePartnerAction` (`null` = «сбросить ставку»).
- `noUncheckedIndexedAccess`: чини перестройкой кода (`for…of`,
  деструктуризация с проверкой, `.find()`), а не `!`. Non-null assertion —
  только когда индекс доказуемо валиден, с комментарием-обоснованием.
- `any` и `@ts-ignore` запрещены в обоих проектах (в тестах `any` разрешён
  eslint-политикой, но не как способ обойти эти флаги).

## 12b. Гигиена кода (фаза 2)

- **Мёртвый код**: `npm run deadcode` (knip, конфиг [knip.json](knip.json)) — неиспользуемый экспорт/тип/файл/зависимость = красная сборка (входит в `verify` и CI). Не экспортируй «на всякий случай»: символ, нужный только внутри файла, живёт без `export`.
- **Barrel-политика**: `index.ts` — только публичный API модуля и только с реэкспортами, которые реально используются извне (knip это энфорсит). Прямой импорт из подмодуля (`@/components/ui/spinner`) — норма, а не нарушение.
- **Дублирование**: `npm run dup:check` (jscpd, порог 3% на `src/`) — в `verify` и CI. Общие помощники server-actions (`str`, `ActionResult`) — в [src/lib/actions/form.ts](src/lib/actions/form.ts); `revalidate()`-хелперы остаются локальными (пути свои у каждого домена). Зеркальные security-ветки (например в `worker/processors/scan-document.ts`) — осознанное дублирование, не «оптимизировать».
- **Нейминг (фактический, зафиксирован)**: компоненты — `kebab-case.tsx`; модули lib/services — `camelCase.ts` (или `kebab-case.ts` там, где так сложилось в домене — внутри домена стиль не смешивать); тесты — `src/__tests__/<area>.<name>.test.ts[x]` с префиксом слоя (`api.`, `services.`, `components.`, `pages.`, `worker.`, `server-actions.`); строковые списки-справочники не копируются между файлами — единый источник (константа в lib или prisma-enum).

## 13. Stylistic preferences

- Импорты — alias `@/...` (см. tsconfig.json `paths`).
- React: `'use client'` только когда реально нужно (форма, состояние, эффекты); серверные компоненты по умолчанию.
- Prisma запросы возвращают **узкие** селекты, не `findMany()` всего.
- UI цвета: оранжевая палитра проекта `#F97316` (primary), `#EA580C` (hover), `#111111` (heading), `#F3F4F6` (panel bg). **Палитра запекается в примитивы `ui/` (Button/Badge/контролы) — не инлайнь brand-hex в новых компонентах; переиспользуй примитив.** (eslint-guardrail на инлайн-hex отложен — см. spec frontend-foundation §6.)
- Локализация UI — русский язык; user-facing строки на русском, идентификаторы / коды ошибок — на английском.

## 14. Программа развития по ТЗ — протокол «продолжай по ТЗ»

Действующее ТЗ — [docs/tz/2026-07-29-tz-lk-otsfera-v0.5.md](docs/tz/2026-07-29-tz-lk-otsfera-v0.5.md) («ТЗ продукта v0.5» от 29.07.2026, сверено с кодом). Прогресс — **только** в [docs/tz/STATUS.md](docs/tz/STATUS.md).

**В `docs/tz/` лежат два ТЗ — не перепутай:**

- **ТЗ продукта v0.5** (29.07.2026) — **действующее**, работа идёт по нему. Открытый объём — его **§24 «Не реализовано»** (два пункта), разбитый на этапы в STATUS.md.
- [ТЗ развития v1.0](docs/tz/2026-07-23-tz-lk-otsfera-v1.md) (23.07.2026) — программа из 12 этапов, **закрыта 28.07.2026** ([close-out](docs/tz/2026-07-28-tz-program-DONE.md)). Только история.

> **Две ловушки этой пары документов.**
> 1. **v0.5 новее v1.0.** Линейки версий независимые; меньший номер не значит «устарело». Не «возвращайся» к v1.0.
> 2. **Ссылки вида «§N ТЗ» из старого протокола относились к v1.0 и в v0.5 означают совсем другое** (в v1.0 §9–§11 — про процесс и этапы, в v0.5 §9 — комиссия, §10 — статусы, §11 — настраиваемые поля). Поэтому шаги ниже ссылаются на разделы **этого файла**, а не на номера параграфов ТЗ. Встретишь «§N ТЗ» в исторических документах — сверься, о каком документе речь.

Когда пользователь пишет **«продолжай по ТЗ»** (или вариации: «дальше по ТЗ», «следующий этап ТЗ», «работай по ТЗ»):

0. **Сначала прочитай шапку `docs/tz/STATUS.md` — строку «Текущий этап».** Там либо номер этапа с описанием и текущим шагом, либо «программа … завершена / остатков нет». Во втором случае продолжать нечего — действуй по блоку «Программа закрыта» ниже и **не выдумывай себе работу**.
1. Определи **текущий этап** (первый не-`✅`) и на каком он шаге (спека / подтверждение / план / реализация / PR).
2. Продолжи ровно с этого шага по циклу §8 этого файла: состав этапа + файлы-якоря (в STATUS.md есть раздел «Разведка по коду») → **спека** в `docs/superpowers/specs/` → **стоп: подтверждение заказчика** (спека предъявляется до кода — не начинай реализацию без явного «да») → **план** в `docs/superpowers/plans/` → реализация → зелёные `typecheck`/`lint`/`npm test` → CHANGELOG.md → PR → close-out `-DONE.md`.
3. Если этап блокирован открытым вопросом из раздела «Открытые вопросы заказчику» в STATUS.md — задай вопрос заказчику до спеки.
4. По ходу и по завершении обновляй STATUS.md (статус этапа, ссылки на спеку/план/PR, журнал). Мержит PR только владелец; `✅ готов` ставится после мержа в `main`.

**Объём работ берётся из §24 ТЗ, а не из головы.** Остальные разделы v0.5 сверены с кодом и уже отгружены — «улучшать» их по своей инициативе нельзя. Новый пункт появляется в STATUS.md только после явной просьбы заказчика и подтверждённой спеки.

**PR всегда открывается с `base: main`.** Дважды (этап 8, PR-2 и PR-3) PR
открывался стеком — `base` указывал на ветку предыдущего PR. Владелец мержил
такой PR в его base-ветку, ветка после мержа удалялась, и код в `main` не
попадал (обнаруживалось только следующей проверкой). Если следующий PR
опирается на неотмерженный код — либо дождись мержа предыдущего, либо открой
PR от `main` и включи в него нужные коммиты; стек через `base` на ветку не
использовать. После мержа своих PR проверяй, что код реально в `main`
(`git cat-file -e origin/main:<файл-маркер>`).

Этапы не перескакивать и не смешивать в одном PR. Все конвенции этого файла (§1–13) действуют поверх ТЗ; при противоречии — спроси заказчика.

### Состояние на 29.07.2026 — программа открыта

По действующему ТЗ продукта v0.5 **работа есть**: заведены два этапа из §24
«Не реализовано».

| Этап | Что | Состояние |
|---|---|---|
| 1 | §11 — настраиваемые поля: 5 сущностей вместо одной, 12 типов вместо 5, подсказка + видимость и право правки по ролям, защита системных полей | ⬜ спеки нет |
| 2 | §10 — настраиваемый справочник статусов: добавление, переименование, порядок, деактивация; использованный статус не удаляется физически | ⬜ спеки нет |

Ближайший шаг по фразе «продолжай по ТЗ» — **спека этапа 1 и предъявление её
заказчику до кода**. Разведка по коду (что уже есть, чего не хватает, где
файлы-якоря) лежит в `STATUS.md` — начинай с неё, а не с чистого листа.
Актуальную картину всегда бери из `STATUS.md`: эта таблица — снимок на дату и
может отстать.

### Программа закрыта — что делать по «продолжай по ТЗ»

Порядок на случай, когда все этапы `✅` и остатков нет (так было с 28.07.2026 по
29.07.2026, пока не появилось ТЗ v0.5):

1. **Проверь, что состояние не изменилось**: в `STATUS.md` нет этапов без `✅`,
   в `gh pr list` нет открытых PR. Если появилось новое — работай по нему.
2. **Загляни в раздел «Задел на будущее» в `STATUS.md`.** Там перечислено то,
   что осознанно НЕ входит в объём (с пометкой, почему). Это **не
   обязательства**: брать оттуда задачу можно только по явной просьбе
   заказчика.
3. **Скажи заказчику прямо, что работы по ТЗ нет**, и предложи выбор: новый
   объём (нужна новая версия ТЗ или отдельная спека по §8) либо задача из
   «Задела». Не начинай ни то, ни другое без ответа.
4. **Чего делать НЕЛЬЗЯ:** придумывать «улучшения» и выдавать их за ТЗ;
   массово править исторические планы и close-out'ы; заводить новый этап в
   `STATUS.md` без подтверждённой спеки.

Полезная проверка перед ответом (даёт факты, а не догадки):

```bash
grep -n "^## Текущий этап" docs/tz/STATUS.md
```

```bash
gh pr list --state open
```
