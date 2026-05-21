# Spec: Партнёрский кабинет Промтехносфера

**Дата:** 2026-05-21
**Статус:** Draft — на ревью пользователя
**Подход:** A — Зеркало 1С + лёгкая активность партнёра
**Целевой пользователь:** Партнёр (дилер/интегратор) и его команда

---

## 1. Цель и контекст

### 1.1 Бизнес-цель

Закрыть три ключевые боли партнёра, перепродающего услуги Промтехносферы своим клиентам-организациям:

1. **Непрозрачные деньги** — партнёр не видит своей комиссии в реальном времени, постоянные сверки с бухгалтерией Excel'ом.
2. **Непонятный статус сделок** — партнёр не знает, на каком этапе заявка каждой из его 100+ организаций, что ожидает действия, где застряло.
3. **Документы и бюрократия** — счета/акты/договоры ходят по почте, теряются, подписываются долго. Партнёр не имеет доступа к сканам готовых документов по конкретным организациям.

### 1.2 Ключевые метрики успеха (3 месяца)

| Метрика | Цель |
|---|---|
| Партнёр-пользователи, активные еженедельно | ≥ 70% |
| Снижение звонков партнёра в Промтехносферу | −50% |
| Среднее время «лид → квалификация» | ≤ 2 дня |
| Доля заказов, статус которых партнёр узнаёт самостоятельно | ≥ 80% |
| Партнёр сам генерит расчёт комиссии за период | ≥ 1 раз/месяц |

### 1.3 Контекст: что уже есть в MVP

- Next.js 15 + TypeScript + Tailwind + Prisma + Supabase (Auth, Storage)
- RBAC (5 ролей: admin/manager/partner/organization/student) через middleware
- `/partner/dashboard` — базовая страница
- Модели: User, Partner, Organization, Order, Document, Comment, Notification, AuditLog
- Корпоративный UI в брендовых цветах (оранжевый/чёрный/белый)
- Прошёл security-hardening

### 1.4 Контекст: что нужно достроить

- Глубину функционала под партнёра-как-главного-пользователя
- Двухмерные статусы заказов (исполнение + финансы)
- Типизированные документы + версионирование
- Лиды (отдельно от Order)
- Расчёт комиссии (модель + PDF/Excel)
- Per-organization override ставки комиссии
- Интеграция с 1С (синхронизация заказов/оплат/документов)
- BullMQ + Redis для async-jobs
- Mobile-friendly UI (card-list, bottom-bar, PWA)
- Команда внутри партнёра (PartnerUser с подролями)

---

## 2. Архитектура

### 2.1 Принципы

1. **Источники истины разделены.** 1С — деньги/документы/контрагенты. Кабинет — лиды/статусы/коммуникация. Никакая сущность не имеет двух владельцев одновременно.
2. **Идемпотентный sync.** Каждая сущность из 1С имеет `externalId`. Все sync-операции — `upsert by externalId`, повтор безопасен.
3. **Реюз существующего MVP.** Не переписываем auth, RBAC, dashboard, comments. Добавляем поверх.
4. **Эволюционируемая модель.** Закладываем поля «впрок» (`externalId`, `lastSyncedAt`, `version`), даже если фронт сразу не использует.
5. **Прагматичный Service Layer.** Сервисы только для нетривиальной логики (комиссия, sync, генерация документов). Простые reads — прямо из Server Component.

### 2.2 Слои

```
┌─────────────────────────────────────────────────────┐
│  Партнёрский кабинет (Next.js 15, App Router)        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │ /partner/*   │ │ /api/*       │ │ Server       │  │
│  │ (Pages)      │ │ (Routes)     │ │ Actions      │  │
│  └──────┬──────┘ └──────┬──────┘ └──────┬───────┘  │
│         │                │                │        │
│         └────────┬───────┴────────────────┘        │
│                  ▼                                  │
│        ┌──────────────────────────┐                │
│        │ src/lib/services/        │                │
│        │  - commission.ts          │                │
│        │  - oneCSync/              │                │
│        │  - leadFlow.ts            │                │
│        │  - docGen.ts              │                │
│        └────┬────────────────┬────┘                │
│             ▼                ▼                     │
│   ┌──────────────┐ ┌────────────────┐              │
│   │ Prisma/PG    │ │ Supabase       │              │
│   │              │ │ Storage        │              │
│   └──────────────┘ └────────────────┘              │
└──────────────────────────────────────────┬─────────┘
                                           ▲
                              ┌────────────┴─────────────┐
                              │  Worker (BullMQ + Redis)  │
                              │  - pull-orders             │
                              │  - pull-payments           │
                              │  - pull-documents          │
                              │  - push-lead               │
                              │  - reconcile               │
                              │  - generateCommissionPdf   │
                              │  - notifications.dispatch  │
                              └────────────┬─────────────┘
                                           ▼
                                     ┌──────────┐
                                     │   1С     │
                                     └──────────┘
```

