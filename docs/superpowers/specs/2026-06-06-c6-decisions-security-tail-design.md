# C6 — решения + security-хвост — дизайн

**Дата:** 2026-06-06
**Статус:** решения приняты (делегировано пользователем), под impl
**Роадмап:** [completion-roadmap §Трек C / C6](2026-06-02-completion-roadmap.md) + раздел «Открытые вопросы / решения»

C6 — это не фича, а закрытие трёх продуктово-технических развилок и связанного «хвоста». Брейнсторм-эквивалент пройден с пользователем в переписке (варианты + trade-offs предъявлены, выбор делегирован). Здесь — финальный дизайн и тест-стратегия.

---

## Решение 1 — `manager completed → pending`: оставляем разрешённым

**Решение:** менеджер может откатывать завершённый заказ обратно в `pending`/`in_progress`. Поведение **не меняется**.

**Почему:** продуктовое требование (заказ может «переоткрыться»). Это «решение, не баг».

**Состояние кода:** [`manager/status.ts`](../../../src/lib/services/manager/status.ts) уже это допускает — валидация это плоский allow-list `MANAGER_SETTABLE_STATUSES = ['pending','in_progress','completed']` без transition-матрицы; строки 80-84 специально очищают `completedAt` при выходе из `completed`.

**Риск без артефакта:** разрешение выражено *отсутствием гарда* → будущий security-аудит может «починить» это как баг и молча сломать продуктовое поведение.

**Артефакт (impl):**
1. Явный regression-тест `completed → pending` (разрешено, `completedAt` очищен) — превращает неявное «нет гарда» в явный замок: тест упадёт, если кто-то добавит запрет.
2. Комментарий-маркер в `status.ts` («intentional: product decision 2026-06-06»).

---

## Решение 2 — гонка 1С push лида: first-writer-wins через атомарный claim

**Решение:** ровно один push на лид; параллельные/повторные попытки идемпотентно отбрасываются; политика — **first-writer-wins**.

**Реальная гонка (сверено с кодом):** в [`oneCSync/push.ts`](../../../src/lib/services/oneCSync/push.ts) guard `if (lead.pushedToOneCAt)` читается через `findUnique`, а отметка ставится `update`-ом **после** успешного `adapter.pushLead()`. Между чтением и отметкой нет атомарности → два параллельных джоба (очередь `pushLead` имеет `attempts: 5`) оба видят `pushedToOneCAt = null` и **дважды создают лид в 1С**. Отдельного пути «переназначения» менеджера/владельца у лида в коде нет — это именно push-идемпотентность.

**Дизайн фикса:**
- Перед вызовом адаптера сделать **атомарный claim**:
  `prisma.lead.updateMany({ where: { id, pushedToOneCAt: null }, data: { pushedToOneCAt: now } })`.
- `claim.count === 0` ⇒ кто-то уже захватил/запушил ⇒ skip (идемпотентный success-лог `operation:'skip'`), адаптер **не** вызывается.
- `claim.count === 1` ⇒ вызываем адаптер; при успехе обновляем только `externalIdInOneC` (`pushedToOneCAt` уже стоит со времени claim).
- **При ошибке адаптера** — откат `updateMany({ where:{ id }, data:{ pushedToOneCAt: null } })`, чтобы лид снова стал доступен для retry (сохраняем текущую семантику «ошибка → можно повторить»). Лог ошибки + `ok:false` как раньше.
- Ранний fast-path по `findUnique` (лид уже `pushedToOneCAt`) сохраняем — он нужен и для маппинга payload, и для дешёвого skip уже-закоммиченного случая.

**Тот же идиом уже есть в проекте** — атомарный single-use claim в student-bridge (`updateMany({ where:{ usedAt:null }, data:{ usedAt } })`). Переиспользуем паттерн, а не изобретаем.

**Граница:** гарантия атомарности — свойство Postgres (`UPDATE ... WHERE pushedToOneCAt IS NULL`). Юнит покрывает логику ветвления; интеграционный — реальную конкуренцию.

**Вне scope:** enqueue-level dedup (`jobId = lead.id`) как доп. DiD — не требуется, сервис-уровневый claim самодостаточен и не трогает вызовы.

