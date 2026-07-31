# Аудит репозитория lk_otsfera — Фаза 0

Дата: 2026-07-30 · Коммит: `f5fd07d` (main) · Режим: только чтение, поведение не менялось.

Цель аудита — зафиксировать фактическое состояние перед программой «эталонный
репозиторий» (фазы 1–9). Все находки имеют severity:

- **BLOCKER** — риск безопасности/данных, чинить в первую очередь;
- **MAJOR** — системная проблема, ломает цель «эталон»;
- **MINOR** — гигиена, чинится попутно.

---

## 1. Сводка фактического состояния

| Метрика | Значение |
|---|---|
| Файлов в git | 2 453 |
| Код (cloc, без node_modules/.next) | TypeScript ~203,6 тыс. строк (1 925 файлов), SQL 78 миграций, Markdown ~77 тыс. строк |
| `tsc --noEmit` | **0 ошибок** (strict уже включён) |
| `npm run lint` | **0 ошибок/предупреждений** (но `next lint` deprecated, в Next 16 удалят) |
| `npm test` | см. §8 (полный прогон unit+integration) |
| `prisma validate` / `migrate status` | схема валидна; 78 миграций, все применены, drift нет |
| `npm audit --omit=dev` | **10 уязвимостей (6 high)**: `xlsx` (prototype pollution + ReDoS, фикса нет), `exceljs`→`uuid` и др. |
| knip | 8 «неиспользуемых» файлов (часть — ложные: `gate-precheck.ts`, `auth.setup.ts`, `sw.js`), **65 неиспользуемых экспортов, 111 неиспользуемых типов**, 1 лишняя dev-зависимость, **prettier вызывается скриптом `format`, но не установлен** |
| jscpd (≥15 строк) | 273 клона, **2,39%** дублированных строк (немного) |
| `any`/`@ts-ignore`/`eslint-disable` в src | 5 386 совпадений широкого grep (львиная доля — тесты, где `any` разрешён политикой); `: any`/`as any` — 457; `@ts-ignore|@ts-expect-error` — **2**; `eslint-disable` — 11 |
| CI | один workflow `ci.yml`: typecheck → lint (max-warnings=0) → test:unit + интеграционный gate на PG-контейнере + `migrate status` |
| Хуки | husky pre-commit (lint-staged + typecheck + test:changed), pre-push (test:unit + условный gate) |

**Важный контекст: репозиторий уже сильно ближе к эталону, чем предполагает
типовой план.** Есть строгий TS, зелёный CI c интеграционным гейтом, покрытие
со 100%-порогом (ручной L3-прогон), IDOR/isolation-тесты, структурные логи с
маскировкой ПДн, журнал доступа к ПДн, Sentry, fail-fast `env.ts` на Zod,
runbook'и, действующее ТЗ и STATUS.md. Фазы 1–9 надо **масштабировать вниз** —
не строить заново, а закрывать конкретные дыры ниже.

---

## 2. Риски безопасности и изоляции данных

### BLOCKER

| # | Находка | Где | Оценка |
|---|---|---|---|
| S1 | ~~`/api/duplicates/by-inn` ищет по всей базе без границы тенанта~~ — **СНЯТО 31.07.2026 (фаза 4): находка ложная.** Роут действительно пускает любую сессию, но `findByInn` первой строкой требует `canTriageClientRequests` (только manager/admin) и отдаёт клиентским ролям `forbidden`; регресс-тест на 403 существует (`api.duplicates.by-inn`). Аудиторский проход смотрел только роут и не увидел гейт в сервисе. Глобальный (без company-скоупа) поиск для staff — осознанный дизайн антидублей (ФТ-13.4). | `src/lib/services/duplicates/findByInn.ts` | — |

### MAJOR

| # | Находка | Где | Оценка |
|---|---|---|---|
| S2 | **76 из 86 роутов без Zod-валидации входа** (body/query разбираются вручную). Авторизация и scope при этом почти везде есть; риск — некорректные данные и 500 вместо 400. Zod есть только в 10 роутах. Из 47 файлов server-actions без Zod — 26. | вся `src/app/api/**` (таблица — §6) | закрывается общим wrapper'ом фазы 4, ~1–2 недели инкрементально |
| S3 | **`npm audit`: 6 high.** Главное — `xlsx`: prototype pollution + ReDoS. **Закрыто фазой 4 (31.07.2026):** npm-версия заморожена на 0.18.5, но SheetJS раздаёт исправленные версии со своего CDN — поставлен `xlsx@0.20.3` тарболом (пакет нужен только для legacy `.xls`; `.xlsx` уже читается exceljs). Остаток — транзитивные (uuid<11.1.1 внутри exceljs, sharp/libvips, brace-expansion, postcss внутри next): ждут релизов упаковщиков / Renovate (фаза 7). | `package.json` | закрыто частично |
| S4 | **Нет gitleaks/secret-скана в CI.** **Закрыто фазой 4 (31.07.2026):** job `gitleaks` в ci.yml + `.gitleaks.toml`. История (1429 коммитов) просканирована: настоящих секретов нет; 48 ложных срабатываний (плейсхолдеры/тестовые значения) в allowlist'е с правилом пополнения. | `.github/workflows/ci.yml`, `.gitleaks.toml` | закрыто |

### MINOR

- S5. `/api/support/question` — приём файла любой ролью без Zod; привязка к
  сессии есть, лимиты файла проверить в сервисе `cabinetQuestion`.