### 2.3 Карта существующее → новое

```
СУЩЕСТВУЕТ:                       ДОБАВЛЯЕМ:
─────────────                     ──────────
src/app/partner/dashboard/    →   + /partner/portfolio
src/app/api/orders/            →   + /partner/portfolio/[orgId]
src/app/api/documents/         →   + /partner/deals
src/app/api/comments/          →   + /partner/deals/[id]
src/middleware.ts (RBAC)       →   + /partner/leads
                                   + /partner/documents
                                   + /partner/finance
                                   + /partner/team
                                   + /partner/notifications
                                   + /api/integrations/1c/*
                                   + /api/leads
                                   + /api/commission-statements
                                   + /api/partner-team
                                   + src/worker/* (BullMQ воркер)
                                   + src/lib/services/*
```

---

## 3. Модель данных

### 3.1 Расширения существующих моделей

| Модель | Поля | Зачем |
|---|---|---|
| `Partner` | `commissionRate Decimal`, `legalName String?`, `slug String? @unique` | Базовая ставка, шапка документов, URL |
| `Organization` | `externalId String? @unique`, `inn String?`, `kpp String?`, `assignedManagerUserId String?`, `partnerCommissionRate Decimal?`, `partnerCommissionRateNote String?`, `partnerCommissionRateChangedAt DateTime?`, `partnerCommissionRateChangedBy String?` | Связь с 1С, реквизиты, ответственный менеджер партнёра, override ставки комиссии |
| `Order` | `externalId String? @unique`, `orderNumber String?`, `totalAmount Decimal`, `paidAmount Decimal @default(0)`, `paidAt DateTime?`, `contractSignedAt DateTime?`, `completedAt DateTime?`, `closedAt DateTime?`, `lastSyncedAt DateTime?`, `partnerId String?`, `vatIncluded Boolean @default(true)`, `vatRate Decimal?`, `executionStatus ExecutionStatus`, `financialStatus FinancialStatus`, `productMix String[]` | Деньги, метки времени стадий, связь с 1С и партнёром, НДС, двухмерный статус, тип продуктов в сделке |
| `Document` | `type DocumentType`, `direction DocumentDirection`, `version Int @default(1)`, `replacesDocumentId String?`, `signedAt DateTime?`, `generatedBy GenerationSource (user|system)`, `externalId String? @unique` | Типизация, версионирование, поддержка генерируемых |
| `Document.uploadedById` | становится **nullable** | Чтобы system-generated `commission_statement` не требовал user |
| `Notification.type` | `String` → enum `NotificationType` | Type safety + документация |

**Новые enums:**

```prisma
enum ExecutionStatus {
  pending
  in_progress
  completed
  cancelled
  on_hold
}

enum FinancialStatus {
  not_billed
  billed
  partially_paid
  paid
  refunded
}

enum DocumentType {
  contract
  extra_agreement
  invoice
  act
  waybill
  certificate         // удостоверение/сертификат обучения
  report
  commission_statement // расчёт вознаграждения (генерируемый)
  other
}

enum DocumentDirection {
  incoming   // от Промтехносферы партнёру/клиенту
  outgoing   // от партнёра/клиента в Промтехносферу
}

enum GenerationSource {
  user
  system
}

enum NotificationType {
  lead_status_changed
  order_status_changed
  payment_received
  document_uploaded
  commission_statement_ready
  mention_in_comment
  partner_assignment_changed
  sync_error
}
```

