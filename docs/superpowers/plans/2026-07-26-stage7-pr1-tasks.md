# Этап 7 PR-1 — Задачи: привязки, фильтры, список, уведомления (ФТ-7.1–7.4)

Спека: [2026-07-26-stage7-intake-tasks-sla-design.md](../specs/2026-07-26-stage7-intake-tasks-sla-design.md) §3, §6 (подтверждена 26.07.2026).
Ветка `claude/stage7-intake-tasks-sla`. ФТ-7.5 (создание из звонка/обращения/заявки) — в PR-2 вместе с Intake.

## A. Модель (аддитивная миграция)

- [x] `Task`: `+linkedLeadId?` (SetNull, `@@index`), `+linkedDealId?` (SetNull,
      `@@index`), `+dueSoonNotifiedAt DateTime?`; обратные relations в `Lead.tasks`
      / `Deal.tasks`. Миграция `stage7_pr1_task_links_due_soon` + prisma:generate.

## B. Сервисы задач

- [x] `tasks.ts`: `inputSchema` + `linkedLeadId/linkedDealId`; `validateRefs` —
      лид (существование; лиды single-tenant, company-floor нет — зеркало
      `leadWhereForLevel`), сделка (companyId === компании задачи);
      create/update пишут поля; `updateTask` сбрасывает `dueSoonNotifiedAt`
      при смене `dueDate` (перенос срока → повторное «скоро срок»).
- [x] Уведомление `task_assigned` (ФТ-7.2): хелпер `notifyTaskAssigned` —
      только НОВЫМ исполнителям (диф в `syncAssignees`), исключая
      самоназначение; после коммита транзакции; graceful (ошибка фан-аута не
      валит операцию); `meta.url` → доска задач. Точки: `createTask`
      (assigneeIds), `updateTask`/`assignTask` (диф).
- [x] `board.ts`: `listTaskBoard(prisma, session, filters?)` — `scope
      'mine'|'all'` (mine = создатель ∨ исполнитель, поверх
      `taskWhereForLevel`), `assigneeId` (лидер), `overdue` (dueDate < now,
      статус ≠ done); `TaskCard` + `linkedLeadId/Subject`,
      `linkedDealId/Title`; `listLinkedTasks(prisma, session,
      {leadId|dealId})` — плоский список для панелей.

## C. Джоб task_due_soon (ФТ-7.2)

- [x] `queues.ts`: `notifications.taskDueSoon`; `scheduling.ts`:
      `TASK_DUE_SOON_SCHEDULES` (cron `0 7 * * *`, Europe/Moscow) +
      `registerTaskDueSoonSchedules`.
- [x] Процессор `src/worker/processors/task-due-soon.ts`: задачи с `dueDate ≤
      конец завтра`, статус ≠ done, `dueSoonNotifiedAt = null` → атомарный
      claim `updateMany({... dueSoonNotifiedAt: null} → now)` (образец
      calendar-reminder) → уведомление исполнителям (нет исполнителей →
      создателю): «Срок задачи близко» + `meta.url`.
- [x] Регистрация в `worker/index.ts` (startWorker + register при
      ENABLE_SYNC_CRON) — guardrail-тест процессора обязателен.

## D. UI

- [x] `TaskDialog`: скрытые поля `linkedLeadId/linkedDealId` (сохранение
      связей при редактировании!), строка «Привязана к лиду/сделке: …»,
      optional prop `link` для префилла из панелей.
- [x] `task-board.tsx`: чип лида/сделки на карточке.
- [x] `tasks-toolbar.tsx` (client): «мои/все», «просроченные», фильтр по
      исполнителю (только лидер), переключатель «доска/список» — через
      URL-searchParams.
- [x] `task-list.tsx` (client): таблица (название, колонка, приоритет, срок
      с подсветкой просрочки, исполнители, связи), сортировка
      срок/приоритет, клик → TaskDialog.
- [x] `linked-tasks-panel.tsx` (client): список привязанных задач + быстрая
      «+ Задача» (title, срок, «на себя» по умолчанию) — на карточке лида
      (server-fetch `listLinkedTasks`) и в `deal-dialog` (ленивая подгрузка
      `listLinkedTasksAction` по образцу заметок).
- [x] Страницы `manager/tasks` + `leader/tasks`: searchParams → фильтры;
      leader дополнительно фильтр по исполнителю.
- [x] Server-actions: маппинг новых полей в `taskInput`,
      `listLinkedTasksAction`.

## E. Тесты (порог 100%)

- [x] Unit: validateRefs (лид/сделка, чужая компания), сброс
      dueSoonNotifiedAt, notifyTaskAssigned (диф, самоназначение, graceful),
      фильтры board-where, listLinkedTasks, процессор (claim, fallback на
      создателя, идемпотентность), scheduling-регистрация, server-actions,
      компоненты (toolbar/list/panel/dialog/board), страницы
      (renderServerComponent, searchParams).
- [x] Integration (живой Postgres): миграция; задача с привязкой к
      лиду/сделке (SetNull при удалении); полный цикл due-soon джоба
      (двойной прогон — второй не шлёт; перенос срока → шлёт снова);
      уведомление task_assigned.
- [x] Актуализация затронутых тестов (QUEUE_NAMES, worker.index, taskInput).

## F. Финал

- [x] typecheck / lint / unit / integration (живой Postgres) зелёные.
- [x] CHANGELOG.md, STATUS.md (журнал), push, PR (переоформить #233 в PR-1).
