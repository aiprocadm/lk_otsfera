# Spec: Admin cabinet — закрытие Phase 6.3–6.7

**Дата:** 2026-05-29
**Статус:** Draft — на ревью пользователя
**Подход:** Горизонтальный (всё 6.3-6.7 одним spec'ом, 5 последовательных PR'ов)
**Feature flag:** Нет (admin internal-only, ≤10 пользователей)
**Целевой пользователь:** Platform admin (сотрудник Промтехносферы)
**Branch (предполагаемый):** `claude/admin-cabinet-6.3-6.7`
**Supersedes (частично):** [2026-05-24-admin-cabinet-mvp-design.md](2026-05-24-admin-cabinet-mvp-design.md) §6-§9 — обновлено под реальность Phase 7/8

---

## 1. Цель и контекст

### 1.1 Бизнес-цель

После Phase 6.0–6.2 у admin есть foundation (AdminAppShell, sidebar, requireAdmin, recordAudit, dashboard, password reset/invite flow). Что отсутствует: рабочие инструменты day-to-day операций — управление пользователями, партнёрами, организациями, просмотр аудит-лога. Без них onboarding и расследование требуют SQL/CLI.

Цель Phase 6.3–6.7 — закрыть этот пробел финальной волной: 5 PR'ов, ~11.5 рабочих дней.

### 1.2 Ключевые метрики успеха (KPI остались от §1.2 оригинала)

| Метрика | Цель |
|---|---|
| Время онбоардинга нового партнёра | ≤ 5 минут (через UI, без curl/SQL) |
| Доля админских операций через UI vs БД/CLI | ≥ 90% |
| Среднее время реакции admin на DLQ alert | ≤ 30 минут |
| Полнота AuditLog по мутациям из admin UI | 100% |

### 1.3 Что уже отгружено (foundation done)

**6.0 — Миграции и password reset flow:**
- `User.passwordHash` nullable, `User.isActive`, `Partner.isActive`, новая модель `PasswordResetToken`.
- `createInviteToken / verifyAndConsumeToken` helper.
- `POST /api/auth/reset-password/{request,confirm}`.
- Переписанная `/reset-password` страница.

**6.1 — Foundation:**
- `requireAdmin()`, `requireSession()`, `requirePartnerAdmin()` в [src/lib/auth/requireRole.ts](../../src/lib/auth/requireRole.ts).
- `recordAudit(prisma, rec)` в [src/lib/auth/audit.ts](../../src/lib/auth/audit.ts) с 12 entities в `AuditEntity` union.
- `AdminAppShell` + `AdminSidebar` (8 ссылок в 3 группах).
- Deprecated stubs `/admin/orders`, `/admin/messages` → `redirect('/admin/dashboard')`.
- 17 audit callsites переписаны на `recordAudit`.

**6.2 — Dashboard:**
- `/admin/dashboard` с KPI / attention / events на `services/admin/dashboard.ts`.

**Phase 7 спин-офф (вне оригинального 6.3-6.7 скоупа):**
- `/admin/organizations` (list с `q` фильтром и skip-pagination).
- `/admin/organizations/[id]` с CustomerAccessSection (invite org-admin через `inviteAdminOrgAdminAction(source='admin')`).

**Phase 8 спин-офф:**
- `/admin/orders/[id]` с `assign-order-manager-form`.
- `/admin/organizations/[id]` дополнен `ManagersBlock` (active + archived assignments).
- `OrganizationManager` join table, `requireManagerForOrg`, etc.

### 1.4 Что эта спека добавит

| Sub-phase | PR | Объём |
|---|---|---|
| **6.3 Users** | PR-1 | `/admin/users` list/filter/[id]/new + email invite + service + actions + ~25 тестов |
| **6.4 Partners** | PR-2 | `/admin/partners` list/[id]/new + транзакционное Partner+admin + ~20 тестов |
| **6.5 Organizations delta** | PR-3 | `OrganizationEditForm` (legalName/inn/kpp/name) + `setOrgRateOverrideAction` (reuse RateOverrideForm) + extract list service + ~15 тестов |
| **6.6 Audit viewer** | PR-4 | `/admin/audit` + filters + cursor pagination + diff dialog + secrets-masking + ~25 тестов |
| **6.7 Polish** | PR-5 | Sidebar +3 пункта, dashboard drill-down links, 4 Playwright snapshot specs, auth.setup.ts admin block |

**Итого:** 9 новых роутов + 1 обновлённый, ~85 тестов, ~5000 LOC diff.

### 1.5 Вне скоупа

- Mobile-полировка admin (admin = desktop, без изменений vs оригинал §1.5).
- Bulk actions (массовая деактивация, импорт CSV).
- UI для feature flags.
- Заполнение `/admin/messages` полноценным функционалом (остаётся redirect).
- Hard delete через UI (только soft delete).
- Push notifications, Telegram-бот, OCR, dark theme.
- **Feature flag `ADMIN_CABINET`** — намеренно опускаем, см. §2 принцип 7.
- **Каскадная деактивация User'ов при `deactivatePartner`** — отдельная следующая итерация.
- **GIN индекс по `AuditLog.meta::text`** — отложено до измеримой проблемы.
- **AuditLog retention** — отложено до > 10M строк.

---

## 2. Принципы

