# MVP Admin Cabinet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Достроить admin-кабинет платформы: единый layout с sidebar, реальный dashboard с метриками, CRUD пользователей/партнёров/организаций, audit log viewer; разблокировать invite-flow через password reset.

**Architecture:** Hybrid-подход — reuse партнёрских компонентов (KpiGrid, EventsFeed, RateOverrideForm) где возможно, Server Actions для admin-мутаций, `requireAdmin()` server-side guard, `recordAudit()` единая точка записи в AuditLog. Восемь фаз 6.0–6.7 (~18 дней одному разработчику).

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, Prisma (PostgreSQL), Vitest, Playwright, Resend (email), Server Actions, JWT cookie auth.

**Spec reference:** [docs/superpowers/specs/2026-05-24-admin-cabinet-mvp-design.md](docs/superpowers/specs/2026-05-24-admin-cabinet-mvp-design.md)

**Branch:** `claude/admin-cabinet-mvp` (создать от main после merge phase5 → main, либо от текущей `claude/partner-cabinet-phase3` если phase5 ещё не вмержена).

---

## Архитектура (карта изменений)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase 6.0 — Foundation (миграции + password reset flow)                  │
│   prisma migrations:                                                     │
│     - 20260524100000_password_hash_nullable                              │
│     - 20260524110000_partner_user_isactive                               │
│     - 20260524120000_password_reset_token                                │
│   src/lib/auth/passwordReset.ts (createInviteToken, verifyAndConsume)    │
│   src/app/api/auth/reset-password/request/route.ts                       │
│   src/app/api/auth/reset-password/confirm/route.ts                       │
│   src/app/(auth)/reset-password/page.tsx       (переписан)               │
│                                                                          │
│ Phase 6.1 — Admin foundation (guards + shell + sidebar)                  │
│   src/lib/auth/requireRole.ts                                            │
│   src/lib/auth/audit.ts                                                  │
│   src/components/admin/admin-app-shell.tsx                               │
│   src/components/admin/admin-sidebar.tsx                                 │
│   src/app/admin/layout.tsx                     (переписан)               │
│   src/app/admin/orders/page.tsx                (redirect)                │
│   src/app/admin/messages/page.tsx              (redirect)                │
│                                                                          │
│ Phase 6.2 — Dashboard                                                    │
│   src/lib/services/admin/dashboard.ts                                    │
│   src/app/admin/dashboard/page.tsx             (переписан)               │
│                                                                          │
│ Phase 6.3 — Users management                                             │
│   src/lib/services/admin/users.ts                                        │
│   src/server-actions/admin/users.ts                                      │
│   src/components/admin/users-table.tsx                                   │
│   src/components/admin/user-edit-form.tsx                                │
│   src/app/admin/users/page.tsx                                           │
│   src/app/admin/users/[id]/page.tsx                                      │
│   src/app/admin/users/new/page.tsx                                       │
│   src/lib/email/templates/user-invite.tsx                                │
│                                                                          │
│ Phase 6.4 — Partners management                                          │
│   src/lib/services/admin/partners.ts                                     │
│   src/server-actions/admin/partners.ts                                   │
│   src/components/admin/partners-table.tsx                                │
│   src/components/admin/partner-edit-form.tsx                             │
│   src/components/admin/partner-create-form.tsx                           │
│   src/app/admin/partners/page.tsx                                        │
│   src/app/admin/partners/[id]/page.tsx                                   │
│   src/app/admin/partners/new/page.tsx                                    │
│                                                                          │
│ Phase 6.5 — Organizations management                                     │
│   src/lib/services/admin/organizations.ts                                │
│   src/server-actions/admin/organizations.ts                              │
│   src/components/admin/organizations-table.tsx                           │
│   src/components/admin/organization-edit-form.tsx                        │
│   src/app/admin/organizations/page.tsx                                   │
│   src/app/admin/organizations/[id]/page.tsx                              │
│                                                                          │
│ Phase 6.6 — Audit log viewer                                             │
│   src/lib/services/admin/auditLog.ts                                     │
│   src/components/admin/audit-log-table.tsx                               │
│   src/components/admin/audit-log-filters.tsx                             │
│   src/app/admin/audit/page.tsx                                           │
│                                                                          │
│ Phase 6.7 — Polish: feature flag + Playwright + smoke + final commit     │
│   src/lib/featureFlags.ts                      (add ADMIN_CABINET flag)  │
│   src/middleware.ts                            (gate /admin behind flag) │
│   src/e2e/snapshots/admin-dashboard.spec.ts                              │
│   src/e2e/snapshots/admin-users.spec.ts                                  │
│   src/e2e/snapshots/admin-audit.spec.ts                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Принципы:**

1. **Без новых пользовательских сценариев в `/partner/*` и `/organization/*`** — план затрагивает только admin-сторону, password reset backend (нужен для invite) и единичный `requireAdmin` рефакторинг существующих admin-страниц.
2. **Каждый task → один git commit.** При падении тестов внутри task — fix-up, не amend.
3. **TDD-light:** для сервисов пишем integration-тесты с live Postgres (как в `services.partner.*`), для server actions — unit с mock prisma. Тесты пишем в той же task, что и реализацию.
4. **Reuse без копирования:** `KpiGrid`, `EventsFeed`, `RateOverrideForm`, `send()` email — импортируем как есть.
5. **Server Actions over API routes** для admin-мутаций.

---

## Метрики приёмки

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings.
- `npm run build` — successful. Новые роуты: `/admin/users`, `/admin/users/[id]`, `/admin/users/new`, `/admin/partners`, `/admin/partners/[id]`, `/admin/partners/new`, `/admin/organizations`, `/admin/organizations/[id]`, `/admin/audit`, `/api/auth/reset-password/request`, `/api/auth/reset-password/confirm`.
- `npm test` — все Phase 5 testbase passing + ожидается +60-80 новых тестов (services, server actions, RBAC, password reset). Итого ~380-400.
- Manual smoke:
  - Создать партнёра через `/admin/partners/new` → получить invite-link (или email если Resend настроен) → reset password → залогиниться как partner-admin → попасть в `/partner/dashboard`.
  - Деактивировать пользователя → после истечения JWT TTL он не может зайти.
  - Открыть `/admin/audit?entity=user&action=user_created` → видим только успешные создания пользователей.
