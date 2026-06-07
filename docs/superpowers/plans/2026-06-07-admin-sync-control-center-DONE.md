# Admin 1С Sync Control Center (v1) — DONE

**Дата завершения:** 2026-06-07
**Branch:** `claude/admin-sync-control-spec`
**Base:** `main` (`7387e01`)
**Commits:** spec `03f3281` → plan `81607bd` → задачи 1–13 (`956e292` … `2e2642f`) → этот close-out
**Spec:** [2026-06-07-admin-sync-control-center-design.md](../specs/2026-06-07-admin-sync-control-center-design.md)
**Plan:** [2026-06-07-admin-sync-control-center.md](2026-06-07-admin-sync-control-center.md)

Первый пункт трека «операционные рычаги» (подсистема **A**) из brainstorming-сессии «всё ли реализовано у admin». Исполнено subagent-driven (свежий субагент на задачу + ревью на стыках, финальное холистическое ревью на opus → **READY TO MERGE**).

## Что отгружено

`/admin/sync` превращён из read-only статуса в **центр управления**; bulk-retry добавлен на `/admin/health`. Четыре рычага:

| Рычаг | Точка входа | Поведение | Audit |
|---|---|---|---|
| Ручной запуск | server-action `triggerSyncAction` → `triggerSync` | `queue.add(reason:'manual')`, дедуп при `active>0` → `already_running` | `sync_triggered` / `sync_state` (best-effort) |
| Bulk-retry DLQ | API-роут `POST /api/admin/dlq/[queue]/retry-all` → `retryAllDlq` | retry до 500 failed, счётчики retried/failed + `truncated` | `sync_dlq_bulk_retried` / `job_queue` (в роуте) |
| Пауза/резюм крона | server-action `setSchedulePausedAction` → `setSchedulePaused` | DB-first (`SyncSchedulePause`) + Redis scheduler; переживает рестарт воркера | `sync_schedule_paused`/`_resumed` / `sync_schedule` |
| Перемотка курсора | server-action `rewindCursorAction` → `rewindCursor` | type-to-confirm, валидация (future/unparseable → `invalid_cursor`), `null`=reset | `cursor_rewound` / `sync_state` (**атомарно** в `$transaction`) |

Инфраструктура: `SyncSchedulePause` модель + миграция; `registerSyncSchedules(getQueueFn, pausedSchedulerIds?)` + `loadPausedSchedulerIds`; worker читает paused-set в блоке `ENABLE_SYNC_CRON`. `AuditEntity` расширен (`sync_state`/`sync_schedule`/`job_queue`). 4 клиентских компонента на общем `<Dialog>` (§9 a11y).

## Проверка состояния

```
npm run test:unit   # 1174 passed (145 файлов)
npm run typecheck   # 0 errors
npm run lint        # 0 warnings/errors
npm run build       # ✓ 62 маршрута (вкл. /admin/sync, /admin/health, /api/admin/dlq/[queue]/retry-all)
```

Новых unit-тестов: ~21 (syncControl 15 + queueStats 3 + scheduling 2 + server-actions 6 + route 4 + dialog 2 + recordAudit 1; пересекаются по файлам).

## Что отложено (operator-driven, НЕ баги)

1. **Применение миграции + integration-тесты.** `localhost:5432` недостижим из сессии агента (контейнер `db` healthy на хосте, но его порт в другом network namespace). Оператору на хосте:
   ```
   npx prisma migrate deploy          # применит 20260607000000_sync_schedule_pause
   npm run test:integration           # services.admin.syncControl.integration.test.ts (2 теста)
   npm run gate                        # полный L2.5 против Docker-PG (если нужно)
   ```
   Файл миграции и integration-тест закоммичены и typecheck-чисты; не запускались только из-за сетевой топологии окружения.
2. **e2e visual snapshot** `/admin/sync` — baseline генерируется на staged Linux/Chromium (`npm run e2e:visual:update`), не коммитится с Windows (паттерн прошлых фаз).
3. **Подсистемы B/C/D** (страница алертов / управление Company / runtime feature-flag тумблеры) — отдельные spec→plan циклы.

## Minor из финального ревью (не блокируют merge)

1. `SyncScheduleToggle` и `RetryAllButton` явно лейблят не все коды (`unknown_schedule`/`UNKNOWN_QUEUE`/`validation` падают в generic `Ошибка: <code>`). Эти коды **недостижимы из UI** (schedulerId/queue всегда из server-rendered статики) — defensive-only, не крэш. Менее полировано, чем sibling-формы.
2. `triggerSyncAction` не кладёт `details` в validation-ошибку (другие два кладут). UI `details` не читает — безвредно.
3. Двойной `new Set(...)`-spread в health-странице (косметика; вынести в `const`).

## Заметки / deviations

- **Спека §6 — лёгкая неточность:** middleware-матчер исключает `/api` (`/((?!api|...).*)`), поэтому retry-all роут защищён НЕ middleware, а guard-слоями 2+3 (`requireSession`+`requireAdmin` из `@/lib/auth/guard`) — ровно как существующий sibling per-job retry. Defense-in-depth соблюдён; формулировку спеки про «middleware режет /api/admin/*» читать как «guard режёт».
- **Два guard-модуля (намеренно):** server-actions → `@/lib/auth/requireRole` (redirect); API-роут → `@/lib/auth/guard` (response). Не перепутаны.
- **Миграция авторская (offline):** `migrate dev` не запускался (нет БД в сессии) — SQL написан вручную в стандартном формате Prisma; применяется `migrate deploy`.
- **Пауза при сбое Redis:** DB-flag пишется до Redis-операции; при падении Redis возвращается `queue_unavailable`, но интент в БД сохранён, воркер сойдётся к нему на следующем boot (спека §3.3, осознанно).

## Следующий шаг

Merge/PR ветки `claude/admin-sync-control-spec`. Перед merge оператор прогоняет отложенные integration/migration на хосте (см. выше).
