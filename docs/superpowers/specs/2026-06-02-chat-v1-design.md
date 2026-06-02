# Чат в кабинете — дизайн v1 (привязка к заказу, до двух сторон)

**Дата:** 2026-06-02
**Статус:** на ревью (брейнсторм завершён — все развилки закрыты)
**Трек:** B (чат) из [completion-roadmap](2026-06-02-completion-roadmap.md)
**Под-навык реализации:** `superpowers:subagent-driven-development`

---

## Контекст

Единственная переписка сегодня — `Comment`, привязанный к `Order`, с общим (неизолированным) потоком на заказе и без нормального inbox/непрочитанного. Нужен чат **по заказу** с изоляцией сторон и командной видимостью, заменяющий комментарии.

## Доменная модель участников

- **Партнёр** ведёт несколько организаций (портфель) и оформляет заказы от их имени. Партнёров назначает **админ**.
- **Организация-заказчик** — прямое обращение (для заказа `Order.partnerId` пуст).
- **Менеджеры — общий котёл:** все видят всё в рамках компании; **руководитель** работает из того же кабинета.

## Решения брейнсторма (финал)

| # | Вопрос | Решение |
|---|---|---|
| 1 | Участники | Команда — хаб; внешние стороны (партнёр / организация) изолированы друг от друга |
| 2 | Структура тредов | **Привязка к заказу, до 2 сторон** на заказ: `org` и `partner` |
| 3 | Транспорт | Поллинг (v1) |
| 4 | Связь с комментариями | **Чат заменяет комментарии** — миграция `Comment` → сообщения (в v1) |
| 5 | Упрощение v1 | order-scoped supersede; realtime и доп. фичи — позже |
| 6 | Видимость менеджеров | Командная: любой менеджер/руководитель видит переписку по всем заказам |

## Скоуп v1

**Делаем:**
- Модели `OrderThread` + `Message` + `ThreadReadState`.
- На заказе до двух тредов: `side=org` (заказчик-организация ↔ команда) и `side=partner` (партнёр ↔ команда). Стороны изолированы.
- Миграция существующих `Comment` → `Message` (с переносом `attachmentPath`); см. правило ниже.
- Перенаведение order-detail comment-поверхностей на чат; inbox'ы по ролям (`/partner/messages` = **C2**, `/organization/messages`, вкладка «Чат» у менеджера/админа).
- Опц. вложение (Storage + ClamAV-скан, §10). Поллинг + непрочитанное (per-user). Уведомления на `Notification`-модели.
- Feature-flag `chat` (opt-in); при **выключенном** флаге работает старый comment-UI (fallback) — см. «Выкатка».

**НЕ делаем в v1 (вынесено):**
- **C8** (отдельный под-проект сразу после): существующие менеджерские экраны → общая видимость + роль руководителя + перепрошивка defense-in-depth тестов. Чат уже строится по командной модели → от C8 не зависит.
- **Ретайр comment-кода** (удаление старого UI/таблицы) — поздний шаг после успешной выкатки чата.
- **v3:** realtime (SSE/Supabase Realtime), typing/presence, поиск.

## Архитектура

### Модель данных (Prisma)

```prisma
enum ThreadSide { org partner }

model OrderThread {
  id            String     @id @default(cuid())
  orderId       String
  order         Order      @relation(fields: [orderId], references: [id], onDelete: Cascade)
  side          ThreadSide
  createdAt     DateTime   @default(now())
  lastMessageAt DateTime   @default(now())
  messages      Message[]
  readStates    ThreadReadState[]
  @@unique([orderId, side])      // максимум один org- и один partner-тред на заказ
  @@index([side, lastMessageAt])
}

model Message {
  id             String   @id @default(cuid())
  threadId       String
  thread         OrderThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  authorId       String
  author         User     @relation(fields: [authorId], references: [id])
  body           String
  attachmentPath String?
  createdAt      DateTime @default(now())
  @@index([threadId, createdAt])
}

model ThreadReadState {
  id         String   @id @default(cuid())
  threadId   String
  userId     String
  lastReadAt DateTime @default(now())
  @@unique([threadId, userId])
}
```

### `canSeeThread` (изоляция + командная видимость)

- **Команда:** `session.role ∈ { manager, admin }` → видит **любой** тред (обе стороны). Руководитель = менеджер с общей видимостью.
- **Заказчик-организация:** `thread.side == org` И `order.organizationId ∈ session.organizationMemberships`.
- **Партнёр:** `thread.side == partner` И `order.partnerId == session.partnerId`.
- Внешние стороны взаимно невидимы by-design.

