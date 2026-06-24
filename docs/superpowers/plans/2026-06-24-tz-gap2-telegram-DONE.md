# Telegram-уведомления пользователям (gap #2) — Close-out

**Дата:** 2026-06-24
**Ветка:** `claude/tz-gap2-telegram` (от main)
**Spec:** [2026-06-24-tz-gap2-telegram-design.md](../specs/2026-06-24-tz-gap2-telegram-design.md) · **Plan:** [2026-06-24-tz-gap2-telegram.md](2026-06-24-tz-gap2-telegram.md)
**Память:** [[project-tz-v04-gap-program-2026-06-23]] gap #2.

## Что отгружено (§18 ТЗ)

Telegram как **третий best-effort канал уведомлений** (рядом с ЛК и e-mail) + привязка через
deep-link/код. Принцип: новый канал, не новая подсистема — Telegram вшит в существующие точки
email-фан-аута, ничего не переписано.

### Привязка
- `User.telegramChatId @unique` + одноразовый код (`telegramLinkCode` + expiry). Миграция аддитивна.
- Транспорт `src/lib/telegram/client.ts`: `isTelegramEnabled()` (graceful-enable по env, **не feature-flag**), `sendTelegramMessage` (fetch + AbortController-таймаут, best-effort never-throws), `botDeepLink`.
- Сервис `src/lib/services/telegram/link.ts` (Result §3): `getTelegramStatus`/`generateLinkCode`/`unlinkTelegram`/`linkByCode`. Код crypto-random, 15-мин TTL, одноразовый; дубль chatId + P2002-гонка → `chat_taken`.
- Webhook `POST /api/integrations/telegram/webhook`: публичный, secret-token-гейт (401 без верного заголовка), `/start <code>`→привязка, мусор→200 (без retry-storm), обёрнут try/catch. Не логирует секрет/код/токен.
- Server-actions `src/server-actions/telegram.ts` (own-account через `requireSession`→`session.sub`).

### Канал в фан-ауте (зеркало email)
- `triggerNotificationTelegram` (core.ts) рядом с `triggerNotificationEmail` в 3 single-user точках (comments route, documents upload route, certificate-expiry worker).
- Per-recipient в `notifyOrgUsers` + `notifyManagers`/`notifyManagersOrderLess` (telegramChatId добавлен в select, best-effort send после email). Admin-alert канал (`monitoring/deliver.ts`) намеренно отдельный (§12).

### UI
- Общий презентационный `src/components/settings/telegram-link-card.tsx` (3 состояния: не настроено / привязать / привязано); только `ui/`-примитивы, `errorMessageRu` (+ ключ `telegram_disabled`), без инлайн-hex (Tailwind `orange-600`).
- 5 тонких страниц `/<role>/settings` (manager/organization/partner/admin/leader) с корректным per-role гардом + пункт «Настройки» в nav каждого кабинета.

### Env / docs
- `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`/`TELEGRAM_WEBHOOK_SECRET` (.env.example) + README (создание бота + `setWebhook` с secret_token) + CHANGELOG `[Unreleased]`.

## Гейты

- `typecheck` ✓ · `lint` ✓ (0 warnings)
- unit: **3145 passed / 3 skipped / 0 failed** (290 файлов; включая исправленные nav-count тесты)
- integration (живой PG): `services.telegram.link` полный цикл generate→link→status→unlink + uniqueness ✓
- Миграция `20260624010000_user_telegram_link` применена (dev-БД пересоздана под ветку, т.к. от main).
- **Holistic review (opus): SHIP WITH MINOR FIXES** — все 7 инвариантов PASS (webhook-secret, no-leak, best-effort, graceful-disable, own-account, additive-migration, mirrors-email). 3 минора **исправлены**: инлайн-hex→`orange-600`; try/catch вокруг `linkByCode` в webhook; ключ `telegram_disabled` в `errorMessageRu`.

## Остаток / follow-up

- Оператор: создать бота, выставить `setWebhook` с secret_token (README).
- Пер-тип настройки «какие уведомления слать в Telegram» — вне v1 (сейчас всё, что зеркалит email).
- Бот может быть общим с admin-alert (один токен) — на усмотрение оператора.

## Коммиты (9)

schema+spec/plan → transport → link service → webhook+actions → fan-out mirror → card → 5 settings pages+nav → docs → review-fixes.
