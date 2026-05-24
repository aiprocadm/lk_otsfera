# Spec: MVP admin-кабинет платформы

**Дата:** 2026-05-24
**Статус:** Draft — на ревью пользователя
**Подход:** B — Hybrid (симметрия с партнёром там, где оправдано; упрощения для admin-specific UX)
**Целевой пользователь:** Platform admin (сотрудник Промтехносферы, управляющий кабинетом)
**Branch (предполагаемый):** `claude/admin-cabinet-mvp`

---

## 1. Цель и контекст

### 1.1 Бизнес-цель

После Phase 5 партнёрского кабинета у platform-admin есть отдельные «острова»: `/admin/health`, `/admin/sync`, `/admin/commission-statements`, `/admin/commission-statements/[id]`. Между ними **нет единого каркаса навигации**, дашборд содержит декоративные плашки без метрик, заглушки `/admin/orders` и `/admin/messages` мертвы, отсутствуют рабочие инструменты для day-to-day операций: управление пользователями, партнёрами, организациями, просмотр аудит-лога.

Цель MVP — закрыть этот пробел: дать админу единый кабинет, в котором он может проводить пользователей через жизненный цикл (создать, назначить роль, привязать, деактивировать) и наблюдать платформу.

### 1.2 Ключевые метрики успеха (3 месяца после запуска)

| Метрика | Цель |
|---|---|
| Время онбоардинга нового партнёра | ≤ 5 минут (всё через UI, без curl/SQL) |
| Доля админских операций через UI vs БД/CLI | ≥ 90% |
| Среднее время реакции admin на DLQ alert | ≤ 30 минут |
| Полнота AuditLog по мутациям из admin UI | 100% (каждая мутация → запись) |

### 1.3 Контекст: что уже есть

- Next.js 15 + TypeScript + Tailwind + Prisma + Supabase + BullMQ.
- Партнёрский кабинет завершён в 5 фазах: services, KPI components, Server Components, Server Actions, Playwright snapshots.
- Admin-«острова»: `/admin/health`, `/admin/sync`, `/admin/commission-statements*`.
- Существующий `AppShell` ([components/dashboard/app-shell.tsx](src/components/dashboard/app-shell.tsx)) — общий wrapper для всех ролей, без role-specific sidebar.
- Email pipeline (Resend) и шаблоны (`commission-ready`, `lead-promoted`, `document-uploaded`) — переиспользуются.
- Reset-password страница ([app/(auth)/reset-password/page.tsx](src/app/(auth)/reset-password/page.tsx)) — голая заглушка с надписью «реализуется через Supabase Auth email recovery». Backend flow (token persistence, request/confirm endpoints) **отсутствует** — его нужно построить в рамках MVP admin как зависимость invite-функционала.

### 1.4 Контекст: что нужно достроить

- `AdminAppShell` с собственным sidebar.
- Реальный admin dashboard с KPI / attention / events.
- CRUD-разделы для Users / Partners / Organizations.
- Audit log viewer с фильтрами.
- `requireAdmin()` server-side guard helper, чтобы убрать дубли в каждой странице.
- `recordAudit()` единая точка записи в AuditLog.
- Email-шаблон `user-invite.tsx`.
- **Полноценный password reset / invite flow** — модель `PasswordResetToken`, API routes `request/confirm`, переписанная страница `/reset-password`. Это зависимость, без которой invite через UI невозможен.
- **Миграции БД** для soft-delete партнёров и пользователей, nullable `passwordHash`.

### 1.5 Вне скоупа MVP

- Mobile-полировка admin страниц (admin работает с десктопа).
- Bulk actions (массовая деактивация и т.п.).
- UI для feature flags (отложено в Phase 6+).
- Заполнение `/admin/orders` и `/admin/messages` полноценным функционалом — оставляем как редирект на dashboard.
- Push notifications, Telegram-бот, OCR, dark theme — всё уже исключено в партнёрской спецификации.
- Hard delete пользователей и партнёров через UI — только soft delete (`isActive=false`).

---

## 2. Принципы