### Слои (CLAUDE.md §2)

- **Сервис** `src/lib/services/chat/`, Result-контракт `{ ok } | { ok:false, error }` (§3). Коды: `forbidden | order_not_found | empty_body | too_large | invalid_mime | storage`.
  - `findOrCreateThread(prisma, session, { orderId, side })` — идемпотентно; внешним пользователям `side` выводится из роли, команде — задаётся явно.
  - `sendMessage(...)` — `canSeeThread` → `Message` → `lastMessageAt` → audit `message_sent` → fan-out уведомления (degrade gracefully).
  - `listMessages` / `listThreads` / `markRead` / `unreadCount` — узкие селекты (§13).
- **Роуты** `src/app/api/messages/**` — тонкие (мап кода в HTTP). Вложение — по паттерну документов (MIME allow-list + 20 МБ + enqueue `docs.scanDocument` + signed-URL).
- **RBAC defense-in-depth (§4):** middleware (`/…/messages` + flag-gate `chat`), роут (`requireRole` + `requireFeature('chat')`), сервис (`canSeeThread`).

### Миграция `Comment` → `Message`

- По каждому комментарию определяем сторону по роли автора:
  - автор-организация → `(orderId, org)`; автор-партнёр → `(orderId, partner)`.
  - автор-менеджер/админ → сторона **ближайшего предыдущего внешнего** комментария на этом заказе; fallback — `org`. *(Разовая эвристика; дальше команда пишет в сторону явно.)*
- `findOrCreate` тред `(orderId, side)`; `Message` с `body`, перенос `attachmentPath`, `createdAt = comment.createdAt`; `thread.lastMessageAt = max(createdAt)`.
- `Comment`-таблица **не удаляется** (откат/fallback). Идемпотентность миграции — по карте `commentId → messageId` (или маркер), чтобы повтор не дублировал.

### Транспорт, уведомления, выкатка, UI

- **Поллинг:** `GET /api/messages?threadId=&after=<cursor>` ~7 с при открытом треде + по focus/visibility; непрочитанное в навигацию.
- **Уведомления:** те же `notifyManagers` / `notifyOrgUsers` / partner-нотификация; новый тип `chat_message`; email best-effort (§3).
- **Выкатка (flag `chat`, §5, три точки):** OFF → старый comment-UI (fallback), миграция уже забэкфилила данные; ON → чат. Per-env staged rollout; ретайр comment-кода — после стабилизации.
- **UI (sibling §4):** перенаведение `partner/{deal-comments,org-comments-tab,add-comment-form}`, `organization/org-events-feed` (+ orders detail), `manager/manager-order-timeline` (+ `/manager/messages`), `admin` (+ `(dashboard)/orders/[id]`). Композер inline; модалка вложения — `<Dialog>`+`useDialogFocus` (§9). Русские строки, английские коды, палитра.

## Тестовая стратегия (§6)

- **Unit** (`vi.hoisted`+`vi.mock`): `canSeeThread` (роли × обе стороны, «команда видит всё»), Result-коды, flag-gating + fallback, формирование уведомлений, unread, эвристика стороны при миграции.
- **Integration** (`new PrismaClient`, авто-детект): идемпотентность `findOrCreateThread`, отправка+листинг, read-state, scope на живой БД, **миграция на сид-данных** (split по стороне). Чистка включает новые таблицы.
- **Без нового worker-процессора** (`docs.scanDocument` + `notifications.dispatch` существуют) → guardrail не затрагивается.

## Открытые вопросы (на ревью)

1. **Схема:** `Organization.partnerId` сейчас **обязателен** (у каждой орг есть партнёр), что расходится с «standalone без партнёра». Для чата не блок (дискриминатор стороны — авторская роль + `Order.partnerId`), но: считаем ли «прямой» заказ = `Order.partnerId == null`? (предлагаю да).
2. **Эвристика миграции** менеджерских комментариев (сторона ближайшего внешнего → fallback org) — приемлемо?
3. **Размещение у менеджера/админа:** вкладка «Чат» в `/messages` (предлагаю) vs отдельный `/chat`.

## Фазы

- **v1 (эта спека):** order-scoped треды (2 стороны), миграция комментариев, поллинг, вложения, непрочитанное, флаг с fallback.
- **C8 (сразу после):** менеджерские экраны → общая видимость + руководитель.
- **Поздний шаг:** ретайр старого comment-кода после стабилизации чата.
- **v3:** realtime, typing/presence, поиск.
