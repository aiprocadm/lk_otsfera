# Уведомления

**Этап дорожной карты:** 5 «Центр уведомлений» · **Требования:** `У-228`…`У-233` · **Приоритет:** MVP (`У-228`, `У-229`, `У-231`…`У-233`), Важно (`У-230`) · **Оценка:** 3 дня.
**Зависимости:** нет (события новых модулей добавляются в реестр их этапами: `note_mention`, `partner_material_published`, `task_comment`, `task_overdue`, `automation_failed`).

## 1. Цель доработки

Уведомления в системе доставляются (32 события, каналы, правила компании, шаблоны писем, воркер), но **читать их негде, кроме выпадающего колокольчика**, а пользователь не может выбрать, что и куда ему слать. Этап добавляет страницу, личные настройки, дедупликацию и дайджест — без изменения механизма доставки.

## 2. Текущая ситуация — что найдено в коде

| Что | Якорь |
|---|---|
| Реестр событий: `document_published`, `payment_received`, `order_status_changed`, `manager_replied`, `requisites_requested`, `order_result_delivered`, `chat_message`, `document_accepted`, `invoice_paid`, `commission_statement_ready`, `comment_from_org`, `document_uploaded_by_org/partner`, `order_status_changed_by_manager`, `client_request_submitted/status_changed`, `enrollment_submitted/status_changed`, `task_assigned`, `task_due_soon`, `sla_escalation`, `staff_dm_message`, `staff_chat_mention`, `deal_note_mention`, `inbound_reply`, `messenger_message`, `certificate_expiring`, `calendar_event_reminder`, `sync_error`, `ops_alert`, `document_created`, `status_changed`, `message_created` | `src/lib/notifications/registry.ts` |
| Каналы: в кабинете (`Notification`), e-mail (Resend, `email/send.tsx`), Telegram, MAX, WhatsApp (агрегатор); выбор каналов пользователя `User.notificationChannels` (Json) | `src/lib/notifications/`, `schema.prisma:295` |
| Правила компании «событие × роль × каналы» (`NotificationRule`), шаблоны писем (`NotificationTemplate`) с подстановками — из UI | `/admin/settings/catalogs/notification-rules`, `/…/email-templates`, `У-127`, `У-128` |
| Доставка через воркер `notifications.dispatch` (флаг `notif_queue`), напоминания `certificateExpiry`, `calendarReminder`, `taskDueSoon` | `src/lib/jobs/queues.ts` |
| UI: колокольчик `notification-bell.tsx`; API `GET/PATCH /api/notifications`, `/api/notifications/unread` | `src/components/notifications/`, `src/app/api/notifications/` |
| Страницы `/…/notifications` | **не найдено** |
| Настройка «событие × канал» на уровне пользователя | **не найдено** (только включение каналов целиком) |
| Дедупликация одинаковых уведомлений, дайджест | **не найдено** |

## 3. Что нужно изменить

**`У-228` — страница «Уведомления» во всех шести кабинетах.** Маршрут `/{admin,leader,manager,organization,partner,student}/notifications`, пункт меню внизу над «Настройками» (`pinnedBottom`), общий презентационный компонент (`Р-23`), данные — `services/notifications/list.ts` со скоупом по пользователю. Список: значок типа, заголовок, текст, время, объект (ссылка), непрочитанность; фильтры «непрочитанные / все», «тип» (из реестра, только типы, доступные роли); «Отметить все прочитанными»; постраничность 50 с `total`. Колокольчик получает ссылку «Показать все». Пустое состояние: «Пока ничего не произошло — здесь появятся события по вашим заказам и обращениям».

**`У-229` — личные настройки по событиям.** Вкладка «Уведомления» личных настроек (общий компонент `У-114`): матрица «событие (доступное роли) × канал (в кабинете · e-mail · Telegram · MAX · WhatsApp)» с переключателями; «в кабинете» отключить нельзя (всегда есть запись); каналы показываются только подключённые; значение по умолчанию — из правил компании (`У-127`), пользователь может только **сузить** (не включить канал, запрещённый правилом). Хранение — `UserNotificationPreference` (`userId`, `eventType`, `channels: String[]`) или расширение `User.notificationChannels` — спека этапа выбирает; приоритет при доставке: правило компании ∩ настройка пользователя.

**`У-230` — дайджест (Важно).** Для ролей `organization`/`partner` опция «получать письма дайджестом раз в день» (время по Москве, из личных настроек): события за сутки собираются в одно письмо по шаблону `daily_digest` (редактируется в `У-128`); мгновенно уходят только «срочные» типы (`document_published`, `invoice_paid`, `messenger_message`, `client_request_status_changed`) — список срочных в реестре флагом `urgent`. Воркер `notifications.digest` по расписанию из UI.