1. **Симметрия с partner / organization / manager кабинетами.** Sibling pattern по CLAUDE.md §4: `admin-users-table`, `admin-partner-edit-form` — не общие компоненты, а отдельные namespaced под admin'а.
2. **Server Actions для admin-мутаций.** API routes — только для уже существующих случаев (DLQ retry).
3. **Один сервис на ресурс** в `src/lib/services/admin/`. Соседствует с `dashboard.ts`, `syncHealth.ts`, etc.
4. **Result-тип по CLAUDE.md §3.** Все service-функции возвращают `{ok:true,...} | {ok:false,error:ErrorCode}` с стабильными error-кодами.
5. **`requireAdmin()` first call** во всех server-actions и страницах. Defense-in-depth (middleware + page + service-layer scope filter).
6. **Audit на каждую мутацию** через `recordAudit`, в одной транзакции с основной мутацией.
7. **No feature flag.** Admin cabinet internal-only, ≤10 users, путь `/admin/*` уже за middleware-RBAC. Добавление флага потребует backfill'а существующих 6.0-6.2 роутов; не оправдано. Если admin user-base расширится — флаг можно добавить отдельным PR.
8. **Запрет escalation через UI.** Admin не может через UI создать другого admin'а, downgrade свою роль, удалить себя.
9. **Last-active-admin protection.** По образцу `assertNotLastActiveAdmin` в [org/team.ts](../../src/lib/services/organization/team.ts) — нельзя deactivate / change-role последнего active `role='admin'`.
10. **Email graceful degradation.** Без `RESEND_API_KEY` — `inviteUrl` в toast/response.
11. **Secret masking в audit viewer.** Defense-in-depth: на render diff dialog маскирует ключи `passwordHash`, `token`, `code`, `secret`, `apiKey` regex-wise, даже если `recordAudit` callsites их не пишут.

---

## 3. Архитектура

### 3.1 Карта изменений

```
src/app/admin/
  users/
    page.tsx                    ← NEW: list + filters + skip pagination
    [id]/page.tsx               ← NEW: edit form
    new/page.tsx                ← NEW: invite form
  partners/
    page.tsx                    ← NEW: list + filters
    [id]/page.tsx               ← NEW: edit form + read-only список partner-admin'ов
    new/page.tsx                ← NEW: combined Partner + admin user form
  organizations/
    [id]/page.tsx               ← ИЗМЕНЁН: добавляются OrganizationEditForm + RateOverrideForm
    page.tsx                    ← ИЗМЕНЁН: добавляются ?partnerId, ?withRateOverride filters
  audit/
    page.tsx                    ← NEW: viewer + filters + cursor pagination + diff dialog
  dashboard/
    page.tsx                    ← ИЗМЕНЁН: drill-down links в events feed и attention list

src/components/admin/
  users-table.tsx               ← NEW (server)
  users-filters.tsx             ← NEW (server, URL params)
  user-edit-form.tsx            ← NEW (client, zod + useTransition)
  user-invite-form.tsx          ← NEW (client modal, useDialogFocus)
  partners-table.tsx            ← NEW (server)
  partners-filters.tsx          ← NEW (server)
  partner-edit-form.tsx         ← NEW (client)
  partner-create-form.tsx       ← NEW (client, combined fields)
  organization-edit-form.tsx    ← NEW (client)
  audit-log-table.tsx           ← NEW (server)
  audit-log-filters.tsx         ← NEW (server, URL params, dropdowns заполнены listAuditFilters)
  audit-diff-dialog.tsx         ← NEW (client modal, useDialogFocus, secret-masking)
  admin-sidebar.tsx             ← ИЗМЕНЁН: +3 пункта (Users, Partners, Audit)

src/lib/services/admin/
  users.ts                      ← NEW: listUsers / getUser / createUser / updateUser / deactivate / reactivate
  partners.ts                   ← NEW: listPartners / getPartner / createPartnerWithAdmin / updatePartner / deactivate / reactivate
  organizations.ts              ← NEW: listOrganizations (extract из page) / getOrganization / updateOrganization
  auditLog.ts                   ← NEW: listAudit / listAuditFilters (cursor pagination, dynamic filter options)

src/server-actions/admin/
  users.ts                      ← NEW: createUserAction / updateUserAction / deactivateUserAction / reactivateUserAction
  partners.ts                   ← NEW: createPartnerWithAdminAction / updatePartnerAction / deactivatePartnerAction / reactivatePartnerAction
  organizations.ts              ← NEW: updateOrganizationAction / setOrgRateOverrideAction

src/lib/email/templates/
  admin-user-invite.tsx         ← NEW (parametrized по role)

src/e2e/
  auth.setup.ts                 ← ИЗМЕНЁН: 4-й блок логинит admin
  snapshots/
    admin-users.spec.ts         ← NEW
    admin-partners.spec.ts      ← NEW
    admin-organizations-edit.spec.ts  ← NEW
    admin-audit.spec.ts         ← NEW

playwright.config.ts            ← ИЗМЕНЁН: admin-desktop / admin-mobile projects
prisma/seed.ts                  ← ИЗМЕНЁН: тестовые данные для admin/users/partners/audit/organizations
```

### 3.2 Точки переиспользования

