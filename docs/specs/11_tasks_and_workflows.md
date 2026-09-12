# Задачи и автоматизация

**Этап дорожной карты:** 4 «Задачи и автоматизация» · **Требования:** `У-218`…`У-227` · **Приоритет:** MVP (`У-218`…`У-220`, `У-222`…`У-227`), Важно (`У-221`) · **Оценка:** 6–7 дней.
**Зависимости:** этап 1 (контакты — `linkedContactId`), этап 3 (диалоги — `linkedDialogId`, статус `waiting_staff` для правила). **От него зависят:** отчёт «просроченные задачи» (этап 7).

## 1. Цель доработки

Задачи в проекте — доска с исполнителями и сроком (`G3`). Отделу продаж не хватает трёх вещей из Битрикса: **обсуждения и чек-листов внутри задачи**, **задачи из любого места** и **роботов** — правил «событие → задача / уведомление / сообщение». Правила делаются короткими и без графического редактора (`01` §4).

## 2. Текущая ситуация — что найдено в коде

| Что | Якорь |
|---|---|
| `Task` (`title`, `description`, `status todo/in_progress/review/done`, `priority`, `columnId`, `dueDate`, `completedAt`, связи `linkedOrderId/OrganizationId/LeadId/DealId`, `dueSoonNotifiedAt`), `TaskColumn` по компании, `TaskAssignee` | `schema.prisma:1100-1173` |
| Сервисы: `listTaskBoard`, `moveTask`, `createTask`, `updateTask`, `deleteTask`, `assignTask`, `listLinkedTasks`, колонки; уведомления `task_assigned`, `task_due_soon` (очередь `notifications.taskDueSoon`) | `src/lib/services/tasks/`, `registry.ts` |
| Экраны: `/manager/tasks`, `/leader/tasks` (доска; форма в диалоге); страницы задачи `/…/tasks/[id]` **нет**; у админа задач **нет** (исключение зеркала) | `src/app/*/tasks/page.tsx` |
| Задача из входящего/звонка (Intake «Задача»), из карточки организации/заказа | `services/intake/convert.ts` |
| Комментарии, чек-листы, повторы, шаблоны задач | **не найдено** |
| Автоматизация «событие → действие» | **не найдено** (`grep -rniE "automation|автоматизац" src` → 0) |
| SLA: только входящие (`monitoring.slaEscalation` по `Company.slaResponseHours`) | `src/lib/monitoring/`, `SlaEscalation` |
| «Мой день» менеджера | `services/manager/myDay.ts` |
| Единый источник событий — реестр уведомлений (`notifyManagers`/`notifyOrgUsers`/`notifyStaff` вызываются в сервисах) | `src/lib/notifications/` |

## 3. Что нужно изменить

**`У-218` — страница задачи и комментарии.** `/{manager,leader}/tasks/[id]` (у админа — нет, исключение сохраняется): описание, статус, приоритет, срок, исполнители, связи (объекты со ссылками), чек-лист (`У-219`), **комментарии** — модель `TaskComment` (`taskId`, `authorId`, `body`, `mentionUserIds`, `createdAt`); уведомление `task_comment` исполнителям и создателю, `note_mention` при упоминании; история изменений задачи из аудита (статус, срок, исполнитель). С доски карточка открывает страницу; диалог быстрого создания остаётся.

**`У-219` — чек-лист.** `TaskChecklistItem` (`taskId`, `title`, `isDone`, `sortOrder`, `doneById`, `doneAt`); на карточке доски прогресс «3/5»; правило «задача с невыполненными пунктами не переводится в `done`» — с подтверждением «завершить всё равно».

**`У-220` — задача откуда угодно.** Кнопка «Задача» в карточке организации (есть), контакта (`linkedContactId` — новое поле), диалога (`linkedDialogId` — новое), входящего/звонка (есть), документа и КП (`linkedDocumentId` — новое), заказа (есть), сделки/лида (есть); в каждой карточке — блок «Задачи» (`listLinkedTasks` расширяется новыми связями); форма предзаполняет исполнителя ответственным менеджером объекта.