1. **Симметрия с партнёрским кабинетом, где она оправдана.** Re-use `KpiGrid`, `EventsFeed`, `StatCard` без копирования. AdminAppShell имеет тот же визуальный язык, но свой набор nav-items.
2. **Server Actions для admin-мутаций.** Прогрессивные формы, минимум клиентского JS. API routes — только для уже существующих случаев (DLQ retry).
3. **Один сервисный файл на ресурс** в `src/lib/services/admin/`. Соседствует с уже существующими `syncHealth.ts`, `queueStats.ts`, `commissionStatements.ts`.
4. **Аудит на каждую мутацию** через единый хелпер `recordAudit({ actorUserId, action, entityType, entityId, before, after, status })`.
5. **`requireAdmin()` как server-side guard.** Заменяет дублированный паттерн `if (session.role !== 'admin') redirect('/login')`.
6. **Запрет escalation через UI.** Admin не может через UI создать другого admin-а, downgrade свою роль, удалить себя.
7. **Graceful degradation для email.** Если `RESEND_API_KEY` пуст — invite-link возвращается в flash-сообщении, admin копирует вручную.

---

## 3. Архитектура

### 3.1 Карта изменений

```
src/app/admin/
  layout.tsx                          ← переписан: AdminAppShell вместо AppShell
  dashboard/page.tsx                  ← переписан: реальные метрики
  users/
    page.tsx                          ← список + фильтры (role, active, search)
    [id]/page.tsx                     ← карточка с edit form (Server Action)
    new/page.tsx                      ← форма создания (Server Action)
  partners/
    page.tsx                          ← список партнёров
    [id]/page.tsx                     ← редактирование Partner + список его users
    new/page.tsx                      ← Partner + первый partner-admin User за раз
  organizations/
    page.tsx                          ← список организаций
    [id]/page.tsx                     ← редактирование (inn/kpp/legalName/assignedManager)
  audit/
    page.tsx                          ← viewer с фильтрами в URL
  orders/page.tsx                     ← deprecated → redirect('/admin/dashboard')
  messages/page.tsx                   ← deprecated → redirect('/admin/dashboard')

src/components/admin/
  admin-app-shell.tsx                 ← AdminAppShell c sidebar
  admin-sidebar.tsx                   ← active state через usePathname()
  users-table.tsx
  user-edit-form.tsx                  ← form action = Server Action
  partners-table.tsx
  partner-edit-form.tsx
  partner-create-form.tsx             ← Partner+User+PartnerUser в одной транзакции
  organizations-table.tsx
  organization-edit-form.tsx
  audit-log-table.tsx
  audit-log-filters.tsx

src/lib/services/admin/
  dashboard.ts                        ← kpis(), recentEvents(), attention()
  users.ts                            ← listUsers, getUser, updateUser, deactivateUser, createUser
  partners.ts                         ← listPartners, getPartner, updatePartner, createPartnerWithAdmin
  organizations.ts                    ← listOrganizations, getOrganization, updateOrganization
  auditLog.ts                         ← listAudit, listAuditFilters

src/lib/auth/requireRole.ts           ← новый: requireAdmin(), requirePartnerAdmin(), requireSession()
src/lib/auth/audit.ts                 ← новый: recordAudit() — единая точка записи

src/lib/email/templates/
  user-invite.tsx                     ← новый шаблон для приглашения

src/server-actions/admin/
  users.ts                            ← createUserAction, updateUserAction, deactivateUserAction
  partners.ts                         ← createPartnerWithAdminAction, updatePartnerAction, deactivatePartnerAction
  organizations.ts                    ← updateOrganizationAction

src/app/api/auth/reset-password/
  request/route.ts                    ← POST: создаёт PasswordResetToken по email (для существующего flow)
  confirm/route.ts                    ← POST: обменивает token+newPassword на passwordHash

src/app/(auth)/reset-password/page.tsx
                                      ← переписан: читает ?token= из URL, форма нового пароля,
                                        POST на /api/auth/reset-password/confirm

src/lib/auth/passwordReset.ts         ← helper: createInviteToken(userId, ttlDays),
                                        verifyAndConsumeToken(token)
```

### 3.2 Точки переиспользования (без копирования)

| Артефакт | Где | Откуда |
|---|---|---|
| `KpiGrid` | admin dashboard | [components/partner/kpi-grid.tsx](src/components/partner/kpi-grid.tsx) |
| `EventsFeed` | admin dashboard | [components/partner/events-feed.tsx](src/components/partner/events-feed.tsx) |
| `StatCard` | admin dashboard | [components/dashboard/stat-card.tsx](src/components/dashboard/stat-card.tsx) |
| `RateOverrideForm` + `setRateOverride` | admin/organizations/[id] | [components/partner/rate-override-form.tsx](src/components/partner/rate-override-form.tsx), [services/partner/rateOverride.ts](src/lib/services/partner/rateOverride.ts) |
| Email transport + `send()` | invite emails | [lib/email/send.ts](src/lib/email/send.ts) |

