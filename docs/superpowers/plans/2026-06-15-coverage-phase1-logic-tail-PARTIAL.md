# Coverage Phase 1 — Logic Tail → 100% — Close-out (PARTIAL)

> Companion to [2026-06-15-coverage-phase1-logic-tail.md](2026-06-15-coverage-phase1-logic-tail.md). План хранит «что планировали»; этот файл — «что отгрузили». **ОБНОВЛЕНО 2026-06-17: авторитетный full-run гейт ПРОЙДЕН на живом Postgres (`npm run test:coverage` → rc=0); фаза 1 закрыта полностью.** История ниже сохранена для контекста.

## Статус фаз (задач плана)

| Task | Тема | Статус | Коммит(ы) |
|---|---|---|---|
| 1 | Фундамент (скрипты + exclude-граница) | ✅ DONE | `08effea` (+ type-only excludes в `2fe3d43`) |
| 2 | `partner/finance.ts` → 100% | ✅ DONE | `4d5ad6f` |
| 3 | `partner/leadAttachments.ts` → 100% | ✅ DONE | `4d0c998` |
| 4 | `auth/orgPageContext.ts` + `organization.ts` → 100% | ✅ DONE | `60b7293` |
| 5 | `worker/index.ts` — exclude (variant B) | ✅ DONE | `5ec1eb9` |
| 6 | Сервисный хвост → 100% | ✅ DONE (unit-verified) | `6117a50`(part), `e26ad52`, `70345be`, `883f5a4`, `e95bfb4`, `5b1fffe` |
| 7 | Worker-процессоры → 100% | ✅ DONE (combined-verified) | `2fe3d43` |
| 8 | `app/api/**` роуты → 100% | ✅ DONE (unit-verified) | `6117a50`, `bb9a1a9`, `0982fe0` |
| 9 | `server-actions/**` → 100% | ✅ DONE (unit-verified) | `0e27b27` |
| 10 | `lib/**` инфра → 100% | ✅ DONE (unit-verified) | `dd7dff8`, `da0e533` (+ `74fde2e` для middleware/managerPolicy) |
| 11 | Per-glob порог-гейт 100% | 🟡 PARTIAL — конфиг+доки отгружены, **full-run валидация PG-pending** | (этот коммит) |

## Что отгружено

**Все логические файлы (`lib/**` кроме `.tsx`, `server-actions/**`, `app/api/**`, `worker/**`, `middleware.ts`) доведены до 100% L/B/F/S.**

Проверка (на момент close-out PG-форвардинг WSL↔Windows лёг — см. ниже), поэтому верификация шла так:
- **Worker-процессоры** — combined-режим (`npx vitest run --coverage src/__tests__/worker.*.test.ts`, без `--mode`, PG ещё был жив): 11/11 процессоров = 100%, 96 тестов.
- **Все остальные слои** — `--mode=unit` per-batch: каждый файл = 100/100/100/100. Это **достаточное** условие для full-гейта, т.к. full-покрытие ⊇ unit-покрытие (объединение), а батчи только **добавляли** тесты, никогда не удаляя покрытие.
- Финальный unit-sweep: **271 файл / 2993 теста зелёные**; из логических слоёв <100% в unit остаются только: integration-only файлы (100% в full-baseline, не тронуты) и PHASE-2 (`lib/ui/useFormAction.ts`).

**Гейт-конфиг** ([vitest.config.ts](../../../vitest.config.ts)): per-glob порог 100% на 5 глобов, **mode-conditional** — активен только в полном прогоне (`npm run test:coverage`), снят в `--mode=unit`/`--mode=integration` (частичный режим не покрывает весь denominator). Задокументирован в [CLAUDE.md §6](../../../CLAUDE.md).

## Denominator carve-outs (вне порога, с обоснованием)

- Фреймворк-шеллы Next (`{layout,loading,error,not-found,global-error,template}.tsx`).
- `worker/index.ts` — process-bootstrap (Task 5 variant B).
- Чисто типовые модули: `lib/jobs/types.ts`, `lib/services/oneCSync/adapter.ts` (только `export type`/`interface` → пустой JS; v8 c `all:true` ложно рапортует 0%). **Поправка к плану:** Task 6 ошибочно называл `oneCSync/adapter.ts` «fake-адаптером для unit-теста» — это интерфейс `OneCAdapter`; настоящий fake — `adapter-fake.ts` (уже 100%).
- **PHASE-2:** `lib/ui/useFormAction.ts` (React-хук) + `lib/email/**/*.tsx` + `lib/email/send.tsx` + `src/hooks/*` — покрываются в фазе 2 (нужен render-харнесс).

## Integration-only файлы (100% в full, не измеримы под `--mode=unit`)

`partner/documentsList.ts`, `partner/portfolio.ts`, `oneCSync/{cursor,log,scope}.ts`, и integration-тестируемые процессоры (`evaluate-alerts`, `generate-commission-{pdf,xlsx}`, `push-lead`, `sync-payments`). Их единственные тесты — integration (`new PrismaClient(`), поэтому под unit они 0–58%, но в full-baseline (снят в начале сессии) = 100%. **Их покрытие не менялось** (батчи их не трогали).

## `/* v8 ignore */` — инвентаризация (все с причиной-комментарием)

