# Admin Cabinet Phase 6.3–6.7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть admin-кабинет: добавить full CRUD по Users / Partners, edit-форму для Organizations, audit-log viewer с фильтрами и секрет-маскированием, e2e snapshots. Без feature flag.

**Architecture:** 5 последовательных PR'ов в `main`. Зеркало Phase 7 / Phase 8 паттернов: Result-тип в сервисах с typed error class (по образцу `OrgMemberError`), server actions как тонкий адаптер с zod validation + `mapXxxError`, sibling components в `src/components/admin/*`, server actions в `src/server-actions/admin/*`. Cursor pagination для audit (отличие от skip/take везде ещё). Defense-in-depth: middleware + `requireAdmin()` + service-layer чекpoint'ы.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, Prisma (PostgreSQL), Vitest, Playwright, Resend (email), Server Actions. **Без новых npm-зависимостей.**

**Spec reference:** [docs/superpowers/specs/2026-05-29-admin-cabinet-6.3-6.7-design.md](../specs/2026-05-29-admin-cabinet-6.3-6.7-design.md)

**Branch strategy:**
- PR-1: `git fetch origin main && git checkout -b claude/admin-6.3-users origin/main`
- PR-2: после merge PR-1: `git fetch origin main && git checkout -b claude/admin-6.4-partners origin/main`
- PR-3: после merge PR-2: `git fetch origin main && git checkout -b claude/admin-6.5-orgs-delta origin/main`
- PR-4: после merge PR-3: `git fetch origin main && git checkout -b claude/admin-6.6-audit origin/main`
- PR-5: после merge PR-4: `git fetch origin main && git checkout -b claude/admin-6.7-polish origin/main`

PR-3 и PR-4 теоретически параллельны PR-1/PR-2, но за чистоту истории merge'им последовательно.

---

## Архитектура (карта изменений)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PR-1 — 6.3 Users management                                              │
│   src/lib/services/admin/users.ts            (NEW)                       │
│   src/server-actions/admin/users.ts          (NEW)                       │
│   src/lib/email/templates/admin-user-invite.tsx  (NEW)                   │
│   src/lib/email/send.ts                      (+sendAdminUserInviteEmail) │
│   src/app/admin/users/page.tsx               (NEW)                       │
│   src/app/admin/users/new/page.tsx           (NEW)                       │
│   src/app/admin/users/[id]/page.tsx          (NEW)                       │
│   src/components/admin/users-table.tsx       (NEW, server)               │
│   src/components/admin/users-filters.tsx     (NEW, server)               │
│   src/components/admin/user-edit-form.tsx    (NEW, client)               │
│   src/components/admin/user-invite-form.tsx  (NEW, client modal)         │
│                                                                          │
│ PR-2 — 6.4 Partners management                                           │
│   src/lib/services/admin/partners.ts         (NEW)                       │
│   src/server-actions/admin/partners.ts       (NEW)                       │
│   src/app/admin/partners/page.tsx            (NEW)                       │
│   src/app/admin/partners/new/page.tsx        (NEW)                       │
│   src/app/admin/partners/[id]/page.tsx       (NEW)                       │
│   src/components/admin/partners-table.tsx    (NEW)                       │
│   src/components/admin/partners-filters.tsx  (NEW)                       │
│   src/components/admin/partner-edit-form.tsx (NEW)                       │
│   src/components/admin/partner-create-form.tsx (NEW)                     │
│                                                                          │
│ PR-3 — 6.5 Organizations delta                                           │
│   src/lib/services/admin/organizations.ts    (NEW)                       │
│   src/server-actions/admin/organizations.ts  (NEW)                       │
│   src/components/admin/organization-edit-form.tsx (NEW)                  │
│   src/components/admin/admin-rate-override-form.tsx (NEW, sibling)       │
│   src/app/admin/organizations/page.tsx       (MODIFY: filters расширены) │
│   src/app/admin/organizations/[id]/page.tsx  (MODIFY: +edit + override)  │
│                                                                          │
│ PR-4 — 6.6 Audit viewer                                                  │
│   src/lib/services/admin/auditLog.ts         (NEW)                       │
│   src/app/admin/audit/page.tsx               (NEW)                       │
│   src/components/admin/audit-log-filters.tsx (NEW, server)               │
│   src/components/admin/audit-log-table.tsx   (NEW, server)               │
│   src/components/admin/audit-diff-dialog.tsx (NEW, client modal)         │
│                                                                          │
│ PR-5 — 6.7 Polish                                                        │
│   src/app/admin/dashboard/page.tsx           (MODIFY: drill-down links)  │
│   prisma/seed.ts                             (MODIFY: admin fixtures)    │
│   src/e2e/auth.setup.ts                      (MODIFY: admin block)       │
│   playwright.config.ts                       (MODIFY: admin projects)    │
│   src/e2e/snapshots/admin-users.spec.ts      (NEW)                       │
│   src/e2e/snapshots/admin-partners.spec.ts   (NEW)                       │
│   src/e2e/snapshots/admin-organizations-edit.spec.ts (NEW)               │
│   src/e2e/snapshots/admin-audit.spec.ts      (NEW)                       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Принципы:**

1. **Каждая task — один git commit.** При падении тестов внутри task — fix-up, не amend.
2. **TDD-light:** для service-функций пишем unit-тест ДО реализации; для server actions — unit с mock prisma; для UI — обычно skip, кроме критичных компонентов (форма, secret-masking).
3. **Sibling components (`admin-*`) по правилу `feedback-component-reuse`:** не пытаемся share с `org-*` / `partner-*` формами.
4. **Server Actions over API routes** для мутаций.
5. **`requireAdmin()` first call** во всех server-actions и страницах.
6. **Audit на каждую мутацию** через `recordAudit` в той же транзакции.
7. **Sidebar НЕ трогаем** — все 11 ссылок уже прописаны в [admin-sidebar.tsx](../../src/components/admin/admin-sidebar.tsx).
8. **Spec-driven errors** — error codes из spec (`forbidden`, `not_found`, `admin_role_via_ui`, `self_action_forbidden`, `last_admin_protected`, `duplicate_email`, `duplicate_slug`) — стабильные строки, не меняй.

---

## Метрики приёмки (после merge всех 5 PR)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings.
- `npm run test:unit` — ~1050 passing (от baseline 956).
- `npm run test:integration` — passing (если live PG доступен).
- `npm run build` — successful. Новые роуты: `/admin/users`, `/admin/users/new`, `/admin/users/[id]`, `/admin/partners`, `/admin/partners/new`, `/admin/partners/[id]`, `/admin/audit`. Обновлённые: `/admin/organizations`, `/admin/organizations/[id]`, `/admin/dashboard`.
- `npm run dev` boot check — нет startup errors.
- Manual smoke per-PR (см. spec §12.3).

## Зависимости

**Без новых npm-пакетов.** Уже установлены: `zod`, `resend`, `@react-email/components`, `@prisma/client`, `bcryptjs`, `react`.

**Новые env:** нет.

## Открытые вопросы (не блочат план — defaults из spec §13)

- [ ] AuditLog meta `q` ILIKE indexing — отложено до измеримой проблемы.
- [ ] Каскадная деактивация User'ов при `deactivatePartner` — не в MVP.
- [ ] Sessions revocation после deactivate — полагаемся на JWT TTL.

---

## Bite-sized tasks

> **Соглашение по тестам:** unit-тест и реализация — в одной task; запускаем `npm run test:unit -- <file-pattern>` для быстрой проверки. Полный `npm run test:unit` — в финальной task PR'а.

> **Соглашение по импортам:** все импорты — через alias `@/...`. Никогда не используем относительные пути за пределами одного компонента.

> **Соглашение по комментариям:** не пишем JSDoc / inline-комментарии в новом коде, кроме случаев когда нужно объяснить «почему» (не «что»). Per CLAUDE.md.

---

# PR-1 — 6.3 Users management

### Task 1: Service skeleton + типы + `listUsers`

**Files:**
- Create: `src/lib/services/admin/users.ts`
- Test: `src/__tests__/services.admin.users.test.ts`

- [ ] **Step 1.1**: Создать файл `src/lib/services/admin/users.ts` с типами:
  ```ts
  import type { PrismaClient, Prisma, Role } from '@prisma/client';
  import { createInviteToken } from '@/lib/auth/passwordReset';
  import { recordAudit } from '@/lib/auth/audit';

  export type AdminUserErrorCode =
    | 'forbidden'
    | 'not_found'
    | 'admin_role_via_ui'
    | 'self_action_forbidden'
    | 'last_admin_protected'
    | 'duplicate_email';

  export class AdminUserError extends Error {
    readonly code: AdminUserErrorCode;
    constructor(code: AdminUserErrorCode) {
      super(code);
      this.code = code;
      this.name = 'AdminUserError';
    }
  }

  export type UserFilters = {
    role?: Role;
    active?: boolean;
    q?: string;
    partnerId?: string;
    organizationId?: string;
    take?: number;
    skip?: number;
  };

  export type UserRow = {
    id: string;
    email: string;
    name: string;
    role: Role;
    isActive: boolean;
    createdAt: Date;
    attachmentLabel: string;
  };

  function computeAttachmentLabel(u: {
    role: Role;
    partner: { name: string } | null;
    organizationMemberships: Array<{ organization: { name: string } }>;
    organizationManagerships: Array<{ organization: { name: string } }>;
    studentLink: { organization: { name: string } } | null;
  }): string {
    if (u.role === 'partner') return u.partner?.name ?? '—';
    if (u.role === 'organization') {
      const first = u.organizationMemberships[0]?.organization.name;
      const extra = u.organizationMemberships.length - 1;
      return first ? (extra > 0 ? `${first} (+${extra})` : first) : '—';
    }
    if (u.role === 'manager') {
      const first = u.organizationManagerships[0]?.organization.name;
      const extra = u.organizationManagerships.length - 1;
      return first ? (extra > 0 ? `${first} (+${extra})` : first) : '—';
    }
    if (u.role === 'student') return u.studentLink?.organization.name ?? '—';
    return '—';
  }
  ```
  Прим.: проверь точные имена back-relations в `schema.prisma` (модель `User`): возможно `partner`, `organizationMemberships`, `organizationManagerships`, `studentLink` — будут другие. Адаптируй имена сообразно реальной schema.

- [ ] **Step 1.2**: Добавить `listUsers`:
  ```ts
  export async function listUsers(
    prisma: PrismaClient,
    filters: UserFilters
  ): Promise<{ rows: UserRow[]; total: number }> {
    const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
    const skip = Math.max(filters.skip ?? 0, 0);

    const where: Prisma.UserWhereInput = {};
    if (filters.role) where.role = filters.role;
    if (filters.active !== undefined) where.isActive = filters.active;
    if (filters.q) {
      where.OR = [
        { email: { contains: filters.q, mode: 'insensitive' } },
        { name: { contains: filters.q, mode: 'insensitive' } }
      ];
    }
    if (filters.partnerId) where.partnerId = filters.partnerId;
    if (filters.organizationId) {
      where.OR = [
        ...(where.OR ?? []),
        { organizationMemberships: { some: { organizationId: filters.organizationId } } },
        { organizationManagerships: { some: { organizationId: filters.organizationId } } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          partner: { select: { name: true } },
          organizationMemberships: {
            where: { isActive: true },
            include: { organization: { select: { name: true } } }
          },
          organizationManagerships: {
            where: { isActive: true },
            include: { organization: { select: { name: true } } }
          },
          studentLink: { include: { organization: { select: { name: true } } } }
        },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        take,
        skip
      }),
      prisma.user.count({ where })
    ]);

    const rows: UserRow[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      attachmentLabel: computeAttachmentLabel(u as Parameters<typeof computeAttachmentLabel>[0])
    }));

    return { rows, total };
  }
  ```