**Старый `OrderStatus` enum** — оставляем для backward compat с существующими данными; в новой логике не используется. Мигрируется в `executionStatus + financialStatus` per row.

### 3.2 Новые модели

```prisma
model PartnerUser {
  id              String   @id @default(cuid())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  partnerId       String
  partner         Partner  @relation(fields: [partnerId], references: [id])
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  roleInPartner   String   // "admin" | "manager"
  assignedOrgIds  String[] // [] = доступ ко всем; иначе scope
  isActive        Boolean  @default(true)

  @@unique([partnerId, userId])
  @@index([partnerId, isActive])
  @@index([userId])
}

model Lead {
  id                  String     @id @default(cuid())
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  partnerId           String
  partner             Partner    @relation(fields: [partnerId], references: [id])
  createdByUserId     String
  createdByUser       User       @relation(fields: [createdByUserId], references: [id])
  organizationId      String?    // null если новая организация (ещё не в БД)
  organization        Organization? @relation(fields: [organizationId], references: [id])
  clientCompanyName   String
  clientInn           String?
  clientContactName   String
  clientContactPhone  String?
  clientContactEmail  String?
  subject             String
  estimatedAmount     Decimal?
  productType         String[]   // ["training", "service", "supply"]
  status              LeadStatus @default(new)
  assignedManagerId   String?    // FK на User (менеджер Промтехносферы)
  assignedManager     User?      @relation("LeadManager", fields: [assignedManagerId], references: [id])
  promotedOrderId     String?    // FK на Order, если конвертирован
  promotedOrder       Order?     @relation("LeadPromoted", fields: [promotedOrderId], references: [id])
  rejectedReason      String?
  notes               String?
  attachments         LeadAttachment[]

  @@index([partnerId, status])
  @@index([assignedManagerId])
}

enum LeadStatus {
  new
  in_review
  qualified
  promoted_to_order
  rejected
}

model LeadAttachment {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  leadId      String
  lead        Lead     @relation(fields: [leadId], references: [id])
  name        String
  path        String
  mimeType    String
  size        Int
}

model CommissionStatement {
  id                     String   @id @default(cuid())
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  partnerId              String
  partner                Partner  @relation(fields: [partnerId], references: [id])
  periodFrom             DateTime
  periodTo               DateTime
  calculatedAt           DateTime @default(now())
  calculatedByUserId     String?
  calculatedByUser       User?    @relation(fields: [calculatedByUserId], references: [id])
  totalBaseAmount        Decimal
  averageRate            Decimal  // средневзвешенная (если есть per-org overrides)
  totalCommissionAmount  Decimal
  status                 CommissionStatementStatus @default(draft)
  pdfPath                String?  // Supabase Storage path
  xlsxPath               String?
  approvedByUserId       String?
  approvedAt             DateTime?
  paidAt                 DateTime?
  supersededBy           String?  // FK на новый statement, если пересчитан
  notes                  String?
  items                  CommissionStatementItem[]

  @@index([partnerId, periodFrom, periodTo])
  @@index([status])
}

enum CommissionStatementStatus {
  draft
  approved
  paid
  superseded
}

model CommissionStatementItem {
  id                String   @id @default(cuid())
  statementId       String
  statement         CommissionStatement @relation(fields: [statementId], references: [id])
  orderId           String
  order             Order    @relation(fields: [orderId], references: [id])
  orderNumber       String?  // снимок на момент расчёта
  organizationName  String   // снимок
  baseAmount        Decimal
  rate              Decimal  // фактическая ставка (с учётом override)
  commissionAmount  Decimal

  @@index([statementId])
  @@index([orderId])
}

model Payment {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  externalId  String?  @unique  // 1С payment doc ID
  amount      Decimal
  paidAt      DateTime
  method      String?  // "wire" | "card" | "cash" | ...
  isRefund    Boolean  @default(false)
  note        String?

  @@index([orderId])
  @@index([paidAt])
}

model SavedView {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  scope       String   // "orders" | "documents" | "leads" | "finance" | "portfolio"
  name        String
  filters     Json
  isDefault   Boolean  @default(false)
  isShared    Boolean  @default(false)  // видна всем в команде партнёра

  @@index([userId, scope])
}

model SyncLog {
  id              String   @id @default(cuid())
  createdAt       DateTime @default(now())
  entity          String   // "order" | "payment" | "document" | "organization" | "lead"
  externalId      String?
  direction       String   // "inbound" | "outbound"
  operation       String   // "create" | "update" | "skip" | "delete"
  status          String   // "success" | "error" | "warn"
  errorMessage    String?
  payload         Json?
  durationMs      Int?

  @@index([entity, createdAt])
  @@index([status, createdAt])
}
```

