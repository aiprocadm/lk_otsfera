# Spec: Telegram-уведомления пользователям (gap #2)

**Дата:** 2026-06-24
**Источник:** ТЗ «Личный кабинет Промтехносфера» v0.4 — §18
**Статус:** design (autonomous goal-run); решения зафиксированы, ждут review перед planning.
**Память:** [[project-tz-v04-gap-program-2026-06-23]] gap #2.

## 1. Проблема и контекст

§18 ТЗ: пользователь привязывает Telegram и получает туда уведомления. Сейчас Telegram
существует **только** для admin-алертов мониторинга ([monitoring/deliver.ts](src/lib/monitoring/deliver.ts)
`deliverTelegram` шлёт в один захардкоженный `ALERT_TELEGRAM_CHAT_ID`). Пользовательских
привязок и канала в фан-аут уведомлений нет.

Архитектура уведомлений (как есть):
- **ЛК-канал** — `Notification`-строка. Пишется либо хелпером `createNotification`
  ([core.ts](src/lib/notifications/core.ts)), либо напрямую `db.notification.create` внутри
  циклов `notifyOrgUsers`/`notifyManagers` ([org.ts](src/lib/notifications/org.ts),
  [manager.ts](src/lib/notifications/manager.ts)).
- **Email-канал** — best-effort, **зеркалит** ЛК в тех же местах: `triggerNotificationEmail`
  (single-user) + `dispatchOrgEmail`/`dispatch` per-recipient в циклах фан-аута. No-op при
  `!isEmailEnabled()`.

**Единой точки фан-аута нет** — Telegram подключается как **третий best-effort канал,
зеркалящий email** в тех же ~6 местах. Это `improve logic, not rewrite`: новый канал, а не
новая подсистема уведомлений.

## 2. Решения (зафиксированы)

1. **Доставка** — webhook (не polling): `POST /api/integrations/telegram/webhook`, секрет-гейт
   заголовком `X-Telegram-Bot-Api-Secret-Token`. Serverless-friendly; middleware уже исключает
   `/api` (matcher), роут публичный.
2. **Привязка** — deep-link `https://t.me/<bot>?start=<code>`. `/start <code>` в боте →
   webhook находит юзера по одноразовому коду → пишет `telegramChatId`.
3. **Хранение** — поля на `User` (без новой таблицы): `telegramChatId String? @unique`,
   `telegramLinkCode String?`, `telegramLinkCodeExpiresAt DateTime?`. (Уникальность chatId =
   один Telegram-аккаунт ↔ один пользователь.)
4. **Включение** — graceful `isTelegramEnabled()` (наличие `TELEGRAM_BOT_TOKEN` +
   `TELEGRAM_BOT_USERNAME`), **не feature-flag** (зеркалит `isEmailEnabled()`; §5 не требует
   3 точек для env-гейта). Не настроено → карточка показывает «не настроено», sends — no-op.
5. **UI** — общий презентационный `TelegramLinkCard` (domain-agnostic, §4) + тонкая страница
   `/<role>/settings` в каждом кабинете (manager/organization/partner/admin/leader). Серверные
   экшены привязки — общие (роль-агностичны, нужен лишь `userId` из сессии).
6. **Бот** — тот же бот может слать и алерты, и пользовательские уведомления (оператор может
   выставить `TELEGRAM_BOT_TOKEN == ALERT_TELEGRAM_BOT_TOKEN`). Раздельные env для гибкости.

## 3. Модель данных

`User` (добавить):
```prisma
  telegramChatId             String?   @unique  // null = не привязан
  telegramLinkCode           String?            // одноразовый код привязки (deep-link start param)
  telegramLinkCodeExpiresAt  DateTime?
```
Миграция аддитивна (всё nullable). Индекс под `telegramLinkCode` не нужен (lookup редкий, при
/start); `@unique` на `telegramChatId` даёт индекс для адресации.

**DB-state gotcha:** ветка от main; dev-БД `cabinet` сейчас несёт миграцию gap #4 (не в этой
ветке). Перед `migrate deploy` этой ветки — пересоздать БД (`npm run db:recreate-local` /
`dev-stack -Reset`), чтобы применились только main+gap2 миграции (иначе Prisma ругнётся на drift).

## 4. Транспорт Telegram

Новый модуль `src/lib/telegram/client.ts` (server-only):
- `isTelegramEnabled(): boolean` — `!!TELEGRAM_BOT_TOKEN && !!TELEGRAM_BOT_USERNAME`.
- `sendTelegramMessage(chatId: string, text: string): Promise<{ ok: boolean }>` — `fetch`
  `api.telegram.org/bot<token>/sendMessage` с AbortController-таймаутом (как `deliverTelegram`,
  паттерн переиспользуется/обобщается). Никогда не бросает наружу важный путь (best-effort).
- `botDeepLink(code: string): string` → `https://t.me/<username>?start=<code>`.

`monitoring/deliver.ts` `deliverTelegram` остаётся (admin-alert чат) — можно позже
переиспользовать `sendTelegramMessage`, но не обязательно в этом spec (не ломаем).

## 5. Фан-аут: канал Telegram

`core.ts` — новый хук, зеркало email:
```ts
export async function triggerNotificationTelegram(payload: { userId; title; body; type; url? }) {
  if (!isTelegramEnabled()) return;
  const u = await prisma.user.findUnique({ where: { id: payload.userId }, select: { telegramChatId: true } });
  if (!u?.telegramChatId) return;
  await sendTelegramMessage(u.telegramChatId, `${payload.title}\n\n${payload.body}`);
}
```
Подключить рядом с КАЖDOЙ точкой email-фан-аута (best-effort try/catch, как email):
- single-user сайты: `triggerNotificationEmail` вызовы в
  [api/comments/route.ts](src/app/api/comments/route.ts), [api/documents/upload/route.ts](src/app/api/documents/upload/route.ts),
  [worker/processors/certificate-expiry.ts](src/worker/processors/certificate-expiry.ts).