- [ ] **Step 1.3**: Написать тест `src/__tests__/services.admin.users.test.ts`. Mock-подход см. эталон [src/__tests__/services.admin.dashboard.test.ts](../../src/__tests__/services.admin.dashboard.test.ts):
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { listUsers } from '@/lib/services/admin/users';

  describe('listUsers', () => {
    it('фильтрует по role и active', async () => {
      const prisma = {
        user: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0)
        }
      } as unknown as Parameters<typeof listUsers>[0];

      await listUsers(prisma, { role: 'partner', active: true });

      const findManyArgs = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(findManyArgs.where).toMatchObject({ role: 'partner', isActive: true });
    });

    it('собирает OR-clause для q-поиска по email и name', async () => {
      const prisma = {
        user: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0)
        }
      } as unknown as Parameters<typeof listUsers>[0];

      await listUsers(prisma, { q: 'foo' });

      const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(args.where.OR).toEqual(
        expect.arrayContaining([
          { email: { contains: 'foo', mode: 'insensitive' } },
          { name: { contains: 'foo', mode: 'insensitive' } }
        ])
      );
    });

    it('возвращает attachmentLabel для partner', async () => {
      const prisma = {
        user: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'u1',
              email: 'p@x',
              name: 'P',
              role: 'partner',
              isActive: true,
              createdAt: new Date(),
              partner: { name: 'Acme' },
              organizationMemberships: [],
              organizationManagerships: [],
              studentLink: null
            }
          ]),
          count: vi.fn().mockResolvedValue(1)
        }
      } as unknown as Parameters<typeof listUsers>[0];

      const { rows } = await listUsers(prisma, {});
      expect(rows[0].attachmentLabel).toBe('Acme');
    });
  });
  ```

- [ ] **Step 1.4**: `npm run test:unit -- services.admin.users` — все ✓.

- [ ] **Step 1.5**: `npm run typecheck` — 0 errors.

- [ ] **Step 1.6 — Commit:**
  ```bash
  git add src/lib/services/admin/users.ts src/__tests__/services.admin.users.test.ts
  git commit -m "feat(admin): listUsers service with filters + types"
  ```

### Task 2: `getUser` + `createUser`

**Files:**
- Modify: `src/lib/services/admin/users.ts`
- Modify: `src/__tests__/services.admin.users.test.ts`

- [ ] **Step 2.1**: Добавить `UserDetail` тип и `getUser`:
  ```ts
  export type UserDetail = UserRow & {
    partnerId: string | null;
    organizationMemberships: Array<{
      organizationUserId: string;
      organizationId: string;
      organizationName: string;
      roleInOrg: string;
      isActive: boolean;
    }>;
    organizationManagerships: Array<{
      organizationManagerId: string;
      organizationId: string;
      organizationName: string;
      isActive: boolean;
    }>;
    studentLink: { organizationId: string; organizationName: string } | null;
  };

  export async function getUser(
    prisma: PrismaClient,
    id: string
  ): Promise<UserDetail | null> {
    const u = await prisma.user.findUnique({
      where: { id },
      include: {
        partner: { select: { name: true } },
        organizationMemberships: {
          include: { organization: { select: { id: true, name: true } } }
        },
        organizationManagerships: {
          include: { organization: { select: { id: true, name: true } } }
        },
        studentLink: { include: { organization: { select: { id: true, name: true } } } }
      }
    });
    if (!u) return null;

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      attachmentLabel: computeAttachmentLabel(u as Parameters<typeof computeAttachmentLabel>[0]),
      partnerId: u.partnerId,
      organizationMemberships: u.organizationMemberships.map((m) => ({
        organizationUserId: m.id,
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        roleInOrg: m.roleInOrg,
        isActive: m.isActive
      })),
      organizationManagerships: u.organizationManagerships.map((m) => ({
        organizationManagerId: m.id,
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        isActive: m.isActive
      })),
      studentLink: u.studentLink
        ? { organizationId: u.studentLink.organizationId, organizationName: u.studentLink.organization.name }
        : null
    };
  }
  ```

- [ ] **Step 2.2**: Добавить `createUser`:
  ```ts
  export type CreateUserArgs = {
    email: string;
    name: string;
    role: Exclude<Role, 'admin'>;
    partnerId?: string | null;
  };

  export type CreateUserResult = {
    user: { id: string; email: string; name: string; role: Role };
    inviteToken: string;
  };

  export async function createUser(
    prisma: PrismaClient,
    actorUserId: string,
    args: CreateUserArgs
  ): Promise<CreateUserResult> {
    if (args.role === ('admin' as Role)) {
      throw new AdminUserError('admin_role_via_ui');
    }
    if (args.role === 'partner' && !args.partnerId) {
      throw new AdminUserError('not_found');
    }

    return prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: args.email } });
      if (existing) throw new AdminUserError('duplicate_email');

      const user = await tx.user.create({
        data: {
          email: args.email,
          name: args.name,
          role: args.role,
          partnerId: args.partnerId ?? null,
          passwordHash: null,
          isActive: true
        }
      });

      if (args.role === 'partner' && args.partnerId) {
        await tx.partnerUser.create({
          data: {
            userId: user.id,
            partnerId: args.partnerId,
            roleInPartner: 'member',
            assignedOrgIds: []
          }
        });
      }

      const { token } = await createInviteToken(tx, user.id);

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_created',
        entity: 'user',
        entityId: user.id,
        after: {
          email: args.email,
          role: args.role,
          partnerId: args.partnerId ?? null
        }
      });

      return {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        inviteToken: token
      };
    });
  }
  ```

- [ ] **Step 2.3**: Тесты:
  ```ts
  describe('createUser', () => {
    it('бросает admin_role_via_ui при попытке role=admin', async () => {
      const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof createUser>[0];
      await expect(
        createUser(prisma, 'actor', { email: 'a@x', name: 'A', role: 'admin' as never })
      ).rejects.toMatchObject({ code: 'admin_role_via_ui' });
    });

    it('бросает duplicate_email при существующем email', async () => {
      const txMock = {
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) }
      };
      const prisma = {
        $transaction: vi.fn().mockImplementation((cb) => cb(txMock))
      } as unknown as Parameters<typeof createUser>[0];

      await expect(
        createUser(prisma, 'actor', { email: 'a@x', name: 'A', role: 'organization' })
      ).rejects.toMatchObject({ code: 'duplicate_email' });
    });

    // Smoke happy path test
    it('создаёт user + invite token, пишет audit', async () => {
      const created = { id: 'u1', email: 'a@x', name: 'A', role: 'organization' };
      const txMock = {
        user: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(created)
        },
        partnerUser: { create: vi.fn() },
        passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn() }
      };
      const prisma = {
        $transaction: vi.fn().mockImplementation((cb) => cb(txMock))
      } as unknown as Parameters<typeof createUser>[0];

      const result = await createUser(prisma, 'actor', { email: 'a@x', name: 'A', role: 'organization' });
      expect(result.user).toMatchObject(created);
      expect(result.inviteToken).toBeTruthy();
      expect(txMock.auditLog.create).toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2.4**: `npm run test:unit -- services.admin.users` — ✓.

- [ ] **Step 2.5 — Commit:**
  ```bash
  git add src/lib/services/admin/users.ts src/__tests__/services.admin.users.test.ts
  git commit -m "feat(admin): getUser + createUser with anti-escalation + duplicate-email guard"
  ```

### Task 3: `updateUser` + `assertNotLastActiveAdmin`

**Files:**
- Modify: `src/lib/services/admin/users.ts`
- Modify: `src/__tests__/services.admin.users.test.ts`

- [ ] **Step 3.1**: Добавить helper:
  ```ts
  async function assertNotLastActiveAdmin(
    tx: Prisma.TransactionClient,
    candidateUserId: string
  ): Promise<void> {
    const remaining = await tx.user.count({
      where: { role: 'admin', isActive: true, NOT: { id: candidateUserId } }
    });
    if (remaining === 0) {
      throw new AdminUserError('last_admin_protected');
    }
  }
  ```

- [ ] **Step 3.2**: Добавить `updateUser` (ограниченные role transitions per spec §4.6):
  ```ts
  export type UpdateUserArgs = {
    name?: string;
    role?: Exclude<Role, 'admin'>;
    partnerId?: string | null;
    isActive?: boolean;
  };

  const ALLOWED_TRANSITIONS: ReadonlyArray<[Role, Role]> = [
    ['partner', 'partner'],
    ['partner', 'student'],
    ['student', 'partner']
  ];

  function isAllowedRoleTransition(from: Role, to: Role): boolean {
    if (from === to) return true;
    return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
  }

  export async function updateUser(
    prisma: PrismaClient,
    actorUserId: string,
    id: string,
    args: UpdateUserArgs
  ): Promise<UserDetail> {
    if (id === actorUserId && (args.role !== undefined || args.isActive === false)) {
      throw new AdminUserError('self_action_forbidden');
    }
    if (args.role === ('admin' as Role)) {
      throw new AdminUserError('admin_role_via_ui');
    }

    return prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, isActive: true, partnerId: true, name: true }
      });
      if (!before) throw new AdminUserError('not_found');

      // Role transition gates
      if (args.role && args.role !== before.role) {
        if (!isAllowedRoleTransition(before.role, args.role)) {
          throw new AdminUserError('not_found'); // misleading code, but better surface: keep as not_found for UI? Better — extend error union.
        }
      }

      // Last-admin protection
      if (before.role === 'admin' && (args.role !== undefined || args.isActive === false)) {
        await assertNotLastActiveAdmin(tx, id);
      }

      // Partner cleanup if changing away from partner
      if (before.role === 'partner' && args.role && args.role !== 'partner') {
        await tx.partnerUser.deleteMany({ where: { userId: id } });
      }
      // Partner attach if changing TO partner
      if (args.role === 'partner' && args.partnerId && before.role !== 'partner') {
        await tx.partnerUser.create({
          data: { userId: id, partnerId: args.partnerId, roleInPartner: 'member', assignedOrgIds: [] }
        });
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.role !== undefined ? { role: args.role } : {}),
          ...(args.partnerId !== undefined ? { partnerId: args.partnerId } : {}),
          ...(args.isActive !== undefined ? { isActive: args.isActive } : {})
        }
      });

      const isRoleChange = args.role !== undefined && args.role !== before.role;
      await recordAudit(tx, {
        userId: actorUserId,
        action: isRoleChange ? 'user_role_changed' : 'user_updated',
        entity: 'user',
        entityId: id,
        before: { role: before.role, isActive: before.isActive, partnerId: before.partnerId, name: before.name },
        after: { role: updated.role, isActive: updated.isActive, partnerId: updated.partnerId, name: updated.name }
      });

      const detail = await getUser(tx as unknown as PrismaClient, id);
      return detail!;
    });
  }
  ```

  **Замечание:** `not_found` ошибка для запрещённой role-transition сбивает с толку. Лучше расширить `AdminUserErrorCode` новым кодом `role_transition_forbidden`. Если согласовано — добавь в Step 3.1.

- [ ] **Step 3.3**: Тесты:
  ```ts
  describe('updateUser', () => {
    it('бросает self_action_forbidden при изменении своей роли', async () => {
      const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof updateUser>[0];
      await expect(
        updateUser(prisma, 'me', 'me', { role: 'organization' })
      ).rejects.toMatchObject({ code: 'self_action_forbidden' });
    });

    it('бросает admin_role_via_ui при попытке role=admin', async () => {
      const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof updateUser>[0];
      await expect(
        updateUser(prisma, 'a', 'b', { role: 'admin' as never })
      ).rejects.toMatchObject({ code: 'admin_role_via_ui' });
    });

    it('бросает last_admin_protected при попытке deactivate последнего active admin', async () => {
      const txMock = {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'u1', role: 'admin', isActive: true, partnerId: null, name: 'X'
          }),
          count: vi.fn().mockResolvedValue(0) // no other active admins
        }
      };
      const prisma = {
        $transaction: vi.fn().mockImplementation((cb) => cb(txMock))
      } as unknown as Parameters<typeof updateUser>[0];

      await expect(
        updateUser(prisma, 'actor', 'u1', { isActive: false })
      ).rejects.toMatchObject({ code: 'last_admin_protected' });
    });
  });
  ```

- [ ] **Step 3.4**: `npm run test:unit -- services.admin.users` — ✓.

- [ ] **Step 3.5 — Commit:**
  ```bash
  git add src/lib/services/admin/users.ts src/__tests__/services.admin.users.test.ts
  git commit -m "feat(admin): updateUser with role-transition limits + last-admin protection"
  ```

### Task 4: `deactivateUser` + `reactivateUser`

**Files:**
- Modify: `src/lib/services/admin/users.ts`
- Modify: `src/__tests__/services.admin.users.test.ts`

- [ ] **Step 4.1**: Добавить функции:
  ```ts
  export async function deactivateUser(
    prisma: PrismaClient,
    actorUserId: string,
    id: string
  ): Promise<void> {
    if (id === actorUserId) throw new AdminUserError('self_action_forbidden');

    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { role: true, isActive: true }
      });
      if (!before) throw new AdminUserError('not_found');
      if (!before.isActive) return;

      if (before.role === 'admin') {
        await assertNotLastActiveAdmin(tx, id);
      }

      await tx.user.update({ where: { id }, data: { isActive: false } });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_deactivated',
        entity: 'user',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false }
      });
    });
  }

  export async function reactivateUser(
    prisma: PrismaClient,
    actorUserId: string,
    id: string
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { isActive: true }
      });
      if (!before) throw new AdminUserError('not_found');
      if (before.isActive) return;

      await tx.user.update({ where: { id }, data: { isActive: true } });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_reactivated',
        entity: 'user',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true }
      });
    });
  }
  ```

- [ ] **Step 4.2**: Тесты на self_action_forbidden и last_admin_protected для `deactivateUser` (по образцу Task 3 Step 3.3).

- [ ] **Step 4.3**: `npm run test:unit -- services.admin.users` — ✓.

- [ ] **Step 4.4 — Commit:**
  ```bash
  git add src/lib/services/admin/users.ts src/__tests__/services.admin.users.test.ts
  git commit -m "feat(admin): deactivateUser + reactivateUser with self/last-admin guards"
  ```

### Task 5: Email template `admin-user-invite.tsx` + `sendAdminUserInviteEmail`

**Files:**
- Create: `src/lib/email/templates/admin-user-invite.tsx`
- Modify: `src/lib/email/send.ts`
- Test: `src/__tests__/email.templates.admin.test.ts`

- [ ] **Step 5.1**: Создать template (минимальный, по образцу `manager/invite.tsx`):
  ```tsx
  import * as React from 'react';

  type Props = {
    inviteUrl: string;
    name: string;
    role: 'organization' | 'partner' | 'manager' | 'student';
    invitedByName?: string;
  };

  const ROLE_LABELS: Record<Props['role'], string> = {
    organization: 'кабинету организации',
    partner: 'партнёрскому кабинету',
    manager: 'кабинету менеджера',
    student: 'учебному порталу'
  };

  export function AdminUserInviteEmail({ inviteUrl, name, role, invitedByName }: Props) {
    const roleLabel = ROLE_LABELS[role];
    return (
      <html>
        <body style={{ fontFamily: 'Arial, sans-serif', color: '#111111' }}>
          <p>Здравствуйте, {name}!</p>
          <p>{invitedByName ? `${invitedByName} пригласил` : 'Вас пригласили'} к {roleLabel} Промтехносферы.</p>
          <p>Установите пароль, чтобы войти:</p>
          <p>
            <a href={inviteUrl} style={{ background: '#F97316', color: 'white', padding: '12px 24px', textDecoration: 'none', borderRadius: 6 }}>
              Установить пароль
            </a>
          </p>
          <p style={{ color: '#6B7280', fontSize: 13 }}>
            Если кнопка не работает, скопируйте ссылку в браузер: {inviteUrl}
          </p>
          <p style={{ color: '#6B7280', fontSize: 12 }}>
            Ссылка действительна 7 дней.
          </p>
        </body>
      </html>
    );
  }
  ```