### 3.3 Что НЕ добавляем сейчас (Phase 2)

- `OrderItem` (позиции внутри заказа) — используем `Order.productMix String[]` для базовой типизации
- `Product` каталог
- `Invoice` как отдельная модель — счёт = `Document.type=invoice`
- Полная история подписания (электронная подпись)
- `Chat` как отдельная сущность — `Comment` под заказом покрывает MVP

### 3.4 Миграционная стратегия

1. Все новые поля nullable / с дефолтом → миграция non-breaking
2. Существующие `Order.status` (старый enum) — оставляем; новые поля `executionStatus` и `financialStatus` заполняются миграцией по правилам: `new → pending/not_billed`, `in_progress → in_progress/billed`, `waiting_client → in_progress/partially_paid`, `completed → completed/paid`
3. `Document.type = 'other'` для всех существующих записей; админ-инструмент для переклассификации
4. `externalId` остаются NULL до первого синка из 1С; sync делает upsert

---

## 4. Интеграция с 1С

### 4.1 Контракт владения данными

**Поля владения 1С** (sync перезаписывает):
- `Order.totalAmount`, `paidAmount`, `paidAt`, `contractSignedAt`, `completedAt`, `closedAt`
- `Order.financialStatus`
- `Order.orderNumber`
- `Organization.inn`, `kpp`, `legalName`
- `Document` (когда `type ∈ {contract, invoice, act, waybill, certificate}`)
- `Payment.*`

**Поля владения Кабинета** (sync игнорирует):
- `Order.executionStatus` — партнёр и менеджер могут менять в UI
- `Order.partnerInternalNote`
- `Order.partnerId` — назначается при первом синке, после не меняется
- `Lead.*`
- `Comment.*`
- `Notification.*`
- `CommissionStatement.*`
- `Organization.partnerCommissionRate*`

**Read-only после первого создания:**
- `externalId` (любая модель)
- `Order.orderNumber` (если пришёл из 1С)

### 4.2 Адаптер 1С

```
src/lib/services/oneCSync/
  ├── adapter.ts        ← interface OneCAdapter
  ├── adapter-rest.ts   ← REST API
  ├── adapter-file.ts   ← XML/CSV (резерв)
  ├── adapter-fake.ts   ← in-memory для dev/тестов
  ├── mappers.ts        ← 1С DTO → Prisma model
  ├── pull.ts
  ├── push.ts
  └── log.ts
```

Выбор адаптера через env: `ONE_C_ADAPTER=rest|file|fake`.

### 4.3 Очереди BullMQ

| Очередь | Расписание | Назначение |
|---|---|---|
| `oneCSync.pullOrders` | `*/15 * * * *` | Заказы изменённые за последние ~30 мин |
| `oneCSync.pullPayments` | `*/15 * * * *` | Поступления денег |
| `oneCSync.pullDocuments` | `0 * * * *` | Документы (тяжелее) |
| `oneCSync.pullOrganizations` | `0 */6 * * *` | Контрагенты |
| `oneCSync.pushLead` | event-driven | При промоушене лида |
| `oneCSync.reconcile` | `0 3 * * *` | Ночная сверка целостности |
| `docs.generateCommissionPdf` | event-driven | При создании statement |
| `docs.generateCommissionXlsx` | event-driven | При создании statement |
| `notifications.dispatch` | event-driven | Email/Telegram (Phase 2) рассылка |
| `emails.send` | event-driven | SMTP отправка |

**Конфигурация retry:**
```typescript
{
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
}
```

### 4.4 Webhook от 1С (опционально)