**`У-221` — повторяющиеся задачи (Важно).** `Task.recurrence Json?` (`{ freq: daily|weekly|monthly, interval, byWeekday?, byMonthDay?, until? }`), `Task.recurrenceParentId`; при завершении экземпляра или по расписанию (очередь `tasks.recurrence`, ежедневно 06:00 МСК) создаётся следующий с тем же чек-листом (пункты не выполнены) и исполнителями; редактирование «этой» или «всех будущих» (как в календарях); отключение серии.

**`У-222` — правила автоматизации.** Модель `AutomationRule` (`companyId`, `name`, `isActive`, `trigger` enum, `conditions Json`, `actions Json[]`, `createdById`, `updatedAt`, `isBuiltin`). Триггеры MVP: `order_status_changed { toStatusId }`, `lead_stage_changed { toStageId }`, `deal_stage_changed { toStageId }`, `document_issued { type }`, `payment_received`, `client_request_submitted { source? }`, `proposal_no_answer { days }` (по `docs.expireProposals`), `dialog_waiting_staff_overdue { hours }` (этап 3). Действия MVP: `create_task { titleTemplate, descriptionTemplate, assignee: responsible_manager | user:<id> | role:leader, dueInDays, priority, checklist[] }`, `notify { audience: responsible_manager | role:leader | user:<id>, template }`; действие `send_message { channel: email | messenger, template }` — **Важно** (после `У-208`). Условия: `organizationId in`, `amount >=`, `partnerId is null/not null`, `source`. Раздел хаба «Конфигурация процессов → Автоматизация» (`/{admin,leader}/settings/processes/automation`): список с переключателем, форма «Если … (условия) → То …», предпросмотр подстановок, «журнал срабатываний» (`У-223`); руководитель — своя компания, admin — любая (с выбором компании).

**`У-223` — исполнение правил.** Диспетчер `src/lib/automation/dispatch.ts` подписан на те же вызовы, что реестр уведомлений (`Р-Б-6`): каждое событие получает `eventId` (uuid) и `companyId`; подходящие активные правила ставят задачу в очередь `automation.run` (`{ ruleId, eventId, payload }`, идемпотентность по `ruleId+eventId` через `AutomationRun @@unique`); процессор выполняет действия, пишет `AutomationRun` (`status ok/failed/skipped`, `error`, `createdTaskIds`, `notifiedUserIds`); сбой правила **не** влияет на бизнес-операцию (fail-open §3, `log.error`); зацикливание исключено: действия правил не порождают событий, на которые подписаны правила (создание задачи не триггер). Журнал — в хабе и в карточке задачи «Создана правилом X».

**`У-224` — правила из коробки** (создаются миграцией как `isBuiltin`, выключены): «Счёт выставлен → задача ответственному "Проверить оплату по счёту {{document.number}}" через 5 дней», «Заказ переведён в статус "В работе" → задача "Подготовить документы по заказу {{order.number}}"», «КП без ответа 7 дней → задача "Позвонить по КП {{document.number}}"», «Обращение с сайта → уведомление руководителю», «Диалог без ответа дольше SLA → уведомление руководителю». Включаются галочкой; текст правится.

**`У-225` — SLA задач.** Просроченная задача (`dueDate < now`, не `done`) → уведомление `task_overdue` исполнителям в день просрочки и руководителю на 3-й день (расширение `monitoring.slaEscalation`); блок «Просроченные» на дашборде руководителя и в отчёте (`У-243`); порог дней — в хабе «SLA» (`У-130`).

**`У-226` — «Мой день».** Дополняется: диалоги в `waiting_staff` (мои), КП с истекающим сроком, задачи с чек-листами (прогресс), события календаря — единый экран без изменения существующих блоков.

**`У-227` — стражи и тесты.** Правило чужой компании не срабатывает; действие с ошибкой не блокирует смену статуса; повторная доставка события не создаёт вторую задачу; процессоры `automation.run`, `tasks.recurrence` покрыты интеграционными тестами (`worker.processor-coverage`); мутация каждого стража.