### 3.3 Файлы под удаление

- Нет. Заглушки `/admin/orders/page.tsx` и `/admin/messages/page.tsx` переписываются на `redirect('/admin/dashboard')`, не удаляются — на случай старых bookmarks.

---

## 4. Навигация: AdminAppShell + sidebar

### 4.1 Структура

**Десктоп (mobile вне скоупа):**
- Левая колонка 240px: sidebar с группами разделов.
- Топ-бар: title секции (динамический) + email текущего admin + кнопка «Выход».
- Контент: max-width 1280px, padding 24px.

### 4.2 Группы и пункты sidebar

```
Платформа
  ⌂ Дашборд               /admin/dashboard
  💚 Здоровье              /admin/health
  🔄 Синхронизация         /admin/sync

Операции
  💰 Комиссии              /admin/commission-statements
  📋 Аудит                  /admin/audit

Справочники
  👤 Пользователи           /admin/users
  🏢 Партнёры               /admin/partners
  🏛 Организации           /admin/organizations
```

### 4.3 Active state

`admin-sidebar.tsx` — single client component, использует `usePathname()` для подсветки текущего пункта. Это единственное место в admin-кабинете, где требуется client component (для активной подсветки). Server-side через middleware-инъекцию header'а возможен, но усложнение неоправдано.

---

## 5. Dashboard `/admin/dashboard`

### 5.1 KPI-плитки (4)

| Плитка | Источник данных |
|---|---|
| Партнёры активные | `Partner.count({ where: { isActive: true } })` + дельта за 30 дней |
| Организации в системе | `Organization.count()` + дельта за 30 дней |
| Закрытые заказы за месяц | `Order.count({ where: { closedAt: { gte: monthStart } } })` + sum `totalAmount` |
| К выплате партнёрам | `CommissionStatement.aggregate({ where: { status: 'approved' }, _sum: { totalCommissionAmount } })` |

### 5.2 Attention list

- Sync lag > 24ч по любой сущности → ссылка на `/admin/health`.
- DLQ jobs > 0 → ссылка на `/admin/health`.
- Approved `CommissionStatement` старше 7 дней без `paidAt` → ссылка на `/admin/commission-statements?status=approved`.
- Партнёры за последние 7 дней без `commissionRate > 0` → ссылка на `/admin/partners?filter=norate`.

### 5.3 Events feed (последние 20)

- Источник: `AuditLog orderBy createdAt desc`.
- Фильтр на «значимые» action: `commission_*`, `partner_created`, `user_role_changed`, `org_rate_override`, `lead_promoted`.
- Каждое событие: actor + verb + entity + timestamp.

### 5.4 Сервис `src/lib/services/admin/dashboard.ts`

```ts
export async function kpis(prisma: PrismaClient): Promise<KpiTile[]>;
export async function attention(prisma: PrismaClient): Promise<AttentionItem[]>;
export async function recentEvents(prisma: PrismaClient, take = 20): Promise<EventItem[]>;
```

Контракт типов совместим с уже сущ. `KpiGrid`/`EventsFeed`.

---

## 6. Управление пользователями `/admin/users`

### 6.1 Список

Таблица: `Email | Имя | Роль | Привязка | Активен | Создан | Действия`.

Фильтры (URL params):
- `?role=partner|organization|manager|admin|student`
- `?active=true|false`
- `?q=<search-by-email-or-name>` — `ILIKE '%q%' on (email, name)`
- `?partnerId=<id>`, `?companyId=<id>`

Pagination: server-side cursor-based (`take=50&cursor=<id>`).

### 6.2 Редактирование `/admin/users/[id]`

Поля:
- `name` — editable.
- `email` — readonly (изменение через отдельный confirm-flow, отложено).
- `role` — dropdown; **admin** в опциях недоступен (см. 6.4).
- `partnerId` — visible если role=partner; dropdown по `Partner.findMany`.
- `companyId` — visible если role∈{organization, manager}; dropdown по `Company.findMany`.
- `isActive` — toggle.