- [ ] **Step 5.2**: В `src/lib/email/send.ts` добавить sender (читать существующий файл, повторить паттерн `sendOrgInviteEmail`):
  ```ts
  // Найди в send.ts паттерн sendOrgInviteEmail и добавь рядом:
  export async function sendAdminUserInviteEmail(args: {
    to: string;
    name: string;
    role: 'organization' | 'partner' | 'manager' | 'student';
    inviteUrl: string;
    invitedByName?: string;
  }): Promise<'sent' | 'skipped'> {
    const { AdminUserInviteEmail } = await import('@/lib/email/templates/admin-user-invite');
    return send({
      to: args.to,
      subject: `Приглашение в кабинет Промтехносферы`,
      react: AdminUserInviteEmail(args)
    });
  }
  ```

- [ ] **Step 5.3**: Минимальный тест на render (по образцу `email.templates.organization.test.ts`):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { AdminUserInviteEmail } from '@/lib/email/templates/admin-user-invite';

  describe('AdminUserInviteEmail', () => {
    it('рендерит инвайт-ссылку и role label', () => {
      const html = renderToStaticMarkup(
        AdminUserInviteEmail({
          inviteUrl: 'https://lk.otsfera.ru/reset-password?token=abc',
          name: 'Иван',
          role: 'partner',
          invitedByName: 'Anna'
        }) as React.ReactElement
      );
      expect(html).toContain('Иван');
      expect(html).toContain('партнёрскому');
      expect(html).toContain('Anna');
      expect(html).toContain('abc');
    });
  });
  ```

- [ ] **Step 5.4**: `npm run test:unit -- email.templates.admin` — ✓.

- [ ] **Step 5.5 — Commit:**
  ```bash
  git add src/lib/email/templates/admin-user-invite.tsx src/lib/email/send.ts src/__tests__/email.templates.admin.test.ts
  git commit -m "feat(email): admin-user-invite template + sendAdminUserInviteEmail"
  ```

### Task 6: Server actions `src/server-actions/admin/users.ts`

**Files:**
- Create: `src/server-actions/admin/users.ts`
- Test: `src/__tests__/server-actions.admin.users.test.ts`

- [ ] **Step 6.1**: Создать файл с actions (по образцу [src/server-actions/organization/team.ts](../../src/server-actions/organization/team.ts)):
  ```ts
  'use server';

  import { z } from 'zod';
  import { revalidatePath } from 'next/cache';
  import { prisma } from '@/lib/db/prisma';
  import { requireAdmin } from '@/lib/auth/requireRole';
  import {
    createUser,
    updateUser,
    deactivateUser,
    reactivateUser,
    AdminUserError,
    type AdminUserErrorCode
  } from '@/lib/services/admin/users';
  import { sendAdminUserInviteEmail } from '@/lib/email/send';

  type Failure = { ok: false; error: 'validation' | AdminUserErrorCode; details?: unknown };
  type ActionResult<T = void> = ({ ok: true } & T) | Failure;

  const ROLE_ENUM = z.enum(['organization', 'partner', 'manager', 'student']);

  const createSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
    role: ROLE_ENUM,
    partnerId: z.string().optional().nullable()
  }).refine(
    (d) => d.role !== 'partner' || (d.partnerId && d.partnerId.length > 0),
    { message: 'partnerId required for partner role', path: ['partnerId'] }
  );

  const updateSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
    role: ROLE_ENUM.optional(),
    partnerId: z.string().nullable().optional(),
    isActive: z.coerce.boolean().optional()
  });

  const targetSchema = z.object({ id: z.string().min(1) });

  function readField(fd: FormData, key: string): string {
    const v = fd.get(key);
    return typeof v === 'string' ? v : '';
  }

  function mapErr(e: unknown): Failure {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }

  function appBaseUrl(): string {
    return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
  }

  export async function createUserAction(
    fd: FormData
  ): Promise<ActionResult<{ user: { id: string; email: string }; inviteUrl: string }>> {
    const parsed = createSchema.safeParse({
      email: readField(fd, 'email'),
      name: readField(fd, 'name'),
      role: readField(fd, 'role'),
      partnerId: readField(fd, 'partnerId') || null
    });
    if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

    const session = await requireAdmin();
    try {
      const result = await createUser(prisma, session.sub, parsed.data);
      const inviteUrl = `${appBaseUrl()}/reset-password?token=${result.inviteToken}`;

      // best-effort email
      await sendAdminUserInviteEmail({
        to: parsed.data.email,
        name: parsed.data.name,
        role: parsed.data.role,
        inviteUrl,
        invitedByName: session.name ?? undefined
      });

      revalidatePath('/admin/users');
      return { ok: true, user: { id: result.user.id, email: result.user.email }, inviteUrl };
    } catch (e) {
      return mapErr(e);
    }
  }

  export async function updateUserAction(fd: FormData): Promise<ActionResult> {
    const parsed = updateSchema.safeParse({
      id: readField(fd, 'id'),
      name: readField(fd, 'name') || undefined,
      role: readField(fd, 'role') || undefined,
      partnerId: readField(fd, 'partnerId') || undefined,
      isActive: readField(fd, 'isActive') || undefined
    });
    if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

    const session = await requireAdmin();
    try {
      const { id, ...args } = parsed.data;
      await updateUser(prisma, session.sub, id, args);
      revalidatePath('/admin/users');
      revalidatePath(`/admin/users/${id}`);
      return { ok: true };
    } catch (e) {
      return mapErr(e);
    }
  }

  export async function deactivateUserAction(fd: FormData): Promise<ActionResult> {
    const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
    if (!parsed.success) return { ok: false, error: 'validation' };

    const session = await requireAdmin();
    try {
      await deactivateUser(prisma, session.sub, parsed.data.id);
      revalidatePath('/admin/users');
      return { ok: true };
    } catch (e) {
      return mapErr(e);
    }
  }

  export async function reactivateUserAction(fd: FormData): Promise<ActionResult> {
    const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
    if (!parsed.success) return { ok: false, error: 'validation' };

    const session = await requireAdmin();
    try {
      await reactivateUser(prisma, session.sub, parsed.data.id);
      revalidatePath('/admin/users');
      return { ok: true };
    } catch (e) {
      return mapErr(e);
    }
  }

  // Form-compatible thin wrappers
  export async function updateUserFormAction(fd: FormData): Promise<void> { await updateUserAction(fd); }
  export async function deactivateUserFormAction(fd: FormData): Promise<void> { await deactivateUserAction(fd); }
  export async function reactivateUserFormAction(fd: FormData): Promise<void> { await reactivateUserAction(fd); }
  ```

- [ ] **Step 6.2**: Тесты (по образцу [src/__tests__/server-actions.organization.team.test.ts](../../src/__tests__/server-actions.organization.team.test.ts)):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  const { requireAdmin, createUser, sendAdminUserInviteEmail } = vi.hoisted(() => ({
    requireAdmin: vi.fn(),
    createUser: vi.fn(),
    sendAdminUserInviteEmail: vi.fn().mockResolvedValue('sent')
  }));

  vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
  vi.mock('@/lib/services/admin/users', async () => {
    const actual = await vi.importActual<typeof import('@/lib/services/admin/users')>('@/lib/services/admin/users');
    return { ...actual, createUser, updateUser: vi.fn(), deactivateUser: vi.fn(), reactivateUser: vi.fn() };
  });
  vi.mock('@/lib/email/send', () => ({ sendAdminUserInviteEmail }));
  vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
  vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

  import { createUserAction } from '@/server-actions/admin/users';

  describe('createUserAction', () => {
    beforeEach(() => {
      requireAdmin.mockResolvedValue({ sub: 'admin-1', name: 'Admin' });
      createUser.mockResolvedValue({
        user: { id: 'u1', email: 'a@x', name: 'A', role: 'organization' },
        inviteToken: 'tok-xyz'
      });
    });

    it('возвращает validation на пустой email', async () => {
      const fd = new FormData();
      fd.set('email', '');
      const r = await createUserAction(fd);
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toBe('validation');
    });

    it('возвращает inviteUrl на success', async () => {
      const fd = new FormData();
      fd.set('email', 'a@x.test');
      fd.set('name', 'A');
      fd.set('role', 'organization');
      const r = await createUserAction(fd);
      expect(r.ok).toBe(true);
      expect((r as { inviteUrl: string }).inviteUrl).toContain('tok-xyz');
      expect(sendAdminUserInviteEmail).toHaveBeenCalled();
    });

    it('мапит AdminUserError code → error', async () => {
      const { AdminUserError } = await import('@/lib/services/admin/users');
      createUser.mockRejectedValueOnce(new AdminUserError('duplicate_email'));
      const fd = new FormData();
      fd.set('email', 'a@x.test');
      fd.set('name', 'A');
      fd.set('role', 'organization');
      const r = await createUserAction(fd);
      expect(r).toMatchObject({ ok: false, error: 'duplicate_email' });
    });
  });
  ```

- [ ] **Step 6.3**: `npm run test:unit -- server-actions.admin.users` — ✓.

- [ ] **Step 6.4 — Commit:**
  ```bash
  git add src/server-actions/admin/users.ts src/__tests__/server-actions.admin.users.test.ts
  git commit -m "feat(admin): user CRUD server actions with zod + error mapping"
  ```

### Task 7: Page `/admin/users` + components `users-table` + `users-filters`

**Files:**
- Create: `src/app/admin/users/page.tsx`
- Create: `src/components/admin/users-table.tsx`
- Create: `src/components/admin/users-filters.tsx`
- Test: `src/__tests__/components.admin-users-table.test.tsx`

- [ ] **Step 7.1**: Создать `src/components/admin/users-filters.tsx` (server component, форма через GET):
  ```tsx
  import Link from 'next/link';

  type Props = {
    role?: string;
    active?: string;
    q?: string;
    partnerId?: string;
    organizationId?: string;
  };

  const ROLES: Array<{ value: string; label: string }> = [
    { value: '', label: 'Все роли' },
    { value: 'admin', label: 'Админы' },
    { value: 'manager', label: 'Менеджеры' },
    { value: 'partner', label: 'Партнёры' },
    { value: 'organization', label: 'Организации' },
    { value: 'student', label: 'Студенты' }
  ];

  export function UsersFilters({ role, active, q, partnerId, organizationId }: Props) {
    const hasActive = role || active || q || partnerId || organizationId;
    return (
      <form method="get" className="flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-xl p-3">
        <label className="flex flex-col text-xs text-gray-500">
          Роль
          <select name="role" defaultValue={role ?? ''} className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm">
            {ROLES.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          Активность
          <select name="active" defaultValue={active ?? ''} className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm">
            <option value="">Все</option>
            <option value="true">Активные</option>
            <option value="false">Деактивированные</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-500 flex-1 min-w-[200px]">
          Поиск
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Email или имя"
            className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
          />
        </label>
        {partnerId && <input type="hidden" name="partnerId" value={partnerId} />}
        {organizationId && <input type="hidden" name="organizationId" value={organizationId} />}
        <button type="submit" className="px-3 py-1.5 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C]">
          Применить
        </button>
        {hasActive && (
          <Link href="/admin/users" className="px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50">
            Сбросить
          </Link>
        )}
      </form>
    );
  }
  ```

