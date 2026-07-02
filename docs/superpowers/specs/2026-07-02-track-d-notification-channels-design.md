# Spec: Трек D (P1) — каналы уведомлений за единым интерфейсом

**Дата:** 2026-07-02
**Источник:** ТЗ_Разработчик lk_otsfera v0.5 §9, §12.1 + §25.3 (единый слой интеграций); задание «Трек D».
**Статус:** design (autonomous run по прямому заданию); решения зафиксированы.
**Предпосылка:** треки A+C, B в `main`.

## 1. Проблема и контекст (как есть, сверено)

Доставка уведомлений сегодня — **синхронно inline** в четырёх фан-аутах:
[core.ts](../../../src/lib/notifications/core.ts) (`triggerNotificationEmail`/`triggerNotificationTelegram`),
[org.ts](../../../src/lib/notifications/org.ts) (`notifyOrgUsers`),
[manager.ts](../../../src/lib/notifications/manager.ts) (`notifyManagers`/`notifyManagersOrderLess`),
[partner.ts](../../../src/lib/notifications/partner.ts) (`notifyPartnerUsers`).
Каналы email (Resend, typed React-шаблоны) и Telegram захардкожены в циклах per-recipient.

- **22 места генерации событий** (server-actions, api/comments, chat, 1С writers, manager
  status/leads/uploads, worker cert-expiry/commissions) вызывают только фан-аут-функции —
  каналов они не знают. Шов канала ставится **внутри фан-аутов**, места генерации не трогаем.
- Очереди `notifications.dispatch` и `emails.send` **объявлены в QUEUE_NAMES, но не имеют
  ни продюсеров, ни процессоров** — доставка целиком в web-процессе.
- `User` несёт привязку Telegram (`telegramChatId @unique`, `telegramLinkCode`,
  `telegramLinkCodeExpiresAt`); полей Max/WhatsApp и настроек каналов нет.
- Партнёрский фан-аут **не шлёт Telegram вовсе** — при том, что `/partner/settings` уже
  предлагает привязку. Существующая несостыковка (см. §8-решение 7).
- `Notification.type` в модели — `String` (enum `NotificationType` моделью не используется);
  новых значений enum не требуется.
- Redis: `getRedisConnection()` бросает без `REDIS_URL`; существующий паттерн продюсеров —
  проверка env + try/catch, деградация в «не ставим задачу».

## 2. Решения (зафиксированы)

1. **Интерфейс** `NotificationChannel` в `src/lib/notifications/channels/types.ts`:

   ```ts
   type ChannelKey = 'email' | 'telegram' | 'max' | 'whatsapp';

   interface NotificationChannel {
     key: ChannelKey;
     /** привязка (chatId/phone) + пользовательская настройка + env/flag-гейт */
     isEnabledFor(user: ChannelRecipient): boolean;
     send(user: ChannelRecipient, payload: ChannelPayload): Promise<ChannelSendResult>;
   }
   ```

   `ChannelRecipient` — узкий select из `User` (константа `CHANNEL_RECIPIENT_SELECT`
   переиспользуется всеми фан-аутами). `ChannelSendResult` =
   `{ status: 'sent' | 'skipped' | 'failed'; reason?: string }` — стабильные коды по §3 CLAUDE.md.

2. **Email-контент сериализуем**: React-шаблоны рендерятся **один раз на событие** в фан-ауте
   (контент событийный, не per-recipient) и кладутся в payload как готовые
   `{ subject, html, text }`. Это (а) сохраняет существующие письма байт-в-байт,
   (б) делает payload JSON-сериализуемым для очереди. Мессенджер-каналы шлют `title\n\nbody`
   (как сейчас Telegram).

3. **Настройки каналов — `User.notificationChannels Json?`**, не отдельная таблица.
   Обоснование: (а) три булевых значения фиксированного набора — таблица
   `NotificationPreference` это over-normalization без запросной выгоды; (б) привязки уже
   живут полями на `User` (telegram-трио) — настройки каналов логично рядом; (в) фан-ауты
   читают recipient-ов одним узким select-ом — Json-поле входит в него бесплатно, join-таблица
   добавила бы include в 6+ мест; (г) Json-поля — устоявшийся паттерн репо (`Notification.meta`,
   `AuditLog.meta`, `SavedView.filters`). Форма: `{ telegram?: boolean, max?: boolean,
   whatsapp?: boolean }`, парсинг через zod (уже в зависимостях), мусор → дефолты.