Server Action `updateUserAction(formData)`:
1. `requireAdmin()`.
2. Zod validate.
3. Проверка уникальности email если меняется (защита на будущее).
4. Транзакция: `prisma.user.update` + `recordAudit('user_updated', { before, after })`.
5. `revalidatePath('/admin/users')` + redirect на `/admin/users/[id]`.

### 6.3 Создание `/admin/users/new`

Server Action `createUserAction(formData)`:
1. `requireAdmin()`.
2. Zod validate (email, name, role≠admin, partnerId/companyId if applicable).
3. Создать User с `passwordHash=null` (после миграции §11.1.A), `isActive=true`.
4. Сгенерировать reset-token, сохранить в новой `PasswordResetToken` (см. §11.1.C) с `purpose='invite'` и TTL 7 дней.
5. Если `RESEND_API_KEY` есть → отправить email `templates/user-invite.tsx` с reset-link.
6. Если нет → return flash `{ inviteUrl }` для копирования.
7. `recordAudit('user_created', { entity: 'user', entityId: newUserId, after: { email, role, partnerId, companyId }, meta: { sentEmail: bool } })`.

**Замечание про `User.isActive`**: в текущей схеме поля `isActive` у `User` нет. Добавляется миграцией §11.1.D.

### 6.4 Защита от escalation

- Admin **не может** создать User с `role='admin'`. Zod-схема не пропускает; даже если в HTML form передадут admin — Server Action отклоняет с `recordAudit('user_create_denied', { reason: 'admin_role_via_ui' })`.
- Admin **не может** изменить свою роль через `/admin/users/[id]`. Server Action проверяет `userId !== session.sub`.
- Admin **не может** деактивировать себя (`isActive=false` при self-edit).

### 6.5 Удаление

Hard delete недоступен через UI. Только `deactivateUserAction`:
- `prisma.user.update({ data: { isActive: false } })`.
- `recordAudit('user_deactivated')`.
- Сессионные токены деактивированного User-а не аннулируются автоматически (отложено). В рамках MVP — admin полагается на TTL JWT (1 час) для эффективного отзыва доступа.

---

## 7. Управление партнёрами `/admin/partners`

### 7.1 Список

Таблица: `Название | Slug | Ставка по умолч. | Активных орг | Сумма выплат YTD | Действия`.

«Активных орг» — count `Order.organization.distinct()` где `partnerId = <this>`.
«Сумма выплат YTD» — sum `CommissionStatement.totalCommissionAmount where status='paid' and paidAt >= jan1`.

Фильтры:
- `?active=true|false`
- `?filter=norate` — для attention list (партнёры без commissionRate)
- `?q=<name-or-slug>`

### 7.2 Редактирование `/admin/partners/[id]`

Поля:
- `legalName`, `slug` (с unique-check), `commissionRate`, `isActive`.

Дополнительно ниже формы — read-only список Partner-admin user-ов (link на `/admin/users/[id]`).

### 7.3 Создание `/admin/partners/new`

Комбинированная форма, одна Server Action `createPartnerWithAdminAction`:
1. `requireAdmin()`.
2. Zod validate (Partner fields + admin email/name).
3. Транзакция:
   1. Создать Partner.
   2. Создать User с `role='partner'`, `partnerId=<new>`, `passwordHash=null`.
   3. Создать PartnerUser с `roleInPartner='admin'`, `assignedOrgIds=[]`.
   4. Создать PasswordResetToken.
4. После транзакции (вне TX, чтобы email-fail не откатывал данные):
   1. Отправить invite email или вернуть link в flash.
   2. `recordAudit('partner_created', { partnerId, partnerAdminUserId })`.

Откат всей транзакции при любом падении в шагах 3.1–3.4.

### 7.4 Запреты

- Hard delete партнёра через UI недоступен.
- Изменение `slug` после создания запрещено через UI (могут существовать ссылки/QR-коды) — поле readonly в edit-форме.

---

## 8. Управление организациями `/admin/organizations`

### 8.1 Список

Таблица: `Название | ИНН | Партнёр | Ставка override | Заказов | Действия`.

«Партнёр» — через subquery: партнёр первой Order для этой организации (детерминированно по `partnerId`).
«Ставка override» — `partnerCommissionRate` или прочерк.
«Заказов» — count Orders.