| Артефакт | Откуда |
|---|---|
| `createInviteToken / verifyAndConsumeToken` | [src/lib/auth/passwordReset.ts](../../src/lib/auth/passwordReset.ts) (Phase 6.0) |
| `recordAudit` | [src/lib/auth/audit.ts](../../src/lib/auth/audit.ts) (Phase 6.1) |
| `requireAdmin` | [src/lib/auth/requireRole.ts](../../src/lib/auth/requireRole.ts) (Phase 6.1) |
| `useDialogFocus` | [src/hooks/useDialogFocus.ts](../../src/hooks/useDialogFocus.ts) (modal a11y, CLAUDE.md §9) |
| `RateOverrideForm` | [src/components/partner/rate-override-form.tsx](../../src/components/partner/rate-override-form.tsx) — рендерится с `mode='admin'` |
| `setRateOverride` service | [src/lib/services/partner/rateOverride.ts](../../src/lib/services/partner/rateOverride.ts) — admin server-action делает thin wrapper |
| Resend transport + `sendEmail` | [src/lib/email/transport.ts](../../src/lib/email/transport.ts) (Phase 5) |
| `assertNotLastActiveAdmin` паттерн | [src/lib/services/organization/team.ts](../../src/lib/services/organization/team.ts) (Phase 7) |

### 3.3 Файлы под удаление

Нет.

---

## 4. 6.3 Users management

### 4.1 Маршруты

```
/admin/users          ← list + filters + skip pagination
/admin/users/new      ← invite form (создание + email)
/admin/users/[id]     ← edit form
```

### 4.2 Сервис `src/lib/services/admin/users.ts`

```ts
type UserFilters = {
  role?: 'admin' | 'manager' | 'partner' | 'organization' | 'student';
  active?: boolean;
  q?: string;          // ILIKE по email и name
  partnerId?: string;
  organizationId?: string;
  take?: number;
  skip?: number;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  attachmentLabel: string;  // computed: "Partner X" / "Org Y (+2)" / "—"
};

type UserDetail = UserRow & {
  partnerId: string | null;
  organizationMemberships: Array<{ id, name, role: string, isActive: boolean }>;
  organizationManagerships: Array<{ id, name, isActive: boolean }>;
  studentLink: { organizationId: string, organizationName: string } | null;
};

type UserError =
  | 'forbidden'
  | 'not_found'
  | 'admin_role_via_ui'
  | 'self_action_forbidden'
  | 'last_admin_protected'
  | 'duplicate_email';

listUsers(prisma, filters): Promise<{ rows: UserRow[]; total: number }>;
getUser(prisma, id): Promise<UserDetail | null>;
createUser(prisma, actor, args): Promise<{ok:true, user, inviteToken} | {ok:false, error: UserError}>;
updateUser(prisma, actor, id, args): Promise<{ok:true, user} | {ok:false, error: UserError}>;
deactivateUser(prisma, actor, id): Promise<{ok:true} | {ok:false, error: UserError}>;
reactivateUser(prisma, actor, id): Promise<{ok:true} | {ok:false, error: UserError}>;
```

### 4.3 Server actions `src/server-actions/admin/users.ts`

```ts
'use server';

createUserAction(formData): Promise<{ok:true, inviteUrl?:string} | {ok:false, error:string}>;
updateUserAction(formData): Promise<{ok:true} | {ok:false, error:string}>;
deactivateUserAction(formData): Promise<{ok:true} | {ok:false, error:string}>;
reactivateUserAction(formData): Promise<{ok:true} | {ok:false, error:string}>;

// Form-compatible void wrappers
createUserFormAction = (fd) => { await createUserAction(fd); };
// etc.
```

Каждая action начинается с `await requireAdmin()`, zod-validate, call service, `revalidatePath('/admin/users')`.

### 4.4 Колонки таблицы

`Email · Имя · Роль · Привязка · Активен · Создан · Действия`

«Привязка» — computed:
- `role='partner'` → `PartnerUser.partner.name` или «—»
- `role='organization'` → первая `OrganizationUser.organization.name` + count if > 1
- `role='manager'` → первая `OrganizationManager.organization.name` + count if > 1
- `role='student'` → `Student.organization.name` или «—»
- `role='admin'` → «—»

«Действия»: `Редактировать` (link) + `Деактивировать` / `Восстановить` (form action в строке).

### 4.5 Filters

URL params: `?role=… &active=true|false &q=… &partnerId=… &organizationId=…`

Pagination: skip/take (как `/admin/organizations`), default `take=50`.

### 4.6 Edit form поля

- `name` — editable.
- `email` — readonly (изменение через отдельный confirm-flow, отложено).
- `role` — dropdown; **admin** в опциях недоступен.
- `partnerId` — visible если `role='partner'`; dropdown по `Partner.findMany({ where: { isActive: true } })`.
- **Role transition в MVP — ограниченное:**
  - `partner → partner` (смена `partnerId`) — поддерживается; удаляет старую `PartnerUser` запись, создаёт новую с `roleInPartner='member'`.
  - `partner ↔ student` — поддерживается (создаёт/удаляет `Student` запись).
  - `partner ↔ organization` / `partner ↔ manager` — **запрещено через эту форму**. Cleanup memberships и audit-цепочка сложна; admin должен deactivate старого user'а и создать нового. UI скрывает эти переходы в dropdown.
  - `organization ↔ manager` (и наоборот) — **запрещено**, по тому же reasoning.
- При смене role на/с `organization` или `manager` (если разрешено в будущем) → memberships управляются на `/organization/team`, `/admin/organizations/[id]` (managers block). Эта форма не трогает joins-таблицы для org/manager.
- UI показывает информационную плашку: «Привязки к организациям и managed-organizations управляются на странице организации».
- `isActive` — toggle (с last-admin protection).