## 4. Файлы и папки

`src/lib/services/tasks/{comments,checklist,recurrence}.ts`, `src/lib/automation/{dispatch,rules,actions,templates}.ts`, `src/worker/processors/{automation-run,tasks-recurrence}.ts`, `src/lib/jobs/queues.ts` (+2 очереди), `src/app/{manager,leader}/tasks/[id]/page.tsx`, `src/app/{admin,leader}/settings/processes/automation/**`, `src/components/tasks/{task-page,task-comments,task-checklist}.tsx`, `src/components/automation/{rule-form,rule-list,run-log}.tsx`, `src/lib/navigation/settings.ts`, `src/lib/notifications/registry.ts` (`task_comment`, `task_overdue`, `automation_failed`), `src/lib/audit/labels.ts`, миграции.

## 5. Сущности данных

`TaskComment`, `TaskChecklistItem`, `AutomationRule`, `AutomationRun`; поля `Task.linkedContactId/linkedDialogId/linkedDocumentId/recurrence/recurrenceParentId/createdByRuleId`.

## 6. API / actions

Server actions: `tasks.ts` (`addComment`, `toggleChecklistItem`, `addChecklistItem`, `setRecurrence`), `automation.ts` (`createRule`, `updateRule`, `toggleRule`, `deleteRule`, `testRule` — прогон на последнем событии в режиме «сухого» выполнения). API не требуется (нет файлов).

## 7. Роли

Задачи: менеджер (свои/назначенные), руководитель (компания); admin — не участник. Правила: admin (все), leader (своя компания); менеджер видит имя правила в задаче. Клиенты и партнёры — ничего.

## 8. Что должно быть скрыто

Клиенты не видят задач, комментариев, правил; имя правила и журнал — только сотрудникам с `settings.automation`.

## 9. Ошибки и edge cases

- Ответственный менеджер объекта не назначен → задача правила уходит руководителю компании с пометкой «нет ответственного».
- Правило с несуществующим статусом (удалили) — деактивируется с уведомлением `automation_failed` админу/руководителю.
- Повторяющаяся задача с `until` в прошлом — серия завершается без ошибки.
- Шаблон с неизвестной подстановкой — ошибка сохранения правила.

## 10. Критерии приемки

- [ ] Страница задачи с комментариями и чек-листом; прогресс на доске; завершение с невыполненными пунктами требует подтверждения.
- [ ] Задача создаётся из карточки контакта, диалога, документа; блок «Задачи» виден в каждой из них.
- [ ] Правило «счёт выставлен → задача через 5 дней» создаёт ровно одну задачу с правильным исполнителем и сроком; повторная доставка события — без дубля; сбой действия не мешает выставить счёт.
- [ ] Журнал срабатываний показывает результат и ошибку; руководитель видит только правила своей компании.
- [ ] Просроченная задача уведомляет исполнителя и (на 3-й день) руководителя; дашборд показывает «Просроченные».
- [ ] (`У-221`) Еженедельная задача создаёт следующий экземпляр после завершения.
- [ ] Новые экраны — три вопроса, 390×844; глоссарий: «Правило автоматизации», «Чек-лист», «Повторяющаяся задача».

## 11. Приоритет, зависимости, риски

MVP. Риск — зацикливание правил (закрыто правилом «действия не порождают триггеры» + тест); риск нагрузки на воркер — отдельная очередь с лимитом конкурентности 2.

## 12. Чеклист

1. Спека → подтверждение. 2. PR-1: комментарии, чек-лист, страница задачи, новые связи. 3. PR-2: `AutomationRule`/`AutomationRun`, диспетчер, процессор, стражи. 4. PR-3: раздел хаба, правила из коробки, журнал. 5. PR-4: SLA задач, «Мой день». 6. PR-5 (Важно): повторы. 7. AUDIT, CHANGELOG, close-out.
