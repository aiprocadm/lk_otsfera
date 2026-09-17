# Этап 5 «Центр уведомлений» — план

Спека — [2026-09-17-stage5-notification-center-design.md](../specs/2026-09-17-stage5-notification-center-design.md)
(решения `Р-Э5-1`…`Р-Э5-9`, вопросы `В-5-1`…`В-5-5` с умолчаниями).
Требования `У-228`…`У-233`, пакет — [09_notifications.md](../../specs/09_notifications.md).

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

Порядок PR жёсткий: PR-1 → PR-2 → PR-3 → PR-4 → PR-5. Каждый PR открывается от
`main` с `base: main`, после мержа код проверяется в `main`
(`git cat-file -e origin/main:<файл>`). Гейты в каждом PR: `typecheck`,
`lint`, `boundaries`, `deadcode`, `dup:check`, `format:check`, `tz:status`,
unit (4 четверти), integration (4 четверти). Страж — только с мутацией.

---

## PR-1. Страница и меню (`У-228`, `У-233` реестр ↔ фильтр)

- [x] Флаг `notification_center` (поведенческий, opt-in) + запись в `featureFlags.test.ts`
- [x] Реестр типов: поле `icon` у всех 39 типов (значки из семантического реестра); страж `notifications.registry-filter` (label + icon у каждого; фильтр = `notificationTypesFor(роль)`; у слушателя пусто)
- [x] `services/notifications/list.ts`: фильтры `unread`/`type`, страница 50, `total`; `markAllRead` по скоупу
- [x] Скоуп администратора → личный (`Р-Э5-2`); тест `api.notifications.test.ts:96` переписан с объяснением; страж `notifications.page-scope` (мутация: вернуть `{}`)
- [x] Страница серверная — фильтры и `total` идут через сервис, `GET` роут не менялся (колокольчик ждёт прежний массив); `PATCH { all: true }`; `requireRole` + `student` в обоих роутах; матрица `security.role-access-matrix` роуты уведомлений не перечисляет — правки не потребовала
- [x] `notifications-screen.tsx` (презентационный): список с значком, заголовком, текстом, временем, «×N», ссылкой; фильтры; «Отметить все прочитанными»; пустое состояние с фразой пакета; 390×844 — карточки
- [x] Шесть страниц `/{admin,leader,manager,organization,partner,student}/notifications` с `notFound()` при выключенном флаге; три вопроса §15
- [x] `sectionLabels.ts` + `icons.ts` (`notifications`, 🔔), `cabinet.ts` — пункт `pinnedBottom` над «Настройками» (у слушателя — над «Справкой»), `flag: 'notification_center'`; страж зеркала зелёный без новых исключений
- [x] Колокольчик: ссылка «Показать все» при включённом флаге
- [x] Тесты страниц ×6 (`renderServerComponent`), экрана, кнопки, действия; скоуп и `total` — стражем `notifications.page-scope` на фейках; живой скоуп шести ролей — в `services.notifications.list.integration` (PR-5)
- [x] AUDIT: `У-228` → ✅; CHANGELOG; STATUS

## PR-2. Личные настройки (`У-229`)

- [x] Миграция `UserNotificationPreference` (`userId`, `eventType`, `channels String[]`, `@@unique([userId, eventType])`)
- [x] `services/notifications/preferences.ts`: матрица для роли (события `notificationTypesFor`, каналы — только привязанные, правило компании как умолчание и как потолок), `savePreferences` с отказом `channel_disabled_by_company`, аудит
- [x] `CHANNEL_RECIPIENT_SELECT` + `notificationPreferences`; `dispatchToRecipient`: `effective = routed ∩ pref` до развилки inline/очередь
- [x] `preferences-matrix.tsx` во вкладке «Уведомления» личных настроек (все пять кабинетов с настройками); запрещённый канал — серым с подсказкой «отключено вашей компанией»; под флагом
- [x] Server action `notificationPreferences.ts` (`savePreferences`)
- [x] Страж `notifications.preferences-narrow` (мутация: `∩` → `∪`); тесты сервиса, компонента, действия
- [x] AUDIT: `У-229` → ✅; CHANGELOG; STATUS

