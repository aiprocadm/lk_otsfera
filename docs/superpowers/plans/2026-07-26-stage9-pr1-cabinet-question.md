# Этап 9 PR-1 — «Задать вопрос» из кабинета (ФТ-11.1)

Спека: [2026-07-26-stage9-support-sessions-exports-design.md](../specs/2026-07-26-stage9-support-sessions-exports-design.md) §3 (подтверждена 26.07.2026).
Ветка `claude/stage9-support-sessions-exports`. Сессии — PR-2, экспорты — PR-3.

## A. Сервис

- [x] `InboundDto.channel` += `'cabinet'`; ingest не резолвит отправителя для
      кабинета (он известен из сессии) — ветка «данные отправителя переданы».
- [x] `services/inbound/cabinetQuestion.ts` — `submitCabinetQuestion(prisma,
      session, {subject, body, file?})`: гейт `partner|organization`,
      валидация (тема ≤200, текст 1..5000), вложение — лимиты/MIME/magic-bytes
      как у вложений заявок, S3 `support/{userId}/{uuid}-{name}`,
      `externalId='cabinet:<uuid>'`, `resolvedUserId=session.sub`,
      `resolvedOrgId`/`companyId` (организация — активная; партнёр — без орг,
      companyId из партнёрских заказов не выводим → null),
      **`status='unresolved'`** (иначе не попадёт в Intake);
      возвращает короткий код `ОБР-XXXXXX` (решение §9-3).
      Отдельного фан-аута менеджерам НЕ добавляем: уведомления о входящих в
      проекте нет ни для одного канала, а видимость обеспечена Intake с
      живым бейджем-счётчиком (этап 7, ФТ-8.4).
- [x] Ответ менеджера: ветка `cabinet` в `replyToInbound` — уведомление
      `notifyOrgUsers`/`notifyPartnerUsers` вместо внешнего транспорта
      (решение §9-2). Сигнатура расширяется `resolvedOrgId/resolvedUserId`.

## B. API + UI

- [x] Роут `POST /api/support/question` (multipart): `requireSession`,
      `notFoundIfDisabled('cabinet_questions')`, маппинг Result → HTTP.
- [x] Флаг `cabinet_questions` (opt-in; поведенческий — кнопка + роут,
      middleware-точки нет: это не префикс).
- [x] `AskQuestionButton` + `AskQuestionDialog` (Dialog: тема, текст,
      вложение, счётчик символов; успех → toast с кодом).
- [x] Монтаж: `app-shell` (партнёр) и `org-app-shell` (организация);
      мобильный `bottom-tab-bar` партнёра — не трогаем (кнопка в шапке видна
      и на мобильном).
- [x] ~~Карточка «Задать вопрос» в welcome-блоке~~ — отложена: welcome-блок
      живёт на дашбордах и ведёт на страницы, а вопрос открывается модалкой из
      шапки (она видна с любой страницы кабинета). Дублировать не стали.

## C. Канал в staff-UI (5 мест)

- [x] `inbox-list` CHANNEL_LABEL, `inbox-filters` CHANNELS,
      `manager/inbox/page` KNOWN_CHANNELS (иначе фильтр молча теряется),
      `org-card-tabs` INBOUND_CHANNEL_LABEL, `deal-activity/activity-item`
      CHANNEL_LABEL — подпись «Вопрос из кабинета».

## D. Тесты (порог 100%)

- [x] Unit: сервис (гейты ролей, валидация, вложение/скан, unresolved +
      resolved-поля, код обращения, graceful notify), reply-ветка cabinet,
      роут (флаг/роль/лимиты/ошибки), диалог и кнопка, лейблы/фильтры.
- [x] Integration (живой Postgres): вопрос из кабинета → виден в
      `/manager/inbox` и в Intake; повторная отправка не дедуплится
      (разные externalId); партнёрский вопрос виден staff.
- [x] Актуализация тестов inbox-страницы/фильтров/шеллов.

## E. Финал

- [x] typecheck / lint / unit / integration зелёные; CHANGELOG; STATUS.md; PR
      (`base: main` — правило §14).
