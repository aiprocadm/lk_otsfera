# Health / readiness-проба для production-готовности — design

**Дата:** 2026-05-31
**Автор:** Claude (session-driven, brainstorming)
**Статус:** Approved (design step), pending implementation
**Related:** Трек 1 (production-readiness), подсистема 1В (operability). Идёт после уже отгруженной (PR #81) страховочной сетки (1Б). Алертинг (вторая половина 1В) — отдельная будущая спека.

## Проблема

Для безопасного деплоя нужен **машиночитаемый сигнал живости/готовности**, которого нет:

- Единственный мониторинг — страница [`admin/health`](../../../src/app/admin/health/page.tsx): она под `requireAdmin()` и возвращает **HTML**. Оркестратор (Docker `HEALTHCHECK`, k8s-пробы, балансировщик) и uptime-монитор не умеют ни авторизоваться сессионной кукой админа, ни парсить HTML.
- Под `/api/health|ready|healthz` **ничего нет** (проверено glob'ом).
- Следствие: приложение нельзя корректно поставить за балансировщик/автоскейлер (некуда слать readiness-чек) и нельзя подключить внешний uptime-мониторинг.

Слой *данных* при этом уже есть (`getSyncLag`, `getQueueStats`, `getDlq`) — не хватает **поверхности operability**.

## Цель

Переносимые пробы, работающие под Docker `HEALTHCHECK` / k8s / внешний монитор без переделки:

- **Liveness** — «процесс жив» (для решения о рестарте), без зависимостей, публичный.
- **Readiness** — «может обслуживать трафик» (БД + Redis достижимы), token-gated, с детальным телом.

## Не-цели / Out of scope (явно)

- **Алертинг** (пороги → уведомления операторов) — вторая половина 1В, отдельная спека.
- **Worker-liveness проба** — воркер это отдельный процесс; его живость не входит в readiness веб-приложения (см. Дизайн). Возможный follow-up.
- **Supabase Storage в readiness** — внешняя зависимость; приложение деградирует gracefully, readiness не должен от неё зависеть.
- **Prometheus `/metrics` / трейсинг** — другой класс задачи (метрики, не пробы). YAGNI.
- **Изменение страницы `admin/health`** — она остаётся как human-facing дашборд.
- **Промежуточный статус `degraded`** — для балансировщика readiness двоичен (в ротации / нет).

## Дизайн

### Роуты (App Router)

Два GET-роута под `/api/health` (App Router route handlers):

- **`src/app/api/health/live/route.ts`** — liveness, **публичный**. Возвращает `200 { status: 'ok' }` немедленно. Зависимостей нет: сам факт ответа = процесс жив и event-loop крутится.
- **`src/app/api/health/route.ts`** — readiness, **token-gated**. Проверяет БД + Redis; `200` если оба живы, `503` если хоть один недоступен.

Оба: `export const dynamic = 'force-dynamic'` — пробу нельзя кэшировать/статически оптимизировать (иначе Next вернёт устаревший `200`).

**Middleware не трогаем.** Matcher в [src/middleware.ts](../../../src/middleware.ts) уже исключает `/api` (`'/((?!api|...).*)'`), поэтому `/api/health*` не проходит через auth/RBAC/feature-flag-гейт. Авторизацию readiness реализуем **внутри route-handler'а** (это машинный токен, а не сессия — сознательно отдельный механизм от `requireRole`).

### Чеки readiness — лёгкие, не stats-функции

Readiness отвечает на «достижимо?», а не «как данные» — поэтому НЕ переиспользуем `getSyncLag/getQueueStats` (они агрегируют по Postgres/Redis). Вместо них:

- **БД:** `prisma.$queryRaw\`SELECT 1\``.
- **Redis:** `getRedisConnection().ping()` (ioredis возвращает `'PONG'`).

Оба чека гоняются **параллельно** (`Promise.all`), каждый обёрнут в **таймаут ~2с** через `Promise.race`. Это критично: ioredis-коннект создан с `maxRetriesPerRequest: null` ([connection.ts](../../../src/lib/jobs/connection.ts)) — команда к упавшему Redis иначе **висит бесконечно**, и проба зависнет именно в момент аварии. Хелпер `withTimeout(promise, ms)` → резолвит `{ ok, ms }` или (при reject/таймауте) `{ ok: false, ms, error }`. Route-handler сам никогда не бросает.

### Тело и коды

```jsonc
// 200 (оба ok) или 503 (любой down)
{ "status": "ok" | "down",
  "checks": { "db": { "ok": true, "ms": 3 },
              "redis": { "ok": false, "ms": 2001, "error": "timeout" } } }
```

Коды: все чеки ok → `200`; хоть один не ok → `503`. Двоично, без `degraded`.

### Токен readiness

- env **`HEALTH_TOKEN`**. Readiness требует заголовок `Authorization: Bearer <HEALTH_TOKEN>`; сравнение **константное по времени** (`crypto.timingSafeEqual`, с защитой от разной длины).
- Невалидный / отсутствующий заголовок → **`401`** (без тела чеков — не раскрываем детали неавторизованному).
- **`HEALTH_TOKEN` не задан в env → `503 { status: 'down', reason: 'health_token_unconfigured' }`** — fail-closed: secure-by-default и громко сигналит о мисконфиге на первом readiness-чеке после деплоя.
- В [.env.example](../../../.env.example) добавить закомментированный `HEALTH_TOKEN` с пометкой «32+ символа; readiness-проба».

### Сознательные исключения

- **Воркер вне readiness веб-приложения** — отдельный процесс; веб обслуживает UI/API и без него. Связать readiness с воркером = выкидывать веб из ротации, когда стоят лишь фоновые задачи.
- **Supabase вне readiness** — внешняя зависимость, приложение без неё деградирует gracefully.

### Раскладка файлов

```
src/app/api/health/route.ts          (new — readiness: token + db/redis checks)
src/app/api/health/live/route.ts     (new — liveness: public, no deps)
src/lib/health/checks.ts             (new — withTimeout + checkDb/checkRedis, чтобы роут был тонким и тестируемым отдельно)
.env.example                         (edit — +HEALTH_TOKEN, закомментированный)
Dockerfile                           (edit, опционально — HEALTHCHECK → /api/health/live)
```

`src/lib/health/checks.ts` держит логику чеков (timeout + db + redis) отдельно от HTTP — роут остаётся тонким (CLAUDE.md §3: роут только мапит результат в статус), а чеки юнит-тестируются без поднятия Next-роута.

### Rollout

1. Ветка от `main`: `claude/health-readiness-probe` (создана).
2. `src/lib/health/checks.ts` + unit-тесты (mock prisma/redis).
3. `live` роут + тест.
4. `health` (readiness) роут + token-логика + тесты.
5. `.env.example`; опционально `Dockerfile HEALTHCHECK`.
6. `typecheck`/`lint`/`test:unit` зелёные; ручной smoke (`curl /api/health/live`, `/api/health` с токеном и без).
7. PR со ссылкой на спеку.

## Tests

Всё **unit-слой** (мокаем зависимости — Postgres/Redis не нужны; паттерн §6 `vi.hoisted` + `vi.mock`):

- **`checks.ts`:** `withTimeout` резолвит ok при быстром промисе, `{ok:false,error:'timeout'}` при медленном (фейковый таймер или короткий timeout + `setTimeout`); `checkDb`/`checkRedis` → ok при успехе, not-ok при throw.
- **liveness роут:** `GET` → `200`, тело `{status:'ok'}`, без обращения к prisma/redis (мок не вызывается).
- **readiness роут** (mock `@/lib/health/checks` или `@/lib/db/prisma` + `@/lib/jobs/connection`):
  - оба ok + валидный токен → `200`, `status:'ok'`, оба `checks.*.ok`;
  - БД лёг → `503`, `status:'down'`, `checks.db.ok=false`;
  - Redis лёг/таймаут → `503`;
  - токен невалиден → `401`; токен отсутствует → `401`; `HEALTH_TOKEN` не задан → `503` `reason:'health_token_unconfigured'`;
  - ответы не кэшируются (`dynamic='force-dynamic'` присутствует).

## Принятые решения (по делегированию пользователя)

1. **Переносимый дефолт** (не привязка к k8s/Docker/монитору): liveness + readiness, работают везде.
2. **Гибридная авторизация:** `/api/health/live` публичный; `/api/health` token-gated.
3. **`HEALTH_TOKEN` unset → fail-closed (503)** — secure-by-default.
4. **Двоичный readiness** (без `degraded`).
5. **Воркер и Supabase — вне readiness.**
6. **Таймаут чека ~2с**, чеки параллельно.
7. **Логика чеков вынесена в `src/lib/health/checks.ts`** (тонкий роут, тестируемость).
8. **Docker `HEALTHCHECK` — опционально** (добавить, если решим).

## Риск

Низкий.

- **Зависание пробы при аварии Redis** — закрыто `Promise.race`-таймаутом (главный риск, явно покрыт тестом).
- **Публичный liveness как DoS-вектор** — тривиален: без зависимостей, без БД, отвечает константой; влияние ничтожно.
- **Readiness бьёт по БД на каждый запрос** — `SELECT 1` дёшев; при агрессивном опросе можно добавить короткий кэш (~1с), но это YAGNI до появления проблемы.
- **`HEALTH_TOKEN` забыли задать** — fail-closed делает приложение «не готово», что оператор замечает на первом деплое (forcing function), а не тихо открывает детали.
- **Утечка информации через readiness** — тело отдаётся только с валидным токеном; неавторизованный получает `401` без деталей.
