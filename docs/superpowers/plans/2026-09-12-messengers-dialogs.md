# План: мессенджеры как канал общения с клиентами

Спека — [2026-09-12-messengers-dialogs-design.md](../specs/2026-09-12-messengers-dialogs-design.md).
Четыре PR от `main`, каждый зелёный сам по себе; порядок нарушать нельзя
(PR-2 читает таблицы PR-1, PR-3 переносит формы, которые PR-2 не трогает,
PR-4 шлёт уведомление о диалоге из сервиса PR-1).

Гейты на каждый PR: `npm run typecheck` · `npm run lint` · `npm run test:unit`
· интеграционные тесты затронутых сервисов против живого Postgres ·
покрытие новых файлов 100 % (`npx vitest run --coverage` адресно) ·
`npm run boundaries` · `npm run deadcode` · `npm run dup:check` ·
`npm run format:check` · запись в `CHANGELOG.md`.

## PR-1 «фундамент» — данные копятся, пользователь ничего не видит

- [x] `prisma/schema.prisma`: `MessengerDialog`, `MessengerMessage`, обратные
      связи на `Company`/`Organization`/`Contact`/`User`
- [x] миграция `2026091210xxxx_messenger_dialogs` (аддитивная, с комментарием
      «зачем»), `npx prisma migrate status` чисто
- [x] `services/messengers/channels.ts` — список каналов, подписи, доступность
- [x] `services/messengers/transport.ts` — `sendToMessenger`;
      `inbound/reply.ts` переведён на него
- [x] `services/messengers/scope.ts` — Prisma-форма + in-memory двойник
- [x] `services/messengers/appendInbound.ts` — upsert диалога из входящего;
      хук в `inbound/ingest.ts` (best-effort)
- [x] `services/messengers/recordOutbound.ts` — исходящее в историю; хук в
      `inbound/sendReply.ts` после удачной отправки
- [x] `services/messengers/backfill.ts` + `scripts/backfill-messenger-dialogs.ts`
      + `npm run backfill:messengers`
- [x] аудит: действия/сущность в `auth/audit.ts`, названия в `audit/labels.ts`
- [x] тесты: unit на каждый сервис (mock-prisma), integration на
      `ingest → диалог` (идемпотентность, гонка, привязка при распознавании,
      переоткрытие), `sendReply → история`, бэкфилл (идемпотентен)
- [x] `CHANGELOG.md`

## PR-2 «диалоги» — раздел «Мессенджеры» у менеджера

- [x] `services/messengers/list.ts`, `get.ts` (+ `markDialogRead`),
      `send.ts`, `bind.ts`, `start.ts`, `status.ts`
- [x] `errors/messages.ts`: `channel_unavailable`, `no_messenger_channel`
      (`text_too_long` уже был; чужой диалог отвечает общим `not_found`)
- [x] `pii/contexts.ts`: `messengers_list`, `messengers_view`,
      `messengers_candidates`
- [x] `server-actions/messengers.ts` — тонкие адаптеры, zod на форму входа
- [x] флаг `inbound_messaging` → поведенческий: убрать из `FEATURE_PREFIXES`,
      обновить `docs/feature-flags-matrix.md`, подпись в
      `feature-flags-matrix.tsx`, тесты `featureFlags.manager`
- [x] реестры: `sectionLabels` (`messengers`), `icons` (`📱`), `cabinet.ts`
      (пункт менеджера, `badgeKey: 'messengersUnread'`), `mirrorExceptions`,
      `intake/badges.ts` + `nav-badge.tsx`
- [x] страницы `/manager/messengers` и `/manager/messengers/[id]` с крошками,
      подзаголовками, главной кнопкой, пустым состоянием, мобильной раскладкой
- [x] компоненты `components/manager/messengers/*`: список, фильтры, лента,
      форма ответа, форма привязки, кнопка состояния, диалог «Новый диалог»
- [x] глоссарий: `docs/glossary.md` + `lib/help/glossary.ts` («Мессенджеры»,
      «Диалог»)
- [x] тесты: unit сервисов, IDOR-интеграционный (компания B не видит и не
      пишет), server-actions, компоненты (jsdom), страницы
      (`renderServerComponent`), стражи реестров зелёные
- [x] `CHANGELOG.md`

## PR-3 «подключение» — раздел «Подключение мессенджеров» у администратора

- [x] `navigation/settings.ts`: раздел `integrations.messengers`
- [x] страница `/admin/settings/integrations/messengers`: светофор по трём
      каналам, шаги подключения, формы (переезд из обзора), переключатели
- [x] обзор «Интеграции»: вместо трёх форм — карточка-ссылка
- [x] тесты страницы и реестра; `pages.admin-integrations` обновлён
- [x] `CHANGELOG.md`

## PR-4 «уведомления и клиент»

- [x] `notifications/registry.ts`: `messenger_message` (staff); ссылка в
      диалог — через `meta.url`, `href.ts` не менялся
- [x] `appendInbound.ts`: уведомление менеджерам организации диалога
- [x] тексты бота (`/start`) и подсказки карточек привязки
- [x] `docs/tz/STATUS.md`: строка о программе; close-out
      `2026-09-12-messengers-dialogs-DONE.md`
- [x] `CHANGELOG.md`
