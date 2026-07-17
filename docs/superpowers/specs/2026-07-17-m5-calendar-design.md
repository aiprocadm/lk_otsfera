# Spec: M5 — Календарь сотрудников (события + агрегация задач, напоминания)

**Дата:** 2026-07-17
**Источник:** программа CRM-паритет (M1 ✅ #201 → M2 ✅ #202 → M3 ✅ #205 → M4 ✅ #207 → **M5**); позиция в roadmap брейнсторма — «M5 (календарь)». Отдельного брейнсторма по M5 не было — скоуп v1 предложен агентом по образцу соседних модулей, минимально-рисковый.
**Статус:** design — предложение агента, реализация в той же сессии (subagent-driven паттерн M4). Открытые вопросы §6 — кандидаты на фазу 2 после реакции владельца.
**Ветка:** `claude/m5-calendar` (от `main`@`774d490`, включает M1–M4).

> **Домен staff-only.** Календарь — рабочий инструмент сотрудников (admin / руководитель / менеджеры): встречи, созвоны, дедлайны. Клиентские роли (partner/organization/student) его не видят никогда — как задачи G3 (§4 sibling-rule). Существующие даты сделок (`Order.deadline` и т.п.) в v1 не агрегируются — дверь открыта (§6.2).

---

## 0. Решения (зафиксированы в этой спеке)

1. **Подход M1-агрегатор + одна новая таблица.** Хранимая модель только для **событий** (`CalendarEvent` + участники M:N). **Задачи** (`Task.dueDate`, трек G3) в календарь попадают read-агрегацией через существующий scope-шов `taskWhereForLevel` — без дублирования и без синхронизации.
2. **Скоуп видимости = скоуп задач.** Календарь — то же «внутреннее рабочее» пространство, что и задачи: уровень охвата берётся из `session.accessProfile?.tasks` (`all|own|assigned`), company-floor C8 обязателен, admin — Model A. Отдельный capability не заводим (v1).
3. **Страницы:** `/manager/calendar` (+ `/leader/calendar` — sibling, как у задач G3). Admin своей страницы не имеет (симметрия с G3: admin задачами тоже управляет не из зеркала).
4. **Напоминания входят в v1:** `remindAt` на событии, cron-джоб каждые 5 минут, доставка через существующий Трек D (`createNotification` + `deliverNotificationToUser`, dedupKey = id строки Notification — идемпотентность BullMQ). Получатели — создатель + участники.
5. **Флаг `staff_calendar`** — route-флаг, opt-in (staged rollout, как все M-модули), 3 точки: nav (`flag:`), page-гейт `notFound()`, server-actions гейт `requireFeature`.
6. **UI v1:** месячная сетка + панель «Ближайшие» + создание/редактирование/удаление события в `Dialog`-примитиве (§9 CLAUDE.md). Задачи в сетке — read-only чипы со ссылкой на `/manager/tasks`. Неделя/день-виды, drag-n-drop, повторяющиеся события — фаза 2.

## 1. Контекст (сверено по коду)

- **Задачи (G3):** `Task.dueDate DateTime?`, `completedAt`, `assignees TaskAssignee[]` ([schema.prisma:710](../../../prisma/schema.prisma)); scope — `taskWhereForLevel(session, level)` + `canSeeTask` ([accessProfile.ts:134](../../../src/lib/auth/accessProfile.ts)); сервис-эталон Result-контракта — [tasks.ts](../../../src/lib/services/tasks/tasks.ts) (`staffGate`, `validateRefs`, `$transaction` + `recordAudit`, `TaskError → Result`).
- **Уведомления (Трек D):** `deliverNotificationToUser({userId,title,body,type,url?,dedupKey})` ([core.ts:51](../../../src/lib/notifications/core.ts)); эталон cron-напоминаний — certificate expiry: processor [certificate-expiry.ts](../../../src/worker/processors/certificate-expiry.ts) + `CERT_EXPIRY_SCHEDULES` (`upsertJobScheduler`, pattern `0 7 * * *`) в [scheduling.ts](../../../src/lib/jobs/scheduling.ts).
- **Навигация:** `navByRole` ([cabinet.ts:22](../../../src/lib/navigation/cabinet.ts)); образец пункта G3 — `{ href: '/manager/tasks', label: 'Задачи', icon: '✅', flag: 'internal_tasks' }`; leader-пункты без `flag` не гейтятся — для M5 пункт leader несёт `flag: 'staff_calendar'` (как `/leader/tasks` несёт `internal_tasks`).
- **Гварды страниц:** `requireManager()` / `requireManagerLeader()` ([requireRole.ts](../../../src/lib/auth/requireRole.ts)); страница-эталон — [manager/tasks/page.tsx](../../../src/app/manager/tasks/page.tsx) (`isFeatureEnabled → notFound()`, `force-dynamic`).
- **Guardrail воркера:** каждый processor обязан иметь integration-тест (`worker.processor-coverage.guardrail.test.ts`).

**Безопасность (сквозной инвариант).** Тело события — данные, не команды. Cross-company изоляция (C8) держится на company-floor в where и в `canSeeEvent`. **Журнал ПДн (§25.7) не применяется** — событие staff-календаря не читает ПДн физлиц клиентского контура (линк на сделку/организацию отображается идентификатором и названием, которые менеджер и так видит в своём scope; та же логика, что у Task.linkedOrder).

## 2. Модель данных — 2 аддитивные таблицы (миграция обратима)

```prisma
/// M5 (спека 2026-07-17): событие staff-календаря. Company-scoped (hard FK, C8).
/// Привязки к заявке/организации — nullable SetNull (идиома Task). Напоминание:
/// remindAt вычисляется сервисом (startsAt − remindMinutes) и «сжигается»
/// атомарным claim'ом reminderSentAt в процессоре (идемпотентность при retry).
model CalendarEvent {
  id                   String                  @id @default(cuid())
  createdAt            DateTime                @default(now())
  updatedAt            DateTime                @updatedAt
  companyId            String
  company              Company                 @relation(fields: [companyId], references: [id], onDelete: Cascade)
  title                String
  description          String?
  location             String?
  startsAt             DateTime
  endsAt               DateTime?
  allDay               Boolean                 @default(false)
  remindAt             DateTime?
  reminderSentAt       DateTime?
  createdById          String
  createdBy            User                    @relation("CalendarEventCreatedBy", fields: [createdById], references: [id])
  linkedOrderId        String?
  linkedOrder          Order?                  @relation("CalendarEventLinkedOrder", fields: [linkedOrderId], references: [id], onDelete: SetNull)
  linkedOrganizationId String?
  linkedOrganization   Organization?           @relation("CalendarEventLinkedOrganization", fields: [linkedOrganizationId], references: [id], onDelete: SetNull)
  attendees            CalendarEventAttendee[]

  @@index([companyId, startsAt])
  @@index([remindAt])
}

model CalendarEventAttendee {
  id        String        @id @default(cuid())
  createdAt DateTime      @default(now())
  eventId   String
  event     CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  userId    String
  user      User          @relation("CalendarEventAttendee", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([eventId, userId])
  @@index([userId])
}
```

Back-relations: `User.calendarEventsCreated/calendarAttendances`, `Company.calendarEvents`, `Order`/`Organization` — по одной relation.

## 3. Сервисный слой — `src/lib/services/calendar/`

- **`policy.ts`** — `canSeeEvent(session, {companyId, createdById, attendeeUserIds}): boolean`: admin → true; manager → company-floor C8, затем `session.accessProfile?.tasks` (`all`/нет профиля → вся компания; `own`/`assigned` → создатель ∨ участник). `assigned` для событий тождественен `own` (у события нет закреплённой организации-скоупа в v1 — линк не влияет на видимость, §6.3).
- **`events.ts`** — `createEvent/updateEvent/deleteEvent(prisma, session, ...)` по эталону tasks.ts: `staffGate`, zod-схема (`title ≤200`, `description ≤5000`, `startsAt` обязателен, `endsAt > startsAt`, `remindMinutes ∈ {15,60,1440}?`, `attendeeIds` — сотрудники компании), `validateRefs` (order/org/attendees принадлежат компании), `$transaction` + `recordAudit` (`calendar_event_created/updated/deleted`), `CalendarError → Result`. `remindAt = remindMinutes ? startsAt − remindMinutes*60_000 : null`; при update пере-вычисляется и `reminderSentAt` сбрасывается, если `remindAt` сдвинулся в будущее.
- **`items.ts`** — `listCalendarItems(prisma, session, {from, to})`: события (`companyId` + scope-OR если уровень `own|assigned` + пересечение [from,to) по `startsAt`/`endsAt`) ∪ задачи (`taskWhereForLevel(session, session.accessProfile?.tasks ?? 'all')` + `dueDate` в диапазоне) → `CalendarItem[]` (`kind: 'event'|'task'`, отсортировано по дате). Также `getEventFormOptions` (коллеги + сделки/организации для линков — переиспользует подход `getTaskFormOptions`).

## 4. Поверхность

- **Server actions** `src/server-actions/calendar/index.ts` (`'use server'`): `createEventAction`, `updateEventAction`, `deleteEventAction` — `requireSession()` + `requireFeature('staff_calendar')`, FormData→input, revalidate `/manager/calendar` + `/leader/calendar`.
- **Страницы:** `src/app/manager/calendar/page.tsx` (`requireManager`, флаг-гейт, `listCalendarItems` на месяц ±похвост, `force-dynamic`) и `src/app/leader/calendar/page.tsx` (`requireManagerLeader`, тот же дата-путь). Обе рендерят клиентский `<CalendarMonthView/>`.
- **Компоненты** `src/components/calendar/`: `calendar-month-view.tsx` (сетка месяца, чипы событий/задач, панель «Ближайшие», навигация месяцев через `?m=YYYY-MM`), `event-dialog.tsx` (`Dialog`-примитив: создание/редактирование, участники-чекбоксы, напоминание select, линки select). Палитра — примитивы `ui/`, без инлайн-hex.
- **Навигация:** `{ href: '/manager/calendar', label: 'Календарь', icon: '📅', flag: 'staff_calendar' }` (manager) + аналогичный `/leader/calendar` (leader).
- **Флаг:** `staff_calendar` в `FEATURE_FLAGS` + `OPT_IN_FLAGS`; комментарий с точками чтения (nav, 2 страницы, server-actions). Middleware-префикс не добавляется — по прецеденту G3 (`internal_tasks` живёт без middleware-точки: страничный `notFound()` после auth не утекает).

## 5. Напоминания — worker

- Очередь **`notifications.calendarReminder`** (queues.ts, стандартный retry-профиль §7).
- Расписание в scheduling.ts по образцу `CERT_EXPIRY_SCHEDULES`: `CALENDAR_REMINDER_SCHEDULES`, pattern **`*/5 * * * *`** (частота оправдана: напоминания точечные о встречах), регистрация в `worker/index.ts`.
- Processor `src/worker/processors/calendar-reminder.ts`: `runCalendarReminders(prisma, now)` — кандидаты `remindAt ≤ now && reminderSentAt = null` (лаг > 24ч отбрасывается как протухший, только помечается); **атомарный claim** `updateMany({where: {id, reminderSentAt: null}, data: {reminderSentAt: now}})` → count 0 = другой воркер забрал; получатели = создатель ∪ участники; на каждого `createNotification({type:'calendar_event_reminder'})` + `deliverNotificationToUser({dedupKey: row.id, url: '/manager/calendar'})`. Fan-out best-effort (try/catch + log), как M4.
- Integration-тест процессора — обязателен (guardrail).

## 6. Открытые вопросы → фаза 2

1. Недельный/дневной вид, drag-n-drop перенос, повторяющиеся события (RRULE).
2. Агрегация дат сделок (`Order.deadline`) и `SalesTarget` в сетку.
3. Отдельный scope-уровень календаря в конструкторе ролей (G1) вместо наследования `tasks`.
4. Приглашения/подтверждения участия (accept/decline) и статус занятости.
5. ICS-экспорт / подписка.

## 7. Тестовая стратегия

Unit (мок-prisma по образцу staff-chat): policy (роли/floor/уровни), events CRUD (validation/refs/scope/remindAt-пересчёт), items (склейка+сортировка, диапазон), reminder-выборка (протухшие/claim). Server-actions тест (hoisted-мок сервиса). Page-тесты обеих страниц (renderServerComponent, флаг off → notFound). Integration: processor (живой Postgres, идемпотентность повторного прогона). Полный `test:unit` перед коммитом.
