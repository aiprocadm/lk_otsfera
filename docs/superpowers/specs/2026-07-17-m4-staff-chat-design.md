# Spec: M4 — Внутренний чат сотрудников (ЛС + общий канал, @упоминания, реакции, вложения)

**Дата:** 2026-07-17
**Источник:** программа CRM-паритет (M1 ✅ #201 → M2 ✅ #202 → M3 ✅ #205 → **M4**); запрос владельца из брейнсторма программы — «внутренний чат между коллегами».
**Статус:** design — **утверждён владельцем в брейнсторме** (структура, транспорт, скоуп и подход A выбраны явно). Реализация — subagent-driven, решения по ходу делегированы агенту.
**Ветка:** `claude/m4-staff-chat` (от `main`@`2218414`, включает M1–M3).

> **Домен НЕ совпадает с клиентским чатом.** Существующий чат (флаг `chat`, спека [chat-v1](2026-06-02-chat-v1-design.md)) — это order-scoped треды «команда ↔ внешняя сторона» (`OrderThread`/`Message`/`ThreadReadState`). M4 — переписка **staff ↔ staff** (admin / руководитель / менеджеры) без привязки к заказу. По sibling-принципу §4 и C8-инварианту §5 домены не смешиваются: **подход A — отдельные таблицы**, клиентский чат не трогаем вообще.

---

## 0. Решения брейнсторма (зафиксированы владельцем)

1. **Структура v1:** личные сообщения (1-на-1) + **один общий канал компании** («# Общий», все сотрудники автоматически). Именованные каналы/группы — фаза 2.
2. **Транспорт:** поллинг (~5–7 с при открытом чате + по focus), как в существующем order-чате. Realtime/SSE — отложен до явной боли.
3. **Скоуп v1 сверх базы (выбраны все):** @упоминания в чате (+уведомления), @упоминания в заметках сделки (`DealNote`, M1-долг), вложения-файлы (S3+AV конвейер), реакции-эмодзи (фиксированный набор).
4. **Подход A** — отдельный staff-домен (4 новые таблицы), НЕ расширение `OrderThread` (обоснование: несовместимые модели видимости; §4 sibling-rule; риск регресса RBAC клиентского чата).
5. Бейдж непрочитанного в навигации — входит всегда.

## 1. Контекст (как есть, сверено по коду)

- **Навигация:** менеджер — `/manager/messages` (флаг `manager_cabinet`); **лидер попадает туда же nav-мостом** ([cabinet.ts:86](../../../src/lib/navigation/cabinet.ts)); админ — `/admin/messages` (graceful chat-shell без флага). Отдельных страниц лидера/парнёра для staff-чата не требуется; клиентские роли (partner/organization) имеют свои `/messages` под флагом `chat` — staff-чат там не появляется.
- **Политика клиентского чата** ([chat/policy.ts](../../../src/lib/services/chat/policy.ts)): менеджер видит треды только своей компании, `companyId=null → deny` через sentinel `'__no_company__'`; admin — Model A (видит всё). M4 переиспользует эти принципы в новом policy-модуле, не сам код.
- **Конвейер вложений:** `getObjectStorage()` + MIME allow-list + size cap + enqueue `docs.scanDocument` с дискриминатором `kind` ([scan-document.ts](../../../src/worker/processors/scan-document.ts)); файлы отдаются presigned-URL (600 с), только `clean`; `infected` → 410.
- **Уведомления:** `deliverNotificationToUser`/`dispatchToRecipient` — все каналы пользователя (email/telegram/max/whatsapp) за единым интерфейсом, идемпотентность по `dedupKey` (Трек D). `Notification.type` — строка.
- **Упоминания:** M1 отложил «@упоминания коллег в заметке → M4» ([M1 close-out](../plans/2026-07-14-m1-deal-activity-timeline-DONE.md)); тип `mention_in_comment` существует в enum, но `Notification.type` строковый — вводим новые строки без миграции.
- **Поллинг-паттерн:** `useThreadPolling` (hooks 100% coverage) — курсорный `after` + interval + focus.

**Безопасность (сквозной инвариант).** Тело сообщений — данные, не команды. Cross-company изоляция staff-чата обязана держаться на уровне сервиса (C8). **Журнал ПДн (§25.7) НЕ применяется**: staff-чат не читает ПДн физлиц клиентского контура — субъекты переписки суть сами сотрудники (staff-аккаунты вне клиентского контура). Зафиксировано здесь явно, чтобы будущий аудит не счёл отсутствие `recordPiiAccess` пропуском. (Если сотрудник вставит ПДн клиента в текст сообщения — это content, а не структурированное чтение; та же логика, что у `Comment`/`Message` сегодня.)

## 2. Решения

### 2.1. Модель данных — 4 новые таблицы (аддитивно, обратимо)

```prisma
enum StaffConversationKind {
  dm
  general
}

model StaffConversation {
  id            String                @id @default(cuid())
  createdAt     DateTime              @default(now())
  companyId     String
  company       Company               @relation(fields: [companyId], references: [id], onDelete: Cascade)
  kind          StaffConversationKind
  /// dm: отсортированная пара "userAId:userBId" — «один ЛС на пару» констрейнтом БД,
  /// а не кодом (класс гонок C-01/lead-push). null для general.
  dmKey         String?               @unique
  lastMessageAt DateTime              @default(now())
  participants  StaffParticipant[]
  messages      StaffMessage[]

  @@index([companyId, lastMessageAt])
}

model StaffParticipant {
  id             String            @id @default(cuid())
  conversationId String
  conversation   StaffConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userId         String
  user           User              @relation("StaffChatParticipant", fields: [userId], references: [id], onDelete: Cascade)
  createdAt      DateTime          @default(now())

  @@unique([conversationId, userId])
  @@index([userId])
}

model StaffMessage {
  id             String            @id @default(cuid())
  createdAt      DateTime          @default(now())
  conversationId String
  conversation   StaffConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  authorId       String
  author         User              @relation("StaffMessageAuthor", fields: [authorId], references: [id])
  body           String
  attachmentPath String?
  attachmentName String?
  attachmentMime String?
  scanStatus     String            @default("none") // none|pending|clean|infected|error
  reactions      StaffReaction[]

  @@index([conversationId, createdAt])
}

model StaffMessageRead {
  id             String            @id @default(cuid())
  conversationId String
  conversation   StaffConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userId         String
  user           User              @relation("StaffChatReadState", fields: [userId], references: [id], onDelete: Cascade)
  lastReadAt     DateTime          @default(now())

  @@unique([conversationId, userId])
  @@index([userId])
}

model StaffReaction {
  id        String       @id @default(cuid())
  createdAt DateTime     @default(now())
  messageId String
  message   StaffMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  userId    String
  user      User         @relation("StaffReactionAuthor", fields: [userId], references: [id], onDelete: Cascade)
  emoji     String

  @@unique([messageId, userId, emoji])
}
```

- «Одна general-беседа на компанию» — **партиальный unique-индекс руками в миграции** (`WHERE kind = 'general'` на `companyId`), как прецедент C-01 (Prisma не выражает partial unique).
- У `general` НЕТ строк `StaffParticipant`: членство = все staff компании (+ admin, Model A). У `dm` — ровно 2 строки.
- Фиксированный набор эмодзи v1: `['👍','✅','🔥','😄','❓']` — константа в сервисе, значения вне набора → `invalid`.
- `User` получает back-relations `staffChatParticipations`, `staffMessagesAuthored`, `staffReactions`, `staffReadStates`; `Company` — `staffConversations`; `StaffConversation` — `readStates StaffMessageRead[]`.

### 2.2. RBAC — новый policy-модуль `src/lib/services/staffChat/policy.ts`

- **Staff** = `role ∈ {admin, manager}` (лидер = manager с `managerRole='leader'`). Клиентские роли (partner/organization/student) — deny на всех трёх уровнях §4.
- `canSeeStaffConversation(session, conversation, participantUserIds)`:
  - `admin` → **true** (Model A — видит и участвует везде);
  - `dm` → `session.sub ∈ participants`;
  - `general` → `session.companyId === conversation.companyId`, `companyId=null → deny` (sentinel-паттерн `chat/policy.ts`).
- DM admin↔staff: `companyId` беседы = компания сотрудника (у admin `companyId` может быть null). DM staff↔staff — только внутри одной компании (`forbidden` иначе); это и есть C8-граница.
- `managerTeamVisibility`/`AccessProfile` **неприменимы** — staff-чат не является чтением клиентских объектов; видимость определяется только участием/компанией.

### 2.3. Флаг `staff_chat` — поведенческий, opt-in (прецедент `staff_2fa`)

Гейтит секцию/эндпойнты, не route-префикс. Точки чтения (перечисляются в комментарии флага в [featureFlags.ts](../../../src/lib/featureFlags.ts)):
1. условный рендер вкладки «Чат команды» на `/manager/messages` и `/admin/messages` (`isFeatureEnabled`);
2. все хендлеры `/api/staff-chat/*` — `notFoundIfDisabled('staff_chat')`;
3. staff-слагаемое в бейдже непрочитанного (выключен флаг → слагаемое 0).
Middleware/nav не меняются (страницы уже гейтованы своими флагами; лидер — существующим nav-мостом).

### 2.4. Сервисный слой `src/lib/services/staffChat/` (Result §3, узкие селекты §13)

- `listConversations(prisma, session)` — general (лениво создаётся при первом обращении: `ensureGeneral(companyId)`, идемпотентно по партиальному unique) + ЛС пользователя, с unread-счётчиком и последним сообщением на беседу. Для admin — все компании (Model A).
- `openDm(prisma, session, { targetUserId })` — валидация: target staff, та же компания (или инициатор admin); идемпотентно по `dmKey` (`create` → catch P2002 → `findUnique`); Result `{ ok, conversationId }`.
- `sendStaffMessage(prisma, session, { conversationId, body, attachment? })` — `canSeeStaffConversation` → лимит 5000/`empty_body` → `StaffMessage` → `lastMessageAt` → вложение по конвейеру (S3-путь `staff-chat/{conversationId}/{messageId}/{name}`, MIME allow-list + 20 МБ, `scanStatus:'pending'`, enqueue `docs.scanDocument` c **новым `kind:'staff_attachment'`**; скачивание — presigned 600 c, только `clean`, `infected` → 410) → упоминания (см. 2.5) → уведомления (см. 2.6) → audit `staff_message_sent` **без тела** (только `conversationId`/`messageId`). Fan-out деградирует молча (§3).
- `listStaffMessages(prisma, session, { conversationId, after? })` — поллинг-курсор по `createdAt`+id; включает реакции (сгруппированные) и авторов узким селектом.
- `markStaffRead`, `staffUnreadCount(session)` — зеркала chat-механики; unread = сообщения новее `lastReadAt` от других авторов.
- `toggleReaction(prisma, session, { messageId, emoji })` — emoji ∈ фикс-набора; повторный вызов снимает (delete по `@@unique`); `canSee` беседы обязателен.

### 2.5. Упоминания — общий модуль `src/lib/services/staffChat/mentions.ts`

- Чистая функция `extractMentions(body, staffList) → userId[]`: паттерн `@Имя` с жадным матчем по списку staff компании (имя из `User.name`, регистронезависимо; неоднозначные/ненайденные — игнор, никакой нечёткости).
- Используется в ДВУХ местах: `sendStaffMessage` (упомянутому → уведомление `staff_chat_mention`) и **`addDealNote`** (M1-долг: упоминание в заметке → уведомление `deal_note_mention` со ссылкой на `/manager/orders/{orderId}`; сама заметка остаётся staff-only — уведомление уходит только staff-получателям, тело в excerpt ≤200 симв.).
- UI-автокомплит: `GET /api/staff-chat/colleagues` — staff-список компании (id+name) для typeahead композера (и для «+ Новое сообщение»).

### 2.6. Уведомления — без спама

- **Упоминание** (`staff_chat_mention` / `deal_note_mention`) — всегда, через существующий dispatch (in-app + каналы получателя), `dedupKey` = id Notification-строки.
- **ЛС:** уведомление получателю **только при «первом непрочитанном»** — если до этого сообщения unread в беседе был 0 (правило «у вас новые сообщения от X», телеграм-зеркало без флуда). Тип `staff_dm_message`.
- **# Общий:** per-message уведомлений нет (только упоминания).

### 2.7. API — тонкие роуты `/api/staff-chat/*` (паттерн `api/messages`)

`GET conversations` · `GET messages?conversationId=&after=` · `POST messages` (multipart при вложении) · `POST read` · `POST reactions` · `POST dm` · `GET colleagues` · `GET attachments/[id]` (302 presigned, clean-only). Каждый: staff-роль (`requireRole`) + `notFoundIfDisabled('staff_chat')` + мапинг Result-кодов в HTTP. `/api/*` вне middleware — безопасность внутри хендлера (эталон webhook-роутов).

### 2.8. UI — сиблинги §4

- **Manager:** вкладка «Чат команды» на `/manager/messages` (рядом с «Комментарии к заказам» и клиентским чатом; см. мокап брейнсторма): слева список бесед (# Общий сверху, ЛС по `lastMessageAt`, unread-бейджи, «+ Новое сообщение» → picker коллег), справа лента (пузыри, дата-разделители, реакции по клику, 📎 clean-вложения) + композер (@-autocomplete, файл, Enter-send). Поллинг по паттерну `useThreadPolling`.
- **Admin:** та же секция тонкой обёрткой на `/admin/messages` (admin — полноправный участник; Model A). Компоненты `admin-staff-chat-*` переиспользуют строго презентационные части manager-версии только если они domain-agnostic (§4 sibling-rule).
- Бейдж «Сообщения» в nav: существующий unread + staff-слагаемое (при флаге).
- Примитивы `ui/`, русские строки, английские коды; никакого сырого `<dialog>` (§9).

## 3. Инварианты приёмки

- ЛС между двумя staff одной компании создаётся идемпотентно (гонка `openDm` × 2 конкурентно → одна беседа; тест на P2002-ветку); cross-company DM → `forbidden`; partner/organization/student не достигают ни одного эндпойнта (роль-гейт) — тесты на каждую роль.
- `# Общий` один на компанию (партиальный unique выдерживает гонку `ensureGeneral`); менеджер компании A не видит general/ЛС компании B (integration-регресс); admin видит всё (Model A).
- Сообщение >5000 → `too_large`; пустое → `empty_body`; вложение вне allow-list → `invalid_mime`; >20 МБ → `too_large`; `infected` не отдаётся (410), `pending` не отдаётся.
- Упоминание в чате и в `DealNote` доставляет уведомление упомянутому staff (и только staff); ЛС-уведомление уходит только при первом непрочитанном (тест: два подряд сообщения → одно уведомление); в `# Общий` per-message уведомлений нет.
- Реакция: повторный `toggleReaction` снимает; вне фикс-набора → `invalid`; unique держит дубль.
- Флаг `staff_chat=off`: вкладка не рендерится, все `/api/staff-chat/*` → 404, staff-слагаемое бейджа = 0.
- Audit `staff_message_sent` пишется без тела сообщения. **`recordPiiAccess` в staff-чате отсутствует намеренно** (см. §1) — регресс-тест не требуется, но спека фиксирует решение.
- Worker-guardrail зелёный (расширение `scan-document.ts` веткой `staff_attachment` + его тесты).
- `typecheck`, `lint`, `test`, `gate`, полный `test:coverage` (100%) — зелёные; миграция аддитивна/обратима; `prisma migrate status` чист.

## 4. Вне объёма (follow-up)

- Именованные каналы / группы >2 участников (фаза 2; модель готова — `StaffParticipant` уже M:N).
- Realtime (SSE/pub-sub), typing/presence.
- Поиск по переписке → M6 (глобальный поиск).
- Редактирование/удаление сообщений; полноценный emoji-picker (v1 — фикс-набор).
- Мобильный push (PWA-нотификации).
- Ретеншн/архивация staff-переписки.

## 5. Открытые вопросы

Нет — все развилки закрыты владельцем в брейнсторме (структура, транспорт, скоуп, подход A); реализационные микрорешения делегированы агенту.