Фильтры:
- `?partnerId=<id>` — все организации, где есть заказ с этим партнёром.
- `?withRateOverride=true|false`.
- `?q=<inn-or-name>`.

### 8.2 Редактирование `/admin/organizations/[id]`

Поля:
- `legalName`, `inn`, `kpp`, `assignedManagerUserId` (dropdown с User-ами role=manager).

Override ставки комиссии — **переиспользуем существующий компонент** `<RateOverrideForm>` ([components/partner/rate-override-form.tsx](src/components/partner/rate-override-form.tsx)) и сервис `setRateOverride()`. Тот же UX, тот же audit.

Не редактируем через UI: `externalId` (read-only после 1С sync), `companyId` (привязка к тенанту — миграционная операция).

---

## 9. Audit log viewer `/admin/audit`

### 9.1 Фильтры (URL)

- `?entity=user|partner|organization|order|commission_statement|lead|document`
- `?action=<exact-action-string>` — dropdown с уникальными action из БД.
- `?actorUserId=<id>` — поиск/dropdown.
- `?from=<date>&to=<date>` — диапазон.
- `?q=<text>` — поиск по `metadata::text ILIKE '%q%'`.

### 9.2 Таблица

`Когда | Actor | Action | Entity | Diff`.

«Diff» — кликабельный popover, рендерит JSON `metadata.before / metadata.after` через `<pre>` (raw JSON, без визуального диффинга — для MVP достаточно).

### 9.3 Pagination

Cursor-based (`take=50&before=<id>`).

### 9.4 Сервис

```ts
export async function listAudit(
  prisma: PrismaClient,
  filters: AuditFilters
): Promise<{ rows: AuditRow[]; nextCursor: string | null }>;

export async function listAuditFilters(
  prisma: PrismaClient
): Promise<{ actions: string[]; entities: string[]; actors: ActorRef[] }>;
```

### 9.5 Производительность

Без GIN-индекса по `metadata::text` — это OK для MVP (`AuditLog` пока не велик). Если станет медленно — добавим индекс отдельной миграцией.

---

## 10. Безопасность и RBAC

### 10.1 `src/lib/auth/requireRole.ts`

```ts
export async function requireSession(): Promise<Session>; // throws → redirect('/login')
export async function requireAdmin(): Promise<Session>;
export async function requirePartnerAdmin(): Promise<Session>;
```

Все имплементируются через тонкую обёртку над `getSession()` + `redirect()`.

### 10.2 Изменения в существующих admin-страницах

`/admin/health/page.tsx`, `/admin/sync/page.tsx`, `/admin/commission-statements/*` — заменить:
```ts
if (!session) redirect('/login');
if (session.role !== 'admin') redirect('/login');
```
на:
```ts
const session = await requireAdmin();
```

Не функциональное изменение, refactor — единая точка изменения политики.

### 10.3 Server Actions

Каждый action начинается с `await requireAdmin()`. Это гарантирует, что POST-ы к Server Action endpoint-ам тоже защищены (не только страничные роуты через middleware).

### 10.4 `src/lib/auth/audit.ts` — `recordAudit()`