4. **Семантика opt-in = «привязка + не выключено»**: канал включён ⟺ привязка существует
   (`telegramChatId`/`maxChatId`/`whatsappPhone`) **и** `notificationChannels[key] !== false`.
   Привязка — и есть акт opt-in (пользователь явно жмёт «Привязать» в настройках); toggle
   позволяет замьютить канал без отвязки. Даёт **нулевую миграцию данных** (существующие
   привязанные Telegram-пользователи продолжают получать сообщения — поведение сохранено)
   и честный opt-in для новых каналов. **Email всегда включён** — не хранится и не отключается;
   `isEnabledFor` = `!!user.email`.

5. **Поля привязки** (миграция аддитивна, всё nullable):

   ```prisma
   maxChatId                 String?   @unique // Max: null = не привязан (зеркало telegram)
   maxLinkCode               String?
   maxLinkCodeExpiresAt      DateTime?
   whatsappPhone             String?   @unique // WhatsApp через агрегатор: адресация по номеру
   notificationChannels      Json?             // { telegram?: bool, max?: bool, whatsapp?: bool }
   ```

   Max привязывается deep-link-ом (зеркало `services/telegram/link.ts` + webhook);
   WhatsApp — вводом номера в настройках (E.164-нормализация), т.к. агрегатор адресует по номеру.

6. **Диспетчер** `channels/dispatch.ts`:
   - `deliverToRecipient(user, payload)` — перебор каналов реестра, `isEnabledFor` → `send`,
     **каждый канал в своём try/catch** (ошибка одного не роняет остальные), возвращает
     `Record<ChannelKey, ChannelSendResult>`.
   - `dispatchToRecipient(user, payload, { dedupKey })` — если `REDIS_URL` задан: enqueue
     job-ов `notifications.dispatch` **по одному на (recipient × канал)** с детерминированным
     `jobId = notif:{dedupKey}:{userId}:{channelKey}`; BullMQ дедуплицирует по jobId —
     **идемпотентность** (одно событие → не задваивается в канале). Ошибка enqueue →
     деградация в inline-доставку (уведомления важнее очереди). Без `REDIS_URL` — inline
     (тестовый/dev-путь = текущее поведение).
   - `dedupKey` = id созданной in-app `Notification`-строки (создаётся всегда и ровно одна
     на событие×получателя — естественный ключ идемпотентности).

7. **Воркер**: процессор `src/worker/processors/dispatch-notification.ts` на очереди
   `notifications.dispatch` (объявлена давно — начинаем использовать). Достаёт юзера узким
   select-ом, повторно проверяет `isEnabledFor` (настройки могли смениться), шлёт через канал.
   `failed` → пишет `SyncLog { entity: 'notification', direction: 'out', operation:
   'channel_<key>', status: 'error' }` и **бросает** → BullMQ ретраит (attempts: 5,
   exponential backoff — дефолт очередей). `skipped` → успешное завершение job-а.
   Inline-путь ошибки логирует `console.warn` (как сейчас) — SyncLog для воркера,
   где нет наблюдателя-веб-запроса.

8. **Существующая шероховатость, чинится сознательно**: партнёрский фан-аут переходит на
   диспетчер ⇒ партнёры с привязанным Telegram начинают получать Telegram-зеркало. Это
   выравнивание с обещанием UI («Уведомления привязаны к этому чату»), а не случайный дрейф.
   Регресс-тесты партнёра остаются зелёными (в тестовом env Telegram выключен).

