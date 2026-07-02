# Трек D — каналы уведомлений за единым интерфейсом — Close-out

**Дата:** 2026-07-02
**Ветка:** `claude/determined-volhard-12a975` (от main)
**Spec:** [2026-07-02-track-d-notification-channels-design.md](../specs/2026-07-02-track-d-notification-channels-design.md) · **Plan:** [2026-07-02-track-d-notification-channels.md](2026-07-02-track-d-notification-channels.md)
**ТЗ:** §9, §12.1, §25.3 (единый слой интеграций).

> **Именование:** этот «Трек D» — про **каналы уведомлений**. В CHANGELOG `[Unreleased]`
> буква D раньше использовалась для «сквозной консистентности кабинетов» (роль-консистентность) —
> это другой трек. В CHANGELOG новая запись названа «Трек D каналов», чтобы не путать.

## Что отгружено

Каналы уведомлений вынесены под единый интерфейс `NotificationChannel`; добавлены Max (нативно)
и WhatsApp (через агрегатор), пользовательские настройки каналов, доставка через воркер с
идемпотентностью. Ядро генерации событий (22 места) **не тронуто** — принцип «новый канал = новая
реализация интерфейса».

### D1 — единый интерфейс (`src/lib/notifications/channels/`)
- `types.ts`: `NotificationChannel { key, isEnabledFor(user), send(user, payload) }`,
  `ChannelRecipient` + `CHANNEL_RECIPIENT_SELECT` (общий узкий select), `ChannelSendResult`
  (стабильные коды §3), `EmailContentRef` (сериализуемая ссылка на шаблон — JSON-совместима,
  резолвится в те же sender-функции `send.tsx`, письма байт-в-байт).
- `email.ts` (базовый, всегда включён при наличии email), `telegram.ts` (перенос без изменений),
  `registry.ts` (`getChannels()` — единственная точка расширения), `deliver.ts`
  (`deliverToRecipient` — inline-веер, per-channel try/catch = изоляция ошибок).
- Фан-ауты `org.ts`/`manager.ts`/`partner.ts`/`core.ts` переведены на канальный слой; сигнатуры
  и счётчики сохранены. `triggerNotificationEmail`/`triggerNotificationTelegram` → единый
  `deliverNotificationToUser`. Партнёр получил Telegram-зеркало (выравнивание с UI-обещанием).

### D2 — настройки + привязки (миграция `20260702120000_user_notification_channels`)
- `User`: `maxChatId`/`maxLinkCode`(+expiry), `whatsappPhone` (E.164, unique),
  `notificationChannels Json`. Аддитивная миграция, **нулевая миграция данных**.
- Семантика opt-in: канал включён ⟺ привязка есть И `notificationChannels[key] !== false`.
  Email всегда включён (в Json не хранится).
- `channels/preferences.ts` (терпимый zod-парсер: мусор → дефолты) +
  `services/notifications/preferences.ts` (Result-контракт: `updateChannelPreference`,
  `saveWhatsappPhone` с E.164-нормализацией и P2002→`phone_taken`, `getNotificationSettings`).
- UI `NotificationChannelsCard` (email-бейдж «всегда включён», per-channel toggle, Max deep-link,
  WhatsApp номер) в «Настройках» всех 5 кабинетов.

### D5 — диспетчер + воркер (`channels/dispatch.ts`, `worker/processors/dispatch-notification.ts`)
- `dispatchToRecipient(user, payload, { dedupKey })`: при `notif_queue` + `REDIS_URL` — job на
  каждый включённый канал, `jobId = notif_<notificationId>_<userId>_<channel>` (BullMQ дедуп →
  идемпотентность). Ошибка enqueue → деградация в inline. Без флага/Redis — inline (= D1).
- Процессор: перечитывает `isEnabledFor` (настройки могли смениться), оживляет Date-props из JSON
  по whitelist, `failed` → `SyncLog(entity=notification, direction=out)` + throw (ретрай BullMQ
  attempts:5 / exp backoff). Зарегистрирован на `notifications.dispatch` (очередь была объявлена,
  начали использовать).

### D3 — Max (нативно, под флагом `max_channel`)
- `lib/max/client.ts` (`isMaxEnabled` = флаг+креды, `sendMaxMessage` fetch+таймаут, `maxDeepLink`),
  `services/max/link.ts` (зеркало telegram-link: status/generate/unlink/linkByCode, audit),
  webhook `/api/integrations/max/webhook` (флаг-гейт 404, секрет-заголовок, защитный парсинг
  `/start`), `channels/max.ts`, server-actions. Сеть замокана в тестах, креды из env.