- `auth/requireRole.ts` ×2 — `?? []` после `requireОрganization()` (рантайм-гарантия непустого массива).
- `notifications/manager.ts` ×6 — type-guard `if (input.type !== 'X') throw` внутри `Record`, кейенного по `input.type` (structurally unreachable).
- `worker/processors/scan-document.ts`, `evaluate-alerts.ts` — live-ClamAV/storage infra + unreachable defensive fallback.
- `lib/health/checks.ts`, `lib/storage/mimeValidator.ts` — finally-timer guard / default-param `offset` (always 0 at call-sites).
- `oneCSync/resilience.ts` ×2 — dead `throw lastErr` после retry-цикла (цикл всегда бросает на последней попытке) + `issue.message ?? 'invalid'` (zod message всегда задан).
- `oneCSync/adapter-rest.ts` — MAX_PAGES guard (10 000 fetch'ей, не unit-достижимо).
- `oneCSync/adapter-file.ts` — dead `isRefund` параметр (все call-sites передают `false`).
- `admin/users/mutations.ts` ×2 — dead-via-earlier-guard (`from===to`; admin-role-change перехватывается раньше).
- `admin/queueStats.ts`, `admin/syncControl.ts` — DI-seam `defaultProvider` (infra, заменяется в тестах).
- `app/api/auth/login/route.ts`, `documents/upload/route.ts`, `partner/leads/[id]/attachments/route.ts`, `student/bridge/token/route.ts` — module-load env-fallback / 10K-entry cleanup / always-truthy `correlationId` / node-FormData MIME-strip env-limit.
- `manager/dashboard/attention.ts` — sort-comparator `:1` (urgents всегда сконструированы раньше warns → недостижимо).
- `import/parse-workbook.ts` ×2 — xlsx round-trip `value===undefined` / ExcelJS `RichText.text` всегда задан.

**Снято в этой сессии (был неоправданным):** bare `/* v8 ignore */` в `manager/team.ts` на `b.deactivatedAt?.getTime() ?? 0` — заменён детерминированным тестом (2-элементный массив форсит null-row в `b`-слот компаратора). `manager/team.ts` остался без рантайм-правок.

## Поведение-сохраняющая правка рантайма (1 шт., обзор пройден)

`app/api/notifications/route.ts` (`0982fe0`): удалён мёртвый `if (ids && ids.length>0)` + 400-fallback, заменён на `ids!` — zod `.refine((d) => d.id || (d.ids && d.ids.length>0))` гарантирует непустой `ids`, когда `id` отсутствует (`id` это `z.string().min(1)`, никогда не falsy-present). Поведение идентично; 400-ветка была уже недостижима (refine-failure отдаёт 400 раньше).

## Остаток (для оператора)

1. **✅ Авторитетный full-run гейт — ВАЛИДИРОВАН 2026-06-17 (живой Postgres, изнутри WSL).** `npm run test:coverage` против свежей ICU-БД `cabinet_cov` → **rc=0**: vitest возвращает 0 только когда (а) все тесты зелёные **и** (б) per-glob порог 100% выполнен на всех 5 глобах; extglob-ключ `'src/lib/**/!(*.tsx)'` Vitest 2.1.9 принял (открытый вопрос spec §7 закрыт). Прогон — в клоне `/root/lk-verify` (origin = host-репозиторий, обновлён до 099cd32 через git-bundle, т.к. fetch по 9p-маунту виснет). **Гочи, выявленные по ходу:**
   - **Свежую тест-БД создавать с `LOCALE_PROVIDER icu`** (обе локальные БД `cabinet`/`cabinet_phaseb` — `C.UTF-8`, где кириллический `ILIKE` не делает case-folding → ложные падения). `CREATE DATABASE cabinet_cov TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' LOCALE 'C.UTF-8'`.
   - **`prisma migrate deploy` использует `directUrl` (env `DIRECT_URL`), не `url`.** При смене тест-БД править в `.env` **обе** строки — иначе миграции уходят в одну БД, а runtime-клиент тестов читает другую (пустую) → массовые «table does not exist» (потеряли на этом один прогон).
   - **Поднять `--testTimeout`/`--hookTimeout`** (использовано 40000/90000): под нагрузкой v8-инструментации на ext4-поверх-Windows дефолтные 5с/10с дают флейки-таймауты даже на тривиальных тестах. Прогон с дефолтами: 3 ложных падения из 3393; с поднятыми — 0.
   - integration-тесты сами создают данные в `beforeAll` → отдельный `prisma:seed` не нужен.
2. **Если extglob `!(*.tsx)` не поддержан** — заменить ключ на перечисление под-деревьев `lib` ИЛИ вынести `lib/email/**/*.tsx` в exclude (они PHASE-2).
3. **Фазы 2–3** программы 100%-покрытия (UI: `components/**`, `app/**/*.tsx`, хуки) — отдельные планы.

## Незакоммиченный мусор (не от этой работы)

~~В рабочем дереве лежат untracked скрипты прошлой сессии: `check-*.cjs`, `check-cov*.js`, `scripts/check-*.mjs`.~~ **Удалены 2026-06-17** (22 untracked-файла), рабочее дерево чистое.
