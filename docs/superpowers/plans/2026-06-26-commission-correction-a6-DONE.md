# Корректировка возврат-после-выплаты §9.5 (SP-2: A6) — Close-out (DONE)

**Companion to** [2026-06-26-commission-correction-a6.md](2026-06-26-commission-correction-a6.md) (plan) и [спеке](../specs/2026-06-26-commission-correction-a6-design.md). План = «что планировали», этот файл = «что отгрузили».

**Branch:** `claude/commission-correction-a6` (стек поверх SP-1 §9.2, merge-base `main` @ `17f70f1`). **Статус:** реализация + верификация завершены, готово к PR. Roadmap-пункт **A6 / §9.5** (Track A, SP-2) закрыт кодом.

## Что отгружено (12 коммитов)

| Коммит | Содержание |
|---|---|
| `97aa4a4` | spec §9.5 (до этого диапазона; основание) |
| `17b3267` | plan |
| `2907589` | **Task 1** — модель `CommissionCorrection` + `CommissionStatementItem.correctionId` (schema + миграция `20260626130000`) |
| `919ddbb` | **Task 2** — калькулятор складывает готовые correction-строки (2-й аргумент `corrections`, `CorrectionForCalc`); комиссия берётся из поля, не пересчитывается |
| `4921bc0` | **Task 3** — `detectLateRefundCorrections`: возврат в `approved`/`paid` период → `needs_review` (идемпотентно по `paymentId @unique`) |
| `9cc2284` | **Task 4** — `listCorrectionQueue` + `resolveCorrection` (apply/waive, RBAC admin/leader, leader company-scoped, waive требует причину, audit) |
| `6c503cb` | **Task 5** — statement-builder переносит `applied`-корректировки отрицательной строкой (`correctionId` в обоих createMany-путях) |
| `0bf8b7d` | **Task 6** — `approveStatement` материализует остаток-цепочку синтетической `applied`-корректировкой при зажиме R2 |
| `3fa5bc8` | **Task 7** — месячный крон запускает детект перед расчётом (best-effort, §3 graceful degrade) |
| `f80989a` | **Task 8** — integration end-to-end (late refund → detect → apply → перенос строкой) |
| `b8194c3` | **Task 9** — server-action `resolveCorrectionAction` + страница `/admin/commission-corrections` + таблица-очередь с resolve-Dialog |
| `63a7be1` | **Task 10** — `/leader/commission-corrections` (company-scoped) + рендер correction-строк в партнёрской ведомости |
| `55688c6` | nav-канон admin/leader (пункт «Корректировки»); CHANGELOG `[Unreleased]` (Task 11 Step 5) |

## Верификация (Task 11)

Все слои зелёные в этой среде (2026-06-27):

- **`typecheck`** ✅ (strict, чисто)
- **`lint`** ✅ (без warnings/errors)
- **`test:unit`** ✅ — **313 файлов / 3331 тест** passed (1 файл + 3 теста skipped). Новые ветки покрыты unit-кейсами: calculator (fold/clamp/precomputed), detect (paid/approved/draft/idempotent/no-partner), resolve (apply/waive/forbidden/invalid_state/reason_required/leader-scope), carry-line, chain (clamp/no-clamp), worker (detect-before-calc), server-action (apply/validation).
- **integration (live PG)** ✅ — `services.commission.corrections.test.ts` + `services.commission.statement.test.ts` → **16/16** passed. Включает A6 end-to-end (late refund 30000 × 0.1 = 3000 → detect → admin apply → майская ведомость несёт строку `-3000`, нетто 2000).
- **`build`** ✅ — `Compiled successfully`; `/admin/commission-corrections` и `/leader/commission-corrections` зарегистрированы как `ƒ` (dynamic).
- **CHANGELOG** ✅ — пункт A6 в `[Unreleased] → Изменено`.

### Gotcha среды (для следующего прогона integration на этой машине)

Порт Redis `6379` (и весь диапазон **6339–6438**, включая 6380) попадает в зарезервированный Windows TCP-exclusion range (Hyper-V/WSL) → `redis-server` падает с `bind: Unknown error`, а integration-тесты ловят таймаут 5000ms на ioredis-ретраях (enqueue из statement-сервиса). Лечение: поднять Redis на порту **вне** всех `netsh int ipv4 show excludedportrange protocol=tcp` диапазонов (использован **6500**) и прогнать с inline `REDIS_URL="redis://127.0.0.1:6500"` (Prisma грузит `.env` с `override:false` — inline побеждает). Postgres (`5432`) свободен. Это среда, не дефект кода — родственно ICU-collation gotcha.

## Расхождения с планом (осознанные, не дефекты)

1. **Leader RBAC.** План упрощённо писал `session.role === 'leader'`. Реальная модель проекта (C8 / leader-cabinet): leader — это **под-роль менеджера**, поэтому в `corrections.ts` гейт = `s.role === 'admin' || (s.role === 'manager' && s.managerRole === 'leader')`, и leader-scope-фильтр идёт по той же ветке. Соответствует существующему канону, а не буквальному тексту плана.
2. **Полный `test:coverage` (100%-гейт §6)** на live PG — **не прогнан** (L3/ручной, дорогой полный unit+integration прогон). Новые ветки покрыты адресными кейсами; формальный per-glob 100%-замер остаётся пунктом перед PR/релизом.

## Остаток (перед PR)

- [ ] `npm run test:coverage` на live PG — подтвердить 100% per-glob на `corrections.ts` и новых ветках calculator/statement/lifecycle (Self-Review §6 плана).
- [ ] Ручная dev-проверка UI: очереди `/admin/commission-corrections` (admin) и `/leader/commission-corrections` (руководитель в рамках компании), apply/waive-Dialog, рендер correction-строки в партнёрской ведомости (требует `dev:3000` + seed + Redis на свободном порту).
- [ ] Открыть PR поверх SP-1 (#157).
