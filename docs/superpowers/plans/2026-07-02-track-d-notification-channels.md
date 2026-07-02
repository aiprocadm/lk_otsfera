# Трек D — каналы уведомлений за единым интерфейсом — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (или executing-plans inline). Steps use `- [ ]`.

**Goal:** ТЗ v0.5 §9/§12.1/§25.3 — email/Telegram/Max/WhatsApp за единым `NotificationChannel`; настройки каналов на пользователе (email всегда включён); доставка через воркер (BullMQ) с ретраями и идемпотентностью; Max нативно + WhatsApp через Wazzup-подобный агрегатор — за адаптерами, под флагами, с моками в тестах.

**Architecture:** канальный слой `src/lib/notifications/channels/` (types/email/telegram/max/whatsapp/registry/dispatch); email-контент рендерится один раз на событие и кладётся в payload (`{subject,html,text}`) — JSON-сериализуем для очереди; opt-in = привязка + `notificationChannels[key] !== false` (нулевая миграция данных); очередь `notifications.dispatch` (объявлена, не использовалась) получает продюсера (диспетчер, jobId-дедуп) и процессор (SyncLog при ошибке + throw→retry); inline-fallback без Redis сохраняет текущее поведение и тесты.

**Tech Stack:** Next.js 15 / Prisma 5 / BullMQ / Vitest. Spec: [2026-07-02-track-d-notification-channels-design.md](../specs/2026-07-02-track-d-notification-channels-design.md). Порядок: D1→D2→D5→D3→D4.

---

### Task 1 (D1a): Канальный слой — types + email + telegram + registry + deliver

**Files:** create `src/lib/notifications/channels/{types.ts,email.ts,telegram.ts,registry.ts,deliver.ts}`; test `src/__tests__/notifications.channels.test.ts`

- [ ] `types.ts`: `ChannelKey`, `ChannelRecipient` (id/email/name/telegramChatId; max/whatsapp/prefs добавит Task 3), `ChannelPayload` (`type,title,body,url?,email?:{subject,html,text}`), `ChannelSendResult` (`{status:'sent'|'skipped'|'failed';reason?}`), `CHANNEL_RECIPIENT_SELECT`.
- [ ] `email.ts`: `isEnabledFor` = `!!user.email`; `send` → низкоуровневый `send()` из `email/send.tsx` с pre-rendered контентом; без контента → generic `sendNotificationEmail`; map `SendResult`→`ChannelSendResult`.
- [ ] `telegram.ts`: `isEnabledFor` = `isTelegramEnabled() && !!telegramChatId` (prefs добавит Task 3); `send` → `sendTelegramMessage(chatId, "title\n\nbody")`, `{ok:false}`→`failed`.
- [ ] `registry.ts`: `getChannels(): NotificationChannel[]` (пока email+telegram); `deliver.ts`: `deliverToRecipient(user,payload)` — перебор, per-channel try/catch, `Record<ChannelKey,ChannelSendResult>`.
- [ ] TDD-матрица: enabled/disabled × привязка × результат; изоляция ошибки (telegram бросает → email sent). Commit `feat(notifications): D1 channel layer (email+telegram)`.

### Task 2 (D1b): Перенос фан-аутов на канальный слой (без изменения поведения)

**Files:** modify `src/lib/notifications/{core.ts,org.ts,manager.ts,partner.ts}`, `src/worker/processors/certificate-expiry.ts`; tests обновить `notifications.core.test.ts`

- [ ] `core.ts`: `deliverNotificationToUser(userId,payload)` (узкий select по `CHANNEL_RECIPIENT_SELECT` → deliver); заменяет `triggerNotificationEmail`+`triggerNotificationTelegram` (удалить, единственный вызывающий — cert-expiry). Pre-render generic email (`renderNotificationEmailContent` в `email/send.tsx`).
- [ ] `org.ts`/`manager.ts`/`partner.ts`: рендер email-контента один раз на событие → `ChannelPayload`; цикл per-recipient: `notification.create` + `deliverToRecipient`; счётчики `emailsSent/emailsSkipped` из результата email-канала; `console.warn` при `failed` сохранить. Партнёр переходит на общий deliver (Telegram появляется — sanctioned, spec §2.8).
- [ ] Прогнать ВСЕ существующие notification-тесты (регресс — зелёные, минимальные правки моков допустимы только там, где мокался внутренний модуль). Commit `refactor(notifications): D1 fan-outs via channel layer, no behavior change`.