- Playwright: новые snapshots baseline без diff.

## Зависимости (новые)

- Нет новых npm-зависимостей. Используем уже установленные `bcryptjs`, `crypto` (Node-builtin), `zod`, `resend`, `@react-email/components`.
- Новые env: `INVITE_TOKEN_TTL_DAYS` (default `7`).

## Открытые вопросы (не блочат план — defaults из spec §13)

- [ ] Email-шаблон invite текст — финальная редактура копирайта (default: минимальный).
- [ ] Кастомизация sidebar (расположение групп) — по UX-фидбеку после первого rollout.

---

## Bite-sized tasks (для агентов-исполнителей)

## Phase 6.0 — Foundation: миграции + password reset flow

### Task 1: Миграция `passwordHash` nullable

**Files:**
- Create: `prisma/migrations/20260524100000_password_hash_nullable/migration.sql`
- Modify: `prisma/schema.prisma` (line 95: `passwordHash String?`)
- Modify: `src/app/api/auth/login/route.ts` (отклонение при `passwordHash == null` с сообщением «активируйте учётную запись через invite-link»)
- Test: `src/__tests__/auth.login.route.test.ts` (расширить — login отклоняет user без пароля)

- [ ] **Step 1.1**: Изменить `prisma/schema.prisma` — `passwordHash String` → `String?`.
- [ ] **Step 1.2**: Создать миграцию: `npx prisma migrate dev --name password_hash_nullable --create-only`. Проверить SQL: `ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;`.
- [ ] **Step 1.3**: Применить миграцию: `npx prisma migrate dev`.
- [ ] **Step 1.4**: Обновить `src/app/api/auth/login/route.ts` — если `user.passwordHash === null`, вернуть 403 с error `"account_not_activated"`.
- [ ] **Step 1.5**: Добавить тест в `auth.login.route.test.ts`: user с `passwordHash=null` → 403 + error code.
- [ ] **Step 1.6**: `npm test src/__tests__/auth.login.route.test.ts` — все проходят.
- [ ] **Step 1.7 — Commit**: `feat(auth): make passwordHash nullable for invite flow`

### Task 2: Миграция `User.isActive` + `Partner.isActive`

**Files:**
- Create: `prisma/migrations/20260524110000_partner_user_isactive/migration.sql`
- Modify: `prisma/schema.prisma` (добавить `isActive Boolean @default(true)` в User и Partner)
- Modify: `src/lib/auth/session.ts` (при `user.isActive === false` возвращать `null`)
- Test: `src/__tests__/auth.session.test.ts` (новый — session возвращает null для деактивированного user)

- [ ] **Step 2.1**: В `schema.prisma` добавить `isActive Boolean @default(true)` в модели `User` (после `name`) и `Partner` (после `commissionRate`).
- [ ] **Step 2.2**: `npx prisma migrate dev --name partner_user_isactive --create-only`. Проверить, что SQL добавляет колонки с дефолтом `true`.
- [ ] **Step 2.3**: Применить миграцию.
- [ ] **Step 2.4**: В `src/lib/auth/session.ts` после `verifyToken` загрузить user, проверить `isActive`. Если false — return null. Кэширования нет (минимальное усложнение, измерим позже если потребуется).
- [ ] **Step 2.5**: Создать `src/__tests__/auth.session.test.ts`: setup user `isActive=false` → `getSession()` → `expect(result).toBeNull()`.
- [ ] **Step 2.6**: `npm test` — новый тест проходит.
- [ ] **Step 2.7 — Commit**: `feat(auth): add isActive soft delete to User and Partner`

### Task 3: Модель `PasswordResetToken` + миграция

**Files:**
- Create: `prisma/migrations/20260524120000_password_reset_token/migration.sql`
- Modify: `prisma/schema.prisma` (добавить модель PasswordResetToken + back-relation в User)

- [ ] **Step 3.1**: В `schema.prisma` добавить модель `PasswordResetToken` точно как в spec §11.1.C: поля `id, createdAt, token (unique), userId, user, purpose, expiresAt, usedAt`, индексы `userId`, `expiresAt`.
- [ ] **Step 3.2**: Добавить back-relation в `User`: `passwordResetTokens PasswordResetToken[]`.
- [ ] **Step 3.3**: `npx prisma migrate dev --name password_reset_token --create-only`. Проверить SQL.
- [ ] **Step 3.4**: Применить миграцию.
- [ ] **Step 3.5**: `npm run prisma:generate` — обновить Prisma Client.
- [ ] **Step 3.6 — Commit**: `feat(auth): add PasswordResetToken model and migration`

### Task 4: Helper `lib/auth/passwordReset.ts`

**Files:**
- Create: `src/lib/auth/passwordReset.ts`
- Test: `src/__tests__/auth.passwordReset.test.ts`

**Сигнатуры:**
```ts
export async function createInviteToken(
  prisma: PrismaClient,
  userId: string,
  ttlDays?: number  // default из env INVITE_TOKEN_TTL_DAYS, fallback 7
): Promise<{ token: string; expiresAt: Date }>;

export async function verifyAndConsumeToken(
  prisma: PrismaClient,
  token: string,
  newPasswordHash: string
): Promise<{ ok: true; userId: string } | { ok: false; reason: 'not_found' | 'expired' | 'used' }>;
```