- [ ] **Step 7.2**: Создать `src/components/admin/users-table.tsx`:
  ```tsx
  import Link from 'next/link';
  import {
    deactivateUserFormAction,
    reactivateUserFormAction
  } from '@/server-actions/admin/users';
  import type { UserRow } from '@/lib/services/admin/users';

  const ROLE_LABELS: Record<string, string> = {
    admin: 'Админ',
    manager: 'Менеджер',
    partner: 'Партнёр',
    organization: 'Организация',
    student: 'Студент'
  };

  export function UsersTable({ rows, currentUserId }: { rows: UserRow[]; currentUserId: string }) {
    if (rows.length === 0) {
      return (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          Пользователей не найдено
        </div>
      );
    }
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left">
              <th className="px-4 py-2.5 font-medium text-gray-600">Email</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">Имя</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">Роль</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">Привязка</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">Активен</th>
              <th className="px-4 py-2.5 font-medium text-gray-600">Создан</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-[#FFF7ED]">
                  <td className="px-4 py-2.5 font-mono text-xs text-[#111111]">{u.email}</td>
                  <td className="px-4 py-2.5">{u.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{ROLE_LABELS[u.role] ?? u.role}</td>
                  <td className="px-4 py-2.5 text-gray-600">{u.attachmentLabel}</td>
                  <td className="px-4 py-2.5">
                    {u.isActive ? (
                      <span className="text-green-600 text-xs">●</span>
                    ) : (
                      <span className="text-gray-300 text-xs">●</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">
                    {new Intl.DateTimeFormat('ru-RU').format(u.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/admin/users/${u.id}`} className="text-[#F97316] text-xs hover:underline">
                        Редактировать
                      </Link>
                      {!isSelf && (
                        u.isActive ? (
                          <form action={deactivateUserFormAction}>
                            <input type="hidden" name="id" value={u.id} />
                            <button type="submit" className="text-gray-500 text-xs hover:text-red-600">
                              Деактивировать
                            </button>
                          </form>
                        ) : (
                          <form action={reactivateUserFormAction}>
                            <input type="hidden" name="id" value={u.id} />
                            <button type="submit" className="text-gray-500 text-xs hover:text-green-600">
                              Восстановить
                            </button>
                          </form>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  ```

- [ ] **Step 7.3**: Создать `src/app/admin/users/page.tsx` (server component, паттерн от [/admin/organizations/page.tsx](../../src/app/admin/organizations/page.tsx)):
  ```tsx
  import Link from 'next/link';
  import type { Role } from '@prisma/client';
  import { requireAdmin } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { listUsers } from '@/lib/services/admin/users';
  import { UsersFilters } from '@/components/admin/users-filters';
  import { UsersTable } from '@/components/admin/users-table';

  export const dynamic = 'force-dynamic';

  const PAGE_SIZE = 50;

  type SP = { role?: string; active?: string; q?: string; partnerId?: string; organizationId?: string; skip?: string };

  function parseRole(v?: string): Role | undefined {
    const allowed = ['admin', 'manager', 'partner', 'organization', 'student'];
    return allowed.includes(v ?? '') ? (v as Role) : undefined;
  }

  export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SP> }) {
    const session = await requireAdmin();
    const sp = await searchParams;
    const skip = Number.isFinite(Number(sp.skip)) ? Math.max(0, Number(sp.skip)) : 0;

    const filters = {
      role: parseRole(sp.role),
      active: sp.active === 'true' ? true : sp.active === 'false' ? false : undefined,
      q: sp.q?.trim() || undefined,
      partnerId: sp.partnerId || undefined,
      organizationId: sp.organizationId || undefined,
      take: PAGE_SIZE,
      skip
    };

    const { rows, total } = await listUsers(prisma, filters);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#111111]">Пользователи</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} всего</p>
          </div>
          <Link href="/admin/users/new" className="px-3 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]">
            + Пригласить
          </Link>
        </div>

        <UsersFilters
          role={sp.role}
          active={sp.active}
          q={sp.q}
          partnerId={sp.partnerId}
          organizationId={sp.organizationId}
        />

        <UsersTable rows={rows} currentUserId={session.sub} />

        {total > PAGE_SIZE && (
          <Paginator skip={skip} take={PAGE_SIZE} total={total} sp={sp} />
        )}
      </div>
    );
  }

  function Paginator({ skip, take, total, sp }: { skip: number; take: number; total: number; sp: SP }) {
    function url(s: number): string {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) if (v && k !== 'skip') p.set(k, v);
      if (s > 0) p.set('skip', String(s));
      return `/admin/users${p.toString() ? '?' + p.toString() : ''}`;
    }
    const page = Math.floor(skip / take) + 1;
    const pages = Math.max(1, Math.ceil(total / take));
    return (
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>Страница {page} из {pages} · {total} всего</span>
        <div className="flex gap-2">
          {skip > 0 && (
            <a href={url(Math.max(0, skip - take))} className="px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">Назад</a>
          )}
          {skip + take < total && (
            <a href={url(skip + take)} className="px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">Вперёд</a>
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 7.4**: Минимальный тест таблицы:
  ```tsx
  // src/__tests__/components.admin-users-table.test.tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { UsersTable } from '@/components/admin/users-table';

  describe('UsersTable', () => {
    it('рендерит «Пользователей не найдено» на пустой list', () => {
      render(<UsersTable rows={[]} currentUserId="me" />);
      expect(screen.getByText(/не найдено/i)).toBeTruthy();
    });

    it('скрывает кнопку Деактивировать для самого себя', () => {
      const rows = [{
        id: 'me', email: 'me@x', name: 'Me', role: 'admin' as const,
        isActive: true, createdAt: new Date(), attachmentLabel: '—'
      }];
      render(<UsersTable rows={rows} currentUserId="me" />);
      expect(screen.queryByText(/Деактивировать/)).toBeNull();
    });
  });
  ```

- [ ] **Step 7.5**: `npm run test:unit -- admin-users-table` — ✓.

- [ ] **Step 7.6**: `npm run typecheck` — 0 errors.

- [ ] **Step 7.7 — Commit:**
  ```bash
  git add src/app/admin/users/page.tsx src/components/admin/users-table.tsx src/components/admin/users-filters.tsx src/__tests__/components.admin-users-table.test.tsx
  git commit -m "feat(admin): /admin/users list page + filters + table"
  ```

### Task 8: Page `/admin/users/new` + `user-invite-form`

**Files:**
- Create: `src/app/admin/users/new/page.tsx`
- Create: `src/components/admin/user-invite-form.tsx`

- [ ] **Step 8.1**: Создать форму (client, `useDialogFocus` НЕ нужен на full page; зато на /new — обычная страница, не modal):
  ```tsx
  // src/components/admin/user-invite-form.tsx
  'use client';

  import { useState, useTransition } from 'react';
  import { useRouter } from 'next/navigation';
  import { createUserAction } from '@/server-actions/admin/users';

  type Partner = { id: string; name: string };

  export function UserInviteForm({ partners }: { partners: Partner[] }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [inviteUrl, setInviteUrl] = useState<string | null>(null);
    const [role, setRole] = useState<'organization' | 'partner' | 'manager' | 'student'>('organization');

    function submit(formData: FormData) {
      setError(null);
      setInviteUrl(null);
      startTransition(async () => {
        const result = await createUserAction(formData);
        if (result.ok) {
          setInviteUrl(result.inviteUrl);
        } else {
          setError(translateError(result.error));
        }
      });
    }

    return (
      <form action={submit} className="space-y-4 bg-white border border-gray-200 rounded-xl p-6 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-[#111111] mb-1">Email</label>
          <input
            type="email"
            name="email"
            required
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#111111] mb-1">Имя</label>
          <input
            type="text"
            name="name"
            required
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#111111] mb-1">Роль</label>
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          >
            <option value="organization">Организация</option>
            <option value="partner">Партнёр</option>
            <option value="manager">Менеджер</option>
            <option value="student">Студент</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">Создание admin'а через UI недоступно.</p>
        </div>
        {role === 'partner' && (
          <div>
            <label className="block text-sm font-medium text-[#111111] mb-1">Партнёр</label>
            <select
              name="partnerId"
              required
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            >
              <option value="">— выберите —</option>
              {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </div>
        )}
        {error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</div>
        )}
        {inviteUrl && (
          <div role="status" className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">
            Приглашение создано. Если email не дошёл, скопируйте ссылку:
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="w-full mt-2 border border-green-200 rounded px-2 py-1 font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={() => router.push('/admin/users')}
              className="mt-3 px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50"
            >
              К списку
            </button>
          </div>
        )}
        {!inviteUrl && (
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C] disabled:opacity-60"
          >
            {pending ? 'Создаю…' : 'Пригласить'}
          </button>
        )}
      </form>
    );
  }

  function translateError(code: string): string {
    switch (code) {
      case 'duplicate_email': return 'Пользователь с таким email уже существует.';
      case 'admin_role_via_ui': return 'Создание admin через UI недоступно.';
      case 'validation': return 'Проверьте корректность полей.';
      default: return `Ошибка: ${code}`;
    }
  }
  ```

- [ ] **Step 8.2**: Создать страницу:
  ```tsx
  // src/app/admin/users/new/page.tsx
  import Link from 'next/link';
  import { requireAdmin } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { UserInviteForm } from '@/components/admin/user-invite-form';

  export const dynamic = 'force-dynamic';

  export default async function NewUserPage() {
    await requireAdmin();
    const partners = await prisma.partner.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    });

    return (
      <div className="space-y-4 max-w-3xl">
        <div>
          <Link href="/admin/users" className="text-xs text-gray-500 hover:text-[#F97316]">
            ← К списку
          </Link>
          <h1 className="text-2xl font-bold text-[#111111] mt-1">Пригласить пользователя</h1>
        </div>
        <UserInviteForm partners={partners} />
      </div>
    );
  }
  ```

- [ ] **Step 8.3**: `npm run typecheck && npm run build` — нет startup errors на `/admin/users/new`.

- [ ] **Step 8.4 — Commit:**
  ```bash
  git add src/app/admin/users/new/page.tsx src/components/admin/user-invite-form.tsx
  git commit -m "feat(admin): /admin/users/new invite form with inviteUrl fallback"
  ```

### Task 9: Page `/admin/users/[id]` + `user-edit-form`

**Files:**
- Create: `src/app/admin/users/[id]/page.tsx`
- Create: `src/components/admin/user-edit-form.tsx`

- [ ] **Step 9.1**: Создать `src/components/admin/user-edit-form.tsx` (client). Реализуй по аналогии с Task 8 `UserInviteForm`, но:
  - Подгружает `UserDetail` через server props.
  - Поля: `name` (editable), `email` (readonly), `role` (dropdown без admin; учитывает allowed transitions Task 3), `partnerId` (visible if role=partner), `isActive` (toggle, но disabled если currentUserId === user.id).
  - Информационная плашка: «Привязки к организациям управляются на странице организации».
  - При submit вызывает `updateUserAction`.
  - State показывает success / error из ActionResult.
  - Допустимые role transitions: `partner ↔ partner`, `partner ↔ student`. Остальные → disable option в dropdown.

  Скелет (заполни по образцу `UserInviteForm`):
  ```tsx
  'use client';
  import { useState, useTransition } from 'react';
  import { updateUserAction } from '@/server-actions/admin/users';
  import type { UserDetail } from '@/lib/services/admin/users';

  type Partner = { id: string; name: string };

  function allowedRoles(currentRole: string): string[] {
    if (currentRole === 'partner') return ['partner', 'student'];
    if (currentRole === 'student') return ['student', 'partner'];
    if (currentRole === 'organization') return ['organization'];
    if (currentRole === 'manager') return ['manager'];
    return [currentRole]; // admin or other — no change via form
  }

  export function UserEditForm({ user, partners, isSelf }: { user: UserDetail; partners: Partner[]; isSelf: boolean }) {
    // ... like UserInviteForm, but pre-filled and submits to updateUserAction
  }
  ```

- [ ] **Step 9.2**: Создать страницу:
  ```tsx
  import { notFound } from 'next/navigation';
  import Link from 'next/link';
  import { requireAdmin } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { getUser } from '@/lib/services/admin/users';
  import { UserEditForm } from '@/components/admin/user-edit-form';

  export const dynamic = 'force-dynamic';

  export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await requireAdmin();
    const { id } = await params;
    const user = await getUser(prisma, id);
    if (!user) notFound();

    const partners = await prisma.partner.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    });

    return (
      <div className="space-y-4 max-w-3xl">
        <div>
          <Link href="/admin/users" className="text-xs text-gray-500 hover:text-[#F97316]">
            ← К списку
          </Link>
          <h1 className="text-2xl font-bold text-[#111111] mt-1">{user.name}</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <UserEditForm user={user} partners={partners} isSelf={session.sub === user.id} />
      </div>
    );
  }
  ```

- [ ] **Step 9.3**: `npm run typecheck && npm run build`.

- [ ] **Step 9.4 — Commit:**
  ```bash
  git add src/app/admin/users/[id]/page.tsx src/components/admin/user-edit-form.tsx
  git commit -m "feat(admin): /admin/users/[id] edit form with role transition guards"
  ```

### Task 10: PR-1 финальная проверка + push + PR

- [ ] **Step 10.1**: `npm run typecheck` — 0 errors.

- [ ] **Step 10.2**: `npm run lint` — 0 новых warnings.

- [ ] **Step 10.3**: `npm run test:unit` — passing (~981, +25 от baseline 956).

- [ ] **Step 10.4**: `npm run build` — successful. Проверь, что новые routes `/admin/users`, `/admin/users/new`, `/admin/users/[id]` в выводе.

- [ ] **Step 10.5**: `npm run dev` boot check — нет startup errors. Дождаться `✓ Ready in ...`, Ctrl+C.

- [ ] **Step 10.6**: Push + create PR:
  ```bash
  git push -u origin claude/admin-6.3-users
  gh pr create --title "feat(admin): 6.3 Users management" --body "$(cat <<'EOF'
  ## Summary
  - listUsers / getUser / createUser / updateUser / deactivate / reactivate с типом AdminUserError
  - Server actions с zod validation + error mapping
  - `/admin/users` list + filters + skip-pagination
  - `/admin/users/new` invite form с inviteUrl fallback
  - `/admin/users/[id]` edit с ограниченным role transition (partner ↔ student)
  - Anti-escalation: admin role недоступен в UI, audit_status=denied при попытке
  - Last-active-admin protection
  - +25 unit-тестов

  Закрывает Phase 6.3 spec [docs/superpowers/specs/2026-05-29-admin-cabinet-6.3-6.7-design.md](docs/superpowers/specs/2026-05-29-admin-cabinet-6.3-6.7-design.md) §4.

  ## Test plan
  - [ ] Создать тестового partner-user через UI → invite email → reset password → login в /partner/dashboard
  - [ ] Попытка создать admin через UI → denied + audit
  - [ ] Деактивировать второго active admin → success; затем последнего → last_admin_protected
  - [ ] Cross-role transition partner → organization → blocked

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

---

# PR-2 — 6.4 Partners management

### Task 11: Service `partners.ts` — types + `listPartners`

**Files:**
- Create: `src/lib/services/admin/partners.ts`
- Test: `src/__tests__/services.admin.partners.test.ts`

- [ ] **Step 11.1**: Types + `listPartners` (паттерн как Task 1):
  ```ts
  import { Prisma } from '@prisma/client';
  import type { PrismaClient } from '@prisma/client';
  import { createInviteToken } from '@/lib/auth/passwordReset';
  import { recordAudit } from '@/lib/auth/audit';
  import { AdminUserError, type AdminUserErrorCode } from '@/lib/services/admin/users';

  export type AdminPartnerErrorCode = 'forbidden' | 'not_found' | 'duplicate_slug' | AdminUserErrorCode;

  export class AdminPartnerError extends Error {
    readonly code: AdminPartnerErrorCode;
    constructor(code: AdminPartnerErrorCode) {
      super(code);
      this.code = code;
      this.name = 'AdminPartnerError';
    }
  }

  export type PartnerFilters = {
    active?: boolean;
    filter?: 'norate';
    q?: string;
    take?: number;
    skip?: number;
  };

  export type PartnerRow = {
    id: string;
    name: string;
    slug: string;
    commissionRate: number | null;
    isActive: boolean;
    activeOrgCount: number;
    paidYTD: string; // serialised Decimal for client
  };

  export async function listPartners(
    prisma: PrismaClient,
    filters: PartnerFilters
  ): Promise<{ rows: PartnerRow[]; total: number }> {
    const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
    const skip = Math.max(filters.skip ?? 0, 0);
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    const where: Prisma.PartnerWhereInput = {};
    if (filters.active !== undefined) where.isActive = filters.active;
    if (filters.filter === 'norate') where.commissionRate = null;
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { slug: { contains: filters.q, mode: 'insensitive' } }
      ];
    }

    const [partners, total] = await Promise.all([
      prisma.partner.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        take,
        skip
      }),
      prisma.partner.count({ where })
    ]);

    const rows: PartnerRow[] = await Promise.all(
      partners.map(async (p) => {
        const [activeOrgCount, paidAgg] = await Promise.all([
          prisma.organization.count({
            where: { orders: { some: { partnerId: p.id } } }
          }),
          prisma.commissionStatement.aggregate({
            where: { partnerId: p.id, status: 'paid', paidAt: { gte: yearStart } },
            _sum: { totalCommissionAmount: true }
          })
        ]);
        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          commissionRate: p.commissionRate ? Number(p.commissionRate) : null,
          isActive: p.isActive,
          activeOrgCount,
          paidYTD: (paidAgg._sum.totalCommissionAmount ?? new Prisma.Decimal(0)).toString()
        };
      })
    );

    return { rows, total };
  }
  ```

- [ ] **Step 11.2**: Минимальный тест на filter wiring (по образцу Task 1.3).

- [ ] **Step 11.3**: `npm run test:unit -- services.admin.partners` — ✓.

- [ ] **Step 11.4 — Commit:**
  ```bash
  git add src/lib/services/admin/partners.ts src/__tests__/services.admin.partners.test.ts
  git commit -m "feat(admin): listPartners service with rate / norate / q filters"
  ```

### Task 12: `getPartner` + `updatePartner` + `deactivate` + `reactivate`

**Files:**
- Modify: `src/lib/services/admin/partners.ts`
- Modify: `src/__tests__/services.admin.partners.test.ts`

- [ ] **Step 12.1**: Добавить функции:
  ```ts
  export type PartnerDetail = PartnerRow & {
    admins: Array<{
      partnerUserId: string;
      userId: string;
      email: string;
      name: string;
      isActive: boolean;
      createdAt: Date;
    }>;
  };

  export async function getPartner(prisma: PrismaClient, id: string): Promise<PartnerDetail | null> {
    const p = await prisma.partner.findUnique({
      where: { id },
      include: {
        partnerUsers: {
          where: { roleInPartner: 'admin' },
          include: { user: { select: { id: true, email: true, name: true, isActive: true, createdAt: true } } }
        }
      }
    });
    if (!p) return null;

    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const [activeOrgCount, paidAgg] = await Promise.all([
      prisma.organization.count({ where: { orders: { some: { partnerId: p.id } } } }),
      prisma.commissionStatement.aggregate({
        where: { partnerId: p.id, status: 'paid', paidAt: { gte: yearStart } },
        _sum: { totalCommissionAmount: true }
      })
    ]);

    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      commissionRate: p.commissionRate ? Number(p.commissionRate) : null,
      isActive: p.isActive,
      activeOrgCount,
      paidYTD: (paidAgg._sum.totalCommissionAmount ?? new Prisma.Decimal(0)).toString(),
      admins: p.partnerUsers.map((pu) => ({
        partnerUserId: pu.id,
        userId: pu.userId,
        email: pu.user.email,
        name: pu.user.name,
        isActive: pu.user.isActive,
        createdAt: pu.user.createdAt
      }))
    };
  }

  export type UpdatePartnerArgs = {
    name?: string;
    commissionRate?: number | null;
    isActive?: boolean;
  };

  export async function updatePartner(
    prisma: PrismaClient,
    actorUserId: string,
    id: string,
    args: UpdatePartnerArgs
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.partner.findUnique({
        where: { id },
        select: { name: true, commissionRate: true, isActive: true }
      });
      if (!before) throw new AdminPartnerError('not_found');

      await tx.partner.update({
        where: { id },
        data: {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.commissionRate !== undefined ? { commissionRate: args.commissionRate as Prisma.Decimal | null } : {}),
          ...(args.isActive !== undefined ? { isActive: args.isActive } : {})
        }
      });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'partner_updated',
        entity: 'partner',
        entityId: id,
        before: { name: before.name, commissionRate: before.commissionRate?.toString() ?? null, isActive: before.isActive },
        after: { ...args }
      });
    });
  }

  export async function deactivatePartner(prisma: PrismaClient, actorUserId: string, id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.partner.findUnique({ where: { id }, select: { isActive: true } });
      if (!before) throw new AdminPartnerError('not_found');
      if (!before.isActive) return;

      await tx.partner.update({ where: { id }, data: { isActive: false } });
      await recordAudit(tx, {
        userId: actorUserId,
        action: 'partner_deactivated',
        entity: 'partner',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false }
      });
    });
  }

  export async function reactivatePartner(prisma: PrismaClient, actorUserId: string, id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.partner.findUnique({ where: { id }, select: { isActive: true } });
      if (!before) throw new AdminPartnerError('not_found');
      if (before.isActive) return;

      await tx.partner.update({ where: { id }, data: { isActive: true } });
      await recordAudit(tx, {
        userId: actorUserId,
        action: 'partner_reactivated',
        entity: 'partner',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true }
      });
    });
  }
  ```

- [ ] **Step 12.2**: Тесты на `not_found` + audit-вызов для каждой mutation function.

- [ ] **Step 12.3**: `npm run test:unit -- services.admin.partners` — ✓.

- [ ] **Step 12.4 — Commit:**
  ```bash
  git add src/lib/services/admin/partners.ts src/__tests__/services.admin.partners.test.ts
  git commit -m "feat(admin): getPartner + updatePartner + deactivate/reactivate"
  ```

### Task 13: `createPartnerWithAdmin` (transactional)

**Files:**
- Modify: `src/lib/services/admin/partners.ts`
- Modify: `src/__tests__/services.admin.partners.test.ts`

- [ ] **Step 13.1**: Добавить функцию:
  ```ts
  export type CreatePartnerWithAdminArgs = {
    name: string;
    slug: string;
    commissionRate?: number | null;
    adminEmail: string;
    adminName: string;
  };

  export type CreatePartnerWithAdminResult = {
    partner: { id: string; name: string; slug: string };
    user: { id: string; email: string };
    inviteToken: string;
  };

  export async function createPartnerWithAdmin(
    prisma: PrismaClient,
    actorUserId: string,
    args: CreatePartnerWithAdminArgs
  ): Promise<CreatePartnerWithAdminResult> {
    return prisma.$transaction(async (tx) => {
      const slugExists = await tx.partner.findUnique({ where: { slug: args.slug } });
      if (slugExists) throw new AdminPartnerError('duplicate_slug');

      const emailExists = await tx.user.findUnique({ where: { email: args.adminEmail } });
      if (emailExists) throw new AdminPartnerError('duplicate_email');

      const partner = await tx.partner.create({
        data: {
          name: args.name,
          slug: args.slug,
          commissionRate: args.commissionRate ?? null,
          isActive: true
        }
      });

      const user = await tx.user.create({
        data: {
          email: args.adminEmail,
          name: args.adminName,
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

      const { token } = await createInviteToken(tx, user.id);

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'partner_created',
        entity: 'partner',
        entityId: partner.id,
        after: {
          name: args.name,
          slug: args.slug,
          commissionRate: args.commissionRate ?? null,
          adminUserId: user.id,
          adminEmail: args.adminEmail
        }
      });

      return {
        partner: { id: partner.id, name: partner.name, slug: partner.slug },
        user: { id: user.id, email: user.email },
        inviteToken: token
      };
    });
  }
  ```

- [ ] **Step 13.2**: Тесты:
  - `duplicate_slug` бросается до Partner.create.
  - `duplicate_email` бросается до Partner.create.
  - Happy path: партнёр, user, partnerUser, token, audit — все вызваны.

- [ ] **Step 13.3**: `npm run test:unit -- services.admin.partners` — ✓.

- [ ] **Step 13.4 — Commit:**
  ```bash
  git add src/lib/services/admin/partners.ts src/__tests__/services.admin.partners.test.ts
  git commit -m "feat(admin): transactional createPartnerWithAdmin + slug/email pre-checks"
  ```

### Task 14: Server actions `src/server-actions/admin/partners.ts`

**Files:**
- Create: `src/server-actions/admin/partners.ts`
- Test: `src/__tests__/server-actions.admin.partners.test.ts`

- [ ] **Step 14.1**: Реализовать по паттерну Task 6 (`server-actions/admin/users.ts`):
  - `createPartnerWithAdminAction` (returns `{ partner, user, inviteUrl }`).
  - `updatePartnerAction`, `deactivatePartnerAction`, `reactivatePartnerAction`.
  - + form-compatible void wrappers.
  - В `createPartnerWithAdminAction` после успеха — `sendAdminUserInviteEmail({ role: 'partner', ... })`.
  - `mapErr` мапит `AdminPartnerError` → error code.

  Zod schemas:
  ```ts
  const createSchema = z.object({
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'lowercase, цифры и дефис'),
    commissionRate: z.coerce.number().min(0).max(100).optional(),
    adminEmail: z.string().email(),
    adminName: z.string().min(1).max(200)
  });

  const updateSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
    commissionRate: z.coerce.number().min(0).max(100).nullable().optional(),
    isActive: z.coerce.boolean().optional()
  });

  const targetSchema = z.object({ id: z.string().min(1) });
  ```

- [ ] **Step 14.2**: Тесты на `createPartnerWithAdminAction`: validation, success returns inviteUrl, duplicate_slug mapping.

- [ ] **Step 14.3**: `npm run test:unit -- server-actions.admin.partners` — ✓.

- [ ] **Step 14.4 — Commit:**
  ```bash
  git add src/server-actions/admin/partners.ts src/__tests__/server-actions.admin.partners.test.ts
  git commit -m "feat(admin): partner CRUD server actions"
  ```

### Task 15: `/admin/partners` list page + table + filters

**Files:**
- Create: `src/app/admin/partners/page.tsx`
- Create: `src/components/admin/partners-table.tsx`
- Create: `src/components/admin/partners-filters.tsx`

- [ ] **Step 15.1**: Создать `partners-filters.tsx` (по паттерну users-filters):
  - Поля: `active` select (Все/Активные/Деактивированные), `filter` checkbox для `norate`, `q` поиск.
- [ ] **Step 15.2**: Создать `partners-table.tsx`:
  - Колонки: `Название · Slug · Ставка · Активных орг · Сумма выплат YTD · Действия`.
  - Действия: «Редактировать» link + Деактивировать/Восстановить form action.
  - `Decimal` сумма форматируется через `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })`.
- [ ] **Step 15.3**: Создать страницу `page.tsx` по паттерну Task 7 Step 7.3:
  - `listPartners` с фильтрами из URL.
  - Кнопка `+ Создать партнёра` → `/admin/partners/new`.
  - Paginator идентичный Task 7.

- [ ] **Step 15.4**: `npm run typecheck && npm run build`.

- [ ] **Step 15.5 — Commit:**
  ```bash
  git add src/app/admin/partners/page.tsx src/components/admin/partners-table.tsx src/components/admin/partners-filters.tsx
  git commit -m "feat(admin): /admin/partners list + filters + table"
  ```

### Task 16: `/admin/partners/new` + create form

**Files:**
- Create: `src/app/admin/partners/new/page.tsx`
- Create: `src/components/admin/partner-create-form.tsx`

- [ ] **Step 16.1**: Создать `partner-create-form.tsx` (client) — по паттерну `UserInviteForm`. Поля: `name`, `slug`, `commissionRate` (optional, % 0-100), `adminEmail`, `adminName`. После success — показывает `inviteUrl` (для копирования) и link «К списку».

- [ ] **Step 16.2**: Создать `page.tsx`:
  ```tsx
  import Link from 'next/link';
  import { requireAdmin } from '@/lib/auth/requireRole';
  import { PartnerCreateForm } from '@/components/admin/partner-create-form';

  export const dynamic = 'force-dynamic';

  export default async function NewPartnerPage() {
    await requireAdmin();
    return (
      <div className="space-y-4 max-w-3xl">
        <div>
          <Link href="/admin/partners" className="text-xs text-gray-500 hover:text-[#F97316]">
            ← К списку
          </Link>
          <h1 className="text-2xl font-bold text-[#111111] mt-1">Новый партнёр</h1>
        </div>
        <PartnerCreateForm />
      </div>
    );
  }
  ```

- [ ] **Step 16.3 — Commit:**
  ```bash
  git add src/app/admin/partners/new/page.tsx src/components/admin/partner-create-form.tsx
  git commit -m "feat(admin): /admin/partners/new combined Partner + admin form"
  ```

### Task 17: `/admin/partners/[id]` + edit form + admin list

**Files:**
- Create: `src/app/admin/partners/[id]/page.tsx`
- Create: `src/components/admin/partner-edit-form.tsx`

- [ ] **Step 17.1**: `partner-edit-form.tsx` (client) — поля: `name`, `commissionRate`, `isActive`. **`slug` — readonly** (показывается, но не editable). Submit → `updatePartnerAction`.

- [ ] **Step 17.2**: `page.tsx`:
  - `getPartner(prisma, id)` — bring back `PartnerDetail` со списком admin'ов.
  - Render: header → `<PartnerEditForm partner={...}>` → блок «Администраторы партнёра» (таблица из `partner.admins`, каждая строка с link на `/admin/users/[id]`).

- [ ] **Step 17.3**: `npm run typecheck && npm run build` — /admin/partners/[id] в выводе.

- [ ] **Step 17.4 — Commit:**
  ```bash
  git add src/app/admin/partners/[id]/page.tsx src/components/admin/partner-edit-form.tsx
  git commit -m "feat(admin): /admin/partners/[id] edit form + admins read-only list"
  ```

### Task 18: PR-2 финальная проверка + push + PR

- [ ] **Step 18.1**: typecheck / lint / test:unit / build / dev boot — all ✓.

- [ ] **Step 18.2**: Push + PR:
  ```bash
  git push -u origin claude/admin-6.4-partners
  gh pr create --title "feat(admin): 6.4 Partners management" --body "$(cat <<'EOF'
  ## Summary
  - listPartners / getPartner / createPartnerWithAdmin (transactional) / update / deactivate / reactivate
  - Server actions с zod validation
  - `/admin/partners` list + filters (active / norate / q) + skip-pagination
  - `/admin/partners/new` Partner + первый admin user в одной транзакции
  - `/admin/partners/[id]` edit (slug readonly) + read-only admin list
  - +20 unit-тестов

  Закрывает Phase 6.4 spec §5.

  ## Test plan
  - [ ] Создать партнёра через /admin/partners/new → invite email → reset password → login в /partner/dashboard (5-min KPI)
  - [ ] Попытка дубль slug → duplicate_slug error
  - [ ] Попытка дубль email → duplicate_email error
  - [ ] Фильтр norate показывает партнёров без commissionRate
  - [ ] Deactivate Partner → активные user'ы партнёра не каскадно деактивируются (sanity)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