### Task 3 (D2): Схема — привязки Max/WhatsApp + настройки каналов + prefs-сервис

**Files:** `prisma/schema.prisma` + migration `user_notification_channels`; create `src/lib/services/notifications/preferences.ts`; modify `channels/types.ts`, `channels/telegram.ts`; tests `src/__tests__/services.notifications.preferences.test.ts`

- [ ] Prisma `User`: `maxChatId String? @unique`, `maxLinkCode String?`, `maxLinkCodeExpiresAt DateTime?`, `whatsappPhone String? @unique`, `notificationChannels Json?`. `prisma migrate dev` + `generate`.
- [ ] `preferences.ts`: zod-парсер `parseChannelPrefs(Json)` (мусор→{}), `channelPrefEnabled(prefs,key)` (`!==false`), Result-сервисы `getNotificationSettings(prisma,session)` / `updateChannelPreference(prisma,session,{channel,enabled})` (`invalid_channel` для email/неизвестных), `saveWhatsappPhone(prisma,session,{phone})` (E.164-нормализация, `invalid_phone`, P2002→`phone_taken`, пустая строка = отвязка+prefs sync).
- [ ] `ChannelRecipient` + `CHANNEL_RECIPIENT_SELECT` расширить новыми полями; `telegram.ts` учитывает `channelPrefEnabled(...,'telegram')`.
- [ ] TDD: prefs-матрица, нормализация телефона, отвязка. Commit `feat(db,notifications): D2 channel bindings + user preferences`.

### Task 4 (D5): Диспетчер через очередь + процессор воркера + идемпотентность

**Files:** create `src/lib/notifications/channels/dispatch.ts`, `src/worker/processors/dispatch-notification.ts`; modify `src/worker/index.ts`, фан-ауты (enqueue вместо прямого deliver), `src/lib/jobs/types.ts`; tests `src/__tests__/notifications.dispatch.test.ts` (unit), `src/__tests__/worker.dispatch-notification.test.ts` (integration — guardrail требует)

- [ ] `dispatch.ts`: `dispatchToRecipient(user,payload,{dedupKey})` — `REDIS_URL` есть → по job-у на включённый канал, `jobId='notif:'+dedupKey+':'+userId+':'+key`, enqueue-ошибка → inline fallback; нет Redis → `deliverToRecipient`. `dedupKey` = id Notification-строки.
- [ ] Payload-тип `DispatchNotificationJobPayload {userId,channel,payload}` в `jobs/types.ts`.
- [ ] Процессор: user select → channel by key → re-check `isEnabledFor` → send; `failed` → `SyncLog{entity:'notification',direction:'out',operation:'channel_'+key,status:'error'}` + throw (retry); `skipped`/`sent` → return. Регистрация в `worker/index.ts`.
- [ ] Фан-ауты вызывают `dispatchToRecipient` (счётчики: queued → считаем email как sent? НЕТ — считаем `emailsQueued` отдельным полем, `emailsSent` остаётся для inline-пути; без Redis в тестах — поведение неизменно).
- [ ] TDD: jobId-детерминизм (два вызова, один dedupKey → 1 add-вызов эффективен — мок Queue.add), fallback без Redis, изоляция ошибок, процессор (sent/skip/fail+SyncLog+throw). Commit `feat(notifications): D5 queued dispatch + worker processor + idempotency`.

### Task 5 (D3): Канал Max — транспорт, привязка, webhook, канал, флаг

**Files:** create `src/lib/max/client.ts`, `src/lib/services/max/link.ts`, `src/app/api/integrations/max/webhook/route.ts`, `src/server-actions/max.ts`, `channels/max.ts`; modify `featureFlags.ts` (+`max_channel` opt-in), `registry.ts`, `preferences.ts` (settings-статус); tests `max.client.test.ts`, `services.max.link.test.ts`, `api.integrations.max.webhook.test.ts`

- [ ] `client.ts` (зеркало telegram): `isMaxEnabled()` = флаг `max_channel` + `MAX_BOT_TOKEN` + `MAX_BOT_USERNAME`; `maxDeepLink(code)`; `sendMaxMessage(chatId,text)` — fetch `MAX_API_BASE_URL` (default `https://botapi.max.ru`), таймаут 5с, `{ok}`; сеть мокается.
- [ ] `services/max/link.ts` — зеркало telegram/link (status/generate/unlink/linkByCode, audit `max_linked`/`max_unlinked`, ошибки `max_disabled`/`invalid_code`/`chat_taken`).
- [ ] Webhook: секрет `x-max-webhook-secret`≠env→401; `notFoundIfDisabled('max_channel')`; защитный парсинг `/start`-эквивалента (`bot_started.payload` | `message`) → `linkByCode`; всегда 200 на валидный JSON; код не логировать.
- [ ] `channels/max.ts`: `isEnabledFor` = `isMaxEnabled() && maxChatId && pref!==false`; в registry.
- [ ] Commit `feat(notifications): D3 Max channel (native, flagged, mocked)`.

