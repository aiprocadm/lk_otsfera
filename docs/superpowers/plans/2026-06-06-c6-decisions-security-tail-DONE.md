# C6 — решения + security-хвост — close-out (DONE)

**Дата:** 2026-06-06 · **Ветка:** `claude/c6-decisions-security-tail` · **Спека:** [c6-decisions-security-tail-design](../specs/2026-06-06-c6-decisions-security-tail-design.md) · **План:** [c6-decisions-security-tail](2026-06-06-c6-decisions-security-tail.md)

Компаньон к плану (не замена). План — «что собирались», этот файл — «что отгрузили».

## Статус

**Реализовано на ветке `claude/c6-decisions-security-tail` (9 коммитов). PR ещё не открыт** (ждёт явного «да» пользователя на push). Все три развилки C6 закрыты; security-хвост (#2, #3) зачинен с тестами.

## Что отгружено

| # | Решение | Содержимое |
|---|---|---|
| **1** | `completed→pending` — оставить разрешённым | Regression-тест `completed → pending` (ok, `completedAt` очищен) + intent-комментарий в `manager/status.ts`. Поведение **не менялось** — замок против будущего «фикса». |
| **2** | 1С push лида — first-writer-wins | Атомарный `updateMany({ where:{ id, pushedToOneCAt:null } })`-claim в `oneCSync/push.ts` до адаптера; `count===0` ⇒ идемпотентный skip; ошибка адаптера ⇒ rollback (в try/catch). Unit + integration (2 параллельных push ⇒ адаптер 1 раз). |
| **3** | student-bridge rate-limit → Redis | Новый модуль `lib/rateLimit` (Redis `INCR`+`PEXPIRE` shared counter, таймаут, degrade в in-memory). Роут переключён с per-instance `Map`. |

## Верификация

- `typecheck` ✓ · `lint` ✓ · `build` ✓
- **unit: 140 файлов / 1137 тестов** зелёные (+10 к baseline 1127).
- integration (затронутый push-путь): `worker.push-lead` 4 + `push.idempotent` 2 — зелёные на живом Postgres :5432.
- Финальное adversarial-ревью (subagent) — см. ниже.

## Финальное ревью поймало (исправлено до close-out)

- 🔴 **Critical — push.ts rollback мог бросить:** если БД упала одновременно с адаптером, голый `updateMany`-rollback в `catch` бросал → функция возвращала rollback-ошибку (нарушение §3 Result) вместо ошибки адаптера, а лид оставался claimed → retry уходил в skip. **Фикс:** rollback в inner try/catch, возвращаем ошибку адаптера, stuck-случай в `console.error` для reconcile. + регресс-тест.
- 🟡 **Important — immortal Redis key:** `INCR`+`PEXPIRE` неатомарны; смерть процесса между ними оставляла ключ без TTL → вечная блокировка client+IP. **Фикс:** `PEXPIRE` на каждом хите (sliding-refresh, без Lua).
- 🟡 **Important — мёртвые env в route-тесте:** `WINDOW_MS`/`LIMIT` читаются на module-load, `beforeEach`-оверрайды были no-op. **Фикс:** мок `@/lib/rateLimit` в route-тесте + тест 429-проводки.

## Осознанно отложено / минор

- **(минор, из ревью)** claim-lost skip-путь возвращает синтетический `result.acceptedAt` (реального времени приёма 1С в момент проигрыша гонки нет). Текущий вызыватель (`pushLeadProcessor`) читает только `externalIdInOneC`, так что эффекта нет. Зафиксировано как латентное, если `result.acceptedAt` начнут потреблять.
- **Reconcile stuck-claimed лидов** (если rollback реально упал) — опирается на существующую очередь `oneCSync.reconcile`; отдельный sweeper не добавлялся.
- **fail-open-to-in-memory** лимитера — осознанная политика (DiD, не основной замок); инверсия в fail-closed — однострочник, если понадобится строже.

## Гочи для будущего

- `lib/rateLimit` degrade-путь требует **таймаута** (ioredis `maxRetriesPerRequest:null` иначе виснет на лежащем Redis) — тот же урок, что в health-probe.
- Константы лимита в роуте читаются на module-load из env — менять лимит = env на старте процесса, не в рантайме.
- Push idempotency держится на атомарности Postgres `UPDATE ... WHERE pushedToOneCAt IS NULL`; не «оптимизируй» claim обратно в read-then-write.

## Остаток роадмапа

C-трек: остаётся **C7** (staged rollout org+manager — ops). Трек A (1С live) ждёт встречи. См. [completion-roadmap](../specs/2026-06-02-completion-roadmap.md).