- per-recipient циклы: `notifyOrgUsers` (org.ts, после `notification.create`),
  `notifyManagers` (manager.ts). Telegram-текст — из того же `title`/`body`, что ЛК-строка.
- Для `notifyOrgUsers`/`notifyManagers` нужно подтянуть `telegramChatId` в выборку получателей
  (расширить `select` рядом с `email`).

Сбой Telegram логируется и проглатывается (как email) — не блокирует ЛК (источник истины).

## 6. Webhook + привязка

`POST /api/integrations/telegram/webhook`:
1. Проверить заголовок `X-Telegram-Bot-Api-Secret-Token === TELEGRAM_WEBHOOK_SECRET` (иначе 401).
2. Распарсить update; интересует `message.text` вида `/start <code>` и `message.chat.id`.
3. `/start <code>`: найти `User` где `telegramLinkCode = code` и `telegramLinkCodeExpiresAt > now`.
   Найден → `telegramChatId = chat.id`, очистить код+expiry, audit `telegram_linked`, ответить
   пользователю `sendTelegramMessage(chatId, '✅ Уведомления привязаны')`. Не найден/просрочен →
   ответить «код недействителен». Дубль chatId (уже у другого юзера) → отклонить (unique).
4. Прочие апдейты — 200 OK без действий (Telegram не должен ретраить).
Сервис-логика — `src/lib/services/telegram/link.ts` (`linkByCode`), роут тонкий.

## 7. Сервисы привязки (user-facing) + server-actions

`src/lib/services/telegram/link.ts` (Result-тип §3):
- `getTelegramStatus(prisma, session)` → `{ linked: boolean; enabled: boolean }`.
- `generateLinkCode(prisma, session)` → создаёт код (crypto-random, ~16-символьный, URL-safe),
  expiry +15 мин, пишет на `User`; возвращает `{ ok:true, deepLink }`. (`enabled=false` →
  `{ ok:false, error:'telegram_disabled' }`.)
- `unlinkTelegram(prisma, session)` → `telegramChatId=null`, audit `telegram_unlinked`.
Server-actions `src/server-actions/telegram.ts` — тонкие адаптеры (`requireSession`).

## 8. UI

- `src/components/settings/telegram-link-card.tsx` — `'use client'`, domain-agnostic props
  (`status`, серверные экшены). Состояния: не настроено / не привязано (кнопка «Привязать» →
  открывает deep-link + показывает код) / привязано (кнопка «Отвязать»). Только `ui/`-примитивы,
  строки через `errorMessageRu`, тосты, без инлайн-hex.
- Тонкие страницы `/<role>/settings/page.tsx` (5 кабинетов) — серверный гейт роли (`requireRole`
  / `require*`) + рендер общего card с `getTelegramStatus`. Пункт «Настройки» в nav каждого
  кабинета (`navByRole`).

## 9. Env / docs

`.env.example`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
(закомментированы, с пояснением). README — раздел настройки Telegram-бота + установка webhook
(`setWebhook` с secret_token). CHANGELOG `[Unreleased]`.

## 10. RBAC / безопасность

- Webhook — публичный, защищён secret-token заголовком (только Telegram знает секрет). Без него
  — 401. Не логировать токен/секрет/коды (§12).
- Привязка/отвязка — только свой аккаунт (server-action берёт `userId` из сессии; нельзя
  привязать чужой). Код одноразовый, короткоживущий, crypto-random.
- `telegramChatId @unique` — нельзя «угнать» чужой chat в два аккаунта.
- Видимость уведомлений не меняется — Telegram лишь зеркалит то, что юзер и так получает в ЛК.

## 11. Тесты (§6)

- **Unit**: `isTelegramEnabled` (env-комбинации); `triggerNotificationTelegram` (no-op без
  enabled / без chatId; зовёт send при наличии); `linkByCode` (валид/просрочен/не найден/дубль);
  `generateLinkCode` (disabled → error; формат deep-link); webhook (плохой secret → 401; /start
  валид → линк; мусор → 200 no-op). Транспорт мокается.
- **Integration** (живой PG): полный цикл generate→linkByCode→status=linked→unlink; уникальность
  chatId.
- **Coverage**: новые logic-файлы под порогом 100% (§6 фаза 1) — `telegram/client.ts`,
  `services/telegram/link.ts`, webhook-роут, фан-аут-хук.

## 12. Вне объёма (явно)

- Двусторонний бот (команды кроме /start), inline-кнопки, rich-форматирование.
- Polling-режим (выбран webhook).
- Объединение admin-alert чата с пользовательским каналом (остаётся как есть).
- Пер-тип настройки «какие уведомления слать в Telegram» (v1 — всё, что зеркалит email).

## 13. Критерии приёмки

1. Пользователь генерирует код, открывает deep-link, шлёт `/start` боту → аккаунт привязан
   (виден статус «привязано»); повторная отвязка работает.
2. При настроенном боте пользователь с привязкой получает в Telegram те же уведомления, что в
   ЛК/email (зеркало во всех точках фан-аута); сбой Telegram не ломает ЛК.
3. Без `TELEGRAM_BOT_TOKEN` фича дремлет: карточка «не настроено», sends — no-op, гейты зелёные.
4. Webhook без верного secret-заголовка → 401; мусорный апдейт → 200 без эффекта; токены/коды
   не попадают в логи.
5. Все гейты зелёные (typecheck/lint/unit/integration).