### Task 6 (D4): Канал WhatsApp через агрегатор

**Files:** create `src/lib/whatsapp/aggregator.ts`, `channels/whatsapp.ts`; modify `featureFlags.ts` (+`whatsapp_channel` opt-in), `registry.ts`; tests `whatsapp.aggregator.test.ts`

- [ ] `aggregator.ts`: `isWhatsAppEnabled()` = флаг + `WHATSAPP_AGGREGATOR_BASE_URL` + `WHATSAPP_AGGREGATOR_API_KEY` + `WHATSAPP_AGGREGATOR_CHANNEL_ID`; `sendWhatsAppMessage(phone,text)` — POST `{base}/v3/message`, Bearer key, body `{channelId,chatType:'whatsapp',chatId:phone,text}`, таймаут 5с, `{ok}`; сеть мокается, ключи только из env.
- [ ] `channels/whatsapp.ts`: `isEnabledFor` = enabled + `whatsappPhone` + pref; в registry.
- [ ] Commit `feat(notifications): D4 WhatsApp via aggregator (flagged, mocked)`.

### Task 7 (D2-UI): Настройки каналов в кабинетах

**Files:** create `src/components/settings/notification-channels-card.tsx`, `src/server-actions/notification-channels.ts`; modify 5×`src/app/<role>/settings/page.tsx`; tests `server-actions.notification-channels.test.ts` (+опц. существующие page-тесты)

- [ ] Server-actions (`requireSession`): `updateChannelPreferenceAction`, `saveWhatsappPhoneAction`, `generateMaxLinkAction`, `unlinkMaxAction`.
- [ ] Карточка (client, domain-agnostic props `NotificationSettingsView`): Email — Badge «всегда включён»; Telegram — существующая привязка + toggle; Max — deep-link привязка + toggle (виден только при флаге); WhatsApp — input номера + toggle (при флаге); `ui/`-примитивы, `errorMessageRu`, toast.
- [ ] Страницы settings: собрать `getNotificationSettings` + рендер карточки (TelegramLinkCard остаётся). Commit `feat(settings): D2 notification channels UI`.

### Task 8: Структурный тест приёмки + env + docs

**Files:** test `src/__tests__/notifications.channels.structural.test.ts`; `.env.example`, `README.md`, `CHANGELOG.md`, `src/lib/errors/messages.ts`

- [ ] Структурный тест: мок registry добавляет fake-канал → `notifyOrgUsers` доставляет в него без правок org.ts (критерий «новый канал без правок мест генерации»).
- [ ] `errorMessageRu`: `max_disabled`, `invalid_phone`, `phone_taken`, `invalid_channel`.
- [ ] `.env.example`: блоки MAX_*/WHATSAPP_AGGREGATOR_*/FEATURE_MAX_CHANNEL/FEATURE_WHATSAPP_CHANNEL; README-раздел каналов. Commit `docs(notifications): track D env + docs`.

### Финал

- [ ] `npm run typecheck` && `npm run lint` && `npm test` (полный, последовательный).
- [ ] `npm run gate` (учесть локальный конфликт порта 5432 — при блокировке использовать живой Postgres: `npm run test:integration` + зафиксировать причину) + `prisma migrate status`.
- [ ] Close-out `2026-07-02-track-d-notification-channels-DONE.md`; дифф + список адаптеров/флагов/тестов в отчёте.

## Self-review (покрытие spec)

D1 интерфейс+перенос → Task 1,2 ✓; D2 модель+prefs+UI → Task 3,7 ✓; D5 диспетчер+воркер+идемпотентность → Task 4 ✓; D3 Max → Task 5 ✓; D4 WhatsApp → Task 6 ✓; критерий «канал без правок генерации» → Task 8 структурный тест ✓; email всегда / opt-in-матрица → Task 1,3 тесты ✓; изоляция ошибок → Task 1,4 ✓; env-не-в-коде → Task 5,6,8 ✓; D6 — вне объёма (spec §4) ✓.