`POST /api/integrations/1c/webhook` — авторизация: HMAC-signature + IP-allowlist. При получении сразу enqueue job, ответ 202 Accepted.

### 4.5 Карта соответствий

| 1С | Cabinet | Direction |
|---|---|---|
| Контрагент | `Organization` | pull |
| Реализация (договор) | `Order` head | pull |
| Поступление денежных средств | `Payment` | pull |
| Договор контрагента | `Document` (type=contract) | pull |
| Счёт | `Document` (type=invoice) | pull |
| Акт выполненных работ | `Document` (type=act) | pull |
| Накладная | `Document` (type=waybill) | pull |
| Удостоверение об обучении | `Document` (type=certificate) | pull |
| Заявка партнёра | новая «Заявка партнёра» в 1С | push |

### 4.6 Открытые вопросы для IT 1С

Зафиксированы как **выпустить в Issue до старта Фазы 0**:

- [ ] Какой интерфейс отдаёт 1С: HTTP-сервисы (REST), OData, CommerceML, файловые выгрузки?
- [ ] IP-адреса/whitelist для подключения
- [ ] Лимиты API (rate limits)
- [ ] Структура «партнёра» в 1С — есть ли поле «партнёр» на контрагенте/реализации, или маппинг через справочник?
- [ ] TZ и формат datetime в API
- [ ] Идентификация партнёра при push-leads (по slug, GUID, ИНН партнёра)
- [ ] Возможно ли получать список изменённых сущностей с курсором/timestamp, или только полные выгрузки?
- [ ] Что является «бизнес-стадией» заказа в 1С и как мапить в `executionStatus`?

### 4.7 Инфраструктура

- **dev**: `redis:7-alpine` в `docker-compose.yml`
- **prod**: managed Redis (Upstash / Render / Aiven), URL в `REDIS_URL`
- **worker**: отдельный процесс, образ `lk-otsfera-worker` (тот же codebase, другой entrypoint)
- **monitoring**: `/admin/jobs` (admin role only) — BullMQ dashboard

---

## 5. UI/UX

### 5.1 Навигация

**Desktop**: левый sidebar (collapse-able) + top app-bar.
**Mobile**: top app-bar (логотип + бургер) + bottom tab-bar (4 основные: Дашборд / Сделки / Документы / Финансы).

**Разделы:**
- ⌂ Дашборд
- 🏢 Портфель
- 📋 Сделки
- ✚ Заявки
- 📄 Документы
- 💰 Финансы
- 👥 Команда (admin партнёра)
- ⚙ Настройки

### 5.2 Дашборд

- 4 KPI-плитки: открытые сделки, к оплате (сумма), комиссия за месяц, лиды в обработке
- «Требует внимания»: зависшие сделки > 14 дней, просроченные счета, лиды без квалификации > 5 дней
- Лента событий (последние 10)
- Воронка сделок (desktop only)

Mobile: KPI 2×2, далее «Требует внимания», далее лента — вертикально.

### 5.3 Портфель организаций

Desktop: density-таблица с колонками `Организация | ИНН | Ответств. | Сделок | Долг`. Saved views: «Все», «Мои», «Долги», «В обучении». Pagination (server-side).

Mobile: card-list, на карточке — название организации, ИНН, отв. менеджер, общее число сделок, сумма долга.

Фильтры: organizationName (search), assignedManagerId, hasDebt, hasActiveDeals, productMix.

### 5.4 Карточка организации `/partner/portfolio/[orgId]`

Шапка: название, ИНН, ответственный менеджер партнёра, KPI (сделок / общая сумма / долг).

Табы:
- **Сделки** — список сделок с двухмерным статусом
- **Документы** — сканы готовых документов (главный use-case по комментарию пользователя)
  - Фильтр по типу: Все / Договор / Счёт / Акт / Сертификат / Отчёт
  - Inline preview + download
  - Bulk download zip
- **Сотрудники** — `OrganizationUser` + студенты обучения
- **Комментарии** — `Comment`s связанные с организацией
- **История** — audit log
- **Настройки** (admin партнёра) — переопределение ставки комиссии с обоснованием

### 5.5 Сделки `/partner/deals`

Desktop: таблица `№ заказа | Организация | Тема | Стадия | Σ | Срок` с density-режимом.
Mobile: card-list.