- S6. 5 server-actions на голом `getSession` вместо `require*`-гардов
  (`organization/documents`, `organization/students`, `partner/documents`,
  `security`, `staff/backupCodes`) — работают, но выбиваются из паттерна.
- S7. Срок cookie сессии `60*60*24*7` захардкожен в 2 местах
  (`api/auth/login`, `api/auth/2fa/verify`).

**Что уже хорошо:** publичные точки (login/logout/reset/2FA) — с rate limit;
вебхуки — за подписью/секретом (Mango ещё и IP-allowlist); presigned URL с TTL
600 сек и 302; ClamAV со статусами и 410 для infected; PII-журнал с guardrail;
`console.*` запрещён eslint'ом; логи через pino + `scrub()`.

---

## 3. Архитектура и границы модулей

Фактическая структура — **не** `src/modules/<domain>/{api,domain,data,ui}`, а
слоистая: `app → server-actions → services → lib` (закреплена в CLAUDE.md §2 и
частично защищена eslint-правилом «сервисам нельзя импортировать вверх»).
Доменное разбиение сделано внутри слоёв (services/manager, services/partner…).

| # | Находка | Severity | Оценка |
|---|---|---|---|
| A1 | **Прямые Prisma-запросы мимо сервис-слоя:** 19 из 86 роутов, 27 из 120 страниц, 17 из 47 server-actions, 2 компонента (`partner/org-history-tab.tsx`, `partner/org-employees-tab.tsx` — компонент лезет в базу). Худшие: `api/comments/route.ts` (весь CRUD в роуте), `server-actions/inbound.ts` (бизнес-процесс на 15+ запросов), `app/manager/orders/[id]/page.tsx`. Типовой паттерн нарушения — «мелкий справочник для фильтра прямо в странице». | MAJOR | 1–2 недели инкрементально (выносить в сервисы) |
| A2 | **~25 файлов в `src/lib/**` вне `services/` ходят в БД** (auth, notifications, funnel/stages, tasks/columns, monitoring, config, pii) — фактически второй сервис-слой. Надо либо узаконить эти слои в правилах границ, либо переносить. | MAJOR | решение + перенос, ~1 неделя |
| A3 | **Механической защиты границ нет** (dependency-cruiser/eslint-plugin-boundaries отсутствуют). Есть только точечные eslint-правила: services↛app/components/server-actions, src↛mock-1c, запрет сырого `<dialog>`. Циклы никто не ловит. | MAJOR | 2–3 дня на внедрение правил из фактической (узаконенной) структуры |
| A4 | Barrel-политика неоднородна: где-то `index.ts` (ui, notifications), где-то нет. | MINOR | попутно |
| A5 | Worker-процессоры (все 19) ходят в БД напрямую через параметр `db` — тестируемо и последовательно, но формально мимо services; узаконить в правилах. | MINOR | решение в фазе 3 |

---

## 4. «Конфигурация вместо кода» — найденный хардкод

| # | Находка | Severity |
|---|---|---|
| C1 | **Список статусов лида продублирован и разъехался**: `STATUSES` в `src/app/api/manager/leads/route.ts:8` и `src/app/manager/leads/page.tsx:14` не содержит `promoted_to_deal`, который есть в enum и в `services/access/funnelStages.ts`. Это уже фактический рассинхрон, а не риск. | MAJOR |
| C2 | Статусы сертификатов `['active','expiring','expired']` скопированы **в 6 файлах**; статусы зачислений и client-requests дублируют prisma-enum'ы; списки ролей — в 2 zod-enum'ах (`lib/auth/jwt.ts`, `server-actions/admin/users.ts`). | MINOR |
| C3 | Задокументированные хардкоды-лимиты: `MAX_ORGANIZATION_USERS=10`, `MAX_PARTNER_USERS=5` (`lib/config/teamLimits.ts`), `SLA_MAX_HOURS=168`, порог «истекает» 60 дней, TTL приглашения 7 дней, лимиты импорта 20/10 МБ. Вопрос заказчику: что из этого должно стать настройкой. | MINOR |
| C4 | **Не хардкод (проверено):** ставки комиссии (`Partner.commissionRate`, override `Organization.partnerCommissionRate`), НДС (`vatRate` из 1С) — в БД; стадии воронки / колонки задач / статусы заказа — паттерн «дефолт в коде + company-scoped таблицы `FunnelStage`/`TaskColumn`/`OrderStatusDefinition`» — соответствует ТЗ §10. | ок |

---

## 5. Данные и деньги

| # | Находка | Severity |
|---|---|---|
| D1 | **Float-агрегация денег в KPI партнёра**: `src/lib/services/partner/finance.ts:34–43` суммирует `earnedTotal/pendingTotal/paidTotal` через `Number(s.totalCommissionAmount)` — накопление в double, возможна ошибка в копейках. Единственное найденное место реального сложения денег во float. | MAJOR |
| D2 | Схема — образцово: все денежные поля `Decimal(14,2)`, ставки `Decimal(6,4)/(5,4)`, Float для денег нет; калькулятор комиссии целиком на `Prisma.Decimal` с HALF_UP. Остальные `Number()`/`.toFixed(2)` — форматирование для показа. | ок |
| D3 | Prisma 5.22 при актуальной 7.x — два мажора позади (обновление — отдельная осознанная задача, не «попутно»). | MINOR |
| D4 | Механического запрета `findMany` по company-scoped моделям без фильтра нет (защита — соглашение + isolation-тесты). | MINOR→фаза 5 |

