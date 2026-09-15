# Этап 4 «Задачи и автоматизация» — план

**Спека:** [2026-09-15-stage4-tasks-automation-design.md](../specs/2026-09-15-stage4-tasks-automation-design.md)
(подтверждена мержем PR [#618](https://github.com/aiprocadm/lk_otsfera/pull/618) 15.09.2026; умолчания `В-4-1`…`В-4-5` действуют).
**Требования:** `У-218`…`У-227`. **Программа:** «CRM для отдела продаж — замена Битрикс24» (ТЗ 12.09.2026), этап 4 из 11.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Порядок PR нарушать нельзя:** PR-3 опирается на `createTaskCore` из PR-1,
PR-4 — на движок PR-3, PR-5 — на поля просрочки PR-1. Каждый PR открывается от
`main` (§14 CLAUDE.md), каждый несёт свой страж, **проверенный мутацией**.

**Гейты каждого PR** (CI мёртв с 12.09, всё локально):
`npm run typecheck` · `npm run lint` · `npm run test:unit` ·
**`npm run test:integration`** (урок этапа 3 — красный интеграционный тест
пролежал пять PR) · `npm run boundaries` · `npm run deadcode` ·
`npm run tz:status`.

---

## PR-1. Страница задачи, обсуждение, чек-лист (`У-218`, `У-219`)

### Схема и миграция

- [x] `TaskComment` (`taskId` Cascade, `authorId`, `body`, `mentionUserIds String[]`, `@@index([taskId, createdAt])`)
- [x] `TaskChecklistItem` (`taskId` Cascade, `title`, `isDone`, `sortOrder`, `doneById?`, `doneAt?`, `@@index([taskId, sortOrder])`)
- [x] Колонки `Task`: `createdByRuleId String?` (FK добавится в PR-3 — пока просто колонка + индекс), `overdueNotifiedAt DateTime?`, `overdueEscalatedAt DateTime?`
- [x] Индекс `@@index([companyId, status, dueDate])`
- [x] Миграция через `npx prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new> --script`; `npm run prisma:generate`

### Сервисы

- [x] Расщепить `createTask` → `createTaskCore(tx, data)` (без гарда) + `createTask(prisma, session, input)` (`staffGate` + `validateRefs` + core). Поведение существующих вызовов не меняется
- [x] `src/lib/services/tasks/comments.ts`: `listTaskComments`, `addTaskComment` (разбор `@`-упоминаний, `note_mention` упомянутым, `task_comment` исполнителям и создателю кроме автора)
- [x] `src/lib/services/tasks/checklist.ts`: `addChecklistItem`, `toggleChecklistItem`, `deleteChecklistItem`, `listChecklist`, `hasOpenChecklistItems`. Переименование и перетаскивание пунктов НЕ делаем: в форме их нет, а экспортировать неиспользуемое запрещает §12b — понадобятся, появятся вместе с интерфейсом
- [x] `getTask(prisma, session, id)` — карточка целиком: задача, связи, исполнители, чек-лист, комментарии, история из `AuditLog`
- [x] `moveTask`/`updateTask`: перевод в `done` при незакрытом чек-листе → `checklist_incomplete`, обходится `force: true` (`Р-Э4-9`)
- [x] `listTaskBoard`/`TaskCard`: прогресс чек-листа (`checklistDone`/`checklistTotal`) узким `_count`, без N+1

### Уведомления и аудит

- [x] Тип `task_comment` в `NOTIFICATION_TYPES` (audience `['staff']`, producer — `services/tasks/comments.ts`)
- [x] Новые действия в `AUDIT_ACTIONS` + русские названия в `lib/audit/labels.ts` (иначе не соберётся)

### Server actions и экраны

- [x] `src/server-actions/tasks/index.ts`: `addTaskCommentAction`, `addChecklistItemAction`, `toggleChecklistItemAction`, `deleteChecklistItemAction`; `revalidate()` добавляет `/manager/tasks/[id]` и `/leader/tasks/[id]`
- [x] Страницы `/{manager,leader}/tasks/[id]/page.tsx` — серверные, свой `canSeeTask`-чек на странице (§4, даже при middleware)
- [x] Компоненты `task-page-header`, `task-comments`, `task-checklist` (палитра — из примитивов `ui/`, brand-hex не инлайнить)
- [x] Карточка на доске и в списке ведёт на страницу; диалог быстрого создания остаётся
- [x] §15: заголовок + крошки + подзаголовок одной строкой + главная кнопка; пустые состояния «Обсуждения пока нет» и «Чек-лист пуст» — с кнопкой
- [x] Хлебные крошки задачи — существующим `buildCabinetBreadcrumbs`, правка реестра не понадобилась

### Стражи (каждый — мутацией)

- [x] `tasks.checklist-gate` — в `done` с невыполненными пунктами только по `force`
- [x] `services.tasks.comments` — комментарий виден только сотрудникам своей компании; упоминание шлёт `note_mention`
- [x] `pages.manager-tasks-id` / `pages.leader-tasks-id` — страница зовёт `canSeeTask`, чужая задача → `notFound`
- [ ] Покрытие 100/100/100/100 — **не измерено в этом PR**: гейт считается только полным прогоном `test:coverage` (оба слоя + инструментация, ~30 мин, L3 по §6). У каждого нового файла логического слоя есть свой тест; полный прогон — перед close-out этапа (PR-7)

---

## PR-2. Задача откуда угодно (`У-220`)

- [x] Колонки `Task`: `linkedContactId`, `linkedDialogId`, `linkedDocumentId` (+ FK `SetNull`, индексы, обратные связи в `Contact`/`MessengerDialog`/`Document`)
- [x] `validateRefs` — три новые проверки company-scope (ни одной не пропустить)
- [x] `inputSchema`, `taskInput`, `TaskCard`, `CARD_SELECT`, запись привязок в `createTask`/`updateTask`
- [x] `listLinkedTasks` и `listLinkedTasksAction`: union `link` расширяется с двух вариантов до семи
- [x] `LinkedTasksPanel`: проп `link` — семь вариантов; quick-add ставит нужное поле
- [x] Блок «Задачи» смонтировать: карточка диалога, карточка документа/КП (через `children` `DocumentDetailView`), **карточка организации** (поле было, панели не было)
- [x] Вкладка «Задачи» карточки контакта: `CONTACT_CARD_TABS`, `CONTACT_TABS`, `ContactTabKey`, ветка в `listContactTab`, счётчик в `contact.counts`, `countOf` в `contact-card-screen.tsx`, флаг `internal_tasks`
- [x] Перенос задач при объединении контактов (`contacts/merge.ts` — третье обещание этапа 1)
- [x] Предзаполнение исполнителя ответственным менеджером объекта
- [x] Ревалидация карточек-источников после создания задачи
- [x] Переписать семь стражей §5.3 спеки (включая антистражи `isContactTabKey('tasks') === false` и `tab=tasks` как «неизвестная вкладка») — с комментарием, почему правило изменилось
- [x] Страж `tasks.links-scope` — все семь привязок проверяются на компанию (мутация: убрать одну проверку)

---

## PR-3. Движок правил (`У-222` движок, `У-223`, `У-227` частично)

- [x] Модели `AutomationRule`, `AutomationRun` (`@@unique([ruleId, eventId])`); FK `Task.createdByRuleId` → `AutomationRule`
- [x] Каталоги `AUTOMATION_TRIGGERS` (8 триггеров, `notificationType` — якорь в реестре уведомлений у четырёх, `callSite` у всех) и `AUTOMATION_ACTIONS`
- [x] `src/lib/automation/{dispatch,rules,actions,templates}.ts`; `emitAutomationEvent` с `eventId`, отбором правил, `conditions`, fail-open
- [x] Восемь врезок `emitAutomationEvent` в сервисы бизнес-операций
- [x] Очередь `automation.run` (конкурентность 2) + процессор `src/worker/processors/automation-run.ts` + регистрация в `worker/index.ts`
- [x] Идемпотентность: `jobId = auto_<ruleId>_<eventId>` + `P2002`-пропуск на `AutomationRun`
- [x] Действия `create_task` (через `createTaskCore`) и `notify`; выбор исполнителя по `Р-Э4-5`
- [x] Флаг `automation` (поведенческий, три точки чтения в комментарии флага)
- [x] Тип `automation_failed` в реестре уведомлений
- [x] **Стражи до первого правила из коробки:** `automation.no-loop.guardrail`, `automation.actions-cannot-emit.guardrail` (+ правило dependency-cruiser), `automation.emit-coverage.guardrail`, `automation.company-scope`, `automation.idempotency` (integration), `automation.fail-open` — каждый мутацией

---

## PR-4. Раздел хаба и правила из коробки (`У-222` UI, `У-224`)

- [x] Право `settings.automation.manage` в `SETTINGS_CAPABILITIES`
- [x] Раздел хаба в `lib/navigation/settings.ts` (группа `catalogs`, `cabinets: ['admin','leader']`, `flag: 'automation'`)
- [x] Зеркальная пара страниц `/{admin,leader}/settings/processes/automation` + `requireSettingsSection`
- [x] Форма «Если … (условия) → То …» с предпросмотром подстановок; неизвестная подстановка — отказ сохранить
- [x] Журнал срабатываний (`AutomationRun`) с результатом и ошибкой
- [x] `scopeOf`: admin выбирает компанию, leader — своя; leader без компании → `company_required`
- [x] Пять правил из коробки миграцией (`isBuiltin`, выключены); `send_message` в форме есть, но ни в одном из них
- [x] Аудит переключений правил; §15 на новых экранах

---

## PR-5. SLA задач и «Мой день» (`У-225`, `У-226`)

- [ ] `Company.taskOverdueEscalationDays Int @default(3)`
- [ ] Тип `task_overdue`; расширение `sla-escalation.ts` на задачи: исполнителю в день просрочки (`overdueNotifiedAt`), руководителю на N-й день (`overdueEscalatedAt`), оба claim атомарным `updateMany` по `null`
- [ ] Блок «Просроченные» на дашборде руководителя
- [ ] Раздел хаба `catalogs.slaIntake` → «SLA», второй блок «SLA задач» (`В-4-2`, умолчание); глоссарий и крошки в том же PR
- [ ] «Мой день» менеджера: диалоги `waiting_staff` (мои), КП с истекающим сроком, прогресс чек-листов, события календаря
- [ ] Страж `tasks.overdue-claims` — два уведомления в разные дни, каждое ровно один раз (мутация: склеить поля)

---

## PR-6. Повторяющиеся задачи (`У-221`, «Важно»)

- [ ] `Task.recurrence Json?`, `Task.recurrenceParentId`
- [ ] Очередь `tasks.recurrence` + процессор + расписание 06:00 МСК
- [ ] Материализация следующего экземпляра: тот же чек-лист (пункты не выполнены), те же исполнители
- [ ] Редактирование «этой» / «всех будущих»; отключение серии
- [ ] `until` в прошлом завершает серию без ошибки
- [ ] Интеграционный тест процессора (`worker.processor-coverage` покраснеет сам)

---

## PR-7. Стражи, аудит требований, close-out (`У-227`)

- [ ] Мутационная проверка **всех** стражей этапа, отчёт в close-out
- [ ] `docs/tz/AUDIT.md` — `У-218`…`У-227` с якорями и вердиктами
- [ ] CHANGELOG.md
- [ ] Глоссарий: «Правило автоматизации», «Чек-лист», «Повторяющаяся задача», «Журнал срабатываний»
- [ ] Реестр исключений зеркала: у админа нет задач; «Мой день» только у менеджера (`В-4-1`)
- [ ] Мобильные 390×844 для новых экранов (или явная запись в долг, если стенда нет)
- [ ] `STATUS.md`, close-out `2026-09-15-stage4-tasks-automation-DONE.md`