### 4.7 Invite form (`/admin/users/new`)

Поля: `email`, `name`, `role` (без admin), `partnerId` if role=partner.

Server action `createUserAction`:
1. `requireAdmin()`.
2. Zod validate (`role !== 'admin'`, `partnerId required if role='partner'`).
3. Транзакция:
   - `prisma.user.create({ data: { email, name, role, partnerId, passwordHash: null, isActive: true } })`.
   - Если `role='partner'` — также `prisma.partnerUser.create({ userId, partnerId, roleInPartner: 'member', assignedOrgIds: [] })`. **Default `member`** — admin'ы создаются только через `/admin/partners/new` вместе с самим Partner'ом (§5.6). Промоушн `member → admin` через `/admin/users/[id]` — отдельный вопрос (§13).
   - `createInviteToken(tx, user.id, 'invite')`.
   - `recordAudit(tx, { userId: actor.sub, action: 'user_created', entity: 'user', entityId: user.id, after: { email, role, partnerId, sentEmail: bool } })`.
4. Вне TX: `sendAdminUserInviteEmail({ to: email, name, role, inviteUrl })` через Resend.
5. Return `{ ok: true, inviteUrl }`.

Email graceful: если `RESEND_API_KEY` пуст → `inviteUrl` viewable в toast UI.

### 4.8 Safety / RBAC

1. Zod-схема `createUser` / `updateUser` отклоняет `role='admin'`. Server action пишет `recordAudit(..., { action: 'user_create_denied', status: 'denied', reason: 'admin_role_via_ui' })`.
2. `updateUser` / `deactivateUser` проверяет `userId !== actor.sub`. Иначе → `self_action_forbidden`.
3. Last-active-admin protection в `deactivateUser` и `updateUser`(role change):
```ts
async function assertNotLastActiveAdmin(prisma, userId) {
  const count = await prisma.user.count({
    where: { role: 'admin', isActive: true, NOT: { id: userId } }
  });
  if (count === 0) throw { error: 'last_admin_protected' };
}
```
4. `deactivateUser` НЕ аннулирует существующие JWT сессии (полагается на TTL JWT, ~1 час). Отложено в next iteration.

### 4.9 Audit actions

`user_created`, `user_updated`, `user_role_changed` (specialized когда role меняется), `user_deactivated`, `user_reactivated`, `user_create_denied`.

---

## 5. 6.4 Partners management

### 5.1 Маршруты

```
/admin/partners          ← list + filters
/admin/partners/new      ← Partner + первый admin-user, одна транзакция
/admin/partners/[id]     ← edit Partner + read-only список partner-admin'ов
```

### 5.2 Сервис `src/lib/services/admin/partners.ts`

```ts
type PartnerFilters = {
  active?: boolean;
  filter?: 'norate';   // партнёры без commissionRate
  q?: string;
  take?: number;
  skip?: number;
};

type PartnerRow = {
  id: string;
  name: string;
  slug: string;
  commissionRate: number | null;
  isActive: boolean;
  activeOrgCount: number;     // distinct organizations via orders
  paidYTD: Decimal;           // sum CommissionStatement.totalCommissionAmount where status='paid' and paidAt >= jan1
};

type PartnerError = 'forbidden' | 'not_found' | 'duplicate_slug';

listPartners(prisma, filters): Promise<{ rows: PartnerRow[]; total: number }>;
getPartner(prisma, id): Promise<PartnerDetail | null>;
createPartnerWithAdmin(prisma, actor, args): Promise<{ok:true, partner, user, inviteToken} | {ok:false, error: PartnerError | UserError}>;
updatePartner(prisma, actor, id, args): Promise<{ok:true, partner} | {ok:false, error}>;
deactivatePartner(prisma, actor, id): Promise<{ok:true} | {ok:false, error}>;
reactivatePartner(prisma, actor, id): Promise<{ok:true} | {ok:false, error}>;
```

### 5.3 Server actions `src/server-actions/admin/partners.ts`

`createPartnerWithAdminAction`, `updatePartnerAction`, `deactivatePartnerAction`, `reactivatePartnerAction` + form-compatible void wrappers.

### 5.4 Колонки

`Название · Slug · Ставка по умолч. · Активных орг · Сумма выплат YTD · Действия`

### 5.5 Filters

`?active=true|false &filter=norate &q=…`

### 5.6 Create form

Поля: `name`, `slug`, `commissionRate`, `adminEmail`, `adminName`.

Транзакция:

```ts
await prisma.$transaction(async (tx) => {
  // Pre-check slug
  const existing = await tx.partner.findUnique({ where: { slug } });
  if (existing) throw { ok: false, error: 'duplicate_slug' };

  const partner = await tx.partner.create({
    data: { name, slug, commissionRate, isActive: true }
  });
  const user = await tx.user.create({
    data: {
      email: adminEmail,
      name: adminName,
      role: 'partner',
      partnerId: partner.id,
      passwordHash: null,
      isActive: true
    }
  });
  await tx.partnerUser.create({
    data: {
      userId: user.id,
      partnerId: partner.id,
      roleInPartner: 'admin',
      assignedOrgIds: []
    }
  });
  const token = await createInviteToken(tx, user.id, 'invite');
  await recordAudit(tx, {
    userId: actor.sub,
    action: 'partner_created',
    entity: 'partner',
    entityId: partner.id,
    after: { name, slug, commissionRate, adminUserId: user.id, adminEmail }
  });
  return { partner, user, inviteToken: token };
});

// Outside TX — email graceful
try {
  await sendAdminUserInviteEmail({ to: adminEmail, name: adminName, role: 'partner', inviteUrl });
} catch (e) {
  console.warn('[admin] partner invite email send failed', e);
}
```