---

## 6. Таблица точек входа (route handlers + server actions)

Полная таблица по всем **86 роутам** (~120 HTTP-методов) и **47 файлам
server-actions** (~120 экшенов) построена в ходе аудита; сводка:

- **Авторизация**: без авторизации — только осознанные точки
  (`/api/health/live`, login/logout/reset — с rate limit; вебхуки — за
  подписью/секретом). Непреднамеренно открытых точек **не найдено**.
- **Scope по тенанту**: подтверждённая дыра — **одна** (S1,
  `/api/duplicates/by-inn`); у ~25 точек scope делегирован сервису, для
  большинства есть isolation/IDOR-тесты (`security.idor-*`,
  `services.*.isolation`).
- **Zod во входной точке**: есть лишь у 10/86 роутов и 21/47 action-файлов
  (S2).
- **Тесты**: без прямого теста — `/api/manager/certificates`,
  `/api/admin/queues`, `server-actions/manager/slaSettings` (у всех трёх есть
  тесты сервисного слоя).

Детальная построчная таблица вынесена в Приложение А (конец файла).

---

## 7. Гигиена кода

- knip: 65 неиспользуемых экспортов + 111 неиспользуемых типов (в основном
  «экспорт на всякий случай» из сервисов), 1 дублирующий экспорт
  (`canSeeOrganization|isOrgInScope` в `managerPolicy`). Конфига `knip.json`
  нет — отсюда ложные срабатывания на скрипты хуков/Playwright/sw.js. MINOR.
- **`npm run format` сломан**: prettier не установлен (knip: unlisted binary),
  конфига prettier и `.editorconfig` нет. MINOR, но это «фундамент» фазы 1.
- commitlint нет; история коммитов при этом фактически следует Conventional
  Commits (дисциплина держится на соглашении).
- jscpd: 2,39% — хорошо; главные кластеры дублей — boilerplate в
  `server-actions/{calendar,funnel,intake,tasks}/index.ts` и два блока в
  `worker/processors/scan-document.ts`.
- `next lint` deprecated — мигрировать на ESLint CLI до Next 16.

## 8. Тесты

- Слоёная дисциплина уже есть (L1 pre-commit → L2 pre-push unit → L2.5 gate →
  L3 полный прогон): ~600 unit-файлов (~5,6 тыс. тестов) + ~115
  integration-файлов (~900 тестов), покрытие с per-glob порогом **100%** на
  полный прогон (ручной, не в CI — осознанно, требует живого PG).
- Результат `npm test` (полный прогон, 30.07.2026, 649 сек): **9 764 passed /
  2 failed / 3 skipped** (990 файлов). Оба падения — в
  `components.staff-backup-codes-section.test.tsx` по waitFor-таймауту;
  повторный прогон файла в изоляции — **6/6 зелёные** (~3 сек). Причина —
  конкуренция за CPU (аудит гонял typecheck/lint/jscpd параллельно с тестами;
  CLAUDE.md §6 прямо предупреждает о ложных таймаутах под нагрузкой).
  Фактический вердикт: **suite зелёный**, но у теста есть чувствительность к
  нагрузке — кандидат на увеличение waitFor-таймаута (MINOR).
- Инварианты фазы 6 частично уже существуют как тесты (IDOR-матрицы,
  cross-tenant изоляция, leader-инвариант, комиссия). Отдельного каталога
  `tests/invariants/*` с формулировками из ТЗ — нет; часть инвариантов
  (идемпотентность выплаты по `paidAt`, снимок цен задним числом, приоритет
  ставок, СНИЛС-дедуп) надо проверить на «падает ли при развороте» и собрать
  в явный набор. MAJOR по прозрачности, не по фактическому покрытию.

## 9. CI/CD, наблюдаемость, документация

CI сегодня: typecheck → lint → unit + gate (PG-контейнер: migrate deploy →
seed → integration) + `migrate status`. **Не хватает** (фаза 7):
`next build`, `npm audit`, gitleaks, knip, boundaries-проверки, drift-check
`migrate diff` (текущий `migrate status` дрейф схемы от миграций не ловит —
это честно указано в комментарии workflow), кеш уже есть. PR-шаблона,
CODEOWNERS, Dependabot/Renovate нет.

Наблюдаемость: pino + `scrub()` (ПДн), edge/client-логгеры, Sentry (server/
edge/worker, no-op без DSN), PII-журнал (§25.7) с guardrail-тестом,
`/api/health` (Bearer) + `/api/health/live`, DLQ-панель админа +
retry-роуты, BullMQ с retry/backoff и `removeOnFail:false`. Отдельного
`/api/ready` нет — роль readiness выполняет `/api/health`. Runbook'и:
backups, launch-deploy, prod-infra, staged-rollout, test-stand. MINOR-дыры:
метрики глубины очередей только в DLQ-панели, единый `docs/RUNBOOK.md` не
собран (материал разложен по пяти файлам).

Документация: CLAUDE.md (подробный контракт), действующее ТЗ v0.5 +
STATUS.md, глоссарий, feature-flags-matrix, матрица видимости клиентских
кабинетов (`docs/audit/2026-07-27-client-visibility-matrix.md`), spec-first
процесс в `docs/superpowers/`. **Нет**: `docs/ARCHITECTURE.md`, ADR-журнала
(`docs/adr/*` — материал для него уже есть в ТЗ §23), README-файлов в
модулях.

## 10. Расхождения кода с ТЗ