---

# PR-3 — 6.5 Organizations delta

### Task 19: Service `src/lib/services/admin/organizations.ts` — extract + extend

**Files:**
- Create: `src/lib/services/admin/organizations.ts`
- Test: `src/__tests__/services.admin.organizations.test.ts`

- [ ] **Step 19.1**: Extract inline-query из `/admin/organizations/page.tsx` и добавить новые фильтры `partnerId`, `withRateOverride`:
  ```ts
  import type { PrismaClient, Prisma } from '@prisma/client';
  import { recordAudit } from '@/lib/auth/audit';

  export type AdminOrgErrorCode = 'forbidden' | 'not_found';

  export class AdminOrgError extends Error {
    readonly code: AdminOrgErrorCode;
    constructor(code: AdminOrgErrorCode) { super(code); this.code = code; this.name = 'AdminOrgError'; }
  }

  export type OrgFilters = {
    q?: string;
    partnerId?: string;
    withRateOverride?: boolean;
    take?: number;
    skip?: number;
  };

  export type OrgRow = {
    id: string;
    name: string;
    inn: string | null;
    externalId: string | null;
    partner: { id: string; name: string };
    ordersCount: number;
    organizationUsersCount: number;
    partnerCommissionRate: number | null;
  };

  export async function listOrganizations(
    prisma: PrismaClient,
    filters: OrgFilters
  ): Promise<{ rows: OrgRow[]; total: number }> {
    const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
    const skip = Math.max(filters.skip ?? 0, 0);

    const where: Prisma.OrganizationWhereInput = {};
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { inn: { contains: filters.q, mode: 'insensitive' } },
        { externalId: { contains: filters.q, mode: 'insensitive' } }
      ];
    }
    if (filters.partnerId) where.partnerId = filters.partnerId;
    if (filters.withRateOverride === true) where.partnerCommissionRate = { not: null };
    if (filters.withRateOverride === false) where.partnerCommissionRate = null;

    const [orgs, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true } },
          _count: { select: { orders: true, organizationUsers: true } }
        },
        orderBy: { name: 'asc' },
        take,
        skip
      }),
      prisma.organization.count({ where })
    ]);

    const rows: OrgRow[] = orgs.map((o) => ({
      id: o.id,
      name: o.name,
      inn: o.inn,
      externalId: o.externalId,
      partner: { id: o.partner.id, name: o.partner.name },
      ordersCount: o._count.orders,
      organizationUsersCount: o._count.organizationUsers,
      partnerCommissionRate: o.partnerCommissionRate ? Number(o.partnerCommissionRate) : null
    }));

    return { rows, total };
  }

  export type OrgDetail = {
    id: string;
    name: string;
    legalName: string | null;
    inn: string | null;
    kpp: string | null;
    externalId: string | null;
    partnerId: string;
    partnerCommissionRate: number | null;
    partnerCommissionRateNote: string | null;
  };

  export async function getOrganization(prisma: PrismaClient, id: string): Promise<OrgDetail | null> {
    const o = await prisma.organization.findUnique({
      where: { id },
      select: {
        id: true, name: true, legalName: true, inn: true, kpp: true,
        externalId: true, partnerId: true,
        partnerCommissionRate: true, partnerCommissionRateNote: true
      }
    });
    if (!o) return null;
    return {
      id: o.id, name: o.name, legalName: o.legalName,
      inn: o.inn, kpp: o.kpp, externalId: o.externalId,
      partnerId: o.partnerId,
      partnerCommissionRate: o.partnerCommissionRate ? Number(o.partnerCommissionRate) : null,
      partnerCommissionRateNote: o.partnerCommissionRateNote
    };
  }

  export type UpdateOrgArgs = {
    name?: string;
    legalName?: string | null;
    inn?: string | null;
    kpp?: string | null;
  };

  export async function updateOrganization(
    prisma: PrismaClient,
    actorUserId: string,
    id: string,
    args: UpdateOrgArgs
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id },
        select: { name: true, legalName: true, inn: true, kpp: true }
      });
      if (!before) throw new AdminOrgError('not_found');

      await tx.organization.update({
        where: { id },
        data: {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.legalName !== undefined ? { legalName: args.legalName } : {}),
          ...(args.inn !== undefined ? { inn: args.inn } : {}),
          ...(args.kpp !== undefined ? { kpp: args.kpp } : {})
        }
      });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'organization_updated',
        entity: 'organization',
        entityId: id,
        before,
        after: args
      });
    });
  }
  ```