**`У-231` — дедупликация.** В `notifications.dispatch`: одинаковый `eventType` + `entityId` для одного получателя в течение 60 мин → обновляется существующее уведомление (счётчик «×N», время последнего), не создаётся новое; e-mail/мессенджер — не дублируются. Исключение — `messenger_message` и `chat_message` (каждое сообщение важно) и события с флагом `noDedup` в реестре.

**`У-232` — правильные ссылки.** Каждое уведомление ведёт в кабинет **роли получателя** (руководитель — `/leader/...`, а не `/manager/...`; партнёр — `/partner/orders/[id]`, а не `/organization/...`); тест-таблица «тип × роль → маршрут» на все типы реестра; битая ссылка = дефект.

**`У-233` — стражи.** Тип без строки в реестре не собирается (есть); реестр ↔ фильтр страницы (каждый тип имеет русское название и значок); правило дедупа проверяется мутацией; страж «уведомление роли не ведёт в чужой кабинет».

## 4. Файлы и папки

`src/lib/notifications/registry.ts` (флаги `urgent`, `noDedup`, `audiences` уже есть), `src/lib/notifications/manager.ts`, `src/worker/processors/notifications-dispatch.ts`, новый `src/lib/services/notifications/{list,preferences,digest}.ts`, `src/components/notifications/{notification-page,notification-filters,preferences-matrix}.tsx`, страницы в шести кабинетах, `src/lib/navigation/cabinet.ts` (пункт `notifications`), `sectionLabels.ts`, `icons.ts`, миграция `UserNotificationPreference`.

## 5. Сущности данных

`Notification` (есть: `userId`, `type`, `title`, `body`, `entity`, `entityId`, `readAt`) + поля `dedupCount Int @default(1)`, `lastOccurredAt`; новая `UserNotificationPreference`; `NotificationRule` без изменений.

## 6. API / actions

`GET /api/notifications` (расширить фильтрами и `total`), `PATCH /api/notifications` (`markAllRead`), server actions `notificationPreferences.ts` (`savePreferences`, `setDigest`).

## 7. Роли

Все шесть ролей — страница и личные настройки; правила компании и шаблоны — admin/leader (есть).

## 8. Что должно быть скрыто

Пользователь не видит уведомления других пользователей и типы, недоступные его роли (партнёр не видит `sla_escalation`, клиент не видит `sync_error`); в тексте уведомлений клиенту нет внутренних терминов (страж `У-266`).

## 9. Ошибки и edge cases

- Отключённый канал в правиле компании — в матрице пользователя показан серым с подсказкой «отключено вашей компанией».
- Уведомление об удалённом объекте — ссылка ведёт на список с сообщением «объект недоступен», не на 404.
- Дайджест без событий — не отправляется.
- Сбой доставки в мессенджер не блокирует запись в кабинете (fail-open, как сейчас).

## 10. Критерии приемки

- [ ] Страница есть во всех шести кабинетах, зеркальна, с фильтрами и «отметить все»; колокольчик ведёт на неё.
- [ ] Матрица личных настроек сужает правила компании и не может их расширить (тест).
- [ ] Пять одинаковых событий за час — одно уведомление с «×5»; сообщения мессенджера не дедуплицируются.
- [ ] Таблица «тип × роль → маршрут» покрыта тестом; ни одна ссылка не ведёт в чужой кабинет.
- [ ] (`У-230`) Дайджест собирает события за сутки в одно письмо; срочные уходят сразу.
- [ ] Три вопроса и 390×844 на новых экранах; глоссарий: «Уведомление», «Дайджест».

## 11. Приоритет, зависимости, риски

MVP, кроме дайджеста. Риск: изменение `dispatch` затрагивает 37 console-spy регрессов формата логов (CLAUDE.md §12) — формат сообщений логов не менять. Риск дедупа: агрегация может скрыть важное — поэтому список исключений в реестре и счётчик на экране.

## 12. Чеклист реализации

1. Спека этапа → подтверждение. 2. PR-1: `services/notifications/list.ts`, страница + меню в шести кабинетах, `total`. 3. PR-2: личные настройки (модель, матрица, доставка с пересечением). 4. PR-3: дедуп + флаги реестра + стражи маршрутов. 5. PR-4 (Важно): дайджест. 6. AUDIT, CHANGELOG, close-out.
