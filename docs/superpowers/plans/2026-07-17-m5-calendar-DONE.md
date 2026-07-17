# M5 — Календарь сотрудников — DONE

**Дата завершения:** 2026-07-17
**Branch:** `claude/m5-calendar`
**Base commit:** `774d490` (`main`, merge PR #207 — M4 staff chat)
**Spec:** [2026-07-17-m5-calendar-design.md](../specs/2026-07-17-m5-calendar-design.md)
**Plan:** [2026-07-17-m5-calendar.md](2026-07-17-m5-calendar.md)

## Что отгружено

### Схема (Task 1)
- 2 аддитивные таблицы в [`prisma/schema.prisma`](../../../prisma/schema.prisma): `CalendarEvent` (company-scoped hard FK C8, `remindAt`/`reminderSentAt`, nullable SetNull-линки на Order/Organization — идиома Task) + `CalendarEventAttendee` (M:N, идиома TaskAssignee), миграция `20260717124939_m5_calendar`, индексы `[companyId, startsAt]` и `[remindAt]`.

### Сервисный слой (Task 2)
- [`policy.ts`](../../../src/lib/services/calendar/policy.ts) — `canSeeEvent`: admin Model A; manager — company-floor C8, затем уровень `session.accessProfile?.tasks` (календарь наследует scope задач, v1; `assigned` ≡ `own`).
- [`events.ts`](../../../src/lib/services/calendar/events.ts) — CRUD по эталону tasks.ts: Result-контракт, zod (`endsAt > startsAt`, `remindMinutes ∈ {15,60,1440}`), `validateRefs` (order/org/attendees принадлежат компании), `$transaction` + audit `calendar_event_created/updated/deleted`; `remindAt = startsAt − remindMinutes`; при update rearm `reminderSentAt` только если новое `remindAt` в будущем.
- [`items.ts`](../../../src/lib/services/calendar/items.ts) — `listCalendarItems`: события ∪ задачи (`taskWhereForLevel` — scope переиспользован, не дублирован) → единая хронология; `getEventFormOptions` (company-scoped селекты, `NO_COMPANY_SENTINEL` fail-safe).
- `AuditEntity` += `'calendar_event'`.

### Напоминания — worker (Task 3)
- Очередь `notifications.calendarReminder` + `CALENDAR_REMINDER_SCHEDULES` (`*/5 * * * *`) + регистрация в `worker/index.ts`.
- [`calendar-reminder.ts`](../../../src/worker/processors/calendar-reminder.ts) — атомарный claim `reminderSentAt` (`updateMany where reminderSentAt:null` — параллельный воркер получает count 0), протухшие >24ч помечаются без отправки, получатели создатель∪участники (дедуп), `createNotification` + `deliverNotificationToUser` (dedupKey = id строки Notification), fan-out best-effort.

### Флаг + поверхность (Task 4–5)
- `staff_calendar` — opt-in route-флаг, 3 точки: nav (`flag:`), page-`notFound()`, гейт server-actions (`isFeatureEnabled → forbidden`, идиома backupCodes). Middleware-точки нет — прецедент `internal_tasks`.
- [`server-actions/calendar`](../../../src/server-actions/calendar/index.ts) — create/update/delete, FormData→input, revalidate обеих страниц.
- [`lib/calendar/month.ts`](../../../src/lib/calendar/month.ts) — чистая математика сетки (Monday-first 6×7, `?m=YYYY-MM`), общая для серверной выборки и клиентского рендера.
- [`calendar-month-view.tsx`](../../../src/components/calendar/calendar-month-view.tsx) — сетка, чипы событий (клик → диалог) и задач (read-only Link на канбан, line-through при завершении), панель «Ближайшие» (отсечка по today, лимит 8), навигация месяцев + «Сегодня», «+» в ячейке дня.
- [`event-dialog.tsx`](../../../src/components/calendar/event-dialog.tsx) — Dialog-примитив (§9), участники-чекбоксы, напоминание select, линки на организацию/заявку.
- Страницы `/manager/calendar` (`requireManager`) + `/leader/calendar` (`requireManagerLeader`) — sibling, `force-dynamic`; nav-пункты «Календарь» 📅 у manager и leader.

### Тесты (Task 6, 3 субагента параллельно)
- **119 новых тестов**: unit — policy (8), events (26), items (14), month (12), reminder (9), server-actions (13), scheduling (2); page-тесты обеих страниц (7); компоненты event-dialog (10) + month-view (13); integration процессора (4, живой Postgres: fan-out, идемпотентность повторного прогона, stale, untouched).
- Канон-тесты обновлены: nav leader 14→15 / manager 18→19, opt-in набор флагов, сайдбары.
- Guardrail `worker.processor-coverage` зелёный (integration-тест импортирует процессор).

## Решения агента / отклонения от спеки

- **Гейт server-actions** — `isFeatureEnabled → {ok:false,error:'forbidden'}` (Result-идиома backupCodes), а не `requireFeature` с исключением: страница может быть открыта в момент выключения флага, Result деградирует мягче.
- **Integration-тест напоминаний** — partial mock `@/lib/notifications` через `importOriginal`: реальный `createNotification` пишет в живую БД (строки Notification — проверяемая улика), наружу смотрит только `deliverNotificationToUser` (замокан). Отличается от эталона certificate-expiry (там полный мок) осознанно.
- **`getEventFormOptions` без уровня scope** — списки для селектов диалога company-scoped целиком (как `getTaskFormOptions`); видимость самих событий режет `canSeeEvent`/`eventScopeWhere`.
- **Мультидневные события** — чип рендерится только в ячейке дня начала (v1); выборка пересечения диапазона это уже учитывает.

## Известные хрупкости (не блокеры)

- **Протухшее напоминание сжигается навсегда** (claim до stale-проверки) — по спеке §5: воркер лежал >24ч → напоминание неактуально, не спамим.
- **`datetime-local` → `new Date()` на сервере** — парсинг в TZ сервера (та же идиома, что у `dueDate` задач G3); при расхождении TZ браузера и сервера время сдвинется. Унаследованный паттерн, не новый риск M5.
- **Текст пустого состояния «Ближайших»** («В этом месяце…») слегка неточен: отсечка по `today`, прошедшие события месяца в панель не попадают. Косметика.
- **Server-actions: `updateEventAction` без id → `validation`, `deleteEventAction` без id → `not_found`** — асимметрия унаследована от G3-экшенов.

## Сознательно отложено (фаза 2, спека §6)

Недельный/дневной вид, drag-n-drop, RRULE-повторы; агрегация `Order.deadline`/`SalesTarget`; отдельный scope-уровень календаря в конструкторе ролей G1; accept/decline участия; ICS-экспорт.

## Верификация — статус по гейтам

| Гейт | Результат |
|---|---|
| `npm run test:unit` (полный L2) | **679 файлов / 6702 passed** (3 skipped — преждесуществующие) |
| Integration процессора | 4/4 passed (живой Postgres) |
| `npm run typecheck` | чисто |
| `npm run lint` | `No ESLint warnings or errors` |
| Live smoke | login manager/leader → `/manager/calendar` + `/leader/calendar` 200, сетка/«Ближайшие»/«Новое событие» рендерятся (флаги env) |

**Не запускалось (осознанно, как M4) — на контроллере при финализации:** `npm run test:coverage` (100%-порог, долгий полный прогон), `npm run build`, browser-smoke CRUD события руками, `npm run gate`.

---

**Следующий шаг:** контроллер прогоняет coverage/build/ручной smoke и решает про PR (см. `superpowers:finishing-a-development-branch`).