- [ ] **Step 19.2**: Тест filter wiring + `updateOrganization` audit.

- [ ] **Step 19.3**: `npm run test:unit -- services.admin.organizations` — ✓.

- [ ] **Step 19.4 — Commit:**
  ```bash
  git add src/lib/services/admin/organizations.ts src/__tests__/services.admin.organizations.test.ts
  git commit -m "feat(admin): organizations service — list / get / update + new filters"
  ```

### Task 20: Server actions `src/server-actions/admin/organizations.ts`

**Files:**
- Create: `src/server-actions/admin/organizations.ts`
- Test: `src/__tests__/server-actions.admin.organizations.test.ts`

- [ ] **Step 20.1**: Реализовать. **Важно:** реальные функции в [src/lib/services/partner/rateOverride.ts](../../src/lib/services/partner/rateOverride.ts) — это `setOrgCommissionRate({organizationId, partnerId, newRate, reason, changedByUserId})` и `clearOrgCommissionRate({organizationId, partnerId, reason, changedByUserId})`. `newRate` — дробь в `(0, 1)`, не процент. Обе требуют `partnerId` (валидируют org-under-partner). Admin action должен сначала загрузить `org.partnerId`.
  ```ts
  'use server';
  import { z } from 'zod';
  import { revalidatePath } from 'next/cache';
  import { prisma } from '@/lib/db/prisma';
  import { requireAdmin } from '@/lib/auth/requireRole';
  import { updateOrganization, AdminOrgError, type AdminOrgErrorCode } from '@/lib/services/admin/organizations';
  import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';

  type Failure = { ok: false; error: 'validation' | AdminOrgErrorCode | 'forbidden' | 'not_found' | 'rate_out_of_range'; details?: unknown };

  const updateSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
    legalName: z.string().max(300).nullable().optional(),
    inn: z.string().max(20).nullable().optional(),
    kpp: z.string().max(20).nullable().optional()
  });

  // ratePercent: 0.01..99.99 — будет переведено в дробь /100 на service-вызове
  const overrideSchema = z.object({
    organizationId: z.string().min(1),
    ratePercent: z.coerce.number().gt(0).lt(100).optional(),
    reason: z.string().min(1).max(500),
    clear: z.coerce.boolean().optional()
  });

  function field(fd: FormData, k: string): string {
    const v = fd.get(k);
    return typeof v === 'string' ? v : '';
  }

  function mapErr(e: unknown): Failure {
    if (e instanceof AdminOrgError) return { ok: false, error: e.code };
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('NOT_FOUND')) return { ok: false, error: 'not_found' };
    if (msg.startsWith('RATE_OUT_OF_RANGE')) return { ok: false, error: 'rate_out_of_range' };
    throw e;
  }

  export async function updateOrganizationAction(fd: FormData) {
    const parsed = updateSchema.safeParse({
      id: field(fd, 'id'),
      name: field(fd, 'name') || undefined,
      legalName: field(fd, 'legalName') || undefined,
      inn: field(fd, 'inn') || undefined,
      kpp: field(fd, 'kpp') || undefined
    });
    if (!parsed.success) return { ok: false as const, error: 'validation' as const, details: parsed.error.flatten() };

    const session = await requireAdmin();
    try {
      const { id, ...args } = parsed.data;
      await updateOrganization(prisma, session.sub, id, args);
      revalidatePath(`/admin/organizations/${id}`);
      revalidatePath('/admin/organizations');
      return { ok: true as const };
    } catch (e) {
      return mapErr(e);
    }
  }

  export async function setOrgRateOverrideAction(fd: FormData) {
    const parsed = overrideSchema.safeParse({
      organizationId: field(fd, 'organizationId'),
      ratePercent: field(fd, 'ratePercent') || undefined,
      reason: field(fd, 'reason'),
      clear: field(fd, 'clear') || undefined
    });
    if (!parsed.success) return { ok: false as const, error: 'validation' as const, details: parsed.error.flatten() };

    const session = await requireAdmin();

    // Load org.partnerId — requires for setOrgCommissionRate signature.
    const org = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { partnerId: true }
    });
    if (!org) return { ok: false as const, error: 'not_found' as const };

    try {
      if (parsed.data.clear) {
        await clearOrgCommissionRate(prisma, {
          organizationId: parsed.data.organizationId,
          partnerId: org.partnerId,
          reason: parsed.data.reason,
          changedByUserId: session.sub
        });
      } else if (parsed.data.ratePercent !== undefined) {
        await setOrgCommissionRate(prisma, {
          organizationId: parsed.data.organizationId,
          partnerId: org.partnerId,
          newRate: parsed.data.ratePercent / 100,
          reason: parsed.data.reason,
          changedByUserId: session.sub
        });
      } else {
        return { ok: false as const, error: 'validation' as const };
      }
      revalidatePath(`/admin/organizations/${parsed.data.organizationId}`);
      return { ok: true as const };
    } catch (e) {
      return mapErr(e);
    }
  }

  export async function updateOrgFormAction(fd: FormData): Promise<void> { await updateOrganizationAction(fd); }
  export async function setOrgRateOverrideFormAction(fd: FormData): Promise<void> { await setOrgRateOverrideAction(fd); }
  ```

- [ ] **Step 20.2**: Тест: `updateOrganizationAction` mapping, validation. `setOrgRateOverrideAction` с `clear=true` устанавливает null.

- [ ] **Step 20.3 — Commit:**
  ```bash
  git add src/server-actions/admin/organizations.ts src/__tests__/server-actions.admin.organizations.test.ts
  git commit -m "feat(admin): organization edit + rate-override server actions"
  ```

### Task 21: Components `organization-edit-form.tsx` + `admin-rate-override-form.tsx`

**Files:**
- Create: `src/components/admin/organization-edit-form.tsx`
- Create: `src/components/admin/admin-rate-override-form.tsx`