Маппится на актуальные поля модели `AuditLog` (см. [prisma/schema.prisma:457](prisma/schema.prisma#L457)): `userId`, `action`, `entity`, `entityId`, `meta` (Json?).

```ts
type AuditRecord = {
  userId: string;                  // actor
  action: string;
  entity: 'user' | 'partner' | 'organization' | 'order' | 'commission_statement' | 'lead' | 'document';
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  status?: 'success' | 'denied';   // пишется в meta.status
  reason?: string;                 // пишется в meta.reason
};

export async function recordAudit(prisma: PrismaClient, rec: AuditRecord): Promise<void>;
```

Каждая мутация (успешная и отклонённая) пишет одну запись. Поля `before`, `after`, `status`, `reason` сохраняются в JSON-поле `meta`.

### 10.5 Запрещённые операции в UI

- Создание User с `role='admin'`.
- Изменение `User.role` от admin к чему-то ещё.
- Hard delete User / Partner / Organization.
- Self-deactivation admin-а.
- Изменение собственной роли.

Все эти операции — только через CLI/seed с явным комментарием в audit DBA.

### 10.6 Sessions revocation

Деактивация User-а не аннулирует существующие JWT сессии автоматически (требует sessions table — отдельный архитектурный шаг). В MVP полагаемся на TTL JWT (1 час).

Зафиксировано как открытый вопрос (см. §13).

---

## 11. Модель данных

### 11.1 Необходимые миграции Prisma

После аудита реальной схемы ([prisma/schema.prisma](prisma/schema.prisma)) — нужны три новые миграции:

**A. `User.passwordHash` → nullable**

В текущей схеме `passwordHash String` (NOT NULL). Для invite-flow (User создаётся без пароля, hash появляется после reset) требуется:

```prisma
passwordHash String?  // nullable
```

Логика логина (`src/lib/auth/jwt.ts` или эквивалент) уже проверяет наличие — нужно лишь добавить отказ при `passwordHash == null` (с сообщением «активируйте учётную запись через invite-link»). Один guard.

**B. `Partner.isActive Boolean @default(true)` — новое поле**

Сейчас у `Partner` нет soft-delete. Для UI admin нужен фильтр active/inactive и кнопка «Деактивировать партнёра» без hard delete. Миграция:

```prisma
model Partner {
  // ...
  isActive Boolean @default(true)
}
```

Старые партнёры получают `isActive=true` по дефолту — non-breaking.

**C. Новая модель `PasswordResetToken`**

Сейчас её нет. Добавляем по аналогии с `StudentBridgeGrant`:

```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  purpose   String   // "invite" | "reset"
  expiresAt DateTime
  usedAt    DateTime?

  @@index([userId])
  @@index([expiresAt])
}
```

В `User` добавляется back-relation `passwordResetTokens PasswordResetToken[]`.

**D. `User.isActive Boolean @default(true)` — новое поле**

Сейчас у `User` нет `isActive` (soft delete). Для admin UI («Деактивировать пользователя») необходимо:

```prisma
model User {
  // ...
  isActive Boolean @default(true)
}
```

Гарды в middleware/`getSession` обновляются: при `isActive=false` сессия отклоняется (для аккаунтов, которые уже залогинены — выкинет при следующем запросе, так как JWT TTL короткий). Старые пользователи получают `isActive=true` по дефолту — non-breaking.

### 11.2 Использование AuditLog

Текущая модель `AuditLog` ([prisma/schema.prisma:457](prisma/schema.prisma#L457)) имеет поля: `userId` (actor), `action`, `entity`, `entityId`, `meta` (Json?). Новые action strings:

- `user_created`, `user_updated`, `user_deactivated`, `user_create_denied`, `user_role_changed`
- `partner_created`, `partner_updated`, `partner_deactivated`
- `organization_updated`, `organization_rate_override` (если ещё нет; partner-side уже пишет `org_rate_override`)
- `commission_statement_*` (уже существуют)

В `meta` храним `{ before, after, status, reason }`. Default `status='success'`.

---

## 12. Тестирование

### 12.1 Уровни

| Уровень | Tool | Покрытие |
|---|---|---|
| Unit | Vitest | `requireAdmin`, `recordAudit`, Zod schemas |
| Service (PG) | Vitest + live PG | `services/admin/*` — list/filter/get/create/update |
| Server Action | Vitest + mock prisma | Each action: RBAC, validation, transaction, audit |
| Playwright visual | existing infra | `/admin/dashboard`, `/admin/users`, `/admin/audit` snapshots |

### 12.2 Обязательные кейсы

1. **RBAC изоляция** — не-admin не может попасть на новые admin-роуты (расширяем существующий middleware test).
2. **Создание admin через UI отклоняется** — Zod-schema rejects, audit пишется со `status='denied'`.
3. **Транзакционность `createPartnerWithAdminAction`** — падение на шаге 3 откатывает Partner и User.
4. **Audit на каждую мутацию** — успешные пишут `success`, отклонённые — `denied` с reason.
5. **Self-protection admin** — нельзя себя деактивировать, нельзя изменить свою роль.
6. **Дашборд работает на пустой БД** — нет null pointer / divide-by-zero в дельтах.
7. **URL filters** — параметры `entity/action/actor/from/to/q` корректно прокидываются в Prisma where.
8. **Email graceful** — без `RESEND_API_KEY` action возвращает inviteUrl, не падает.
9. **Pagination cursor** — корректный `nextCursor`, нет повторов строк между страницами.

### 12.3 Ожидаемый рост test suite

Phase 4 завершилась на 319 passing. После MVP admin ожидаем +60-80 тестов (services, server actions, RBAC, password reset flow, Playwright). Итого ~380-400.

---

## 13. Открытые вопросы (default-ы зафиксированы)

| Вопрос | Default | Когда решать |
|---|---|---|
| Создание admin-а через UI | **Запрещено**. Только seed/CLI с двойной аутентификацией DBA. | Сейчас. |
| Email шаблон invite | Минимальный текстовый: «Вы приглашены в Промтехносферу как {role}. Установите пароль: {link}». | При имплементации. |
| AuditLog retention | Без retention. Добавим, когда таблица станет > 10M строк. | Phase 7+. |
| Hard delete через UI | **Запрещено**. Только soft delete (`isActive=false`). | Сейчас. |
| `/admin/orders` и `/admin/messages` | Редирект на `/admin/dashboard`. | Сейчас. |
| Sessions revocation после deactivate | Полагаемся на JWT TTL (1ч). Полноценная sessions table — отдельный спек. | Phase 7+. |
| `User.email` изменение через UI | Отложено. Через CLI/SQL. | Phase 7+. |
| Partner slug изменение | Запрещено через UI. CLI only. | Сейчас. |

---

## 14. Rollout

### 14.1 План фаз

| Фаза | Объём | Срок (один разработчик) |
|---|---|---|
| 6.0 — Миграции и password reset flow | 4 миграции (§11.1), PasswordResetToken helper, API routes request/confirm, переписанная страница `/reset-password` | 2 дня |
| 6.1 — Foundation | requireAdmin, recordAudit, AdminAppShell, sidebar, заглушки orders/messages → redirect | 2 дня |
| 6.2 — Dashboard | services/admin/dashboard, переписан /admin/dashboard, KPI/attention/events | 2 дня |
| 6.3 — Users | services/admin/users, server-actions/admin/users, страницы list/[id]/new, email invite (templates/user-invite.tsx) | 3 дня |
| 6.4 — Partners | services + actions + страницы + транзакционное создание | 3 дня |
| 6.5 — Organizations | services + actions + страницы, переиспользование RateOverrideForm | 2 дня |
| 6.6 — Audit log viewer | services/admin/auditLog, страница /admin/audit, фильтры в URL | 2 дня |
| 6.7 — Polish + tests + Playwright snapshots | +60-80 тестов, baseline snapshots | 2 дня |

**Итого:** ~18 рабочих дней (≈ 3.5 недели) для одного разработчика.

### 14.2 Метрики приёмки

- `npm test` — все Phase 5 testbase passing + новые (~370+).
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings.
- `npm run build` — successful, новые роуты `/admin/users*`, `/admin/partners*`, `/admin/organizations*`, `/admin/audit` в выводе.
- Manual smoke: создать партнёра через UI → получить email с invite-link → reset password → партнёр-admin логинится в `/partner/dashboard`.
- Playwright visual: новые snapshots baseline без diff.

### 14.3 Feature flag

Введём `FEATURE_ADMIN_CABINET=1` (default `1` в `.env.example`, default `0` в prod пока catbinet не готов). При выключении — `/admin/users`, `/admin/partners`, `/admin/organizations`, `/admin/audit` возвращают 404 через middleware (paттерн уже есть для `partner_leads`).

---

## 15. Связанные документы

- `docs/superpowers/specs/2026-05-21-partner-cabinet-design.md` — спека партнёрского кабинета.
- `docs/superpowers/plans/2026-05-22-partner-cabinet-phase5.md` — Phase 5 plan, источник паттернов admin/health и admin/commission-statements.
- `prisma/schema.prisma` — модель данных, без изменений.
- `src/middleware.ts` — RBAC и feature flags, добавляем `FEATURE_ADMIN_CABINET`.

---

## 16. Что НЕ делаем (отложено)

- Достройка organization/manager/student кабинетов — отдельные спеки.
- Удаление legacy `/api/orders`, `/api/documents`, `/api/dashboard` — отдельный refactor.
- Sessions table для революции токенов — отдельный архитектурный спек.
- UI для feature flags — Phase 7+.
- Hard delete операции в UI.
- Mobile полировка admin-кабинета.
- Bulk actions (массовая деактивация, массовое создание).
- OCR, dark theme, English locale, push notifications, Telegram — всё уже out of scope в партнёрской спеке.

---

**Конец спецификации.**