«Стадия» — комбинированный лейбл из `executionStatus + financialStatus` через `lib/orders/humanStage.ts`.

Карточка сделки: статусы, табы Overview / Документы / Комментарии / Оплаты / История.

### 5.6 Заявки/Лиды `/partner/leads`

Табы: Черновики / Отправлены / Квалифицированы / Отклонены.

Форма создания лида (3-шаговый wizard на мобиле):
1. Клиент (название, ИНН, контакт)
2. Тема и оценочная сумма
3. Вложения (опционально)

После отправки read-only для партнёра.

### 5.7 Документы `/partner/documents`

Глобальный список всех документов партнёра. Фильтры: type, organization, period, deal. Bulk download zip (только desktop).

### 5.8 Финансы `/partner/finance`

- KPI: заработано всего / выплачено / в обработке / ожидаемое
- Список `CommissionStatement` по периодам с статусом и кнопкой [⬇ PDF]
- Клик на period — раскрытие со списком сделок-составляющих
- Кнопка «Сформировать за период» (admin партнёра)

### 5.9 Команда `/partner/team`

Только admin партнёра. Список `PartnerUser`, инвайт нового менеджера, назначение организаций менеджеру (scope visibility).

### 5.10 Принципы UX

1. **Density first**, expand on click
2. **Действие = одна кнопка** в правом-верхнем углу
3. **Saved views = state в URL** (query string, sharable)
4. **Bulk actions** на чек-боксах (desktop only)
5. **Skeleton loading** вместо spinner
6. **Empty states с CTA**
7. **Тема**: light only в MVP (брендовые orange/black/white)
8. **Локализация**: только русский в MVP, готовность к i18n
9. **PWA manifest** + install on home screen
10. **Touch targets ≥ 44×44px** на мобиле
11. **Lighthouse mobile ≥ 85**

---

## 6. Документы и комиссия

### 6.1 Хранилище документов

Supabase Storage, bucket `documents`. Структура:
```
documents/partners/{partnerId}/
  organizations/{orgId}/
    orders/{orderId}/
      contracts/   invoices/   acts/   waybills/
      certificates/{studentId}/
    misc/
  commission-statements/{statementId}.pdf
```

Доступ через signed URLs (TTL=5 мин). Скачивание через `/api/documents/[id]/download` с RBAC.

### 6.2 Валидация загрузок

1. MIME-проверка по содержимому (magic bytes)
2. Размер ≤ `DOCUMENT_MAX_FILE_SIZE_MB` (env)
3. PDF structure check (basic)
4. (Phase 2) ClamAV async scan

### 6.3 Расчёт комиссии — алгоритм

**Триггер**: ежемесячный cron (1-е число месяца, считается за прошлый месяц) + ручная генерация из UI.

**Алгоритм**:
```
function calculateCommission(partnerId, periodFrom, periodTo):
    orders = SELECT * FROM Order
             WHERE partnerId = $partnerId
               AND closedAt IS NOT NULL
               AND closedAt BETWEEN $periodFrom AND $periodTo
               AND financialStatus = 'paid'

    statement = INSERT INTO CommissionStatement (
        partnerId, periodFrom, periodTo,
        calculatedAt = NOW()
    )

    totalBase = 0, totalCommission = 0
    weightedRateSum = 0

    FOR EACH order IN orders:
        rate = order.organization.partnerCommissionRate
            ?? partner.commissionRate
        baseAmount = order.totalAmount  // или с учётом vatIncluded
        commissionAmount = baseAmount * rate

        INSERT INTO CommissionStatementItem (
            statementId = statement.id,
            orderId, orderNumber, organizationName,
            baseAmount, rate, commissionAmount
        )

        totalBase += baseAmount
        totalCommission += commissionAmount
        weightedRateSum += rate * baseAmount

    statement.totalBaseAmount = totalBase
    statement.totalCommissionAmount = totalCommission
    statement.averageRate = totalBase > 0 ? weightedRateSum / totalBase : 0
    statement.status = 'draft'

    enqueue('docs.generateCommissionPdf', { statementId })
    enqueue('docs.generateCommissionXlsx', { statementId })
```