Race condition на slug: `P2002` constraint поймает; admin получает `duplicate_slug` error.

### 5.7 Edit form

Поля: `name`, `commissionRate`, `isActive`.

`slug` — readonly (могут существовать публичные ссылки/QR-коды на `/partner/<slug>`-style URLs в будущем; защита от случайного breaking).

### 5.8 Read-only блок «Partner admins»

Под edit-form: список `PartnerUser` где `roleInPartner='admin'` + `User`. Колонки: `Email · Имя · Active · Создан`. Каждая строка — link на `/admin/users/[id]` (детальное редактирование там).

### 5.9 Audit actions

`partner_created`, `partner_updated`, `partner_deactivated`, `partner_reactivated`.

### 5.10 Каскад при `deactivatePartner`

Не каскадим на User'ов (см. §1.5 — отложено). Audit пишет `{after: {isActive: false}}`; users остаются active. Admin может вручную деактивировать через `/admin/users`.

---

## 6. 6.5 Organizations delta

Минимальная итерация — Phase 7 уже заложил list + customer access + manager block.

### 6.1 Что добавляем на `/admin/organizations/[id]/page.tsx`

1. `<OrganizationEditForm>` — новый client component.
   - Поля: `name`, `legalName`, `inn`, `kpp`.
   - `externalId` (1С ID) — readonly.
   - `partnerId` — readonly (1С controls).
   - Server action `updateOrganizationAction(formData)`.

2. `<RateOverrideForm orgId={...} mode="admin">` — reuse [partner/rate-override-form.tsx](../../src/components/partner/rate-override-form.tsx).
   - Server action `setOrgRateOverrideAction(formData)` — thin wrapper над `services/partner/rateOverride.setRateOverride(prisma, actor, ...)`.

### 6.2 Сервис `src/lib/services/admin/organizations.ts`

Extract из inline page-query:

```ts
listOrganizations(prisma, filters): Promise<{ rows; total }>;  // с поддержкой ?partnerId, ?withRateOverride
getOrganization(prisma, id): Promise<OrganizationDetail | null>;
updateOrganization(prisma, actor, id, args): Promise<{ok} | {ok:false, error}>;
```

### 6.3 Server actions `src/server-actions/admin/organizations.ts`

```ts
updateOrganizationAction(formData)
setOrgRateOverrideAction(formData)  // wrapper, audit пишется существующим setRateOverride
```

### 6.4 List page расширение

`/admin/organizations` уже имеет `q` filter. Добавляем:
- `?partnerId=<id>` — filter по партнёру через `orders.some({ partnerId })`.
- `?withRateOverride=true|false` — filter по `partnerCommissionRate IS NOT NULL`.

### 6.5 Audit actions

`organization_updated` (новое), `partner_commission_rate_changed` (уже эмиттится через `setRateOverride`).

### 6.6 Что НЕ добавляем

- `assignedManagerUserId` (устарел; Phase 8 заменил на `OrganizationManager`, уже рендерится через `ManagersBlock`).
- `companyId` (миграционная операция).
- `externalId` (1С controlled).

---

## 7. 6.6 Audit log viewer

### 7.1 Маршрут

`/admin/audit`

### 7.2 Сервис `src/lib/services/admin/auditLog.ts`

```ts
type AuditFilters = {
  entity?: AuditEntity;
  action?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  q?: string;          // meta::text ILIKE '%q%'
  take?: number;       // default 50, max 100
  cursor?: string;     // id-based, для backward pagination
};

type AuditRow = {
  id: string;
  createdAt: Date;
  user: { id: string; email: string; name: string };  // actor
  action: string;
  entity: AuditEntity;
  entityId: string;
  meta: Prisma.JsonValue;  // содержит before/after/status/reason/...
};

listAudit(prisma, filters): Promise<{ rows: AuditRow[]; nextCursor: string | null }>;

listAuditFilters(prisma): Promise<{
  entities: AuditEntity[];   // DISTINCT из БД
  actions: string[];          // DISTINCT из БД, sorted
  actors: Array<{ id, name, email }>;  // первые 200 актёров
}>;
```

### 7.3 Pagination strategy

**Cursor-based** (по `id desc`). В отличие от Users/Partners со skip/take. Reasoning: AuditLog растёт быстрее всего, skip O(n) на больших offset'ах.

UX: «Загрузить ещё» button добавляет 50 строк через `?cursor=<lastId>` в URL. Не infinite-scroll (предсказуемость).

### 7.4 UI components

**`audit-log-filters.tsx`** (server) — form с URL params, dropdown'ы заполняются из `listAuditFilters()`. Actions group by entity-prefix:
```
[organization_*]  org_member_invited, org_member_role_changed, ...
[partner_*]       partner_created, partner_member_invited, ...
[manager_*]       manager_deactivated, order_manager_changed, ...
[user_*]          user_created, user_deactivated, ...
...
```

**`audit-log-table.tsx`** (server) — рендерит rows. Колонки: `Когда · Actor · Action · Entity · ID · Detail`.

