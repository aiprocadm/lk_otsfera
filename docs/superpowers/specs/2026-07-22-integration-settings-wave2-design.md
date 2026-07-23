# Настройка интеграций в UI — волна 2: Mango / Telegram / Max / WhatsApp / IMAP

Дата: 2026-07-22 · Статус: approved · Продолжение фундамента efb29ff
(`IntegrationSetting` + шифрование + почта как образец end-to-end).

## 1. Цель

Довести перенос настройки интеграций из env в /admin/integrations до всех
оставшихся каналов реестра `SETTING_SPECS`: телефония Mango, боты
Telegram/Max, WhatsApp-агрегатор, входящая почта IMAP. Env остаётся
fallback'ом (переходный период), как в образце.

## 2. Ключевая проблема и решение — синхронный кэш настроек

`NotificationChannel.isEnabledFor` **синхронный** (контракт трека D), и все
мессенджер-транспорты читают env синхронно. Прямой перенос на
`getSettingValue` (async) сломал бы контракт каналов.

Решение — модуль `src/lib/config/integrationSettingsCache.ts`:

- `primeIntegrationSettingsCache(prisma)` — async; одним `findMany` грузит
  эффективные значения ВСЕХ ключей реестра (БД → расшифровка секретов) в
  module-level снапшот. TTL 30 с — повторный prime внутри TTL бесплатен.
  **Fail-open**: ошибка чтения БД логируется (`log.warn`) и ставит backoff
  (=TTL), снапшот не считается загруженным — читатели остаются на env.
- `cachedIntegrationSetting(key)` — **sync**; значение из снапшота, если он
  хоть раз загрузился; иначе env-fallback (та же семантика, что у
  `getSettingValue`: пустая строка = не задано).
- `resetIntegrationSettingsCache()` — сброс после сохранения формы.

Точки prime (все — существующие async-швы):

| Шов | Зачем |
|---|---|
| `dispatchToRecipient` / `deliverToRecipient` | inline-доставка уведомлений (web-процесс) |
| `runDispatchNotification(db, …)` | queued-доставка (воркер) — подхват новых токенов без рестарта |
| `pollInboundEmailProcessor(db)` | IMAP-конфиг в воркере |
| `services/{telegram,max}/link.ts`, `services/notifications/preferences.ts` | deep-link/`enabled` в настройках пользователя |
| `/admin/integrations` page | статус-панель показывает эффективные значения |

Непраймленные контексты (юнит-тесты) видят ровно старое env-поведение —
обратная совместимость тестового слоя бесплатна.

## 3. Решения по каналам

- **Telegram / Max / WhatsApp**: `telegram/client.ts`, `max/client.ts`,
  `whatsapp/aggregator.ts` читают токены/ключи через
  `cachedIntegrationSetting`. Поведенческие флаги `max_channel` /
  `whatsapp_channel` остаются env (первая точка гейтинга, §5 CLAUDE.md).
  Базовые URL (`MAX_API_BASE_URL`, `WHATSAPP_AGGREGATOR_BASE_URL`) остаются
  env — деплой-константы, не операционные настройки.
- **Mango**: креды (`mango.apiKey`/`apiSalt`) и `mango.vpbxBaseUrl` — в UI.
  `RestMangoAdapter` читает конфиг **лениво при каждом вызове** (не в
  конструкторе) — смена настроек не требует пересоздания синглтона.
  Вебхук (`api/integrations/mango/webhook`) проверяет подпись по
  `getSettingValue` напрямую (async-роут; мгновенный подхват; fail-closed
  401 при отсутствии кредов сохраняется). Флаг `telephony_mango` остаётся
  **env-only**: он читается в edge-middleware, где БД недоступна. Поэтому
  ключ `mango.enabled` **удаляется из реестра** — чекбокс в БД, который не
  может повлиять на middleware-гейт, создавал бы иллюзию управления.
- **IMAP**: `ImapInboundEmailAdapter` читает конфиг лениво при каждом
  `fetchNewMessages`. Выбор адаптера `imap.adapter` (fake|imap) — тоже из
  настроек: `getInboundEmailAdapter` кэширует синглтон **по kind** и
  пересобирает при смене (паттерн transport.ts `cachedForKey`).
- **Воркер-подхват**: dispatch-notification, poll-inbound-email,
  mango-recording, mango-backfill (и сервис initiateCall) праймят кэш →
  изменения в UI доезжают до воркера без рестарта (≤ TTL + интервал
  очереди). REST-адаптер Mango остаётся стабом (live-wiring отложен).

## 4. UI и server-actions

- Генерик-компонент `IntegrationSettingsForm` (client): props
  `{title, description, note?, action, fields[]}`; вид поля:
  `text | secret | checkbox | select`. Секрет: placeholder «••••», пусто =
  не менять (семантика `saveSettings`); показывается «задан (в конфиге
  сервера)» по `isSet`/`source`. Существующая почтовая форма не трогается
  (отгруженный образец).
- Пять групп на /admin/integrations: Telegram, Max, WhatsApp, Mango
  (с плашкой «включение — флагом FEATURE_TELEPHONY_MANGO на сервере»), IMAP.
- Server-actions (по одному на группу, файл `integrationSettings.ts`):
  requireAdmin → `saveSettings` → `resetIntegrationSettingsCache()`
  (+ `__resetInboundEmailAdapter()` для IMAP) → revalidatePath.
- Статус-панель `getIntegrationsStatus()` читает креды через
  `cachedIntegrationSetting` (страница праймит перед вызовом); подсказки
  переформулированы: «настраивается здесь», env — для флагов.

## 5. Тестовая стратегия

- Новый `config.integrationSettingsCache.test.ts`: prime/чтение, env-fallback
  до prime, TTL (повторный prime не ходит в БД), reset, fail-open + backoff,
  секреты расшифровываются.
- Обновления: клиенты трёх мессенджеров (DB-значение побеждает env после
  prime; без prime — env), adapter-rest/adapter-imap (ленивый конфиг),
  inbound index (пересборка по kind), вебхук Mango (креды из БД),
  server-actions (маппинг FormData → entries, сбросы кэшей), генерик-форма,
  страница, статус-сервис.
- Существующие тесты каналов/доставки не праймят кэш → env-путь, зелёные
  без правок. Файлы, косвенно зовущие prime без БД, получают быстрый
  fail-open (ECONNREFUSED/мок без метода) + backoff.

## 6. Вне скоупа

Live-wiring REST Mango и реального IMAP-клиента (стабы остаются), перенос
поведенческих/route-флагов в БД, per-company настройки интеграций.