---

## Решение 3 — student-bridge rate-limit → Redis-backed с degrade в in-memory

**Решение:** общий Redis-счётчик (`INCR`+`PEXPIRE`) вместо per-instance `Map`; при недоступности Redis — graceful-degradation в in-memory + warn (fail-open для лимитера, не для аутентификации).

**Проблема (сверено):** [`student/bridge/token/route.ts`](../../../src/app/api/student/bridge/token/route.ts) держит лимитер в module-level `new Map()` (строка 10). На serverless каждый инстанс — свой счётчик ⇒ реальный лимит `= max × N инстансов`, сброс на cold start.

**Почему fail-open в in-memory, а не fail-closed:** сам обмен кода защищён без лимитера — timing-safe сравнение shared-secret, role-gate `student`, атомарный single-use claim кода. Лимитер тут — DiD против brute-force. Блокировать вход всех студентов из-за блипа Redis — хуже, чем временно деградировать анти-abuse. (Если позже понадобится строже — fail-closed это однострочная инверсия в модуле.)

**Обязателен таймаут:** `connection.ts` ставит ioredis с `maxRetriesPerRequest: null` — команда к лежащему Redis висит вечно (тот же урок, что в health-probe `withTimeout`). Redis-путь оборачивается в таймаут; таймаут/ошибка ⇒ in-memory fallback.

**Дизайн модуля** `src/lib/rateLimit/index.ts`:
```ts
export interface RateLimiterClient { incr(key: string): Promise<number>; pexpire(key: string, ms: number): Promise<unknown>; }
export async function isRateLimited(
  key: string,
  opts: { windowMs: number; max: number },
  deps?: { client?: RateLimiterClient | null; timeoutMs?: number }
): Promise<boolean>;
```
- `deps.client` задан (тесты) ⇒ используем его; иначе — `getRedisConnection()` если есть `REDIS_URL`, иначе `null`.
- `null` клиент ⇒ in-memory (текущая fixed-window логика + cleanup при `size ≥ 10_000`). Это и есть штатный путь локалки/single-instance (без warn).
- Redis-путь: `n = await incr(key); if (n===1) await pexpire(key, windowMs); return n > max`, всё под `Promise.race` с `timeoutMs` (default 1000). Ошибка/таймаут ⇒ in-memory fallback + `console.warn('[rateLimit] redis backend failed, degrading to in-memory')`.

Роут заменяет локальные `Map`/`isRateLimited` на `await isRateLimited(key, { windowMs, max })` (роут уже async). Константы окна/лимита остаются в роуте из env.

---

## Тест-стратегия

| Решение | Слой | Файл | Покрытие |
|---|---|---|---|
| 1 | unit | `server-actions.manager.status.test.ts` | `completed → pending` разрешён, `completedAt` очищен |
| 2 | unit | `services.oneCSync.push.test.ts` | claim-lost (`count:0`) ⇒ skip, адаптер не вызван; claim-won + ошибка ⇒ rollback `pushedToOneCAt:null`; happy-path обновляет `externalIdInOneC` |
| 2 | integration | `services.oneCSync.push.idempotent.integration.test.ts` (new) | два **параллельных** `pushLeadToOneC` ⇒ адаптер вызван ровно 1 раз, лид запушен 1 раз |
| 3 | unit | `lib.rateLimit.test.ts` (new) | in-memory: `max` проходит, `max+1` лимитится, окно сбрасывается; redis: `pexpire` на первом, лимит при `n>max`; fallback: падающий `incr` ⇒ деградация в memory |

Гейты: `npm run typecheck`, `npm run lint`, затронутый unit + новый integration (живой Postgres на :5432). Build перед PR.

## Файлы

- **Создать:** `src/lib/rateLimit/index.ts`, `src/__tests__/lib.rateLimit.test.ts`, `src/__tests__/services.oneCSync.push.idempotent.integration.test.ts`
- **Изменить:** `src/lib/services/oneCSync/push.ts`, `src/app/api/student/bridge/token/route.ts`, `src/lib/services/manager/status.ts` (комментарий), `src/__tests__/services.oneCSync.push.test.ts`, `src/__tests__/server-actions.manager.status.test.ts`
