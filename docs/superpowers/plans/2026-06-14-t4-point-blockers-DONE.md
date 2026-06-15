# T4 — Точечные launch-блокеры: close-out (DONE, код)

**Дата:** 2026-06-14
**Ветка:** `claude/t1-f6-leader-axes` (вместе с F6/T1-хвостом)
**Спека:** [../specs/2026-06-14-t4-point-blockers-design.md](../specs/2026-06-14-t4-point-blockers-design.md)

Все 4 блокера трека T4 ([launch-readiness-roadmap](../specs/2026-06-13-launch-readiness-roadmap.md)) закрыты по TDD (red→green), каждая находка предварительно подтверждена в реальном коде (3 параллельных Explore с file:line). Pre-commit зелёный на каждом коммите.

| Блокер | Sev | Коммит | Суть фикса |
|---|---|---|---|
| DOC-01 | P1 | `d10993d` | `canReadDocument` org-ветка пинила только `counterpartyType` → org-A качал документ sibling-org-B в одной компании через дженерик-роут. Добавлен пин `counterpartyId === session.organizationId` (симметрично partner-ветке). |
| C-02 | P1 | `e62f966` | Мёртвые шаблон/`sendCommissionReadyEmail`/enum подключены. `PartnerNotifyInput` → discriminated union + per-type view; триггер в cron-воркере при `isNew && itemCount>0` (системный актор, идемпотентно, best-effort). |
| C-05 | P2 | `14d86af` | Opt-in `rejectOverlap` в `calculateStatementForPartner` → throw `PERIOD_OVERLAP` при пересечении разных периодов (точное совпадение = recalc, исключено); ручной POST мапит в 409; cron флаг не передаёт. |
| C-01 | P1 | `bd7f94b` | Partial-unique `WHERE supersededBy IS NULL` (raw-миграция) + P2002-catch→`updateDraftInPlace` fallback. Не более одной живой ведомости на период даже при гонке. |

## Решения, принятые по делегированию владельца
- **F6** (Task 14 из T1): leader-дашборд — оставлена семантика «стоимость активной работы», расхождение осей сделано явным на UI; commit `5d51fc5`.
- **C-02 точка триггера:** cron-воркер (не worker-completion-gate PDF/XLSX) — проще, идемпотентно, юнит-тестируемо, семантически = системный актор.
- **C-05 размещение:** логика в сервисе (§3), роут только мапит throw→409.
- **C-01:** «реализовать сейчас» с операторской дедупликацией прода как gate.

## Верификация
- **Unit:** DOC-01 policy 11/11; C-02 notify 6/6 + worker 10/10; C-05 route 19/19. typecheck/lint чисто на каждом.
- **Локально:** `prisma migrate deploy` применил partial-unique (индекс построился, дублей нет); `dedupe:commission` dry-run чисто.
- **Integration (требует WSL live-PG):** overlap-гард (4 кейса C-05) + C-01 (инвариант индекса + concurrent-calc гонка) дописаны в `services.commission.statement.test.ts`; DOC-01 integration-regression в `services.document-channel-isolation.test.ts` — TODO для WSL-прогона.

## Операторские шаги перед боевым деплоем
1. **C-01 pre-deploy gate (ОБЯЗАТЕЛЬНО):** `DATABASE_URL=<prod> npm run dedupe:commission` (dry-run) → если есть дубли → `--apply` → только потом `prisma migrate deploy`. Иначе partial-unique не построится и миграция упадёт.
2. **WSL integration-прогон** новых тестов ([[project-wsl-live-pg-verification]]).
3. **PR** ветки `claude/t1-f6-leader-axes` (несёт F6 + DOC-01 + C-02 + C-05 + C-01).

## Известные тонкости
- Partial-unique живёт как raw SQL вне schema.prisma (Prisma не выражает; прецедент — Document XOR CHECK). На `prisma migrate dev` теоретически возможен drift-flag — не «принимать» авто-DROP этого индекса.
- `prisma generate` на этой Windows-машине падает EPERM (DLL-lock) — транзиентно, клиент не менялся.