### 6.4 Триггер «попадания в расчёт»

**Default**: `closedAt IS NOT NULL AND financialStatus = 'paid'` (сделка закрыта и полностью оплачена).

**Конфигурируемо через env** для будущей гибкости:
- `COMMISSION_TRIGGER=paid_and_closed` (default)
- `COMMISSION_TRIGGER=paid` (по факту оплаты, даже если ещё не закрыта)
- `COMMISSION_TRIGGER=completed` (по факту исполнения, даже если деньги в пути)

### 6.5 PDF-генерация

`@react-pdf/renderer` (нативный, без Chrome). Шапка: логотип Промтехносферы, реквизиты партнёра. Таблица сделок (номер / организация / база / ставка / комиссия). Итог. Дата генерации. QR-код со ссылкой на statement в кабинете (для верификации).

### 6.6 Excel-выгрузка

`exceljs`. Те же данные плюс sortable/filterable.

### 6.7 Per-organization override ставки

`Organization.partnerCommissionRate` — null означает «использовать `Partner.commissionRate`». При изменении — пишется audit log с `oldRate`, `newRate`, `reason`, `changedBy`.

UI: на карточке организации (Настройки) только admin партнёра. История изменений ставки видна там же.

Влияние: только на будущие расчёты. Уже созданные `CommissionStatement`-ы хранят фактическую ставку в `CommissionStatementItem.rate` (снимок) — не пересчитываются автоматически.

### 6.8 Жизненный цикл `CommissionStatement`

```
draft → approved → paid
   ↓
superseded (если пересчитали)
```

После `approved` — read-only. Если нужно изменить — создаётся новый, старый помечается `supersededBy`.

### 6.9 Открытые вопросы (для бизнеса)

- НДС: комиссия от суммы с НДС или без НДС? **Default**: `vatIncluded ? amount * rate : amount * rate` (т.е. от полной суммы). Фиксируется в `vatIncluded` на каждом заказе.
- Когда фактически Промтехносфера выплачивает партнёру (после approve / по графику / на каждый закрытый заказ)?
- Минимальная сумма к выплате (cutoff)?

---

## 7. Безопасность и RBAC

### 7.1 Роли (расширение MVP)

**Существующие**: admin, manager, partner, organization, student.

**Новое — sub-роли внутри `partner` через `PartnerUser.roleInPartner`**:
- `admin` (внутри партнёра) — видит всё, может управлять командой и переопределять ставки
- `manager` (внутри партнёра) — видит только organizationId в `assignedOrgIds`, не может управлять командой

### 7.2 Изменения в middleware

В `src/middleware.ts` добавить:
- Для `/partner/team/*` — проверка `PartnerUser.roleInPartner = 'admin'`
- Для `/partner/portfolio/[orgId]/settings` — то же
- Для остальных `/partner/*` — RBAC проверяет: либо user.partnerId совпадает с partnerId сущности, либо (если PartnerUser.assignedOrgIds непустой) — orgId в этом списке

### 7.3 API ограничения

- `POST /api/leads` — только partner role, `partnerId` из сессии
- `GET /api/leads` — partner видит только `partnerId = self.partnerId`
- `POST /api/integrations/1c/webhook` — HMAC + IP allowlist
- `GET /api/integrations/1c/*` — admin only

### 7.4 Storage RLS

В Supabase Storage policies:
- Read доступ к `documents/partners/{partnerId}/*` — только пользователи с `partnerId = path partnerId` (через JWT claim)
- Write — только server-side через service role key

### 7.5 Audit log расширение

Записываем в `AuditLog`:
- Изменение `Organization.partnerCommissionRate` (с before/after, reason)
- Создание/approval/payment `CommissionStatement`
- Промоушен `Lead → Order`
- Инвайт/деактивация `PartnerUser`
- Все sync errors (через `SyncLog`, но критичные дублируются в audit)

---

## 8. Тестирование

### 8.1 Уровни