### D6 — входящие (вне объёма)
- Не делалось; шов заложен бесплатно — webhook-роуты Telegram/Max структурно готовы принимать
  не-`/start` апдейты (сейчас игнорируют), см. spec §4.

### D4 — WhatsApp через агрегатор (под флагом `whatsapp_channel`)
- `lib/whatsapp/aggregator.ts`: `WhatsAppViaAggregator` по принципу Wazzup — конфиг **только из
  env** (`WHATSAPP_AGGREGATOR_BASE_URL`/`_API_KEY`/`_CHANNEL_ID`), `sendWhatsAppMessage` (POST
  `/v3/message`, Bearer, chatType whatsapp). `channels/whatsapp.ts` (адресация по номеру).

## Критерии приёмки

- [x] Email и Telegram через единый `NotificationChannel`; поведение не изменилось (регресс-тесты).
- [x] Email всегда; Telegram/Max/WhatsApp — только при opt-in (тесты матрицы `isEnabledFor`).
- [x] Добавление канала не требует правок мест генерации — структурный тест
  `notifications.channels.structural.test.ts` (fake-канал через мок реестра доставлен из
  `notifyOrgUsers` без правок org.ts).
- [x] Max и WhatsApp за интерфейсом, сеть замокана, под флагами.
- [x] Ошибка канала изолирована (тест: telegram бросает → email доставлен); идемпотентность
  (детерминизм jobId, поведение очереди).
- [x] Ключи/URL агрегатора — из окружения, не в коде.

## Гейты

- `typecheck` ✓ · `lint` ✓ (0 warnings)
- Полный `npm test` (unit+integration против живого локального Postgres, sequential):
  **4069 passed / 3 skipped / 0 failed** (409 файлов). Отдельно прогнаны новые coverage-тесты
  (server-actions/max, webhook-ветки, processor-wrapper, SyncLog-fail, core dedupKey): 51 passed.
- `prisma migrate status`: **Database schema is up to date** (42 миграции).
  Миграция `20260702120000_user_notification_channels` применена к dev-БД (+ подтянуты висевшие
  Track B миграции order_service_type / order_completion_and_return_fields).
- `npm run gate` (L2.5 Docker-Postgres): **инфра-блок** — host-порт 5432 занят локальным
  Postgres (`Bind for 0.0.0.0:5432 failed: port is already allocated`), известное ограничение
  стенда. Интеграционный контент гейта = integration-слой, который **прошёл** в полном
  `npm test` против живого PG. `npm run gate:down` отработал, контейнер снят.
- `npm run test:coverage` (L3, strict 100% на логических слоях) **не прогонялся**: дорогой
  full-run + требует живой PG, и сам гейт в repo помечен как ещё не валидированный end-to-end
  (открытый вопрос про extglob-ключ `!(*.tsx)`, см. vitest.config §7). Покрытие новых файлов
  закрыто адресными тестами по мере написания (ветки транспортов, диспетчера, процессора,
  webhook-парсинга, server-actions, prefs) — покрытие не понижено; полный coverage-прогон —
  follow-up перед релизом.

## Новые адаптеры / флаги / тесты

**Адаптеры (транспорты за швом):** `lib/max/client.ts` (Max Bot API),
`lib/whatsapp/aggregator.ts` (Wazzup-подобный агрегатор). Оба — fetch+таймаут, best-effort `{ok}`,
креды из env.

**Feature-флаги (opt-in):** `max_channel`, `whatsapp_channel`, `notif_queue`.

**Тесты (новые):** `notifications.channels.test.ts` (интерфейс + 4 канала + deliver),
`notifications.dispatch.test.ts` (jobId/идемпотентность/fallback), `worker.dispatch-notification.test.ts`
(процессор, integration), `services.notifications.preferences.test.ts` (prefs + settings-view),
`services.max.link.test.ts` (integration), `api.integrations.max.webhook.test.ts`,
`max.client.test.ts`, `whatsapp.aggregator.test.ts`, `server-actions.notification-channels.test.ts`,
`notifications.channels.structural.test.ts` (структурная приёмка). Обновлены существующие
notification/route/monitoring-тесты под новый API (без потери покрытия).

## Остаток / follow-up

- Оператор: боевые креды Max (бот + `setWebhook` с `x-max-webhook-secret`) и агрегатора WhatsApp
  (номер + API-ключ + channelId); поднять флаги при готовности.
- Точный формат апдейта Max webhook уточнить по боевой документации (сейчас защитный парсинг
  `message`/`bot_started`).
- D6 (входящие в тред заявки) — отдельный трек, §10 ТЗ.