9. **Каналы Max и WhatsApp — за адаптерами, под opt-in feature-флагами**:
   - `max_channel`: транспорт `src/lib/max/client.ts` — `isMaxEnabled()` (флаг + `MAX_BOT_TOKEN`
     + `MAX_BOT_USERNAME`), `sendMaxMessage(chatId, text)` (fetch `MAX_API_BASE_URL`,
     дефолт `https://botapi.max.ru`, таймаут 5 с, `{ok:boolean}`), `maxDeepLink(code)`.
     Привязка: `src/lib/services/max/link.ts` (зеркало telegram/link) + webhook
     `POST /api/integrations/max/webhook` (секрет-заголовок `x-max-webhook-secret`,
     `notFoundIfDisabled('max_channel')`). Формат апдейта — за адаптером, парсинг защитный
     (боевые креды/уточнение формата — позже; в тестах всё замокано).
   - `whatsapp_channel`: адаптер `src/lib/whatsapp/aggregator.ts` — `WhatsAppViaAggregator`
     по принципу Wazzup: конфиг **только из env** (`WHATSAPP_AGGREGATOR_BASE_URL`,
     `WHATSAPP_AGGREGATOR_API_KEY`, `WHATSAPP_AGGREGATOR_CHANNEL_ID` — id подключённого
     через сервис номера), `isWhatsAppEnabled()`, `sendWhatsAppMessage(phone, text)`
     (POST `{base}/v3/message`, Bearer, body `{channelId, chatType:'whatsapp', chatId: phone,
     text}`, таймаут 5 с). Входящие (D6) — вне объёма; шов = webhook-роут по образцу
     telegram/max добавляется отдельным треком.

10. **Гейтинг флагов каналов — 3 точки в смысле §5, адаптированные под не-URL фичу**
    (у канала нет route-префикса, middleware/nav неприменимы; фиксируем канонично):
    (а) транспорт/канал — `isMaxEnabled()`/`isWhatsAppEnabled()` включают флаг ⇒ диспетчер
    и `isEnabledFor` гейтятся; (б) настройки UI — карточка канала не показывается при
    выключенном флаге; (в) webhook/binding-роуты и server-actions — `notFoundIfDisabled`/
    `requireFeature`. Оба флага — в `OPT_IN_FLAGS` (staged rollout).

11. **UI настроек** — общая презентационная карточка `NotificationChannelsCard`
    (domain-agnostic props, прецедент — `TelegramLinkCard`, уже общий для 5 ролей):
    Email — бейдж «всегда включён»; Telegram/Max — привязка + toggle; WhatsApp — номер + toggle.
    Server-action `updateNotificationChannelsAction` (+`saveWhatsappPhoneAction`,
    `generateMaxLinkAction`, `unlinkMaxAction`) — роль-агностичны, `requireSession`.
    Сервис `src/lib/services/notifications/preferences.ts` — Result-контракт §3.

12. **`triggerNotificationEmail`/`triggerNotificationTelegram` упраздняются** в пользу
    `deliverNotificationToUser(userId, payload)` (core.ts): один вызов = все каналы юзера.
    Единственный продовый вызывающий — `certificate-expiry.ts` (2 строки → 1). Сигнатуры
    фан-аутов `notifyOrgUsers`/`notifyManagers`/`notifyPartnerUsers` **не меняются**
    (места генерации не трогаем), суммарные счётчики сохраняются.

## 3. Инварианты приёмки

- Email/Telegram ведут себя как раньше (шаблоны, гейты `EMAIL_ENABLED`/`TELEGRAM_BOT_TOKEN`,
  best-effort, счётчики) — регресс-тесты зелёные.
- Email доставляется всегда (при наличии email); Telegram/Max/WhatsApp — только при
  привязке + не выключено (тесты opt-in-матрицы).
- Новый канал = новая реализация интерфейса + регистрация в реестре; места генерации
  не правятся (структурный тест: fake-канал через мок реестра получает доставку из
  `notifyOrgUsers` без правок org.ts).
- Ошибка канала изолирована (тест: telegram бросает → email отправлен, счётчики верны).
- Идемпотентность: повторный dispatch с тем же dedupKey не создаёт второй job (тест на
  детерминизм jobId + поведение очереди с мокнутым `Queue.add`).
- Max/WhatsApp: сеть только через адаптер, в тестах — моки; env-ключи не в коде.
- `typecheck`, `lint`, `test`, `gate` — зелёные; `prisma migrate status` — чисто.

## 4. Вне объёма (D6)

Входящие сообщения из каналов в тред заявки — не в этом треке. Шов уже есть:
webhook-роуты Telegram/Max структурно готовы принимать не-`/start` апдейты (сейчас
игнорируют), адрес входящих определён. Дешевле не делать ничего дополнительно.