| Уровень | Tool | Покрытие |
|---|---|---|
| Unit | Vitest | Service Layer: `humanStatusLabel`, `calculateCommission`, mappers, Zod-validators |
| Integration (DB) | Vitest + testcontainers PG | Prisma queries, миграции, идемпотентность upsert |
| Integration (1С) | adapter-fake | Полный sync цикл |
| API routes | Vitest + Next test utils | RBAC, payload validation, статусы |
| E2E smoke | Playwright | login → dashboard → org → download |
| Visual regression | (Phase 2) | Mobile + desktop snapshots |
| Load | k6 | 1С-sync на 1000 заказов; UI 100+ строк |

### 8.2 Обязательные тест-кейсы

1. **RBAC изоляция партнёров** — расширяем существующие тесты middleware
2. **Commission calc golden test** — 10 заказов с разными rate и override, эталон в JSON
3. **Sync idempotency** — повтор не дублирует
4. **Sync conflict resolution** — кабинетные поля не перетираются
5. **Document download authorization** — нельзя скачать чужое
6. **Lead promotion link** — корректная связь Lead ↔ Order
7. **Saved view URL share** — фильтр в query string восстанавливается
8. **Per-org rate override** — изменение не влияет на старые statement-ы
9. **Mobile responsive** — Playwright тесты на ширине 375px

---

## 9. Rollout

### 9.1 План фаз

| Фаза | Сроки | Milestone |
|---|---|---|
| 0 — Подготовка | 1 неделя | Контракт 1С, Prisma миграции, Redis, скелет worker |
| 1 — Каркас партнёра | 2 недели | partner-admin видит свой портфель, команда |
| 2 — Сделки и документы | 2 недели | UX с фейковыми данными → демо |
| 3 — Реальный 1С | 2 недели | Один партнёр в pilot — реальные данные |
| 4 — Финансы и комиссия | 2 недели | Финансовый цикл закрыт для pilot |
| 5 — Полировка и масштаб | 2 недели | Production rollout на всех |

**Итого**: ~10 недель @ 1 dev fulltime, или ~5-6 недель @ 2 dev параллельно.

### 9.2 Feature flags

Env-переменные:
- `FEATURE_PARTNER_LEADS=1`
- `FEATURE_COMMISSION_PDF=1`
- `FEATURE_1C_SYNC=1`
- `FEATURE_PWA=1`

Позволяют выкатить код в prod и активировать фичи по партнёрам.

### 9.3 Метрики мониторинга

- Uptime / response time (existing infra)
- Sync lag: время от последней успешной синхронизации
- Queue depth (BullMQ)
- Failed jobs (BullMQ DLQ)
- AuditLog рост (бизнес-аномалии)

---

## 10. Что НЕ делаем (Phase 2)

- ЭП-подписание (Контур.Диадок / СБИС)
- Push notifications через service worker
- BI/аналитика (отдельный дашборд)
- OCR / поиск по содержимому документов
- `OrderItem` (позиции внутри заказа)
- Telegram-бот для уведомлений
- Тёмная тема
- Английская локализация
- Чат (отдельная сущность, в дополнение к `Comment`)
- Видеовстречи / звонки

---

## 11. Открытые вопросы для уточнения

### Бизнес

- [ ] Когда Промтехносфера фактически выплачивает партнёру? (`paid` / `closed` / по графику)
- [ ] НДС: комиссия от суммы с НДС или без?
- [ ] Минимальная сумма к выплате партнёру (cutoff)?
- [ ] Может ли менеджер партнёра видеть финансовые KPI всего партнёра, или только своих организаций?

### IT 1С

- [ ] Какой интерфейс отдаёт 1С: REST/OData/CommerceML/файлы?
- [ ] IP-allowlist для подключения
- [ ] Rate limits
- [ ] Структура «партнёра» в 1С
- [ ] TZ и формат datetime
- [ ] Идентификация партнёра при push-leads
- [ ] Курсор/timestamp для инкрементальных синков

### Инфраструктура

- [ ] Где деплоим worker: тот же VPS/контейнер или отдельный?
- [ ] Какой managed Redis (Upstash / Render / Aiven)?
- [ ] Backup strategy для documents bucket?

---

## 12. Связанные документы

- `README.md` — общая информация о MVP, env, RBAC матрица
- `prisma/schema.prisma` — текущая модель данных (точка входа для расширений)
- `src/middleware.ts` — текущий RBAC