Проверено по `docs/tz/STATUS.md` (сверка 30.07.2026):

- **§11 (настраиваемые поля)** — этап 1 закрыт полностью (PR #268–#271,
  close-out есть): 5 сущностей, 12 типов, видимость/право правки по ролям,
  защита системных полей. Расхождений не нашёл.
- **§10 (справочник статусов)** — этап 2 закрыт (PR #272–#277 + #278
  «операционный статус убран из интерфейса»). ⚠️ Таблица этапов в STATUS.md
  отстала от жизни (пишет «PR-2 открыт», хотя всё смержено, а хвост Q3 про
  `executionStatus` закрыт PR #278) — MINOR: обновить STATUS.md.
- Открытый хвост вне объёма ТЗ: **выделение руководителя в отдельную роль** —
  отложено заказчиком (зафиксировано в «Заделе на будущее»).

---

## 11. Предлагаемый порядок фаз 1–9

Порядок изменён относительно исходного плана — безопасность раньше косметики,
границы раньше массовых переносов кода (чтобы CI уже охранял то, что чиним):

| Порядок | Фаза | Почему здесь | Объём с учётом фактов |
|---|---|---|---|
| 1 | **Фаза 1. Фундамент** | быстрые победы, ничего не блокирует | меньше плана: strict уже есть; добавить `noUncheckedIndexedAccess`+`noImplicitOverride` (умеренная правка), `exactOptionalPropertyTypes`/`verbatimModuleSyntax` — оценить отдельно (большая волна правок); prettier+`.editorconfig`+commitlint; скрипт `verify`; миграция с `next lint` на ESLint CLI |
| 2 | **Фаза 4. Контракты API и безопасность** | здесь BLOCKER S1 и самый большой риск (S2, S3) | wrapper `withAuth` + поэтапный Zod-охват; фикс S1 (⚠️ [BEHAVIOR CHANGE] — нужно ваше решение, кому доступен поиск по ИНН); замена `xlsx`→`exceljs`; gitleaks; `env.ts` уже есть |
| 3 | **Фаза 3. Границы модулей** | закрепить фактическую структуру до переносов кода | сначала решение: узаконить слоистую структуру `app/server-actions/services/lib` (рекомендую) вместо ломки в `src/modules/*`; dependency-cruiser с правилами по факту |
| 4 | **Фаза 2. Гигиена** | после границ переносы не сломают правила | knip.json + чистка 176 экспортов; дубли server-actions; починка `format` |
| 5 | **Фаза 5. Данные и деньги** | D1 (float KPI), guard на company-scoped `findMany`, `migrate diff` в CI | схема уже здорова — фаза короче плана |
| 6 | **Фаза 6. Инвариант-тесты** | собрать существующие + дописать недостающие в явный `tests/invariants/*` | половина уже написана, задача — систематизация и «падает при развороте» |
| 7 | **Фаза 7. CI/CD** | собрать всё добавленное фазами в единый конвейер | build, audit, gitleaks, knip, boundaries, PR-шаблон, CODEOWNERS, Renovate |
| 8 | **Фаза 8. Наблюдаемость** | почти готова | метрики очередей, сводный RUNBOOK.md, ревизия логов на ПДн |
| 9 | **Фаза 9. Документация и фронтенд** | финальная фиксация | ARCHITECTURE.md, ADR из ТЗ §23, README модулей, lint на инлайн-hex (отложен спекой frontend-foundation §6) |

Ключевые решения, которые нужны от заказчика до старта фаз:

1. **S1**: кому должен быть доступен `/api/duplicates/by-inn` (рекомендация:
   только staff — admin/manager/leader) — это [BEHAVIOR CHANGE].
2. **Структура**: узаконить фактическую слоистую архитектуру (рекомендую) или
   мигрировать в `src/modules/<domain>/*` (дорого, недели механики).
3. **C3**: какие из лимитов-хардкодов должны стать настройками.
4. `exactOptionalPropertyTypes`/`verbatimModuleSyntax`: включать ли (большая
   волна правок при нулевой текущей ошибке типов) — рекомендую отложить до
   конца программы.

---

## Приложение А. Построчные таблицы точек входа

Обозначения: «в сервисе» — проверка/scope выполняется внутри вызываемого
сервиса (импорты и ключевые сервисы проверены); «Zod» — валидация именно во
входной точке.

### А.1. API-роуты (`src/app/api/**/route.ts`) — 86 файлов

| путь | метод | авторизация | scope по companyId | Zod вход | тест |
|---|---|---|---|---|---|
| /api/admin/custom-fields/[id] | PATCH, DELETE | requireSession + requireFieldsAdmin | глобальные справочники (админ) | нет (ручной разбор body) | api.admin.customFields |
| /api/admin/custom-fields | POST | requireSession + requireFieldsAdmin | глобальные справочники | нет | api.admin.customFields |
| /api/admin/dlq/[queue]/[jobId]/retry | POST | requireAdmin | нет тенант-данных (очереди) | нет | api.admin.dlq |
| /api/admin/dlq/[queue]/retry-all | POST | requireAdmin | нет тенант-данных | нет | api.admin.dlq.retry-all |
| /api/admin/dlq | GET | requireAdmin | нет тенант-данных | нет | api.admin.dlq |
| /api/admin/order-statuses/[id] | PATCH, DELETE | requireSession + requireFieldsAdmin | глобальные справочники | нет | api.admin.orderStatuses |
| /api/admin/order-statuses | POST | requireSession + requireFieldsAdmin | глобальные справочники | нет | api.admin.orderStatuses |
| /api/admin/queues | GET | requireAdmin | нет тенант-данных | нет | нет прямого (есть services.admin.queueStats) |
| /api/admin/sync/summary | GET | requireAdmin | нет (админ видит всё — осознанно) | нет | api.admin.sync.summary |
| /api/admin/training-directions/[id] | PATCH, DELETE | requireAdmin | глобальные справочники | нет | api.admin.trainingDirections |
| /api/admin/training-directions | GET, POST | requireAdmin | глобальные справочники | нет | api.admin.trainingDirections |
| /api/auth/2fa/resend | POST | pending-2FA JWT из cookie + rateLimit | свой пользователь | нет (вход из cookie) | api.auth.2fa.resend |
| /api/auth/2fa/verify | POST | pending-2FA JWT + rateLimit | свой пользователь | да | api.auth.2fa.verify |
| /api/auth/login | POST | публичный (осознанно) + rateLimit | — | да | api.auth.login.*, auth.login.* |
| /api/auth/logout | POST | публичный (только чистит cookie) | нет обращения к данным | нет (вход не нужен) | api.auth.logout |
| /api/auth/reset-password/confirm | POST | публичный + rateLimit + токен сброса | свой пользователь по токену | да | api.reset-password.confirm |
| /api/auth/reset-password/request | POST | публичный + rateLimit | по email, без раскрытия | да | api.reset-password.request |
| /api/client-requests/[id]/attachments/[attId]/download | POST | getSession + featureFlag | в сервисе attachments (по роли/org) | нет | api.client-requests.attachments |
| /api/client-requests/[id]/attachments | GET, POST | getSession + featureFlag | в сервисе attachments | нет | api.client-requests.attachments |
| /api/client-requests/[id] | GET, PATCH | getSession + featureFlag | в сервисе list/triage (по роли) | нет | api.client-requests |
| /api/client-requests | GET, POST | getSession + featureFlag | да: admin=всё, org=свой organizationId (сервис list) | нет (ручной str()) | api.client-requests |
| /api/comments | POST | requireSession + requireOrderAccess (canSeeOrder/managedOrgIds) | да, через policy заказа | да (commentSchema) | comments.route, api.comments.* |
| /api/dashboard | GET | getSession (student — 403) | по роли внутри сервисов | нет (входа почти нет) | api.dashboard |
| /api/documents/[id]/download | POST | requireSession + policy доступа к документу | да (companyId/policy) | нет | documents.route |
| /api/documents | GET | requireSession + requireRole(['admin']) | admin + scan-visibility scope | нет | api.documents.list |
| /api/documents/upload | POST | requireRole(['admin']) + requireOrderAccess | да (organizationId заказа) | нет (formData вручную + mimeValidator) | cov2.upload, services.documents.upload-core |
| /api/duplicates/by-inn | GET | getSession (любая роль!) + rateLimit | **НЕТ — глобальный поиск по всей базе по ИНН** | нет | api.duplicates.by-inn |
| /api/enrollments/[id] | PATCH | getSession + enrollments policy | да (policy по роли) | нет | api.enrollments.advance |
| /api/enrollments/import-template | GET | getSession + policy | нет данных (шаблон файла) | нет | api.enrollments.import-template |
| /api/enrollments | GET, POST | getSession + canSubmitEnrollments/policy | да (organizationId) | нет | api.enrollments |
| /api/enrollments/students | GET | getSession + policy + PII-журнал | да (organizationId) | нет | api.enrollments.students |
| /api/health/live | GET | НЕТ (осознанно, liveness) | нет данных | нет | api.health.live |
| /api/health | GET | Bearer health-токен (secretEquals) | нет тенант-данных | нет | api.health.readiness, api.admin.health |
| /api/integrations/mango/webhook | POST | подпись Mango + IP-allowlist | вебхук, resolve внутри | да (.parse) | api.integrations.mango.webhook, telephony.mango.* |
| /api/integrations/max/webhook | POST | shared secret (secretEquals) | вебхук | нет (ручной) | api.integrations.max.webhook |
| /api/integrations/telegram/webhook | POST | secret-header Telegram (secretEquals) | вебхук | нет | api.telegram.webhook, api.integrations.telegram.inbound |
| /api/integrations/whatsapp/webhook | POST | shared secret (secretEquals) | вебхук | нет | api.integrations.whatsapp.webhook |
| /api/manager/calls/[id]/recording | GET | requireManager | да (companyId/scope звонка) | нет | api.manager.calls.recording, security.idor-calls |
| /api/manager/certificates | POST | requireManager | в сервисе training/certificates | нет | нет прямого (services.training.certificates) |
| /api/manager/documents/[id]/download | POST | requireManager | да (scope в services/manager/documents) | нет | api.manager.documents.download |
| /api/manager/documents/[id]/upload | POST | requireManager | да (scope в services/manager/uploads) | нет | api.manager.documents.upload |
| /api/manager/documents/order-less | POST | requireManager | в сервисе (order-less isolation) | нет | api.manager.documents.order-less, services.order-less-isolation |
| /api/manager/inbox/[id]/attachment | GET | requireManager | да (services/inbound/scope, companyId) | нет | api.manager.inbox.attachment, security.idor-inbox |
| /api/manager/leads/[id] | GET, PATCH | requireManager | в сервисе leads (scope-тесты есть) | нет | api.manager.leads |
| /api/manager/leads | GET | requireManager | в сервисе leads | нет | api.manager.leads, services.manager.leads.scope |
| /api/manager/order-items/[id] | PATCH, DELETE | requireManager | в сервисе orderItems | нет | api.manager.orderItems |
| /api/manager/orders/export | GET | getSession + role==='manager' (+leader для scope=company) | да (в сервисе orders) | нет | api.exports.staff |
| /api/manager/orders/[id]/certificate-scans | POST | requireManager | в сервисе certificateScans | нет | api.manager.certificate-scans |
| /api/manager/orders/[id]/items | GET, POST | requireManager | в сервисе orderItems | нет | api.manager.orderItems |
| /api/manager/organizations/[id]/certificates/export | GET | getSession + managerPolicy (canManagerAccessOrg) | да (organizationId + policy) | нет | api.exports.staff, api.certificates.export |
| /api/manager/organizations/[id]/payments/export | GET | getSession + managerPolicy | да (organizationId + policy) | нет | api.exports.staff |
| /api/messages/attachment | GET, POST | requireSession | да (chat policy по треду) | нет | api.messages.attachment |
| /api/messages/read | POST | requireSession | в сервисе threads | нет | api.messages |
| /api/messages | GET, POST | requireSession | да (chat policy) | нет | api.messages |
| /api/messages/threads | GET | requireSession | в сервисе threads | нет | api.messages |
| /api/messages/unread | GET | requireSession | в сервисе threads | нет | api.messages |
| /api/notifications | GET, PATCH | requireRole(admin,manager,partner,organization) | да (notifications/scope: userId/orgIds/partnerId) | да (PATCH) | api.notifications |
| /api/notifications/unread | GET | requireRole(4 роли) | да (тот же scope) | нет (входа нет) | api.notifications.unread |
| /api/organization/certificates/export | GET | getSession + role==='organization' | да (organizationId из orgContext) | нет | api.certificates.export, api.exports.client |
| /api/organization/documents/[id]/download | POST | requireOrganization + orgContext | да (organizationId) | нет | api.organization.documents.download |
| /api/organization/finance/export | GET | getSession + role==='organization' | да (organizationId) | нет | api.exports.client |
| /api/organization/students/export | GET | getSession + role==='organization' | да (organizationId) | нет | api.exports.client |
| /api/partner/certificates/export | GET | requirePartner | да (портфель партнёра) | нет | api.certificates.export |
| /api/partner/dashboard | GET | requirePartner | да (partner scope) | нет | api.partner.dashboard |
| /api/partner/finance | GET | requirePartner | да (partnerId) | нет | api.partner.finance |
| /api/partner/finance/statements/[id]/pdf | GET | requirePartner | да (проверка принадлежности акта) | нет | api.partner.finance.statements.pdf |
| /api/partner/finance/statements/[id] | GET, PATCH | requirePartner / requirePartnerAdmin | да (partnerId) | нет | api.partner.finance |
| /api/partner/finance/statements/[id]/xlsx | GET | requirePartner | да | нет | api.partner.finance.statements.xlsx |
| /api/partner/finance/statements | POST | requirePartnerAdmin | да (partnerId) | нет | api.partner.finance |
| /api/partner/portfolio/[orgId]/rate | PUT | requirePartnerAdmin + policy (org в портфеле) | да | да | api.partner.portfolio.rate |
| /api/partner/portfolio/[orgId] | GET | requirePartner + policy | да | нет | api.partner.portfolio.org |
| /api/partner/portfolio | GET | requirePartner | да (scope портфеля) | нет | api.partner.portfolio |
| /api/partner/team | GET, POST | requirePartnerAdmin | да (partnerId) | да | api.partner.team |
| /api/partner/team/[userId] | PUT, DELETE | requirePartnerAdmin | да (partnerId) | да | api.partner.team |
| /api/staff/badges | GET | requireRole(admin,manager) | в сервисе intake/badges | нет | api.staff.badges |
| /api/staff-chat/attachment | GET, POST | requireRole(admin,manager) | участники беседы (сервис) | нет | api.staff-chat.routes, services.staff-chat.isolation |
| /api/staff-chat/colleagues | GET | requireRole(admin,manager) | staff-only | нет | api.staff-chat.routes |
| /api/staff-chat/conversations | GET | requireRole(admin,manager) | участники (сервис) | нет | api.staff-chat.routes |
| /api/staff-chat/dm | POST | requireRole(admin,manager) | staff-only | нет | api.staff-chat.routes |
| /api/staff-chat/messages | GET, POST | requireRole(admin,manager) | участники (сервис) | нет | api.staff-chat.routes |
| /api/staff-chat/reactions | POST | requireRole(admin,manager) | участники (сервис) | нет | api.staff-chat.routes |
| /api/staff-chat/read | POST | requireRole(admin,manager) | участники (сервис) | нет | api.staff-chat.routes |
| /api/staff-chat/unread | GET | requireRole(admin,manager) | свой userId | нет | api.staff-chat.routes |
| /api/student/bridge/token | POST | requireRole(['student']) + rateLimit | свой пользователь | нет (входа нет) | api.student.bridge.token, student-bridge-token-route |
| /api/suggest/party | GET | requireSession + rateLimit | нет тенант-данных (внешний DaData) | нет (query вручную) | api.suggest.party |
| /api/support/question | POST | getSession (любая роль) | привязка к своей сессии (сервис) | нет (formData вручную) | api.support.question |

### А.2. Server actions (`src/server-actions/**`) — 47 файлов

| файл / экшены | авторизация | scope по companyId | Zod вход | тест |
|---|---|---|---|---|
| access/profiles (CRUD профилей доступа) | requireSession + requireRole | админ-справочник ролей | нет | server-actions.access.profiles |
| admin/integrationSettings (9 экшенов) | requireAdmin | глобальные настройки | нет | server-actions.admin.integrationSettings |
| admin/inviteOrgAdmin | requireAdmin | organizationId (задаёт админ) | да | server-actions.admin.inviteOrgAdmin |
| admin/manager (7 экшенов) | requireAdmin | да (organizationId/managedOrgIds) | да | server-actions.admin.manager |
| admin/organizations (5 экшенов) | requireAdmin | organizationId | да | server-actions.admin.organizations |
| admin/partners (7 экшенов) | requireAdmin | админ — все партнёры | да | server-actions.admin.partners |
| admin/pendingRecords (requeue) | requireAdmin | нет тенант-данных | да | server-actions.admin.pendingRecords |
| admin/syncControl (trigger/pause/rewind) | requireAdmin | нет тенант-данных | да | server-actions.admin.syncControl |
| admin/users (8 экшенов) | requireAdmin | админ — все пользователи | да | server-actions.admin.users |
| calendar (CRUD событий) | requireSession + requireRole | да (canSeeEvent) | нет | server-actions.calendar |
| commission/corrections (resolveCorrection) | requireSession + requireRole | в сервисе corrections | да | server-actions.commission.corrections |
| contacts (bindCall, createContactFrom*) | requireManager | да (organizationId/scope) | нет | server-actions.contacts |
| customFields (save для org/order) | requireSession + requireRole | в сервисе customFields (access-тесты) | нет | server-actions.customFields |
| deal-activity (addDealNote, initiateCall) | requireManager | в сервисе (idor-тест есть) | нет | server-actions.deal-activity |
| deals/index (11 экшенов) | requireSession + requireRole | да (organizationId в сервисе) | нет | server-actions.deals |
| documents/generate (generate, requestRequisites) | requireSession + requireRole | да (canSeeOrder, companyId) | нет | server-actions.documents.generate |
| enrollment-import (parse) | requireSession + policy | policy | нет | server-actions.enrollment-import |
| funnel/index (move/CRUD стадий) | requireSession + requireRole | да (canSeeLead) | нет | server-actions.funnel |
| import (preview/commitImport) | requireSession + requireRole | в сервисе (import.scope, security.import-leader-scope) | нет | server-actions.import |
| inbound (bind/reply/archive/restore) | requireManager | да (companyId/managedOrgIds) | частичная | server-actions.inbound, inbound.archive |
| intake/index (claim/close/createLeadFrom*) | requireSession + requireRole | в сервисе intake | нет | server-actions.intake |
| invite-resend | requireSession + requireRole | в сервисе team.resend | нет | server-actions.invite-resend |
| leader/analytics (upsertSalesTarget) | requireManagerLeader | в сервисе (idor-тест) | нет | server-actions.leader-analytics |
| manager/create-lead | requireSession + requireRole | в сервисе createLead | нет | server-actions.manager.create-lead |
| manager/leads (pushLeadToOneC) | requireManager | в сервисе | да | server-actions.manager.push-lead |
| manager/orderAssignment (claim/assign) | requireManager / requireManagerLeader | да (companyId) | да | server-actions.manager.orderAssignment |
| manager/orderDelivery (deliver/approve) | requireManager | да (canSeeOrder) | да | server-actions.orderDelivery |
| manager/orderLifecycle (accountingSigned) | requireManager | в сервисе | да | server-actions.manager.orderLifecycle |
| manager/slaSettings | requireManagerLeader | да (companyId) | да | нет прямого (есть services.manager.slaSettings) |
| manager/team (leaderAssign/Deactivate) | requireManagerLeader | да (companyId/orgId) | да | server-actions.manager.team |
| manager/teamVisibility | requireManagerLeader | да (companyId) | да | server-actions.manager.teamVisibility |
| max (generateLink/unlink) | requireSession + requireRole | свой пользователь | нет | server-actions.max |
| notification-channels (preference, whatsappPhone) | requireSession + requireRole | свой пользователь | нет | server-actions.notification-channels |
| orderStatuses (transition) | requireSession + requireRole | в сервисе orderStatuses | да | server-actions.orderStatuses |
| organization/documents (upload) | getSession + membership | да (organizationId/membership) | да | server-actions.organization.documents |
| organization/students (updatePosition) | getSession + policy | да (organizationId) | нет | server-actions.organization-students |
| organization/team (7 экшенов) | requireOrganizationAdminOrLeader | да (organizationId) | да | server-actions.organization.team |
| partner/documents (upload) | getSession (+ проверки в сервисе) | в сервисе partner.documents | да | server-actions.partner.documents |
| partner/inviteOrgAdmin | requirePartnerAdmin | да (organizationId в портфеле) | да | server-actions.partner.inviteOrgAdmin |
| payment-import (6 экшенов) | requireSession + requireRole | organizationId в сервисе | нет | server-actions.payment-import |
| requisites (5 set*-экшенов) | requireSession + requireRole | да (companyId/orgId по роли) | нет | server-actions.requisites |
| security (revokeAllSessions) | getSession | свой пользователь | нет (входа нет) | server-actions.security |
| staff/backupCodes (regenerate) | getSession (staff) | свой пользователь | нет | server-actions.staff.backupCodes |
| staff-profile (updateInternalPhone) | requireManager | свой пользователь | нет | server-actions.staff-profile |
| tasks/index (9 экшенов) | requireSession + requireRole | да (canSeeTask, isolation-тесты) | нет | server-actions.tasks |
| telegram (generateLink/unlink) | requireSession + requireRole | свой пользователь | нет | server-actions.telegram |
| welcome (dismiss) | requireSession + requireRole | свой пользователь | нет | server-actions.welcome |

## Приложение Б. Prisma-запросы вне сервис-слоя

Клиент БД живёт в `src/lib/db/prisma.ts`. Большинство роутов/страниц только
берут клиент и передают его в сервис параметром (разрешённый паттерн тонкого
адаптера) — в таблице ниже лишь те, кто **сам пишет запросы**
`prisma.<модель>...`. Тесты исключены.

| Файл | Слой | Что делает с Prisma |
|---|---|---|
| src/app/api/auth/login/route.ts | route | user (чтение+запись lastLoginAt), twoFactorChallenge (удаление) |
| src/app/api/auth/2fa/verify/route.ts | route | user (чтение+запись lastLoginAt) |
| src/app/api/auth/2fa/resend/route.ts | route | user (чтение), twoFactorChallenge (удаление) |
| src/app/api/auth/reset-password/request/route.ts | route | user (чтение) |
| src/app/api/comments/route.ts | route | **худший**: order (чтение ×3), comment (запись ×3 + count) — вся логика в роуте |
| src/app/api/documents/route.ts | route | document.findMany |
| src/app/api/documents/upload/route.ts | route | order, organization (чтение), document (запись) |
| src/app/api/documents/[id]/download/route.ts | route | document (чтение) |
| src/app/api/notifications/route.ts | route | notification (чтение + updateMany ×2) |
| src/app/api/notifications/unread/route.ts | route | notification.count |
| src/app/api/enrollments/students/route.ts | route | organization (чтение) |
| src/app/api/manager/inbox/[id]/attachment/route.ts | route | inboundMessage (чтение) |
| src/app/api/manager/calls/[id]/recording/route.ts | route | call (чтение) |
| src/app/api/manager/organizations/[id]/payments/export/route.ts | route | organization (чтение) |
| src/app/api/organization/finance/export/route.ts | route | organization (чтение) |
| src/app/api/partner/team/route.ts | route | partner (чтение) |
| src/app/api/partner/finance/statements/[id]/pdf/route.ts | route | commissionStatement (чтение) |
| src/app/api/partner/finance/statements/[id]/xlsx/route.ts | route | commissionStatement (чтение) |
| src/app/api/student/bridge/token/route.ts | route | $transaction (запись токена моста) |
| src/app/manager/orders/[id]/page.tsx | page | **худшая страница**: student, company, organization, deal (чтение), document.groupBy |
| src/app/admin/orders/[id]/page.tsx | page | order, user (чтение) |
| admin: organizations/[id], organizations, users/new, users/[id], intake, integrations, payments-import, documents, enrollments (page.tsx, 9 шт) | page | точечные чтения: partner, organization, user, syncState, document, trainingDirection |
| leader: deals, orders/[id] (page.tsx, 2 шт) | page | organization, student (чтение) |
| manager: leads, deals, enrollments, payments-import, settings (page.tsx, 5 шт) | page | справочники для фильтров (organization, trainingDirection, user) |
| organization: dashboard, certificates, enrollments, orders/[id] (page.tsx, 4 шт) | page | user, trainingDirection, comment (чтение) |
| partner: team, enrollments, certificates, dashboard (page.tsx, 4 шт) | page | organization, trainingDirection, user (чтение) |
| src/app/student/redirect/page.tsx | page | $transaction (запись) |
| src/components/partner/org-history-tab.tsx | component | auditLog.findMany — **компонент лезет в базу** |
| src/components/partner/org-employees-tab.tsx | component | organizationUser.findMany — то же |
| src/server-actions/inbound.ts | server-action | **худший экшен**: inboundMessage (чтение ×4, запись ×3), order, orderThread, contact, organization, message |
| server-actions: organization/documents, partner/documents, documents/generate | server-action | чтения-проверки доступа (organization/order/partner/company) |
| server-actions: manager/team, manager/leads, manager/orderAssignment | server-action | organization, organizationManager, lead, order (чтение) |
| server-actions: admin/{manager,organizations,inviteOrgAdmin}, partner/inviteOrgAdmin, organization/team | server-action | organization (чтения-проверки) |
| server-actions: welcome, security, staff-profile | server-action | user.update (флажки профиля) |
| server-actions: contacts, deal-activity | server-action | inboundMessage / user (чтение) |
| src/lib/auth/policy.ts | util (auth) | organization (×5), order, document — проверки прав |
| src/lib/auth/{session,jwt,requireRole,organization,orgPageContext}.ts | util (auth) | user, order, comment, organizationUser, studentBridgeTokenJti |
| src/lib/notifications/core.ts | util | user (чтение), notification (запись) |
| src/worker/processors/* (19 файлов) | worker | все ходят в БД напрямую (через параметр `db`) — чтение+запись |

Итог по конвенции: route handlers с прямыми запросами — **19 из 86**;
страницы — **27 из 120**; компоненты — **2**; server-actions — **17 из 47**;
`src/lib/**` вне services — ~25 файлов (фактически второй сервис-слой).