## PR-3. Единая точка, дедуп, маршруты (`У-231`, `У-232`, `У-233`)

- [x] Миграция: `Notification.entityId`, `dedupCount`, `lastOccurredAt`, индекс `[userId, type, entityId, createdAt]`
- [x] `recordNotification` в `core.ts` (окно 60 мин, `×N`, `isRead=false`, свежие тексты, `{ row, deduped }`); флаг `noDedup` в реестре (`messenger_message`, `chat_message`)
- [x] Перевод 27 вызовов в 20 файлах на `recordNotification` с явным `entityId`; при `deduped` каналы не дёргаются
- [x] Страж `notifications.single-create-point` (`readSource`, мутация: вернуть прямой вызов)
- [x] Страж `notifications.dedup` (мутации: снять окно, убрать исключение); `notifications.dedup.integration` на живых `createdAt`
- [x] `lib/notifications/routes.ts`: таблица «тип × роль → маршрут» по идентификаторам `meta`; `notificationHref` — обёртка; `meta.url` — запасной путь
- [x] Продьюсеры сотрудников пишут идентификаторы вместо `url` с кабинетом; `role` в `CHANNEL_RECIPIENT_SELECT`; письмо получает `url` по роли получателя
- [x] Списки разделов принимают `?missing=1` и показывают «объект недоступен»
- [x] Страж `notifications.routes` (все пары тип × роль; `leader` → `/leader/`; `null` только из явного списка; существование страницы проверяется по файлу); `notifications.href.test.ts:89` переписан с объяснением
- [x] Лента сортируется по `lastOccurredAt ?? createdAt`; «×N» на экране
- [x] AUDIT: `У-231`, `У-232` → ✅, `У-233` — частично; CHANGELOG; STATUS

## PR-4. Дайджест (`У-230`, «Важно»)

- [ ] Миграция: `User.digestEnabled`, `digestHourMsk`, `digestLastSentAt`
- [ ] Флаг `urgent` в реестре: `document_published`, `invoice_paid`, `messenger_message`, `client_request_status_changed`
- [ ] `dispatchToRecipient`: у пользователя с дайджестом канал `email` вычитается для несрочных типов
- [ ] Очередь `notifications.digest`, расписание ежечасно по Москве (`editable: true`), процессор `notifications-digest.ts`: выбор по часу, атомарный claim по `digestLastSentAt`, сбор за окно без срочных, пусто → не шлём, предел 50 строк
- [ ] Шаблон `dailyDigest` в реестре писем и в `send.tsx`; правится в «Шаблонах писем»
- [ ] Галочка «Получать письма дайджестом раз в день» и час — во вкладке «Уведомления» (только organization/partner; сервис отвергает прочие роли); под флагом
- [ ] Страж `notifications.digest` (мутация: снять проверку пустоты); `worker.notifications-digest.integration`
- [ ] AUDIT: `У-230` → ✅; CHANGELOG; STATUS

## PR-5. Стражи мутацией, аудит, глоссарий, close-out (`У-233`)

- [ ] Мутация всех семи стражей этапа — таблица в `AUDIT.md`
- [ ] Глоссарий: «Уведомление», «Дайджест»
- [ ] Мобильная проверка 390×844 шести страниц (по возможности стенда)
- [ ] Замер покрытия своих файлов (прицельно; полный прогон — если сторож памяти позволит)
- [ ] AUDIT по `У-228`…`У-233` целиком, сводка; CHANGELOG; STATUS (этап закрыт, текущий — 6); CLAUDE.md снимок
- [ ] Close-out `2026-09-17-stage5-notification-center-DONE.md`