**Замечание:** `partner/rate-override-form.tsx` нельзя переиспользовать — он hardcoded на API `/api/partner/portfolio/{orgId}/rate` (см. [строка 25](../../src/components/partner/rate-override-form.tsx#L25)). Создаём sibling, который POST'ит в `setOrgRateOverrideAction` (server action из Task 20). Sibling-pattern per CLAUDE.md §4 + memory note `feedback-component-reuse`.

- [ ] **Step 21.1**: Реализовать `organization-edit-form.tsx` (client, паттерн как `UserEditForm`):
  - Поля: `name`, `legalName`, `inn`, `kpp` — editable.
  - `externalId` (1С) — отображается readonly с надписью «из 1С».
  - `partner.name` — readonly section.
  - Submit → `updateOrganizationAction`, шоу ActionResult в alert/status region.

- [ ] **Step 21.2**: Реализовать `admin-rate-override-form.tsx` (client):
  ```tsx
  'use client';
  import { useState, useTransition } from 'react';
  import { useRouter } from 'next/navigation';
  import { setOrgRateOverrideAction } from '@/server-actions/admin/organizations';

  export function AdminRateOverrideForm({
    organizationId,
    initialRate,
    initialNote
  }: {
    organizationId: string;
    initialRate: number | null;  // фракция (0..1) или null если no override
    initialNote: string | null;
  }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [ratePercent, setRatePercent] = useState<string>(
      initialRate !== null ? (initialRate * 100).toFixed(2) : ''
    );
    const [reason, setReason] = useState<string>(initialNote ?? '');

    function submit(action: 'set' | 'clear') {
      setError(null);
      startTransition(async () => {
        const fd = new FormData();
        fd.set('organizationId', organizationId);
        fd.set('reason', reason || (action === 'clear' ? 'Возврат к базовой ставке' : ''));
        if (action === 'set') fd.set('ratePercent', ratePercent);
        if (action === 'clear') fd.set('clear', 'true');

        const result = await setOrgRateOverrideAction(fd);
        if (result.ok) {
          router.refresh();
        } else {
          setError(translateRateError(result.error));
        }
      });
    }

    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-[#111111]">Ставка комиссии партнёра для этой организации</h2>

        <label className="block">
          <span className="text-sm text-gray-700">Ставка, %</span>
          <input
            type="number" step="0.01" min="0.01" max="99.99"
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
            placeholder="напр. 8.00"
            className="mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-48 focus:outline-none focus:border-[#F97316]"
          />
        </label>

        <label className="block">
          <span className="text-sm text-gray-700">Обоснование (audit log)</span>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)}
            rows={2} placeholder="Например: VIP-клиент, индивидуальные условия"
            className="mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]"
          />
        </label>

        {error && <div role="alert" className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{error}</div>}

        <div className="flex gap-2">
          <button
            type="button" onClick={() => submit('set')}
            disabled={pending || !ratePercent || !reason.trim()}
            className="px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
          >Сохранить</button>
          {initialRate !== null && (
            <button
              type="button" onClick={() => submit('clear')} disabled={pending}
              className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >Вернуть базовую ставку</button>
          )}
        </div>
      </div>
    );
  }

  function translateRateError(code: string): string {
    switch (code) {
      case 'rate_out_of_range': return 'Ставка должна быть строго между 0 и 100%.';
      case 'not_found': return 'Организация не найдена.';
      case 'validation': return 'Проверьте корректность полей.';
      default: return `Ошибка: ${code}`;
    }
  }
  ```

- [ ] **Step 21.3 — Commit:**
  ```bash
  git add src/components/admin/organization-edit-form.tsx src/components/admin/admin-rate-override-form.tsx
  git commit -m "feat(admin): organization-edit-form + admin-rate-override-form (sibling of partner)"
  ```

### Task 22: Обновить `/admin/organizations/[id]/page.tsx` + `/admin/organizations/page.tsx`

**Files:**
- Modify: `src/app/admin/organizations/[id]/page.tsx`
- Modify: `src/app/admin/organizations/page.tsx`

- [ ] **Step 22.1**: На `/admin/organizations/[id]/page.tsx`:
  - Импортировать `OrganizationEditForm` и `AdminRateOverrideForm` (оба из `src/components/admin/`).
  - Сделать `getOrganization(prisma, id)` через новый сервис из Task 19.
  - Добавить блок «Реквизиты» с `<OrganizationEditForm org={org}>`.
  - Добавить блок «Ставка комиссии» с `<AdminRateOverrideForm organizationId={org.id} initialRate={org.partnerCommissionRate} initialNote={org.partnerCommissionRateNote ?? null} />`. Прим.: добавь `partnerCommissionRateNote` в `select` в `getOrganization` Task 19 если ещё нет.
  - Сохраняем существующие `CustomerAccessSection` и `ManagersBlock`.

- [ ] **Step 22.2**: На `/admin/organizations/page.tsx`:
  - Переключить inline-query на `listOrganizations(prisma, filters)`.
  - Добавить новые фильтры в SP-тип: `partnerId`, `withRateOverride`.
  - Расширить форму поиска: dropdown «Партнёр» (загружается из `Partner.findMany`) + чекбокс «Со ставкой override».

- [ ] **Step 22.3**: `npm run typecheck && npm run build`.

- [ ] **Step 22.4 — Commit:**
  ```bash
  git add src/app/admin/organizations/[id]/page.tsx src/app/admin/organizations/page.tsx
  git commit -m "feat(admin): wire OrganizationEditForm + RateOverrideForm + new list filters"
  ```

### Task 23: PR-3 финальная проверка + push + PR

- [ ] **Step 23.1**: typecheck / lint / test:unit / build / dev boot — ✓.

- [ ] **Step 23.2**: Push + PR (analogous to Task 10/18). Заголовок: `feat(admin): 6.5 Organizations delta`.

---

# PR-4 — 6.6 Audit log viewer

### Task 24: Service `src/lib/services/admin/auditLog.ts` — types + `listAudit` (cursor pagination)

**Files:**
- Create: `src/lib/services/admin/auditLog.ts`
- Test: `src/__tests__/services.admin.auditLog.test.ts`

- [ ] **Step 24.1**: Реализовать `listAudit`:
  ```ts
  import type { PrismaClient, Prisma } from '@prisma/client';
  import type { AuditEntity } from '@/lib/auth/audit';

  export type AuditFilters = {
    entity?: AuditEntity;
    action?: string;
    actorUserId?: string;
    from?: Date;
    to?: Date;
    q?: string;
    take?: number;     // default 50, max 100
    cursor?: string;   // id of last seen, exclusive
  };

  export type AuditRow = {
    id: string;
    createdAt: Date;
    actor: { id: string; email: string; name: string } | null;
    action: string;
    entity: AuditEntity;
    entityId: string;
    meta: Prisma.JsonValue;
  };

  export async function listAudit(
    prisma: PrismaClient,
    filters: AuditFilters
  ): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
    const take = Math.min(Math.max(filters.take ?? 50, 1), 100);

    const where: Prisma.AuditLogWhereInput = {};
    if (filters.entity) where.entity = filters.entity;
    if (filters.action) where.action = filters.action;
    if (filters.actorUserId) where.userId = filters.actorUserId;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) (where.createdAt as Prisma.DateTimeFilter).gte = filters.from;
      if (filters.to) (where.createdAt as Prisma.DateTimeFilter).lte = filters.to;
    }
    if (filters.q) {
      where.meta = { path: [], string_contains: filters.q } as Prisma.JsonFilter;
      // NB: Prisma JsonFilter может не поддерживать ILIKE напрямую.
      // Альтернатива через raw: prisma.$queryRaw для meta::text ILIKE.
      // В MVP — если JsonFilter не работает, удалить q-фильтр из сервиса и реализовать через
      // отдельный path с prisma.$queryRaw'ом. См. note в spec §7.7.
    }

    const rows = await prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1, // +1 чтобы определить, есть ли next page
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });

    let nextCursor: string | null = null;
    if (rows.length > take) {
      const last = rows.pop()!;
      nextCursor = rows[rows.length - 1]?.id ?? last.id;
    }

    return {
      rows: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        actor: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null,
        action: r.action,
        entity: r.entity as AuditEntity,
        entityId: r.entityId,
        meta: r.meta
      })),
      nextCursor
    };
  }
  ```

  **Замечание:** Prisma `JsonFilter` для PostgreSQL имеет ограниченную поддержку ILIKE. Если `string_contains` не работает on real DB — реализуй `q` через raw SQL: `prisma.$queryRaw\`SELECT ... WHERE meta::text ILIKE \${'%'+q+'%'} ORDER BY ...\``. Это критично — но реализовать только когда первый JSON-test упадёт. До тех пор — оставь Prisma's `string_contains`.

- [ ] **Step 24.2**: Тесты:
  - Cursor pagination: при 51 row'е с `take=50` возвращает 50 + nextCursor.
  - Все 5 фильтров пробрасываются в `where`.
  - Без фильтров — orderBy: `createdAt desc, id desc`.

- [ ] **Step 24.3**: `npm run test:unit -- services.admin.auditLog` — ✓.

- [ ] **Step 24.4 — Commit:**
  ```bash
  git add src/lib/services/admin/auditLog.ts src/__tests__/services.admin.auditLog.test.ts
  git commit -m "feat(admin): listAudit service with cursor pagination + filters"
  ```

### Task 25: `listAuditFilters` (dropdown population)

**Files:**
- Modify: `src/lib/services/admin/auditLog.ts`
- Modify: `src/__tests__/services.admin.auditLog.test.ts`

- [ ] **Step 25.1**: Добавить функцию:
  ```ts
  export type AuditFiltersOptions = {
    entities: AuditEntity[];
    actions: string[];
    actors: Array<{ id: string; name: string; email: string }>;
  };

  export async function listAuditFilters(
    prisma: PrismaClient
  ): Promise<AuditFiltersOptions> {
    const [entityRows, actionRows] = await Promise.all([
      prisma.auditLog.findMany({
        distinct: ['entity'],
        select: { entity: true },
        orderBy: { entity: 'asc' }
      }),
      prisma.auditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' }
      })
    ]);

    const actorIds = await prisma.auditLog.findMany({
      distinct: ['userId'],
      select: { userId: true },
      take: 200
    });
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds.map((r) => r.userId).filter(Boolean) as string[] } },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' }
        })
      : [];

    return {
      entities: entityRows.map((r) => r.entity as AuditEntity),
      actions: actionRows.map((r) => r.action),
      actors
    };
  }
  ```

- [ ] **Step 25.2**: Тест: вызывает 3 distinct query, возвращает обработанный shape.

- [ ] **Step 25.3 — Commit:**
  ```bash
  git add src/lib/services/admin/auditLog.ts src/__tests__/services.admin.auditLog.test.ts
  git commit -m "feat(admin): listAuditFilters — distinct entities/actions/actors"
  ```

### Task 26: Component `audit-log-filters.tsx`

**Files:**
- Create: `src/components/admin/audit-log-filters.tsx`

- [ ] **Step 26.1**: Реализовать server component:
  - `<form method="get">` с пятью полями: entity, action, actorUserId, from/to, q.
  - Actions group by entity-prefix через `<optgroup>` (per spec §7.4):
    ```tsx
    function groupActions(actions: string[]): Record<string, string[]> {
      const groups: Record<string, string[]> = {};
      for (const a of actions) {
        const prefix = a.split('_')[0];
        (groups[prefix] = groups[prefix] ?? []).push(a);
      }
      return groups;
    }
    ```
  - From/to — `<input type="date">`.
  - Подключается с пропсами `{ entities, actions, actors, current }`.

- [ ] **Step 26.2 — Commit:**
  ```bash
  git add src/components/admin/audit-log-filters.tsx
  git commit -m "feat(admin): audit-log-filters server component with grouped action dropdown"
  ```

### Task 27: Component `audit-log-table.tsx`

**Files:**
- Create: `src/components/admin/audit-log-table.tsx`

- [ ] **Step 27.1**: Реализовать server component:
  - Колонки: `Когда · Actor · Action · Entity · ID · Detail`.
  - «Когда» — `Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium' })`.
  - «Detail» — `<DetailButton row={row} />` — отдельный client component, который держит dialog state.

- [ ] **Step 27.2**: Внутри файла — small client component:
  ```tsx
  'use client';
  import { useState } from 'react';
  import type { AuditRow } from '@/lib/services/admin/auditLog';
  import { AuditDiffDialog } from './audit-diff-dialog';

  export function DetailButton({ row }: { row: AuditRow }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[#F97316] text-xs hover:underline"
        >
          Подробно
        </button>
        {open && <AuditDiffDialog row={row} onClose={() => setOpen(false)} />}
      </>
    );
  }
  ```

  Поскольку файл должен быть server, а DetailButton — client, **выдели DetailButton в отдельный файл** `src/components/admin/audit-detail-button.tsx`, чтобы parent `audit-log-table.tsx` остался server.

- [ ] **Step 27.3 — Commit:**
  ```bash
  git add src/components/admin/audit-log-table.tsx src/components/admin/audit-detail-button.tsx
  git commit -m "feat(admin): audit-log-table server component + detail-button client trigger"
  ```

### Task 28: Component `audit-diff-dialog.tsx` + secret masking

**Files:**
- Create: `src/components/admin/audit-diff-dialog.tsx`
- Test: `src/__tests__/components.admin-audit-diff-dialog.test.tsx`

- [ ] **Step 28.1**: Реализовать modal-with-backdrop по a11y-контракту [src/hooks/useDialogFocus.ts](../../src/hooks/useDialogFocus.ts):
  ```tsx
  'use client';
  import { useEffect } from 'react';
  import { useDialogFocus } from '@/hooks/useDialogFocus';
  import type { AuditRow } from '@/lib/services/admin/auditLog';

  const SENSITIVE_KEY_REGEX = /^(passwordHash|token|code|secret|apiKey|signedUrl|.*Secret|.*Token)$/i;

  function maskValue(key: string, value: unknown): unknown {
    if (SENSITIVE_KEY_REGEX.test(key)) return '*****';
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) return value.map((v, i) => maskValue(`${i}`, v));
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, maskValue(k, v)])
      );
    }
    return value;
  }

  function maskedJsonString(meta: unknown, keys: string[]): string {
    if (!meta || typeof meta !== 'object') return '';
    const filtered = Object.fromEntries(
      Object.entries(meta as Record<string, unknown>).filter(([k]) => keys.includes(k))
    );
    return JSON.stringify(maskValue('', filtered), null, 2);
  }

  function maskedExtraJsonString(meta: unknown, excludeKeys: string[]): string {
    if (!meta || typeof meta !== 'object') return '';
    const extras = Object.fromEntries(
      Object.entries(meta as Record<string, unknown>).filter(([k]) => !excludeKeys.includes(k))
    );
    if (Object.keys(extras).length === 0) return '';
    return JSON.stringify(maskValue('', extras), null, 2);
  }

  export function AuditDiffDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
    const ref = useDialogFocus(true);

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const before = maskedJsonString(row.meta, ['before']);
    const after = maskedJsonString(row.meta, ['after']);
    const extras = maskedExtraJsonString(row.meta, ['before', 'after']);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-diff-title"
          className="bg-white rounded-xl max-w-3xl w-full max-h-[80vh] overflow-auto p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="audit-diff-title" className="text-lg font-bold text-[#111111] mb-2">
            {row.action} · {row.entity}
          </h2>
          <div className="text-xs text-gray-500 mb-4">{row.id}</div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-medium text-gray-700 mb-1">До</div>
              <pre className="bg-gray-50 border border-gray-200 rounded p-3 font-mono whitespace-pre-wrap overflow-auto max-h-[40vh]">
                {before || '—'}
              </pre>
            </div>
            <div>
              <div className="font-medium text-gray-700 mb-1">После</div>
              <pre className="bg-gray-50 border border-gray-200 rounded p-3 font-mono whitespace-pre-wrap overflow-auto max-h-[40vh]">
                {after || '—'}
              </pre>
            </div>
          </div>

          {extras && (
            <div className="mt-4">
              <div className="text-xs font-medium text-gray-700 mb-1">Прочие meta-поля</div>
              <pre className="bg-gray-50 border border-gray-200 rounded p-3 font-mono text-xs whitespace-pre-wrap overflow-auto max-h-[20vh]">
                {extras}
              </pre>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-4 px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50"
          >
            Закрыть
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 28.2**: Тест на secret masking:
  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { AuditDiffDialog } from '@/components/admin/audit-diff-dialog';

  describe('AuditDiffDialog', () => {
    it('маскирует passwordHash в meta.after', () => {
      const row = {
        id: 'a1',
        createdAt: new Date(),
        actor: null,
        action: 'user_updated',
        entity: 'user' as const,
        entityId: 'u1',
        meta: { after: { name: 'X', passwordHash: 'super-secret-bcrypt' } }
      };
      render(<AuditDiffDialog row={row} onClose={() => {}} />);

      expect(screen.queryByText(/super-secret-bcrypt/)).toBeNull();
      // Маскированное значение присутствует
      expect(screen.queryAllByText(/\*\*\*\*\*/).length).toBeGreaterThan(0);
    });

    it('маскирует token, signedUrl в meta.before', () => {
      const row = {
        id: 'a1', createdAt: new Date(), actor: null,
        action: 'foo', entity: 'document' as const, entityId: 'd1',
        meta: { before: { token: 'tok-xyz', signedUrl: 'https://s/sig=secret' } }
      };
      render(<AuditDiffDialog row={row} onClose={() => {}} />);
      expect(screen.queryByText(/tok-xyz/)).toBeNull();
      expect(screen.queryByText(/sig=secret/)).toBeNull();
    });

    it('отрисовывает «Прочие meta-поля» для нестандартных ключей', () => {
      const row = {
        id: 'a1', createdAt: new Date(), actor: null,
        action: 'foo', entity: 'user' as const, entityId: 'u1',
        meta: { sentEmail: true, source: 'admin' }
      };
      render(<AuditDiffDialog row={row} onClose={() => {}} />);
      expect(screen.getByText(/Прочие meta-поля/)).toBeTruthy();
    });
  });
  ```

- [ ] **Step 28.3**: `npm run test:unit -- admin-audit-diff-dialog` — ✓.

- [ ] **Step 28.4 — Commit:**
  ```bash
  git add src/components/admin/audit-diff-dialog.tsx src/__tests__/components.admin-audit-diff-dialog.test.tsx
  git commit -m "feat(admin): audit-diff-dialog with regex secret masking + a11y dialog"
  ```

### Task 29: Page `/admin/audit` + wire

**Files:**
- Create: `src/app/admin/audit/page.tsx`

- [ ] **Step 29.1**: Реализовать страницу:
  ```tsx
  import Link from 'next/link';
  import { requireAdmin } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import type { AuditEntity } from '@/lib/auth/audit';
  import { listAudit, listAuditFilters } from '@/lib/services/admin/auditLog';
  import { AuditLogFilters } from '@/components/admin/audit-log-filters';
  import { AuditLogTable } from '@/components/admin/audit-log-table';

  export const dynamic = 'force-dynamic';

  type SP = {
    entity?: string;
    action?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
    q?: string;
    cursor?: string;
  };

  function parseDate(v?: string): Date | undefined {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : undefined;
  }

  export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<SP> }) {
    await requireAdmin();
    const sp = await searchParams;

    const filters = {
      entity: sp.entity as AuditEntity | undefined,
      action: sp.action || undefined,
      actorUserId: sp.actorUserId || undefined,
      from: parseDate(sp.from),
      to: parseDate(sp.to),
      q: sp.q?.trim() || undefined,
      cursor: sp.cursor || undefined,
      take: 50
    };

    const [{ rows, nextCursor }, options] = await Promise.all([
      listAudit(prisma, filters),
      listAuditFilters(prisma)
    ]);

    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#111111]">Аудит</h1>
        <AuditLogFilters options={options} current={sp} />
        <AuditLogTable rows={rows} />
        {nextCursor && (
          <LoadMore sp={sp} cursor={nextCursor} />
        )}
      </div>
    );
  }

  function LoadMore({ sp, cursor }: { sp: SP; cursor: string }) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'cursor') p.set(k, v);
    p.set('cursor', cursor);
    return (
      <div className="text-center">
        <Link
          href={`/admin/audit?${p.toString()}`}
          className="inline-block px-4 py-2 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50"
        >
          Загрузить ещё
        </Link>
      </div>
    );
  }
  ```

- [ ] **Step 29.2**: `npm run typecheck && npm run build` — `/admin/audit` в выводе.

- [ ] **Step 29.3 — Commit:**
  ```bash
  git add src/app/admin/audit/page.tsx
  git commit -m "feat(admin): /admin/audit page with filters + cursor pagination"
  ```

### Task 30: PR-4 финальная проверка + push + PR

- [ ] **Step 30.1**: typecheck / lint / test:unit / build / dev boot — ✓.

- [ ] **Step 30.2**: Push + PR. Заголовок: `feat(admin): 6.6 Audit log viewer`.

---

# PR-5 — 6.7 Polish

### Task 31: Dashboard drill-down links

**Files:**
- Modify: `src/app/admin/dashboard/page.tsx`
- Modify: соответствующие dashboard widget'ы (читать существующий код)

- [ ] **Step 31.1**: Прочитать `src/app/admin/dashboard/page.tsx` и понять структуру events-feed/attention-list.

- [ ] **Step 31.2**: Каждый event в events-feed обернуть в `<Link href={\`/admin/audit?entity=\${event.entity}&action=\${event.action}\`}>`.

- [ ] **Step 31.3**: Attention list:
  - «Партнёры без ставки» → `<Link href="/admin/partners?filter=norate">`.
  - «DLQ jobs > 0» → ссылка на `/admin/health` (если ещё нет).
  - «Approved CS > 7д» → ссылка на `/admin/commission-statements?status=approved` (если ещё нет).

- [ ] **Step 31.4 — Commit:**
  ```bash
  git add src/app/admin/dashboard/page.tsx
  git commit -m "feat(admin): drill-down links from dashboard to audit and filtered lists"
  ```

### Task 32: `prisma/seed.ts` — admin-facing fixtures

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 32.1**: Прочитать существующий `prisma/seed.ts`. Убедиться, что есть:
  - `admin@demo.local` user (Phase 6.1 added).
  - 2+ partners — один со ставкой, один без (для filter=norate test).
  - 1+ organization без override + 1+ с override (для withRateOverride test).
  - 5+ audit log записей разных entities/actions (для audit viewer snapshot).

- [ ] **Step 32.2**: Если чего-то нет — добавить inserts. Аккуратно, чтобы не сломать существующие partner/organization/manager seed.

- [ ] **Step 32.3**: `npm run prisma:seed` после `npm run prisma:migrate:dev` локально — отрабатывает без ошибок.

- [ ] **Step 32.4 — Commit:**
  ```bash
  git add prisma/seed.ts
  git commit -m "chore(seed): admin-facing fixtures (norate partner, audit events sample)"
  ```

### Task 33: `auth.setup.ts` — admin login block

**Files:**
- Modify: `src/e2e/auth.setup.ts`

- [ ] **Step 33.1**: Прочитать существующий `auth.setup.ts`. Добавить 4-й setup block после partner/organization/manager — логинит `admin@demo.local` и сохраняет в `playwright-report/.auth/admin.json`. По образцу blocks 1-3.

- [ ] **Step 33.2 — Commit:**
  ```bash
  git add src/e2e/auth.setup.ts
  git commit -m "test(e2e): admin auth setup block"
  ```

### Task 34: `playwright.config.ts` — admin projects

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 34.1**: Прочитать существующий config. Добавить:
  ```ts
  {
    name: 'admin-desktop',
    use: { ...devices['Desktop Chrome'], storageState: 'playwright-report/.auth/admin.json' },
    testMatch: /snapshots\/admin-.*\.spec\.ts/
  },
  {
    name: 'admin-mobile',
    use: { ...devices['iPhone 13'], storageState: 'playwright-report/.auth/admin.json' },
    testMatch: /snapshots\/admin-.*\.spec\.ts/
  }
  ```

- [ ] **Step 34.2**: Проверить, что existing `partner-*` / `org-*` / `mgr-*` projects используют **negative-lookahead** или явные testMatch, чтобы admin specs не попали в их выборки.

- [ ] **Step 34.3 — Commit:**
  ```bash
  git add playwright.config.ts
  git commit -m "test(e2e): admin-desktop and admin-mobile playwright projects"
  ```

### Task 35: 4 e2e snapshot specs

**Files:**
- Create: `src/e2e/snapshots/admin-users.spec.ts`
- Create: `src/e2e/snapshots/admin-partners.spec.ts`
- Create: `src/e2e/snapshots/admin-organizations-edit.spec.ts`
- Create: `src/e2e/snapshots/admin-audit.spec.ts`

- [ ] **Step 35.1**: По образцу `src/e2e/snapshots/manager-dashboard.spec.ts`:
  ```ts
  // admin-users.spec.ts
  import { test, expect } from '@playwright/test';

  test('admin users list', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('admin-users-list.png', { fullPage: true });
  });

  test('admin users — filter by role partner', async ({ page }) => {
    await page.goto('/admin/users?role=partner');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('admin-users-filtered.png', { fullPage: true });
  });
  ```

- [ ] **Step 35.2**: `admin-partners.spec.ts` — list view + edit page для одного партнёра (используй seeded id).

- [ ] **Step 35.3**: `admin-organizations-edit.spec.ts` — `/admin/organizations/[id]` с edit-form и rate override visible.

- [ ] **Step 35.4**: `admin-audit.spec.ts` — list view с applied filter + (optional) click «Подробно» button и snapshot dialog.

- [ ] **Step 35.5**: **Baselines НЕ committed** (как Phase 5/8). Генерируются на первом staged Linux/Chromium run через `npm run e2e:visual:update`.

- [ ] **Step 35.6 — Commit:**
  ```bash
  git add src/e2e/snapshots/admin-users.spec.ts src/e2e/snapshots/admin-partners.spec.ts src/e2e/snapshots/admin-organizations-edit.spec.ts src/e2e/snapshots/admin-audit.spec.ts
  git commit -m "test(e2e): visual regression specs for admin users/partners/orgs-edit/audit"
  ```

### Task 36: PR-5 финальная проверка + push + PR

- [ ] **Step 36.1**: `npm run typecheck && npm run lint && npm run test:unit && npm run test:integration && npm run build` — ✓.

- [ ] **Step 36.2**: `npm run dev` boot check.

- [ ] **Step 36.3**: Локально `npm run e2e:visual:update` → визуально проверить baselines → закоммитить.

- [ ] **Step 36.4 — Commit baselines:**
  ```bash
  git add src/e2e/snapshots/admin-*-snapshots/
  git commit -m "test(e2e): admin baselines committed after visual review"
  ```

- [ ] **Step 36.5**: Push + PR. Заголовок: `feat(admin): 6.7 Polish — dashboard drill-down + e2e snapshots`.

---

## После merge всех 5 PR

- [ ] **Создать close-out**: `docs/superpowers/plans/2026-05-29-admin-cabinet-6.3-6.7-DONE.md` (companion summary per CLAUDE.md §8 + memory note `feedback-done-plan-convention`).
- [ ] **Обновить** [README.md](../../README.md) §«Cabinet rollout status»: Admin теперь `Production (Phase 6.0–6.7 done)`.
- [ ] **Закрыть** [2026-05-24-admin-cabinet-mvp-PARTIAL.md](2026-05-24-admin-cabinet-mvp-PARTIAL.md) ссылкой на новый DONE.
- [ ] **Memory update**: добавить `reference-admin-plan.md` (PR-номера, дата).