**`audit-diff-dialog.tsx`** (client) — модалка с backdrop (не popover — content большой, side-by-side `<pre>` блоки нужно место). Открывается по клику на «Detail» button в row. Рендерит:
- `meta.before` (если есть) side-by-side с `meta.after` (если есть), оба через `<pre>` с подсветкой.
- Дополнительный блок «Прочие meta-поля»: показывает все ключи `meta` кроме `before/after/status/reason`.
- Использует `useDialogFocus(open)` (a11y, CLAUDE.md §9): `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape closes, focus trap.

### 7.5 Secrets masking

```ts
const SENSITIVE_KEYS = /^(passwordHash|token|code|secret|apiKey|signedUrl|.*Secret|.*Token)$/i;

function maskValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.test(key)) return '*****';
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, maskValue(k, v)])
    );
  }
  return value;
}
```

Defense-in-depth: `recordAudit` callsites не должны писать секреты, но рендер всё равно маскирует.

### 7.6 Известные entities и actions (текущее состояние на 2026-05-29)

**Entities (12):**
```
user, partner, organization, organization_user, organization_manager,
order, commission_statement, lead, lead_attachment, document,
partner_user, student_bridge
```

**Actions (по группам):**
```
Users / auth:        user_created, user_updated, user_role_changed,
                     user_deactivated, user_reactivated, user_create_denied,
                     password_reset
Partners:            partner_created, partner_updated, partner_deactivated,
                     partner_reactivated, partner_commission_rate_changed
Partner team:        partner_member_invited, partner_member_scope_changed,
                     partner_member_deactivated
Organizations:       organization_updated
Org team:            org_member_invited, org_member_role_changed,
                     org_member_deactivated, org_member_reactivated
Managers:            manager_deactivated, manager_reactivated,
                     order_manager_changed
Orders:              order_status_changed
Documents:           document_upload, document_uploaded,
                     document_download_signed_url
Comments:            comment_posted
Leads:               lead_created, lead_withdrawn,
                     lead_attachment_uploaded, lead_attachment_deleted
Commissions:         commission_statement_calculated,
                     commission_statement_approved,
                     commission_statement_paid
```

В UI dropdown'ы — заполняются динамически через `listAuditFilters()` чтобы новые actions (Phase 9+) появлялись автоматически без code change.

### 7.7 Performance

- `meta::text ILIKE '%q%'` — sequential scan. Acceptable пока `AuditLog < 1M` строк (~ MVP). После — GIN индекс отдельной миграцией:
```sql
CREATE INDEX CONCURRENTLY idx_auditlog_meta_gin ON "AuditLog" USING gin (to_tsvector('russian', meta::text));
```
- `listAuditFilters()` — 3 DISTINCT queries. На 100k строк ~50ms. Если станет узким местом — материализованное view или Redis cache.
- Сам list query с фильтрами — индексы по `(createdAt, id)`, `entity`, `action`, `userId` — нужно проверить какие уже есть в schema.

### 7.8 Audit для самого viewer'а

НЕ пишем (read-only, нет mutation, нет смысла).

### 7.9 Audit actions добавляются

Никаких. Viewer не пишет в audit.

---

## 8. 6.7 Polish

### 8.1 Sidebar `src/components/admin/admin-sidebar.tsx`

Сейчас 8 ссылок в 3 группах. Финальная цель (после всех 5 PR):
```
Платформа
  ⌂ Дашборд              /admin/dashboard
  💚 Здоровье             /admin/health
  🔄 Синхронизация        /admin/sync

Операции
  💰 Комиссии             /admin/commission-statements
  📋 Аудит                /admin/audit              ← добавляется в PR-4

Справочники
  👤 Пользователи         /admin/users              ← добавляется в PR-1
  🏢 Партнёры             /admin/partners           ← добавляется в PR-2
  🏛 Организации          /admin/organizations
