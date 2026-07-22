# План: настройка интеграций в UI — волна 2 (Mango/Telegram/Max/WhatsApp/IMAP)

Спека: [2026-07-22-integration-settings-wave2-design.md](../specs/2026-07-22-integration-settings-wave2-design.md)

- [x] 1. Кэш: `src/lib/config/integrationSettingsCache.ts` (prime/TTL/fail-open,
      sync-чтение с env-fallback, reset) + unit-тест.
- [x] 2. Реестр: удалить `mango.enabled` из `SETTING_SPECS` (env-only флаг,
      edge-middleware) с комментарием-причиной.
- [x] 3. Мессенджер-клиенты на кэш: `telegram/client.ts`, `max/client.ts`,
      `whatsapp/aggregator.ts` + тесты (primed vs unprimed).
- [x] 4. Prime-швы: `dispatch.ts`/`deliver.ts`, `dispatch-notification.ts`,
      `poll-inbound-email.ts`, `services/{telegram,max}/link.ts`,
      `services/notifications/preferences.ts`.
- [x] 5. Mango: ленивый конфиг в `adapter-rest.ts`; вебхук — креды через
      `getSettingValue` (fail-closed сохранён) + тесты.
- [x] 6. IMAP: ленивый конфиг в `adapter-imap.ts`; `inbound/email/index.ts` —
      пересборка синглтона по kind + тесты.
- [x] 7. UI: генерик `IntegrationSettingsForm` + 5 групп на
      /admin/integrations; статус-панель на эффективные значения.
- [x] 8. Server-actions пяти групп + сбросы кэшей + тесты.
- [x] 9. Гейты: typecheck, lint, test:unit; точечные integration при
      затронутых processors; close-out DONE.
