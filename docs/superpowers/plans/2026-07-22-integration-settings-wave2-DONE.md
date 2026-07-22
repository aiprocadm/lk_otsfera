# DONE: настройка интеграций в UI — волна 2 (Mango/Telegram/Max/WhatsApp/IMAP)

План: [2026-07-22-integration-settings-wave2.md](2026-07-22-integration-settings-wave2.md) ·
Спека: [2026-07-22-integration-settings-wave2-design.md](../specs/2026-07-22-integration-settings-wave2-design.md)

## Что отгружено

- **Кэш настроек** `src/lib/config/integrationSettingsCache.ts`: async
  `primeIntegrationSettingsCache` (TTL 30 с, fail-open + backoff), sync
  `cachedIntegrationSetting` (снапшот только реально заданных в БД ключей →
  живой env-fallback для остальных), `resetIntegrationSettingsCache`.
- **Мессенджеры**: `telegram/client`, `max/client`, `whatsapp/aggregator`
  читают креды через кэш; флаги каналов остаются env. Prime-швы: диспетчер
  (`dispatchToRecipient`/`deliverToRecipient`), воркер `dispatch-notification`,
  сервисы привязки telegram/max, `getNotificationSettings`.
- **Mango**: `readMangoConfig` + ленивый конфиг REST-адаптера; вебхук
  проверяет подпись по `getSettingValue` (деградация на env при аварии БД,
  fail-closed 401 сохранён); prime в `mango-recording`/`mango-backfill`/
  `initiateOutboundCall`. `mango.enabled` удалён из реестра (env-only флаг —
  edge-middleware не читает БД).
- **IMAP**: `readImapConfig` + ленивый конфиг адаптера; выбор `fake|imap`
  из настроек с пересборкой синглтона по kind; prime в `poll-inbound-email`.
- **UI**: генерик `IntegrationSettingsForm` (text/secret/checkbox/select,
  пустой секрет = не менять) + 5 групп на /admin/integrations; статус-панель
  на эффективных значениях; server-actions групп со сбросом кэшей
  (+ `__resetInboundEmailAdapter` для IMAP); `.env.example` дополнен.

## Тесты

Новые: `config.integrationSettingsCache.test.ts` (9),
`components.integration-settings-form.test.tsx` (6). Расширены:
server-actions (11), адаптеры Mango/IMAP (конфиг-ридеры, override-ветка,
пересборка по kind), страница интеграций. `email.send.test.ts` пришпилен к
env-fallback — юнит-слой больше не зависит от настроек, сохранённых в
локальной БД (ловилось на dev-сервере с заполненной таблицей).

## Гейты

typecheck ✓ · lint ✓ · test:unit ✓ (6834) · gate (integration, локальный
Postgres `lk_otsfera_gate`) ✓ — см. коммиты ветки `claude/integration-settings-ui`.

## Вне скоупа (осознанно)

Live-wiring REST Mango и реального IMAP-клиента (стабы), перенос route/
поведенческих флагов в БД, per-company настройки.