```

Итого 11 ссылок. **Каждый PR добавляет свою ссылку в sidebar в той же мутации** (а не batch'ит в PR-5). Reasoning: admin'у нужна навигация к новой странице сразу при merge'е PR; ждать PR-5 ради ссылки — лишняя friction в течение ~2-х недель rollout'а. Merge conflict risk низкий — каждый PR трогает разные строки sidebar'а.

### 8.2 Dashboard drill-down

`src/app/admin/dashboard/page.tsx`:
- Events feed: каждый event-item → link на `/admin/audit?entity=<event.entity>&action=<event.action>` для контекстного просмотра.
- Attention list:
  - «Партнёры без ставки» → link `/admin/partners?filter=norate`.
  - «DLQ jobs > 0» → link `/admin/health` (уже есть).
  - «Approved CommissionStatement > 7д без paidAt» → link `/admin/commission-statements?status=approved` (уже есть).

### 8.3 Playwright snapshots

4 новых spec'а в `src/e2e/snapshots/`:

- `admin-users.spec.ts` — list view, фильтры применены, modal `/admin/users/new` открыт.
- `admin-partners.spec.ts` — list view, edit-page для одного партнёра.
- `admin-organizations-edit.spec.ts` — `/admin/organizations/[id]` с обновлёнными edit-форма и RateOverrideForm.
- `admin-audit.spec.ts` — list view с применённым фильтром, diff dialog открыт на одной записи.

### 8.4 Auth setup `src/e2e/auth.setup.ts`

4-й блок (после partner / organization / manager) логинит `admin@demo.local` → `playwright-report/.auth/admin.json`.

`prisma/seed.ts` уже содержит `admin@demo.local`; нужно убедиться, что есть seed-данные для всех 4 snapshot'ов (минимум: 1 партнёр со ставкой, 1 без, 1 организация без override, 5+ audit-events разных entities).

### 8.5 Playwright config

В `playwright.config.ts` добавить:
```ts
{ name: 'admin-desktop', use: { ...desktop, storageState: 'playwright-report/.auth/admin.json' }, testMatch: /snapshots\/admin-.*\.spec\.ts/ },
{ name: 'admin-mobile', use: { ...mobile, storageState: 'playwright-report/.auth/admin.json' }, testMatch: /snapshots\/admin-.*\.spec\.ts/ },
```

Существующие `partner-*`, `org-*`, `mgr-*` projects используют negative-lookahead — не нужно обновлять.

### 8.6 Baselines

**Не committed** — генерируются на первом staged Linux/Chromium run (`npm run e2e:visual:update`), как Phase 5/8.

---

## 9. Безопасность

### 9.1 RBAC

Все 9 новых страниц + 4 обновлённые начинаются с `await requireAdmin()`. Server actions делают то же.

Middleware (`src/middleware.ts`) уже защищает `/admin/*` — feature flag не добавляется (см. §2 принцип 7).

### 9.2 Запрещённые операции в UI

| Operation | Mechanism |
|---|---|
| Создание User с `role='admin'` | Zod-схема rejects; audit `status='denied' reason='admin_role_via_ui'` |
| Изменение `User.role` админа другим админом | Не blocked (admin может demote другого admin'а, кроме last) — но last-active-admin protection срабатывает |
| Hard delete User / Partner / Organization | Нет UI; only soft `isActive=false` |
| Self-deactivation | Service rejects: `self_action_forbidden` |
| Изменение собственной роли | Service rejects: `self_action_forbidden` |
| Deactivate последнего active admin'а | Service rejects: `last_admin_protected` |

### 9.3 Sessions revocation

`deactivate*` не аннулирует существующие JWT (нет sessions table). Полагаемся на TTL JWT (~1 час).

Открытый вопрос (см. §13).

### 9.4 Secret leakage в audit viewer

Defense-in-depth: render-time masking в `audit-diff-dialog.tsx` для regex'а `passwordHash|token|code|secret|apiKey|.*Secret|.*Token`. Маскировка работает даже если callsite в `recordAudit` случайно запишет секрет.

---

## 10. Модель данных

### 10.1 Миграции

**Никаких новых миграций.** Все необходимые модели уже отгружены в Phase 6.0 + Phase 7 + Phase 8.

### 10.2 AuditEntity union — добавления

В оригинальной спеке (2026-05-24) было 7 entities. Текущее состояние [audit.ts:3-15](../../src/lib/auth/audit.ts) — 12:

```ts
type AuditEntity =
  | 'user' | 'partner' | 'organization'
  | 'organization_user' | 'organization_manager'
  | 'order' | 'commission_statement' | 'lead' | 'lead_attachment'
  | 'document' | 'partner_user' | 'student_bridge';
```

Audit viewer должен поддерживать все 12 в фильтрах.

---

## 11. Тестирование

### 11.1 Уровни по CLAUDE.md §6

| Уровень | Файлы | Что тестируется |
|---|---|---|
| **L1 unit** | `services.admin.users.test.ts`, `services.admin.partners.test.ts`, `services.admin.organizations.test.ts`, `services.admin.auditLog.test.ts`, `server-actions.admin.users.test.ts`, `server-actions.admin.partners.test.ts`, `server-actions.admin.organizations.test.ts`, `admin-sidebar.test.tsx`, `audit-log-table.test.tsx`, `audit-diff-dialog.test.tsx` | Service contracts, Result-коды, RBAC, zod-схемы, secret masking |
| **L2 integration** | `api.admin.users.integration.test.ts` (если нужно), `services.admin.partners.transaction.test.ts` | Транзакционность `createPartnerWithAdmin`, atomic audit + mutation на live PG |
| **L3 e2e** | 4 snapshot specs из §8.3 | Visual regression + smoke |

### 11.2 Обязательные кейсы

1. **Anti-escalation**: create user с `role='admin'` → reject + audit `status='denied'`.
2. **Self-protection**: admin не может deactivate себя; не может изменить свою роль; не может deactivate last active admin'а.
3. **Transactionality**: `createPartnerWithAdmin` падает на step 3 (e.g. duplicate email) → Partner + User откатываются.
4. **Email graceful**: без `RESEND_API_KEY` action возвращает `inviteUrl` в response.
5. **Cursor pagination**: audit `nextCursor` корректен, нет повторов между страницами, `nextCursor=null` после последней.
6. **Secret masking**: `passwordHash` в `meta.after` → DOM содержит `*****`, не значение.
7. **Filters thread-through**: каждый URL param корректно прокидывается в Prisma `where`.
8. **Empty DB**: все 4 списка рендерятся без crash на пустой БД (zero-state).
9. **Slug uniqueness**: создание Partner с дублирующим slug → `duplicate_slug` error.
10. **Last-admin protection**: 2 active admin'а → deactivate первого OK; potом deactivate второго → `last_admin_protected`.

### 11.3 Ожидаемый рост test suite

Phase 8 завершилась на 956. После Phase 6.3-6.7 ожидаем +85-95 unit + 5-10 integration = **~1050 passing**.

---

## 12. Rollout

### 12.1 5 PR'ов

| PR | Sub-phase | Объём | Расчёт |
|---|---|---|---|
| **PR-1** | 6.3 Users | service + actions + 3 страницы + invite email template + sidebar +1 (Пользователи) + ~25 тестов | ~3 дня |
| **PR-2** | 6.4 Partners | service + actions + 3 страницы + sidebar +1 (Партнёры) + ~20 тестов | ~3 дня |
| **PR-3** | 6.5 Organizations delta | OrganizationEditForm + setOrgRateOverrideAction + list service extract + ~15 тестов | ~1.5 дня |
| **PR-4** | 6.6 Audit viewer | service + страница + 3 components + secret masking + sidebar +1 (Аудит) + ~25 тестов | ~3 дня |
| **PR-5** | 6.7 Polish | dashboard drill-down, 4 Playwright specs, auth.setup admin block | ~1 день |

**Итого:** ~11.5 рабочих дней. Каждый PR самостоятелен, ship'ится в `main` (без флага).

### 12.2 Зависимости между PR

- PR-2 (Partners) использует `admin-user-invite.tsx` email template из PR-1.
- PR-5 (Polish) зависит от PR-1..4 (snapshot'ы и sidebar нужны после).

PR-3, PR-4 — параллельны PR-1 и PR-2 (не зависят).

### 12.3 Manual smoke per PR (operator-driven)

| PR | Smoke |
|---|---|
| PR-1 | Создать тестового partner-admin через `/admin/users/new` → invite email → reset password → login в `/partner/dashboard` (5-min KPI). |
| PR-2 | Создать партнёра через `/admin/partners/new` (Partner + admin user в одной транзакции) → email → login partner-admin. |
| PR-3 | Изменить inn/kpp у тестовой организации; установить rate override; проверить, что меняется в `/partner/portfolio`. |
| PR-4 | Найти в audit'е любое событие через каждый фильтр (entity, action, actor, date, q); открыть diff dialog; убедиться, что секрет маскируется (если есть тестовый payment с `signedUrl`). |
| PR-5 | Запустить `npm run e2e:visual:update` локально → проверить 4 baseline'а визуально → закоммитить (по образцу Phase 7 baselines committed, vs Phase 5/8 not committed — admin internal, low churn). |

### 12.4 Метрики приёмки

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings.
- `npm run test:unit` — ~1050 passing.
- `npm run test:integration` — passing (если есть live PG).
- `npm run build` — successful, 9 новых роутов в выводе.
- `npm run dev` boot — нет startup errors (release checklist post-#65).
- Manual smoke (operator-driven) — 5 шагов из §12.3 passed.

### 12.5 Что делаем после merge всех 5 PR

1. **Закрыть PARTIAL doc:** [2026-05-24-admin-cabinet-mvp-PARTIAL.md](../plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md) → переименовать в `-DONE.md` или создать новый `2026-05-29-admin-cabinet-6.3-6.7-DONE.md` companion (см. CLAUDE.md §8 + memory note `feedback-done-plan-convention`).
2. **Обновить README.md §«Cabinet rollout status»**: Admin теперь `Production (Phase 6.0–6.7 done)`.
3. **Memory update**: добавить `reference-admin-plan.md` с PR-номерами и датой.

---

## 13. Открытые вопросы

| Вопрос | Default | Когда решать |
|---|---|---|
| Создание admin-а через UI | **Запрещено**. Через seed/CLI. | Сейчас (без изменений vs оригинал). |
| Promote partner-user `member → admin` (и обратно) через `/admin/users/[id]` | Не в MVP. Сейчас admin создаётся только через `/admin/partners/new` вместе с Partner'ом. Если нужно — отдельная action на `/admin/partners/[id]` (next iteration). | Phase 9+. |
| Каскадная деактивация User'ов при `deactivatePartner` | Не каскадим. Отдельный bulk action в next iteration. | Phase 9+. |
| Sessions revocation после deactivate | Полагаемся на JWT TTL (~1ч). | Phase 9+. |
| AuditLog retention | Без retention; добавим при > 10M строк. | TBD по размеру. |
| GIN индекс на `AuditLog.meta::text` | Отложен; добавим если q-search станет узким местом. | После замеров на проде. |
| Hard delete через UI | Запрещено (только soft). | Сейчас. |
| `User.email` изменение через UI | Отложено. CLI/SQL. | Phase 9+. |
| Partner slug изменение | Запрещено через UI. CLI only. | Сейчас. |
| Feature flag `ADMIN_CABINET` | Не вводим. Admin internal-only, ≤10 users. | Revisit если admin user-base > 50 или появится staged rollout требование. |

---

## 14. Связанные документы

- [docs/superpowers/specs/2026-05-24-admin-cabinet-mvp-design.md](2026-05-24-admin-cabinet-mvp-design.md) — оригинальная спека, эта supersede'ит §6-§9.
- [docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md](../plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md) — close-out для 6.0-6.2.
- [docs/superpowers/specs/2026-05-25-organization-cabinet-design.md](2026-05-25-organization-cabinet-design.md) — Phase 7, источник паттернов last-admin protection, useDialogFocus, server-actions конвенции.
- [docs/superpowers/specs/2026-05-26-manager-cabinet-design.md](2026-05-26-manager-cabinet-design.md) — Phase 8, источник паттернов transactional create-with-membership, admin-side invite UI.
- [CLAUDE.md](../../../CLAUDE.md) — §3 Result-тип, §4 sibling pattern, §6 тесты, §9 a11y, §10 audit log.

---

**Конец спецификации.**