- [ ] **Step 4.1**: Реализовать `createInviteToken`: сгенерировать `crypto.randomBytes(32).toString('base64url')`, сохранить с `purpose='invite'` и `expiresAt = now + ttlDays`, вернуть token.
- [ ] **Step 4.2**: Реализовать `verifyAndConsumeToken`: в транзакции — найти token (where unique), проверить `expiresAt > now`, проверить `usedAt is null`. Если ок — update User.passwordHash + PasswordResetToken.usedAt в той же TX. Иначе вернуть reason.
- [ ] **Step 4.3**: Тесты `auth.passwordReset.test.ts`: happy path create+verify; expired token; used token; not found.
- [ ] **Step 4.4**: `npm test src/__tests__/auth.passwordReset.test.ts` — passes.
- [ ] **Step 4.5 — Commit**: `feat(auth): passwordReset helper with create and consume`

### Task 5: API route `POST /api/auth/reset-password/request`

**Files:**
- Create: `src/app/api/auth/reset-password/request/route.ts`
- Test: `src/__tests__/api.reset-password.request.test.ts`

**Контракт:** `POST { email: string } → 200 { ok: true }` (всегда 200 — не leak'аем существование email).

- [ ] **Step 5.1**: Route принимает email, Zod validate. Найти user `where: { email }`.
- [ ] **Step 5.2**: Если user найден и активен — `createInviteToken` с `purpose='reset'`, отправить email через `src/lib/email/send.ts` (если `RESEND_API_KEY` есть; шаблон `password-reset.tsx` — создать минимальный inline в этой же task).
- [ ] **Step 5.3**: Всегда возвращать 200 (anti-enumeration).
- [ ] **Step 5.4**: Тесты: существующий user → email отправлен; несуществующий → 200 без email; деактивированный → 200 без email.
- [ ] **Step 5.5 — Commit**: `feat(auth): POST /api/auth/reset-password/request endpoint`

### Task 6: API route `POST /api/auth/reset-password/confirm`

**Files:**
- Create: `src/app/api/auth/reset-password/confirm/route.ts`
- Test: `src/__tests__/api.reset-password.confirm.test.ts`

**Контракт:** `POST { token: string, newPassword: string } → 200 { ok: true } | 400 { error: 'invalid_token' | 'weak_password' }`.

- [ ] **Step 6.1**: Zod validate `{ token, newPassword (min 8 chars) }`.
- [ ] **Step 6.2**: `bcryptjs.hash(newPassword, 10)` → newHash.
- [ ] **Step 6.3**: `verifyAndConsumeToken(prisma, token, newHash)` → result.
- [ ] **Step 6.4**: Если `result.ok` — `recordAudit('password_reset', { entity: 'user', entityId: userId, status: 'success' })` (helper будет в Task 11; на этой стадии можно прямой `prisma.auditLog.create` с правильной структурой; задействуем helper после рефакторинга в Phase 6.1). Иначе вернуть 400 с error reason.
- [ ] **Step 6.5**: Тесты: happy path; expired token → 400; used token → 400; weak password → 400.
- [ ] **Step 6.6 — Commit**: `feat(auth): POST /api/auth/reset-password/confirm endpoint`

### Task 7: Переписать страницу `/reset-password`

**Files:**
- Modify: `src/app/(auth)/reset-password/page.tsx` (была заглушка)
- Create: `src/components/auth/reset-password-form.tsx` (client component)

- [ ] **Step 7.1**: Server component читает `?token=` из searchParams. Если нет — render «пригласите администратора заново».
- [ ] **Step 7.2**: Если token есть — render `<ResetPasswordForm token={...} />`.
- [ ] **Step 7.3**: `ResetPasswordForm` — client с полями: новый пароль, подтверждение. POST `/api/auth/reset-password/confirm`. На success → redirect на `/login` с toast.
- [ ] **Step 7.4**: Manual smoke: открыть `/reset-password?token=fake` → форма; submit → 400.
- [ ] **Step 7.5 — Commit**: `feat(auth): functional reset-password page with token-based confirm`

### Task 8: Финал Phase 6.0 — lint/typecheck/build/test

- [ ] **Step 8.1**: `npm run typecheck` — 0 errors.
- [ ] **Step 8.2**: `npm run lint` — 0 new warnings.
- [ ] **Step 8.3**: `npm test` — все Phase 5 + новые passing.
- [ ] **Step 8.4**: `npm run build` — successful, новые роуты в выводе.
- [ ] **Step 8.5 — Commit (если есть fix-up)**: `chore(phase6.0): final lint/types polish`. Если ничего не правится — пропустить.

---

## Phase 6.1 — Admin foundation: requireAdmin + recordAudit + AdminAppShell

### Task 9: `requireRole.ts` server-side guards

**Files:**
- Create: `src/lib/auth/requireRole.ts`
- Test: `src/__tests__/auth.requireRole.test.ts`

**Сигнатуры:**
```ts
export async function requireSession(): Promise<Session>;       // throws → redirect('/login')
export async function requireAdmin(): Promise<Session>;
export async function requirePartnerAdmin(): Promise<Session>;
```

- [ ] **Step 9.1**: `requireSession()` — `getSession()`, если null → `redirect('/login')`.
- [ ] **Step 9.2**: `requireAdmin()` — `requireSession()`, проверить `session.role === 'admin'`, иначе redirect.
- [ ] **Step 9.3**: `requirePartnerAdmin()` — проверить `role === 'partner' && partnerRole === 'admin'`.
- [ ] **Step 9.4**: Тесты с mock `next/navigation.redirect` и mock `getSession`.
- [ ] **Step 9.5 — Commit**: `feat(auth): requireRole helpers (requireSession, requireAdmin, requirePartnerAdmin)`

### Task 10: Refactor существующих admin-страниц на `requireAdmin()`

**Files:**
- Modify: `src/app/admin/health/page.tsx`
- Modify: `src/app/admin/sync/page.tsx`
- Modify: `src/app/admin/commission-statements/page.tsx`
- Modify: `src/app/admin/commission-statements/[id]/page.tsx`

- [ ] **Step 10.1**: Заменить во всех 4 файлах:
  ```ts
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/login');
  ```
  на:
  ```ts
  const session = await requireAdmin();
  ```
- [ ] **Step 10.2**: Убедиться, что импорт `getSession` удалён, `requireAdmin` добавлен.
- [ ] **Step 10.3**: Запустить любые существующие admin-тесты — они не должны сломаться.
- [ ] **Step 10.4 — Commit**: `refactor(admin): use requireAdmin guard in existing pages`

### Task 11: `lib/auth/audit.ts` — `recordAudit()` helper

**Files:**
- Create: `src/lib/auth/audit.ts`
- Test: `src/__tests__/auth.recordAudit.test.ts`

**Сигнатура (из spec §10.4):**
```ts
type AuditRecord = {
  userId: string;
  action: string;
  entity: 'user' | 'partner' | 'organization' | 'order' | 'commission_statement' | 'lead' | 'document';
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  status?: 'success' | 'denied';
  reason?: string;
};

export async function recordAudit(prisma: PrismaClient, rec: AuditRecord): Promise<void>;
```

- [ ] **Step 11.1**: Реализовать: `prisma.auditLog.create({ data: { userId, action, entity, entityId, meta: { before, after, status: status ?? 'success', reason } } })`. Поля `before/after/status/reason` идут в `meta` JSON.
- [ ] **Step 11.2**: Тесты — успешная мутация (status=success default); denied мутация (status='denied' в meta); before/after сериализуются.
- [ ] **Step 11.3 — Commit**: `feat(audit): recordAudit helper with unified meta schema`

### Task 12: Backfill — заменить прямые `prisma.auditLog.create` на `recordAudit`

**Files:**
- Modify: все файлы, которые сейчас пишут `auditLog.create` (grep по `auditLog.create`)

- [ ] **Step 12.1**: `grep -rn "auditLog.create" src/` — найти все точки.
- [ ] **Step 12.2**: Заменить каждую на `recordAudit(prisma, { ... })` с правильным маппингом полей.
- [ ] **Step 12.3**: Запустить полный test suite — ничего не должно сломаться.
- [ ] **Step 12.4**: Также обновить Task 6 (password reset confirm) — заменить inline создание на `recordAudit`.
- [ ] **Step 12.5 — Commit**: `refactor(audit): migrate all auditLog.create to recordAudit helper`

### Task 13: `AdminAppShell` + `AdminSidebar`

**Files:**
- Create: `src/components/admin/admin-app-shell.tsx`
- Create: `src/components/admin/admin-sidebar.tsx`
- Test: `src/__tests__/components.admin-sidebar.test.tsx`

- [ ] **Step 13.1**: `AdminAppShell` — server component, рендерит layout 240px sidebar + top bar + content max-w-1280, padding 24px. Принимает `children`. Top-bar показывает email текущего admin + кнопку «Выход» (form action → `/api/auth/logout`).
- [ ] **Step 13.2**: `AdminSidebar` — client component (использует `usePathname()` для active state). Структура: 3 группы (Платформа / Операции / Справочники), 8 ссылок по spec §4.2.
- [ ] **Step 13.3**: Стили: brand colors (`#F97316` оранжевый для active), hover states.
- [ ] **Step 13.4**: Тест: `AdminSidebar` рендерит все 8 ссылок; active class применяется только к одной ссылке.
- [ ] **Step 13.5 — Commit**: `feat(admin): AdminAppShell with role-specific sidebar`

### Task 14: Update `admin/layout.tsx` — использовать AdminAppShell

**Files:**
- Modify: `src/app/admin/layout.tsx`

- [ ] **Step 14.1**: Заменить `<AppShell>{children}</AppShell>` на `<AdminAppShell>{children}</AdminAppShell>`.
- [ ] **Step 14.2**: Запустить dev server, проверить что `/admin/health` рендерит новый sidebar. Все admin-страницы должны загружаться.
- [ ] **Step 14.3 — Commit**: `feat(admin): use AdminAppShell in admin layout`

### Task 15: Deprecated redirects для `/admin/orders` и `/admin/messages`

**Files:**
- Modify: `src/app/admin/orders/page.tsx`
- Modify: `src/app/admin/messages/page.tsx`

- [ ] **Step 15.1**: Каждый файл — `import { redirect } from 'next/navigation'; export default function() { redirect('/admin/dashboard'); }`.
- [ ] **Step 15.2 — Commit**: `chore(admin): redirect deprecated /admin/orders and /admin/messages to dashboard`

---

## Phase 6.2 — Dashboard с реальными метриками

### Task 16: `services/admin/dashboard.ts`

**Files:**
- Create: `src/lib/services/admin/dashboard.ts`
- Test: `src/__tests__/services.admin.dashboard.test.ts`

**Сигнатуры:**
```ts
export type KpiTile = { label: string; value: string | number; delta?: { value: number; positive: boolean } };
export type AttentionItem = { id: string; title: string; href: string; severity: 'warn' | 'urgent' };
export type EventItem = { id: string; actor: string; verb: string; entity: string; entityRef?: string; timestamp: Date };

export async function kpis(prisma: PrismaClient): Promise<KpiTile[]>;
export async function attention(prisma: PrismaClient): Promise<AttentionItem[]>;
export async function recentEvents(prisma: PrismaClient, take?: number): Promise<EventItem[]>;
```

- [ ] **Step 16.1**: `kpis()` — 4 параллельных запроса (см. spec §5.1). Считаем дельту: count за последние 30 дней vs предыдущие 30.
- [ ] **Step 16.2**: `attention()` — sync lag (через `getSyncLag`), DLQ jobs (через `getDlq`), approved statements >7 дней без paid, партнёры без commissionRate (>0).
- [ ] **Step 16.3**: `recentEvents()` — AuditLog orderBy desc, filter action IN (`commission_*`, `partner_created`, `user_role_changed`, `org_rate_override`, `lead_promoted`), include user (actor).
- [ ] **Step 16.4**: Integration-тесты с live PG: пустая БД → KPI все 0, attention пуст, events пуст. Засеять данные → нужные значения.
- [ ] **Step 16.5 — Commit**: `feat(admin): dashboard service with kpis, attention, recent events`

### Task 17: Переписать `/admin/dashboard/page.tsx`

**Files:**
- Modify: `src/app/admin/dashboard/page.tsx` (была декоративная заглушка)

- [ ] **Step 17.1**: Server component, `requireAdmin()` → загрузить kpis/attention/events параллельно через `Promise.all`.
- [ ] **Step 17.2**: Render: `<KpiGrid kpis={k} />` (импорт из `components/partner/kpi-grid.tsx`), `<AttentionList data={a} />` (тоже из partner), `<EventsFeed events={events} />`.
- [ ] **Step 17.3**: Подзаголовок: «Обзор платформы».
- [ ] **Step 17.4**: Manual smoke: `/admin/dashboard` рендерится с реальными данными.
- [ ] **Step 17.5 — Commit**: `feat(admin): real platform dashboard with KPI, attention, events`

---

## Phase 6.3 — Users management

### Task 18: `services/admin/users.ts`

**Files:**
- Create: `src/lib/services/admin/users.ts`
- Test: `src/__tests__/services.admin.users.test.ts`

**Сигнатуры:**
```ts
type ListUsersOptions = {
  role?: Role;
  active?: boolean;
  q?: string;
  partnerId?: string;
  companyId?: string;
  take?: number;
  cursor?: string;
};

export async function listUsers(prisma: PrismaClient, opts: ListUsersOptions): Promise<{ rows: UserRow[]; nextCursor: string | null }>;
export async function getUser(prisma: PrismaClient, id: string): Promise<UserDetail | null>;
export async function updateUser(prisma: PrismaClient, id: string, patch: UpdateUserPatch, actorUserId: string): Promise<UserDetail>;
export async function deactivateUser(prisma: PrismaClient, id: string, actorUserId: string): Promise<void>;
export async function createUser(prisma: PrismaClient, input: CreateUserInput, actorUserId: string): Promise<{ user: UserDetail; inviteUrl: string }>;
```

- [ ] **Step 18.1**: `listUsers` — Zod-validate opts, build `where` (role/active/q ILIKE/partnerId/companyId), take=50 default, cursor-based.
- [ ] **Step 18.2**: `getUser` — `prisma.user.findUnique` с relations (partner, company).
- [ ] **Step 18.3**: `updateUser` — load before, update, `recordAudit('user_updated', { before, after })`. Запрет на role='admin' в patch.
- [ ] **Step 18.4**: `deactivateUser` — `user.update({ isActive: false })` + audit. Запрет self-deactivation (id === actorUserId → throw).
- [ ] **Step 18.5**: `createUser` — Zod validate `role !== 'admin'`, transaction: create user `passwordHash=null`, isActive=true → createInviteToken. Audit `user_created`. Return user + inviteUrl. **Не** шлёт email — это делает action (т.к. сервис чист).
- [ ] **Step 18.6**: Integration-тесты с live PG для каждой функции, включая failure cases (create admin → throws, self-deactivate → throws).
- [ ] **Step 18.7 — Commit**: `feat(admin): users service (list/get/update/deactivate/create)`

### Task 19: `server-actions/admin/users.ts`

**Files:**
- Create: `src/server-actions/admin/users.ts`
- Test: `src/__tests__/server-actions.admin.users.test.ts`

**Actions:**
```ts
export async function createUserAction(formData: FormData): Promise<{ ok: true; inviteUrl?: string } | { ok: false; error: string }>;
export async function updateUserAction(id: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }>;
export async function deactivateUserAction(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
```

- [ ] **Step 19.1**: Каждый action начинается с `requireAdmin()`.
- [ ] **Step 19.2**: `createUserAction` — Zod парсит FormData, зовёт `createUser(...)`, при наличии Resend — `send({ to, react: <UserInvite/>, subject })`, при отсутствии — возвращает inviteUrl как часть результата для отображения в flash. `revalidatePath('/admin/users')`.
- [ ] **Step 19.3**: `updateUserAction` — Zod парсит, `updateUser`, revalidate.
- [ ] **Step 19.4**: `deactivateUserAction` — `deactivateUser`, revalidate.
- [ ] **Step 19.5**: Тесты с mock prisma и mock email: RBAC (требует admin), validation, happy/denied paths.
- [ ] **Step 19.6 — Commit**: `feat(admin): server actions for users (create/update/deactivate)`

### Task 20: Email шаблон `user-invite.tsx`

**Files:**
- Create: `src/lib/email/templates/user-invite.tsx`

- [ ] **Step 20.1**: React Email компонент: header с brand color, заголовок «Вы приглашены в Промтехносферу», текст «Роль: {role}. Активируйте учётную запись:», CTA-кнопка «Установить пароль» с `href={inviteUrl}`.
- [ ] **Step 20.2**: Минимальный inline-стиль (no CSS files); используем `@react-email/components` для совместимости с почтовыми клиентами.
- [ ] **Step 20.3**: Mod в `src/lib/email/send.ts` если нужен новый switch по типу — или просто принимает `react` напрямую (зависит от текущей реализации; проверить файл).
- [ ] **Step 20.4 — Commit**: `feat(email): user-invite template`

### Task 21: Page `/admin/users` (список + фильтры)

**Files:**
- Create: `src/app/admin/users/page.tsx`
- Create: `src/components/admin/users-table.tsx`
- Create: `src/components/admin/users-filter-form.tsx`

- [ ] **Step 21.1**: Page — server component, `requireAdmin()`, парсит URL params в `ListUsersOptions`, вызывает `listUsers`.
- [ ] **Step 21.2**: `UsersFilterForm` — `<form method="get">` с select для role, checkbox active, text input q, dropdown partnerId/companyId. Submit перезагружает страницу с новыми params.
- [ ] **Step 21.3**: `UsersTable` — таблица с colums по spec §6.1, кнопка «Открыть» → `/admin/users/[id]`, link «Создать» → `/admin/users/new` (сверху страницы).
- [ ] **Step 21.4**: Pagination: рендерить кнопку «Дальше» если `nextCursor` есть, link с обновлённым `?cursor=...`.
- [ ] **Step 21.5**: Manual smoke: `/admin/users` показывает таблицу seed-юзеров, фильтр работает.
- [ ] **Step 21.6 — Commit**: `feat(admin): users list page with filters and pagination`

### Task 22: Page `/admin/users/[id]` (редактирование)

**Files:**
- Create: `src/app/admin/users/[id]/page.tsx`
- Create: `src/components/admin/user-edit-form.tsx`

- [ ] **Step 22.1**: Page — server component, `requireAdmin()`, `getUser(id)`. Если null → `notFound()`.
- [ ] **Step 22.2**: `UserEditForm` — client component, controlled inputs для name/role/partnerId/companyId/isActive. `action={updateUserAction.bind(null, id)}`. **Если editing self** — поля role/isActive disabled с подсказкой.
- [ ] **Step 22.3**: Внизу — кнопка «Деактивировать» (опасное действие, modal-confirm) → `deactivateUserAction.bind(null, id)`.
- [ ] **Step 22.4**: Manual smoke: открыть юзера, изменить name → save → обновилось.
- [ ] **Step 22.5 — Commit**: `feat(admin): user edit page with role/scope/active fields`

### Task 23: Page `/admin/users/new` (создание)

**Files:**
- Create: `src/app/admin/users/new/page.tsx`
- Create: `src/components/admin/user-create-form.tsx`

- [ ] **Step 23.1**: Page — server component, `requireAdmin()`, загрузить список Partners и Companies для dropdown.
- [ ] **Step 23.2**: `UserCreateForm` — client, fields email/name/role/partnerId/companyId. Role select **БЕЗ опции admin**.
- [ ] **Step 23.3**: On submit (Server Action) — если успех с `inviteUrl` — render success-card с copy-button. Иначе если email отправлен — render «приглашение отправлено на {email}».
- [ ] **Step 23.4**: Тест: POST с `role='admin'` отклоняется (через тесты server action).
- [ ] **Step 23.5 — Commit**: `feat(admin): user creation page with invite flow`

---

## Phase 6.4 — Partners management

### Task 24: `services/admin/partners.ts`

**Files:**
- Create: `src/lib/services/admin/partners.ts`
- Test: `src/__tests__/services.admin.partners.test.ts`

**Сигнатуры:**
```ts
export async function listPartners(prisma, opts): Promise<{ rows: PartnerRow[]; nextCursor: string | null }>;
export async function getPartner(prisma, id): Promise<PartnerDetail | null>;
export async function updatePartner(prisma, id, patch, actorUserId): Promise<PartnerDetail>;
export async function deactivatePartner(prisma, id, actorUserId): Promise<void>;
export async function createPartnerWithAdmin(prisma, input, actorUserId): Promise<{ partner: PartnerDetail; adminUserId: string; inviteUrl: string }>;
```

- [ ] **Step 24.1**: `listPartners` — фильтры `active`, `filter=norate` (where `commissionRate.equals(0)`), `q` (name/slug ILIKE), join count org/yearTotal через subquery.
- [ ] **Step 24.2**: `getPartner` — fetch partner + список partner-admin users (PartnerUser join).
- [ ] **Step 24.3**: `updatePartner` — slug readonly (если уже не null) — отклонение если patch.slug отличается от текущего. Audit.
- [ ] **Step 24.4**: `deactivatePartner` — `partner.update({ isActive: false })`, audit `partner_deactivated`.
- [ ] **Step 24.5**: `createPartnerWithAdmin` — Prisma transaction:
  1. `partner.create({...})`
  2. `user.create({ role: 'partner', partnerId, passwordHash: null, isActive: true })`
  3. `partnerUser.create({ partnerId, userId, roleInPartner: 'admin', assignedOrgIds: [] })`
  4. `createInviteToken(userId)` → token
  Return объект. Audit `partner_created` вне TX (но в этой же функции).
- [ ] **Step 24.6**: Integration test: createPartnerWithAdmin happy path; падение на step 3 → откат шагов 1-2 (можно симулировать через mock prisma.$transaction reject).
- [ ] **Step 24.7 — Commit**: `feat(admin): partners service (list/get/update/deactivate/createWithAdmin)`

### Task 25: `server-actions/admin/partners.ts`

**Files:**
- Create: `src/server-actions/admin/partners.ts`
- Test: `src/__tests__/server-actions.admin.partners.test.ts`

**Actions:** `createPartnerWithAdminAction`, `updatePartnerAction`, `deactivatePartnerAction`.

- [ ] **Step 25.1**: Каждый action — `requireAdmin()` сначала.
- [ ] **Step 25.2**: `createPartnerWithAdminAction` — Zod parse FormData, зовёт `createPartnerWithAdmin`, шлёт invite email (или возвращает inviteUrl), revalidate `/admin/partners`.
- [ ] **Step 25.3**: `updatePartnerAction` — Zod, update, revalidate.
- [ ] **Step 25.4**: `deactivatePartnerAction` — deactivate, revalidate.
- [ ] **Step 25.5**: Тесты с mock.
- [ ] **Step 25.6 — Commit**: `feat(admin): server actions for partners`

### Task 26: Pages `/admin/partners` (list + edit + new)

**Files:**
- Create: `src/app/admin/partners/page.tsx`
- Create: `src/app/admin/partners/[id]/page.tsx`
- Create: `src/app/admin/partners/new/page.tsx`
- Create: `src/components/admin/partners-table.tsx`
- Create: `src/components/admin/partner-edit-form.tsx`
- Create: `src/components/admin/partner-create-form.tsx`

- [ ] **Step 26.1**: `/admin/partners` — server component с `requireAdmin()`. Парсит URL params (`active`, `filter`, `q`, `cursor`) в `ListPartnersOptions`. Вызывает `listPartners(prisma, opts)`. Рендерит `<PartnersFilterForm/>` (form method=get, поля active/filter/q) над таблицей `<PartnersTable rows={rows}/>`. Внизу кнопка «Следующая» если `nextCursor` есть (link с обновлённым `?cursor=...`). Сверху правый угол — link «Создать партнёра» → `/admin/partners/new`.
- [ ] **Step 26.2**: `/admin/partners/[id]` — `getPartner`, рендер `<PartnerEditForm/>` + список partner-admin users (read-only с link на `/admin/users/[id]`).
- [ ] **Step 26.3**: `/admin/partners/new` — `<PartnerCreateForm/>` — fields: legalName, slug, commissionRate, +partner-admin email/name. Server Action target.
- [ ] **Step 26.4**: На success возвращает inviteUrl/email-sent статус (как в users/new).
- [ ] **Step 26.5**: Manual smoke: создать партнёра → получить link → пройти reset-password → залогиниться.
- [ ] **Step 26.6 — Commit**: `feat(admin): partners pages (list/edit/new with combined admin invite)`

---

## Phase 6.5 — Organizations management

### Task 27: `services/admin/organizations.ts`

**Files:**
- Create: `src/lib/services/admin/organizations.ts`
- Test: `src/__tests__/services.admin.organizations.test.ts`

**Сигнатуры:**
```ts
export async function listOrganizations(prisma, opts): Promise<{ rows; nextCursor }>;
export async function getOrganization(prisma, id): Promise<OrganizationDetail | null>;
export async function updateOrganization(prisma, id, patch, actorUserId): Promise<OrganizationDetail>;
```

- [ ] **Step 27.1**: `listOrganizations` — filter `partnerId`, `withRateOverride`, `q` (name/inn ILIKE), join count Orders.
- [ ] **Step 27.2**: `getOrganization` — include partner, company, assigned manager (User).
- [ ] **Step 27.3**: `updateOrganization` — patch только разрешённых полей (legalName/inn/kpp/assignedManagerUserId). Audit `organization_updated`.
- [ ] **Step 27.4**: Integration tests.
- [ ] **Step 27.5 — Commit**: `feat(admin): organizations service`

### Task 28: `server-actions/admin/organizations.ts`

**Files:**
- Create: `src/server-actions/admin/organizations.ts`

- [ ] **Step 28.1**: `updateOrganizationAction(id, formData)` — `requireAdmin()`, Zod, `updateOrganization`, revalidate.
- [ ] **Step 28.2**: Тесты.
- [ ] **Step 28.3 — Commit**: `feat(admin): server actions for organizations`

### Task 29: Pages `/admin/organizations` (list + edit)

**Files:**
- Create: `src/app/admin/organizations/page.tsx`
- Create: `src/app/admin/organizations/[id]/page.tsx`
- Create: `src/components/admin/organizations-table.tsx`
- Create: `src/components/admin/organization-edit-form.tsx`

- [ ] **Step 29.1**: `/admin/organizations` — list с фильтрами в URL, pagination.
- [ ] **Step 29.2**: `/admin/organizations/[id]` — `<OrganizationEditForm/>` + переиспользуется `<RateOverrideForm/>` из `components/partner/rate-override-form.tsx`. RateOverride использует тот же `setRateOverride` service.
- [ ] **Step 29.3**: Никакой страницы `/new` — создание организации не входит в MVP scope (приходит из 1С).
- [ ] **Step 29.4**: Manual smoke: открыть organization → изменить inn → save; override rate → audit фиксируется.
- [ ] **Step 29.5 — Commit**: `feat(admin): organizations pages (list/edit) with reused RateOverrideForm`

---

## Phase 6.6 — Audit log viewer

### Task 30: `services/admin/auditLog.ts`

**Files:**
- Create: `src/lib/services/admin/auditLog.ts`
- Test: `src/__tests__/services.admin.auditLog.test.ts`

**Сигнатуры:**
```ts
type AuditFilters = {
  entity?: string;
  action?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  q?: string;        // ILIKE по meta::text
  before?: string;   // cursor
  take?: number;     // default 50
};

export async function listAudit(prisma, filters: AuditFilters): Promise<{ rows: AuditRow[]; nextCursor: string | null }>;
export async function listAuditFilters(prisma): Promise<{ actions: string[]; entities: string[]; actors: { id: string; email: string }[] }>;
```

- [ ] **Step 30.1**: `listAudit` — build where, cursor-based pagination by id, include user (actor).
- [ ] **Step 30.2**: Для `q`: использовать `prisma.$queryRaw` или `where: { meta: { path: ..., string_contains: q } }` — выбрать вариант который точно работает на Postgres + Prisma. Если сложно — fallback на `WHERE meta::text ILIKE ` через raw.
- [ ] **Step 30.3**: `listAuditFilters` — distinct queries для actions, entities; top-50 actors по count(audit).
- [ ] **Step 30.4**: Tests с засеянным AuditLog: фильтр по entity, action, actorUserId, диапазон дат, q.
- [ ] **Step 30.5 — Commit**: `feat(admin): audit log service with filters and cursor pagination`

### Task 31: Page `/admin/audit`

**Files:**
- Create: `src/app/admin/audit/page.tsx`
- Create: `src/components/admin/audit-log-table.tsx`
- Create: `src/components/admin/audit-log-filters.tsx`
- Create: `src/components/admin/audit-log-meta-popover.tsx` (client, expand JSON)

- [ ] **Step 31.1**: Page — server, `requireAdmin()`, parse URL params, `listAudit` + `listAuditFilters`.
- [ ] **Step 31.2**: `<AuditLogFilters/>` — `<form method="get">` с dropdown entity, action, actor, date range, text q.
- [ ] **Step 31.3**: `<AuditLogTable/>` — таблица. Колонка «Diff» — кнопка «Показать», открывает `<AuditLogMetaPopover/>` с raw JSON `meta.before / meta.after` через `<pre>`.
- [ ] **Step 31.4**: Pagination: «Дальше» с `?before=<cursor>`.
- [ ] **Step 31.5**: Manual smoke: открыть audit → видим записи; фильтр работает; popover показывает JSON.
- [ ] **Step 31.6 — Commit**: `feat(admin): audit log viewer page with filters and meta popover`

---

## Phase 6.7 — Polish: feature flag, Playwright, smoke, final

### Task 32: Feature flag `ADMIN_CABINET`

**Files:**
- Modify: `src/lib/featureFlags.ts` (добавить `'admin_cabinet'` в union тип и env-маппинг)
- Modify: `src/middleware.ts` (добавить в `FEATURE_PREFIXES`: `{ prefix: '/admin/users', flag: 'admin_cabinet' }`, то же для `partners/organizations/audit`)
- Modify: `.env.example` (добавить `FEATURE_ADMIN_CABINET=1`)

- [ ] **Step 32.1**: Расширить `FeatureFlag` union: `'admin_cabinet'`.
- [ ] **Step 32.2**: Mapping в `isFeatureEnabled`: `admin_cabinet` → `process.env.FEATURE_ADMIN_CABINET === '1'`.
- [ ] **Step 32.3**: В middleware добавить 4 префикса (users/partners/organizations/audit). Дашборд, health, sync, commission-statements **не** гейтятся (они уже работали в Phase 5).
- [ ] **Step 32.4**: Тест в `featureFlags.test.ts` или middleware test: при `FEATURE_ADMIN_CABINET=0` доступ к `/admin/users` → 404.
- [ ] **Step 32.5 — Commit**: `feat(flags): ADMIN_CABINET feature flag gating new admin pages`

### Task 33: Playwright snapshots admin

**Files:**
- Create: `src/e2e/snapshots/admin-dashboard.spec.ts`
- Create: `src/e2e/snapshots/admin-users.spec.ts`
- Create: `src/e2e/snapshots/admin-audit.spec.ts`

- [ ] **Step 33.1**: Использовать существующий `auth.setup.ts`, добавить storageState для admin user (или дополнить setup для admin login).
- [ ] **Step 33.2**: Spec dashboard: login → goto `/admin/dashboard` → snapshot для desktop + mobile.
- [ ] **Step 33.3**: Spec users: goto `/admin/users` → snapshot. Опционально — после фильтра.
- [ ] **Step 33.4**: Spec audit: goto `/admin/audit` → snapshot.
- [ ] **Step 33.5**: Первый прогон создаёт baselines. Commit baselines в репо.
- [ ] **Step 33.6 — Commit**: `test(e2e): visual regression for admin dashboard, users, audit`

### Task 34: Manual smoke + financial check + final

- [ ] **Step 34.1**: `npm run typecheck` → 0 errors.
- [ ] **Step 34.2**: `npm run lint` → 0 new warnings.
- [ ] **Step 34.3**: `npm test` → все ~380-400 passing.
- [ ] **Step 34.4**: `npm run build` → successful, все новые роуты в выводе.
- [ ] **Step 34.5**: Manual smoke walkthrough:
  - `/admin/dashboard` — KPI, attention, events рендерятся.
  - Создать партнёра через `/admin/partners/new` → invite-link/email → reset-password → залогиниться как partner-admin → `/partner/dashboard` доступен.
  - Создать пользователя через `/admin/users/new` с role=manager → invite → login → `/manager/dashboard` доступен.
  - Деактивировать пользователя → подождать 1ч (или вручную истечь JWT в DevTools) → redirect на /login.
  - Открыть `/admin/audit?entity=user` → видим записи `user_created`, `user_updated`.
- [ ] **Step 34.6 — Final commit (если что-то правится)**: `chore(phase6): final polish`. Если нет — пропустить.

---

## Что НЕ делаем в Phase 6 (отложено)

- Достройка organization/manager/student кабинетов — отдельные Phase 7+.
- Удаление legacy `/api/orders`, `/api/documents`, `/api/dashboard` — отдельный refactor.
- Sessions table для революции JWT — отдельный спек.
- UI для feature flags (toggle через UI) — Phase 7+.
- Bulk actions в admin.
- Mobile полировка admin страниц.
- Hard delete операций в UI.
- Email change через UI (только через CLI).
- Partner slug change через UI.

## Сознательные упрощения Phase 6

1. **Audit `meta::text ILIKE` без GIN-индекса** — для MVP достаточно. Если станет медленно — добавим миграцией.
2. **JWT TTL = единственный механизм session revocation** — после deactivate user может ещё ~час использовать токен. Sessions table — отдельный спек.
3. **No password complexity rules beyond min 8 chars** — отложено до бизнес-требования.
4. **No invite-link expiry warning UI** — admin видит результат `inviteUrl` или `sentEmail` в flash, но без TTL-индикатора.
5. **AdminAppShell — desktop-only.** Mobile breakpoints не оптимизированы (admin работает с десктопа).
6. **Server actions используют `revalidatePath`**, без `revalidateTag` (тэги не настроены в проекте).
7. **No optimistic UI** в admin — после action → full page reload через redirect/revalidate. Простоeer и достаточно для admin UX.

---

**После завершения**: PR на main, заголовок `feat(phase6): MVP admin cabinet — layout, dashboard, users/partners/orgs CRUD, audit log`. После merge → admin team получает рабочий кабинет и можно начинать Phase 7 (достройка organization/manager/student кабинетов).
