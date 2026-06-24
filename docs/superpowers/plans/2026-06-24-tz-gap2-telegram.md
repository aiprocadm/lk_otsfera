# Telegram-уведомления пользователям (gap #2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** §18 ТЗ — пользователь привязывает Telegram (deep-link/код через бот-webhook) и получает туда уведомления (третий best-effort канал, зеркало email).

**Architecture:** `User.telegramChatId` + одноразовый код привязки; публичный secret-gated webhook `/api/integrations/telegram/webhook` ловит `/start <code>`; `triggerNotificationTelegram` зеркалит email во всех точках фан-аута; graceful-enable через `isTelegramEnabled()` (env), не feature-flag.

**Tech Stack:** Next.js 15 / Prisma 5 / Vitest. Spec: [2026-06-24-tz-gap2-telegram-design.md](../specs/2026-06-24-tz-gap2-telegram-design.md). Branch `claude/tz-gap2-telegram` (от main).

---

### Task 1: Schema — поля Telegram на User + миграция
**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_user_telegram_link/migration.sql`
- [ ] Добавить в `User`: `telegramChatId String? @unique`, `telegramLinkCode String?`, `telegramLinkCodeExpiresAt DateTime?`.
- [ ] **Пересоздать dev-БД** (`npm run db:recreate-local`) — ветка от main, иначе drift с gap#4-миграцией в БД. Затем `migrate diff`→migration.sql→`migrate deploy`→`prisma generate`.
- [ ] `npm run typecheck`. Commit `feat(schema): User telegram link fields (§18)`.

### Task 2: Транспорт `telegram/client.ts`
**Files:** `src/lib/telegram/client.ts`, test `src/__tests__/telegram.client.test.ts`
- [ ] TDD: `isTelegramEnabled()` по env (token+username); `botDeepLink(code)` → `https://t.me/<username>?start=<code>`; `sendTelegramMessage(chatId,text)` — fetch с AbortController-таймаутом (паттерн `monitoring/deliver.ts`), best-effort `{ok}`; мокать `fetch`.
- [ ] Commit `feat(telegram): transport client + isTelegramEnabled (§18)`.

### Task 3: Сервис привязки + webhook + server-actions
**Files:** `src/lib/services/telegram/link.ts`, `src/app/api/integrations/telegram/webhook/route.ts`, `src/server-actions/telegram.ts`, tests
- [ ] TDD `link.ts` (Result §3): `getTelegramStatus`, `generateLinkCode` (disabled→`{ok:false,'telegram_disabled'}`; иначе код+expiry+15м, deepLink), `unlinkTelegram`, `linkByCode(prisma,{code,chatId})` (валид/просрочен/не найден/дубль-chatId→ошибки; успех очищает код, ставит chatId, audit `telegram_linked`).
- [ ] Webhook route (тонкий): secret-заголовок `X-Telegram-Bot-Api-Secret-Token`≠env→401; `/start <code>`→`linkByCode`→ответ ботом; прочее→200 no-op. НЕ логировать секрет/код.
- [ ] server-actions через `requireSession`.
- [ ] Commit `feat(telegram): link service + webhook + actions (§18)`.

### Task 4: Канал Telegram в фан-аут
**Files:** `src/lib/notifications/core.ts`, `org.ts`, `manager.ts`; call-sites `api/comments/route.ts`, `api/documents/upload/route.ts`, `worker/processors/certificate-expiry.ts`; tests
- [ ] TDD `triggerNotificationTelegram` (core.ts): no-op без enabled/без chatId; шлёт при наличии (мок транспорта).
- [ ] Вызвать рядом с каждым `triggerNotificationEmail` (3 single-user сайта, best-effort try/catch).
- [ ] В `notifyOrgUsers`/`notifyManagers`: добавить `telegramChatId` в `select` получателей; после `notification.create`/email — best-effort Telegram per-recipient.
- [ ] Обновить тесты, проверяющие фан-аут (могут потребовать мок нового хука). Commit `feat(notifications): telegram channel mirrors email (§18)`.

### Task 5: UI — карточка + страницы настроек + nav
**Files:** `src/components/settings/telegram-link-card.tsx`, `src/app/{manager,organization,partner,admin,leader}/settings/page.tsx`, `navByRole` (cabinet.ts), tests
- [ ] `TelegramLinkCard` (`'use client'`, domain-agnostic): состояния не-настроено/не-привязано(«Привязать»→deepLink+код)/привязано(«Отвязать»); `ui/`-примитивы, `errorMessageRu`, тосты, без hex.
- [ ] 5 тонких страниц `/<role>/settings` (серверный гейт роли + `getTelegramStatus` + card). Пункт «Настройки» в nav каждого кабинета.
- [ ] `npm run typecheck && lint`. Commit `feat(settings): Telegram link UI in all cabinets (§18)`.

### Task 6: Env + docs
**Files:** `.env.example`, `README.md`, `CHANGELOG.md`
- [ ] `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`/`TELEGRAM_WEBHOOK_SECRET` (комментированы); README раздел (создание бота + `setWebhook` с secret_token); CHANGELOG `[Unreleased]`. Commit `docs: telegram setup (§18)`.

### Финал
- [ ] Гейты: typecheck/lint/unit + integration (link cycle). Holistic review. Close-out `-DONE.md`. PR.

## Self-review (покрытие spec)
§18 привязка → Task 1,3 ✓; транспорт → Task 2 ✓; канал в фан-аут → Task 4 ✓; UI → Task 5 ✓; env/docs → Task 6 ✓; graceful-enable (не flag) → Task 2; webhook security → Task 3; RBAC own-account → Task 3.
