# M4 — Внутренний чат сотрудников: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff↔staff чат (ЛС + «# Общий» на компанию) с @упоминаниями (в чате и в DealNote), реакциями, вложениями через AV-конвейер, поллингом и бейджем непрочитанного — за поведенческим opt-in флагом `staff_chat`.

**Architecture:** Отдельный staff-домен (подход A): 5 новых Prisma-моделей, policy-модуль `staffChatPolicy` (admin Model A; C8-sentinel `'__no_company__'`), сервисы `src/lib/services/staffChat/*` по Result-контракту §3, тонкие роуты `/api/staff-chat/*` (паттерн `api/messages`: `notFoundIfDisabled` → `requireSession`+`requireRole(['admin','manager'])` → сервис → мапинг кодов), UI-секции на существующих `/manager/messages` и `/admin/messages`. Вложения — по образцу `inbound_attachment` (S3 + `docs.scanDocument` c новым `kind:'staff_attachment'`), НЕ по образцу клиентского чата (тот скан отложил в v1.1 — не наследуем долг). Идемпотентность ЛС — unique `dmKey` в БД; «один general на компанию» — партиальный unique-индекс (прецедент C-01).

**Tech Stack:** Next.js 15 (App Router) · React 19 · TS strict · Prisma 5 + PostgreSQL · BullMQ (скан) · Vitest.

**Спека:** [2026-07-17-m4-staff-chat-design.md](../specs/2026-07-17-m4-staff-chat-design.md). Инварианты репо в каждой задаче: §3 Result, §4 defense-in-depth, §5 флаги, §6 100% coverage, §13 узкие селекты, логи только `@/lib/logging`.

**Два решения, делегированные агенту (зафиксированы):** (1) вложения сканируются (образец `inbound_attachment`), в отличие от клиентского чата; (2) UI — стековая секция «Чат команды» на существующих страницах (не табы) — идиома страниц сохраняется, мокап определял содержимое секции.

---

## Карта файлов

**Создаём:**
- `src/lib/services/staffChat/policy.ts` — `isStaff`, `canSeeStaffConversation`, `NO_COMPANY_SENTINEL`.
- `src/lib/services/staffChat/conversations.ts` — `ensureGeneral`, `openDm`, `listConversations`, `staffUnreadCount`, `markStaffRead`.
- `src/lib/services/staffChat/messages.ts` — `sendStaffMessage`, `listStaffMessages`, `toggleReaction`, `STAFF_REACTION_EMOJI`.
- `src/lib/services/staffChat/mentions.ts` — `extractMentions`, `listColleagues`.
- `src/lib/services/staffChat/attachments.ts` — `uploadStaffAttachment`, `getStaffAttachmentSignedUrl`.
- API: `src/app/api/staff-chat/{conversations,messages,read,reactions,dm,colleagues,unread}/route.ts` + `src/app/api/staff-chat/attachment/route.ts`.
- UI: `src/components/staff-chat/{staff-chat-section.tsx,staff-conversation-list.tsx,staff-thread-view.tsx,staff-composer.tsx,staff-unread-badge.tsx}`; hook `src/hooks/useStaffChatPolling.ts`.
- Тесты: `services.staff-chat.policy.unit.test.ts`, `services.staff-chat.conversations.unit.test.ts`, `services.staff-chat.messages.unit.test.ts`, `services.staff-chat.mentions.unit.test.ts`, `services.staff-chat.attachments.unit.test.ts`, `api.staff-chat.routes.test.ts`, `components.staff-chat.test.tsx`, `hooks.useStaffChatPolling.test.ts`, `services.staff-chat.isolation.integration.test.ts`.

**Модифицируем:**
- `prisma/schema.prisma` — 5 моделей + enum + back-relations (User/Company).
- `src/lib/featureFlags.ts` — флаг `staff_chat` (FEATURE_FLAGS + OPT_IN_FLAGS + комментарий с точками чтения).
- `src/lib/jobs/types.ts` — `ScanDocumentTarget` + `'staff_attachment'`.
- `src/worker/processors/scan-document.ts` — ветки `loadTarget`/`persistResult` для `staff_attachment`.
- `src/lib/services/scan/backfill.ts` — sweep staff-вложений со `scanStatus='pending'`.
- `src/lib/auth/audit.ts` — если `AuditEntity` — закрытый union, добавить `'staff_conversation'`.
- `src/lib/services/manager/dealNotes.ts` — упоминания в заметке → уведомления (M1-долг).
- `src/app/manager/messages/page.tsx`, `src/app/admin/messages/page.tsx` — секция «Чат команды».
- Тесты соответствующих страниц/процессора: `pages.manager-messages.test.tsx`, `pages.admin-messages.test.tsx`, `worker.scan-document.test.ts`, `services.deal-notes.unit.test.ts`, тест backfill.

---

## Task 1: Схема + флаг `staff_chat`

**Files:** Modify `prisma/schema.prisma`, `src/lib/featureFlags.ts`; Create (авто+ручная правка) `prisma/migrations/<ts>_m4_staff_chat/migration.sql`.

- [ ] **Step 1: Модели в `prisma/schema.prisma`**

Добавить enum (рядом с остальными enum) и 5 моделей (в конец файла), плюс back-relations:

```prisma
enum StaffConversationKind {
  dm
  general
}
```

```prisma
/// M4 (спека 2026-07-17): внутренний чат сотрудников — ОТДЕЛЬНЫЙ домен от клиентского
/// чата (OrderThread): несовместимые модели видимости (§4 sibling-rule). dm: ровно 2
/// StaffParticipant; general: участников-строк нет (членство = все staff компании + admin,
/// Model A). dmKey = отсортированная пара "userAId:userBId" — «один ЛС на пару» держится
/// констрейнтом БД, не кодом (класс гонок C-01). «Один general на компанию» — партиальный
/// unique-индекс в миграции (Prisma его не выражает; прецедент C-01).
model StaffConversation {
  id            String                @id @default(cuid())
  createdAt     DateTime              @default(now())
  companyId     String
  company       Company               @relation(fields: [companyId], references: [id], onDelete: Cascade)
  kind          StaffConversationKind
  dmKey         String?               @unique
  lastMessageAt DateTime              @default(now())
  participants  StaffParticipant[]
  messages      StaffMessage[]
  readStates    StaffMessageRead[]

  @@index([companyId, lastMessageAt])
}

model StaffParticipant {
  id             String            @id @default(cuid())
  createdAt      DateTime          @default(now())
  conversationId String
  conversation   StaffConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userId         String
  user           User              @relation("StaffChatParticipant", fields: [userId], references: [id], onDelete: Cascade)

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

  reactions StaffReaction[]

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

В `model User` (блок relations): `staffChatParticipations StaffParticipant[] @relation("StaffChatParticipant")`, `staffMessagesAuthored StaffMessage[] @relation("StaffMessageAuthor")`, `staffReadStates StaffMessageRead[] @relation("StaffChatReadState")`, `staffReactions StaffReaction[] @relation("StaffReactionAuthor")`. В `model Company`: `staffConversations StaffConversation[]`.

- [ ] **Step 2: Флаг `staff_chat`**

В `src/lib/featureFlags.ts`: в массив `FEATURE_FLAGS` (стиль staff_2fa — поведенческий, перечислить точки чтения):
```ts
  // M4: внутренний чат сотрудников. Поведенческий флаг (не route): точки чтения —
  // секции «Чат команды» на /manager/messages и /admin/messages (isFeatureEnabled),
  // все /api/staff-chat/* хендлеры (notFoundIfDisabled), staff-бейдж непрочитанного.
  // Спека 2026-07-17-m4-staff-chat.
  'staff_chat',
```
И тот же ключ — в `OPT_IN_FLAGS`.

- [ ] **Step 3: Миграция с партиальным unique**

```bash
npx prisma migrate dev --create-only --name m4_staff_chat
```
В сгенерированный `migration.sql` добавить в конец:
```sql
-- M4: ровно один general-канал на компанию (Prisma не выражает partial unique; прецедент C-01)
CREATE UNIQUE INDEX "StaffConversation_one_general_per_company" ON "StaffConversation"("companyId") WHERE "kind" = 'general';
```
Затем: `npx prisma migrate dev` (применит правленую миграцию) и `npm run prisma:generate`.

- [ ] **Step 4: Проверка**

Run: `npm run typecheck && npx prisma migrate status`
Expected: PASS; `Database schema is up to date!`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/featureFlags.ts
git commit -m "feat(m4): staff-chat schema (5 models, dmKey unique, partial general unique) + staff_chat flag"
```

---

## Task 2: Policy + conversations-сервис

**Files:** Create `src/lib/services/staffChat/policy.ts`, `src/lib/services/staffChat/conversations.ts`; Test `src/__tests__/services.staff-chat.policy.unit.test.ts`, `src/__tests__/services.staff-chat.conversations.unit.test.ts`.

- [ ] **Step 1: Падающий тест policy**

`src/__tests__/services.staff-chat.policy.unit.test.ts`:
```ts
import { it, expect } from 'vitest';
import { isStaff, canSeeStaffConversation } from '@/lib/services/staffChat/policy';

const conv = (over: Partial<{ kind: 'dm' | 'general'; companyId: string }> = {}) => ({
  kind: over.kind ?? 'general',
  companyId: over.companyId ?? 'c1'
});

it('isStaff: admin/manager true; partner/organization/student false', () => {
  expect(isStaff({ role: 'admin' } as never)).toBe(true);
  expect(isStaff({ role: 'manager' } as never)).toBe(true);
  expect(isStaff({ role: 'partner' } as never)).toBe(false);
  expect(isStaff({ role: 'organization' } as never)).toBe(false);
  expect(isStaff({ role: 'student' } as never)).toBe(false);
});

it('admin sees everything (Model A)', () => {
  expect(canSeeStaffConversation({ role: 'admin', sub: 'a1', companyId: null } as never, conv(), [])).toBe(true);
  expect(canSeeStaffConversation({ role: 'admin', sub: 'a1', companyId: null } as never, conv({ kind: 'dm' }), ['x', 'y'])).toBe(true);
});

it('manager sees general only of own company; companyId=null → deny', () => {
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm1', companyId: 'c1' } as never, conv(), [])).toBe(true);
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm1', companyId: 'c2' } as never, conv(), [])).toBe(false);
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm1', companyId: null } as never, conv(), [])).toBe(false);
});

it('dm visible only to participants (manager)', () => {
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm1', companyId: 'c1' } as never, conv({ kind: 'dm' }), ['m1', 'm2'])).toBe(true);
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm3', companyId: 'c1' } as never, conv({ kind: 'dm' }), ['m1', 'm2'])).toBe(false);
});

it('client roles never see anything', () => {
  expect(canSeeStaffConversation({ role: 'partner', sub: 'p1', companyId: 'c1' } as never, conv(), [])).toBe(false);
  expect(canSeeStaffConversation({ role: 'organization', sub: 'o1', companyId: 'c1' } as never, conv({ kind: 'dm' }), ['o1'])).toBe(false);
});
```

- [ ] **Step 2: Run — FAIL** (`policy.ts` нет): `npx vitest run src/__tests__/services.staff-chat.policy.unit.test.ts`

- [ ] **Step 3: Реализовать `policy.ts`**

```ts
import type { SessionPayload } from '@/lib/auth/jwt';

/** C8-sentinel: companyId=null у staff-сессии режет выборку в ноль, а не «во всё» (паттерн chat/threads.ts). */
export const NO_COMPANY_SENTINEL = '__no_company__';

export type StaffConversationView = { kind: 'dm' | 'general'; companyId: string };

export function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

/**
 * M4 §2.2: admin — Model A (видит и участвует везде); dm — только участники;
 * general — только staff своей компании (companyId=null → deny).
 */
export function canSeeStaffConversation(
  session: SessionPayload,
  conversation: StaffConversationView,
  participantUserIds: string[]
): boolean {
  if (!isStaff(session)) return false;
  if (session.role === 'admin') return true;
  if (conversation.kind === 'dm') return participantUserIds.includes(session.sub);
  return !!session.companyId && conversation.companyId === session.companyId;
}
```

- [ ] **Step 4: Падающий тест conversations**

`src/__tests__/services.staff-chat.conversations.unit.test.ts` — mock-паттерн `vi.hoisted`. Ключевые случаи (полный список — пиши по образцу chat-тестов):
```ts
import { it, expect, vi, beforeEach } from 'vitest';

import {
  ensureGeneral,
  openDm,
  listConversations,
  staffUnreadCount,
  markStaffRead,
  dmKeyFor
} from '@/lib/services/staffChat/conversations';

const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as never;
const admin = { sub: 'a1', role: 'admin', companyId: null } as never;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as never;

beforeEach(() => vi.clearAllMocks());

it('dmKeyFor is order-independent', () => {
  expect(dmKeyFor('u2', 'u1')).toBe('u1:u2');
  expect(dmKeyFor('u1', 'u2')).toBe('u1:u2');
});

it('ensureGeneral creates lazily and recovers from P2002 race', async () => {
  const create = vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
  const findFirst = vi.fn()
    .mockResolvedValueOnce(null)                    // до create
    .mockResolvedValueOnce({ id: 'g1' });           // после P2002
  const prisma = { staffConversation: { create, findFirst } } as never;
  const res = await ensureGeneral(prisma, 'c1');
  expect(res).toEqual({ ok: true, conversationId: 'g1' });
});

it('openDm: cross-company target → forbidden; non-staff caller → forbidden', async () => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u9', role: 'manager', companyId: 'c2', isActive: true, name: 'X' }) },
    staffConversation: { create: vi.fn(), findUnique: vi.fn() }
  } as never;
  expect(await openDm(prisma, manager, { targetUserId: 'u9' })).toEqual({ ok: false, error: 'forbidden' });
  expect(await openDm({} as never, partner, { targetUserId: 'm1' })).toEqual({ ok: false, error: 'forbidden' });
});

it('openDm is idempotent by dmKey (P2002 → findUnique)', async () => {
  const target = { id: 'm2', role: 'manager', companyId: 'c1', isActive: true, name: 'Пётр' };
  const create = vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
  const findUnique = vi.fn().mockResolvedValue({ id: 'dm1' });
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(target) },
    staffConversation: { create, findUnique }
  } as never;
  const res = await openDm(prisma, manager, { targetUserId: 'm2' });
  expect(res).toEqual({ ok: true, conversationId: 'dm1' });
  expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { dmKey: 'm1:m2' } }));
});

it('staffUnreadCount: считает беседы с lastMessageAt > lastReadAt; флаг-off неважен (сервис не гейтит)', async () => {
  const findMany = vi.fn().mockResolvedValue([
    { id: 'g1', lastMessageAt: new Date('2026-07-17T10:00:00Z'), readStates: [] },
    { id: 'd1', lastMessageAt: new Date('2026-07-17T09:00:00Z'), readStates: [{ lastReadAt: new Date('2026-07-17T09:30:00Z') }] }
  ]);
  const prisma = { staffConversation: { findMany } } as never;
  const res = await staffUnreadCount(prisma, manager);
  expect(res).toEqual({ ok: true, count: 1 });
});

it('client role gets empty list / zero count / markRead forbidden', async () => {
  expect(await listConversations({} as never, partner)).toEqual({ ok: true, rows: [] });
  expect(await staffUnreadCount({} as never, partner)).toEqual({ ok: true, count: 0 });
  expect(await markStaffRead({} as never, partner, { conversationId: 'x' })).toEqual({ ok: false, error: 'forbidden' });
});
```

- [ ] **Step 5: Run — FAIL**, затем реализовать `conversations.ts`

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaff, canSeeStaffConversation, NO_COMPANY_SENTINEL } from './policy';

export function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export type EnsureGeneralResult = { ok: true; conversationId: string } | { ok: false; error: 'storage' };

/** Лениво создаёт «# Общий» компании; гонка гасится партиальным unique (P2002 → findFirst). */
export async function ensureGeneral(prisma: PrismaClient, companyId: string): Promise<EnsureGeneralResult> {
  const existing = await prisma.staffConversation.findFirst({
    where: { companyId, kind: 'general' },
    select: { id: true }
  });
  if (existing) return { ok: true, conversationId: existing.id };
  try {
    const created = await prisma.staffConversation.create({
      data: { companyId, kind: 'general' },
      select: { id: true }
    });
    return { ok: true, conversationId: created.id };
  } catch {
    const raced = await prisma.staffConversation.findFirst({
      where: { companyId, kind: 'general' },
      select: { id: true }
    });
    return raced ? { ok: true, conversationId: raced.id } : { ok: false, error: 'storage' };
  }
}

export type OpenDmResult = { ok: true; conversationId: string } | { ok: false; error: 'forbidden' | 'target_not_found' };

export async function openDm(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { targetUserId: string }
): Promise<OpenDmResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  if (args.targetUserId === session.sub) return { ok: false, error: 'forbidden' };
  const target = await prisma.user.findUnique({
    where: { id: args.targetUserId },
    select: { id: true, role: true, companyId: true, isActive: true }
  });
  if (!target || !target.isActive) return { ok: false, error: 'target_not_found' };
  const targetStaff = target.role === 'admin' || target.role === 'manager';
  if (!targetStaff) return { ok: false, error: 'forbidden' };
  // C8: DM staff↔staff — внутри одной компании; admin (Model A) может писать любому.
  // companyId беседы = компания не-админ участника (admin.companyId может быть null).
  const conversationCompanyId =
    session.role === 'admin' ? target.companyId : target.role === 'admin' ? session.companyId : null;
  if (session.role !== 'admin' && target.role !== 'admin') {
    if (!session.companyId || session.companyId !== target.companyId) return { ok: false, error: 'forbidden' };
  }
  const companyId = conversationCompanyId ?? session.companyId ?? target.companyId;
  if (!companyId) return { ok: false, error: 'forbidden' }; // оба без компании — ЛС некуда прикрепить
  const key = dmKeyFor(session.sub, args.targetUserId);
  try {
    const created = await prisma.staffConversation.create({
      data: {
        companyId,
        kind: 'dm',
        dmKey: key,
        participants: { create: [{ userId: session.sub }, { userId: args.targetUserId }] }
      },
      select: { id: true }
    });
    return { ok: true, conversationId: created.id };
  } catch {
    const existing = await prisma.staffConversation.findUnique({ where: { dmKey: key }, select: { id: true } });
    return existing ? { ok: true, conversationId: existing.id } : { ok: false, error: 'forbidden' };
  }
}

export type StaffConversationRow = {
  id: string;
  kind: 'dm' | 'general';
  title: string;
  companyName: string | null; // admin с несколькими компаниями различает general-каналы
  lastMessageAt: Date;
  unread: boolean;
};
export type ListConversationsResult = { ok: true; rows: StaffConversationRow[] };

/**
 * general(и) + СВОИ dm. Admin: general всех компаний (Model A), dm — только собственные
 * (oversight чужих ЛС остаётся возможен по id через canSee, но инбокс не засоряем).
 */
export async function listConversations(prisma: PrismaClient, session: SessionPayload): Promise<ListConversationsResult> {
  if (!isStaff(session)) return { ok: true, rows: [] };
  if (session.role === 'manager' && session.companyId) {
    await ensureGeneral(prisma, session.companyId); // лениво, идемпотентно
  }
  const where =
    session.role === 'admin'
      ? { OR: [{ kind: 'general' as const }, { participants: { some: { userId: session.sub } } }] }
      : {
          companyId: session.companyId ?? NO_COMPANY_SENTINEL,
          OR: [{ kind: 'general' as const }, { participants: { some: { userId: session.sub } } }]
        };
  const rows = await prisma.staffConversation.findMany({
    where,
    select: {
      id: true,
      kind: true,
      lastMessageAt: true,
      company: { select: { name: true } },
      participants: { select: { userId: true, user: { select: { name: true } } } },
      readStates: { where: { userId: session.sub }, select: { lastReadAt: true }, take: 1 }
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100
  });
  return {
    ok: true,
    rows: rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      title:
        c.kind === 'general'
          ? '# Общий'
          : (c.participants.find((p) => p.userId !== session.sub)?.user.name ?? 'Диалог'),
      companyName: c.kind === 'general' ? c.company.name : null,
      lastMessageAt: c.lastMessageAt,
      unread: c.lastMessageAt > (c.readStates[0]?.lastReadAt ?? new Date(0))
    }))
  };
}

export type StaffUnreadResult = { ok: true; count: number };

/** Кол-во бесед с непрочитанным (зеркало chat/unreadCount, но на Prisma — объёмы staff-чата малы). */
export async function staffUnreadCount(prisma: PrismaClient, session: SessionPayload): Promise<StaffUnreadResult> {
  if (!isStaff(session)) return { ok: true, count: 0 };
  const where =
    session.role === 'admin'
      ? { OR: [{ kind: 'general' as const }, { participants: { some: { userId: session.sub } } }] }
      : {
          companyId: session.companyId ?? NO_COMPANY_SENTINEL,
          OR: [{ kind: 'general' as const }, { participants: { some: { userId: session.sub } } }]
        };
  const rows = await prisma.staffConversation.findMany({
    where,
    select: { lastMessageAt: true, readStates: { where: { userId: session.sub }, select: { lastReadAt: true }, take: 1 } },
    take: 200
  });
  const count = rows.filter((c) => c.lastMessageAt > (c.readStates[0]?.lastReadAt ?? new Date(0))).length;
  return { ok: true, count };
}

export type MarkStaffReadResult = { ok: true } | { ok: false; error: 'forbidden' | 'conversation_not_found' };

export async function markStaffRead(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { conversationId: string }
): Promise<MarkStaffReadResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const conv = await prisma.staffConversation.findUnique({
    where: { id: args.conversationId },
    select: { id: true, kind: true, companyId: true, participants: { select: { userId: true } } }
  });
  if (!conv) return { ok: false, error: 'conversation_not_found' };
  if (!canSeeStaffConversation(session, conv, conv.participants.map((p) => p.userId))) {
    return { ok: false, error: 'forbidden' };
  }
  await prisma.staffMessageRead.upsert({
    where: { conversationId_userId: { conversationId: conv.id, userId: session.sub } },
    update: { lastReadAt: new Date() },
    create: { conversationId: conv.id, userId: session.sub }
  });
  return { ok: true };
}
```

- [ ] **Step 6: Run + typecheck**: оба тест-файла PASS; `npm run typecheck` чист. Проверить покрытие двух файлов 100% (`--coverage --coverage.include='src/lib/services/staffChat/**'`), дописать точечные случаи при пробелах.

- [ ] **Step 7: Commit**
```bash
git add src/lib/services/staffChat src/__tests__/services.staff-chat.policy.unit.test.ts src/__tests__/services.staff-chat.conversations.unit.test.ts
git commit -m "feat(m4): staff-chat policy + conversations (ensureGeneral/openDm/list/unread/markRead)"
```

---

## Task 3: Сообщения, реакции, упоминания, уведомления

**Files:** Create `src/lib/services/staffChat/messages.ts`, `src/lib/services/staffChat/mentions.ts`; Modify `src/lib/auth/audit.ts` (union, если закрытый); Test `src/__tests__/services.staff-chat.messages.unit.test.ts`, `src/__tests__/services.staff-chat.mentions.unit.test.ts`.

- [ ] **Step 1: Падающий тест mentions**

`src/__tests__/services.staff-chat.mentions.unit.test.ts`:
```ts
import { it, expect, vi } from 'vitest';
import { extractMentions } from '@/lib/services/staffChat/mentions';

const staff = [
  { id: 'u1', name: 'Пётр Иванов' },
  { id: 'u2', name: 'Пётр' },
  { id: 'u3', name: 'Anna-Maria K.' }
];

it('longest-name-first: "@Пётр Иванов" матчит u1, не u2', () => {
  expect(extractMentions('привет @Пётр Иванов, глянь', staff)).toEqual(['u1']);
});

it('короткое имя матчится, регистронезависимо, дедуп', () => {
  expect(extractMentions('@пётр и ещё раз @Пётр', staff)).toEqual(['u2']);
});

it('ненайденные/пустые игнорируются; спецсимволы в имени экранируются', () => {
  expect(extractMentions('@Никто и @Anna-Maria K. тут', staff)).toEqual(['u3']);
  expect(extractMentions('без упоминаний', staff)).toEqual([]);
});
```

- [ ] **Step 2: Run — FAIL**, реализовать `mentions.ts`

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaff, NO_COMPANY_SENTINEL } from './policy';

export type StaffColleague = { id: string; name: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Точный матч «@Имя» по списку staff: длинные имена первыми (жадность), регистронезависимо,
 * дедуп. Никакой нечёткости — ненайденное игнорируется (решение спеки §2.5).
 */
export function extractMentions(body: string, staff: StaffColleague[]): string[] {
  const found: string[] = [];
  const sorted = [...staff].filter((s) => s.name.trim()).sort((a, b) => b.name.length - a.name.length);
  let rest = body;
  for (const person of sorted) {
    const re = new RegExp(`@${escapeRegExp(person.name)}(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(rest)) {
      found.push(person.id);
      rest = rest.replace(new RegExp(`@${escapeRegExp(person.name)}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
    }
  }
  return found;
}

export type ListColleaguesResult = { ok: true; rows: StaffColleague[] };

/** Staff-состав для автокомплита/пикера: менеджеры компании + активные admin (Model A — участвуют везде). */
export async function listColleagues(prisma: PrismaClient, session: SessionPayload): Promise<ListColleaguesResult> {
  if (!isStaff(session)) return { ok: true, rows: [] };
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: 'manager', companyId: session.role === 'admin' ? undefined : (session.companyId ?? NO_COMPANY_SENTINEL) },
        { role: 'admin' }
      ]
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 200
  });
  return { ok: true, rows };
}
```
Примечание: `companyId: undefined` в Prisma-where означает «без фильтра» (admin видит менеджеров всех компаний) — это осознанно.

- [ ] **Step 3: Падающий тест messages**

`src/__tests__/services.staff-chat.messages.unit.test.ts` (mock `@/lib/auth/audit`, `@/lib/notifications`, `@/lib/jobs/queues`, `./conversations`-хелперы НЕ мокaть — только Prisma):
```ts
import { it, expect, vi, beforeEach } from 'vitest';

const { recordAudit, createNotification, deliverNotificationToUser, addJob } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
  deliverNotificationToUser: vi.fn(),
  addJob: vi.fn()
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: addJob }) }));

import { sendStaffMessage, listStaffMessages, toggleReaction, STAFF_REACTION_EMOJI } from '@/lib/services/staffChat/messages';

const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as never;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as never;

function convFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'conv1',
    kind: 'dm',
    companyId: 'c1',
    participants: [{ userId: 'm1' }, { userId: 'm2' }],
    ...over
  };
}

function prismaFixture(over: Record<string, unknown> = {}) {
  const base = {
    staffConversation: {
      findUnique: vi.fn().mockResolvedValue(convFixture()),
      update: vi.fn().mockResolvedValue({})
    },
    staffMessage: {
      create: vi.fn().mockResolvedValue({ id: 'msg1' }),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn()
    },
    staffMessageRead: { findUnique: vi.fn().mockResolvedValue(null) },
    staffReaction: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([]) }
  };
  return { ...base, ...over } as never;
}

beforeEach(() => vi.clearAllMocks());

it('rejects non-staff / empty / too long', async () => {
  expect(await sendStaffMessage({} as never, partner, { conversationId: 'conv1', body: 'x' })).toEqual({ ok: false, error: 'forbidden' });
  expect(await sendStaffMessage(prismaFixture(), manager, { conversationId: 'conv1', body: '   ' })).toEqual({ ok: false, error: 'empty_body' });
  expect(await sendStaffMessage(prismaFixture(), manager, { conversationId: 'conv1', body: 'а'.repeat(5001) })).toEqual({ ok: false, error: 'too_large' });
});

it('creates message, bumps lastMessageAt, audits WITHOUT body', async () => {
  const prisma = prismaFixture();
  const res = await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'привет' });
  expect(res).toEqual({ ok: true, messageId: 'msg1' });
  expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    action: 'staff_message_sent',
    entityId: 'conv1'
  }));
  const auditArg = recordAudit.mock.calls[0][1];
  expect(JSON.stringify(auditArg)).not.toContain('привет');
});

it('DM: first-unread notification once (второе сообщение подряд молчит)', async () => {
  const prisma = prismaFixture();
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'раз' });
  expect(createNotification).toHaveBeenCalledTimes(1);
  expect(deliverNotificationToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'm2', type: 'staff_dm_message', dedupKey: 'n1' }));
  vi.clearAllMocks();
  createNotification.mockResolvedValue({ id: 'n2' });
  (prisma as never as { staffMessage: { count: ReturnType<typeof vi.fn> } }).staffMessage.count.mockResolvedValue(3); // уже есть непрочитанное
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'два' });
  expect(createNotification).not.toHaveBeenCalled();
});

it('mention notifies mentioned staff (не автора), general без per-message уведомлений', async () => {
  const prisma = prismaFixture({
    staffConversation: {
      findUnique: vi.fn().mockResolvedValue(convFixture({ kind: 'general', participants: [] })),
      update: vi.fn().mockResolvedValue({})
    },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'm2', name: 'Пётр' }, { id: 'm1', name: 'Иван' }]) }
  });
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'ping @Пётр и @Иван' });
  // упомянут и автор (m1=Иван) — себе уведомление не шлём; m2 получает staff_chat_mention
  expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
  expect(deliverNotificationToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'm2', type: 'staff_chat_mention' }));
});

it('attachment: чужой префикс → forbidden; свой → scanStatus pending + enqueue kind staff_attachment', async () => {
  const prisma = prismaFixture();
  expect(await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'f', attachmentPath: 'staff-chat/OTHER/file' }))
    .toEqual({ ok: false, error: 'forbidden' });
  await sendStaffMessage(prisma, manager, {
    conversationId: 'conv1', body: 'файл',
    attachmentPath: 'staff-chat/conv1/abc-file.pdf', attachmentName: 'file.pdf', attachmentMime: 'application/pdf'
  });
  const createArg = (prisma as never as { staffMessage: { create: ReturnType<typeof vi.fn> } }).staffMessage.create.mock.calls.at(-1)![0];
  expect(createArg.data.scanStatus).toBe('pending');
  expect(addJob).toHaveBeenCalledWith('scan', { kind: 'staff_attachment', id: 'msg1' });
});

it('toggleReaction: вне набора → invalid; добавление и снятие', async () => {
  const prisma = prismaFixture({
    staffMessage: {
      findUnique: vi.fn().mockResolvedValue({ id: 'msg1', conversation: convFixture() }),
      findMany: vi.fn(), create: vi.fn(), count: vi.fn()
    }
  });
  expect(await toggleReaction(prisma, manager, { messageId: 'msg1', emoji: '🤡' })).toEqual({ ok: false, error: 'invalid' });
  expect(STAFF_REACTION_EMOJI).toContain('👍');
  const res = await toggleReaction(prisma, manager, { messageId: 'msg1', emoji: '👍' });
  expect(res).toEqual({ ok: true, reacted: true });
});

it('listStaffMessages: forbidden для не-участника dm; after-курсор игнорирует NaN', async () => {
  const prisma = prismaFixture({
    staffConversation: { findUnique: vi.fn().mockResolvedValue(convFixture({ participants: [{ userId: 'x' }, { userId: 'y' }] })), update: vi.fn() }
  });
  expect(await listStaffMessages(prisma, manager, { conversationId: 'conv1' })).toEqual({ ok: false, error: 'forbidden' });
});
```

- [ ] **Step 4: Run — FAIL**, реализовать `messages.ts`

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { isStaff, canSeeStaffConversation } from './policy';
import { extractMentions, listColleagues } from './mentions';

const MAX_BODY = 5000;
export const STAFF_REACTION_EMOJI = ['👍', '✅', '🔥', '😄', '❓'] as const;

type ConvWithParticipants = {
  id: string;
  kind: 'dm' | 'general';
  companyId: string;
  participants: { userId: string }[];
};

async function loadConv(prisma: PrismaClient, id: string): Promise<ConvWithParticipants | null> {
  return prisma.staffConversation.findUnique({
    where: { id },
    select: { id: true, kind: true, companyId: true, participants: { select: { userId: true } } }
  });
}

export type SendStaffError = 'forbidden' | 'conversation_not_found' | 'empty_body' | 'too_large';
export type SendStaffResult = { ok: true; messageId: string } | { ok: false; error: SendStaffError };

export async function sendStaffMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { conversationId: string; body: string; attachmentPath?: string; attachmentName?: string; attachmentMime?: string }
): Promise<SendStaffResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const body = (args.body ?? '').trim();
  if (!body && !args.attachmentPath) return { ok: false, error: 'empty_body' };
  if (body.length > MAX_BODY) return { ok: false, error: 'too_large' };

  const conv = await loadConv(prisma, args.conversationId);
  if (!conv) return { ok: false, error: 'conversation_not_found' };
  if (!canSeeStaffConversation(session, conv, conv.participants.map((p) => p.userId))) {
    return { ok: false, error: 'forbidden' };
  }
  // IDOR-гард пути вложения (зеркало chat/sendMessage)
  if (args.attachmentPath !== undefined && !args.attachmentPath.startsWith(`staff-chat/${conv.id}/`)) {
    return { ok: false, error: 'forbidden' };
  }

  // First-unread правило для ЛС: считаем ДО вставки
  let notifyDmRecipient: string | null = null;
  if (conv.kind === 'dm') {
    const other = conv.participants.map((p) => p.userId).find((id) => id !== session.sub);
    if (other) {
      const read = await prisma.staffMessageRead.findUnique({
        where: { conversationId_userId: { conversationId: conv.id, userId: other } },
        select: { lastReadAt: true }
      });
      const unread = await prisma.staffMessage.count({
        where: {
          conversationId: conv.id,
          authorId: { not: other },
          createdAt: { gt: read?.lastReadAt ?? new Date(0) }
        }
      });
      if (unread === 0) notifyDmRecipient = other;
    }
  }

  const message = await prisma.staffMessage.create({
    data: {
      conversationId: conv.id,
      authorId: session.sub,
      body,
      attachmentPath: args.attachmentPath ?? null,
      attachmentName: args.attachmentName ?? null,
      attachmentMime: args.attachmentMime ?? null,
      scanStatus: args.attachmentPath ? 'pending' : 'none'
    },
    select: { id: true }
  });
  await prisma.staffConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });

  // AV-скан вложения — best-effort enqueue (образец inbound_attachment; §3 degrade gracefully)
  if (args.attachmentPath) {
    try {
      const payload: ScanDocumentPayload = { kind: 'staff_attachment', id: message.id };
      await getQueue('docs.scanDocument').add('scan', payload);
    } catch (err) {
      log.warn('[staffChat/sendStaffMessage] scan enqueue failed', {
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  await recordAudit(prisma, {
    action: 'staff_message_sent',
    entity: 'staff_conversation',
    entityId: conv.id,
    userId: session.sub,
    after: { messageId: message.id } // тело НЕ пишем (§2.6 спеки)
  });

  // Уведомления — best-effort, не блокируют отправку
  try {
    const excerpt = body.slice(0, 200);
    const url = (role: string) => (role === 'admin' ? '/admin/messages' : '/manager/messages');
    // Упоминания: и в dm, и в general
    const colleagues = await listColleagues(prisma, session);
    const mentioned = extractMentions(body, colleagues.rows).filter((id) => id !== session.sub);
    const recipients = await prisma.user.findMany({
      where: { id: { in: mentioned } },
      select: { id: true, role: true }
    });
    for (const r of recipients) {
      const row = await createNotification({
        userId: r.id,
        type: 'staff_chat_mention',
        title: 'Вас упомянули в чате команды',
        body: excerpt,
        meta: { conversationId: conv.id, messageId: message.id }
      });
      await deliverNotificationToUser({
        userId: r.id, title: 'Вас упомянули в чате команды', body: excerpt,
        type: 'staff_chat_mention', url: url(r.role), dedupKey: row.id
      });
    }
    // ЛС: «первое непрочитанное», если получатель не упомянут (иначе он уже уведомлён)
    if (notifyDmRecipient && !mentioned.includes(notifyDmRecipient)) {
      const rec = await prisma.user.findUnique({ where: { id: notifyDmRecipient }, select: { id: true, role: true } });
      if (rec) {
        const row = await createNotification({
          userId: rec.id,
          type: 'staff_dm_message',
          title: 'Новое сообщение в чате команды',
          body: excerpt,
          meta: { conversationId: conv.id }
        });
        await deliverNotificationToUser({
          userId: rec.id, title: 'Новое сообщение в чате команды', body: excerpt,
          type: 'staff_dm_message', url: url(rec.role), dedupKey: row.id
        });
      }
    }
  } catch (err) {
    log.warn('[staffChat/sendStaffMessage] notify failed', {
      messageId: message.id,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return { ok: true, messageId: message.id };
}

export type StaffMessageRow = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  scanStatus: string;
  createdAt: Date;
  reactions: { emoji: string; count: number; mine: boolean }[];
};
export type ListStaffMessagesResult =
  | { ok: true; rows: StaffMessageRow[] }
  | { ok: false; error: 'forbidden' | 'conversation_not_found' };

export async function listStaffMessages(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { conversationId: string; after?: string }
): Promise<ListStaffMessagesResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const conv = await loadConv(prisma, args.conversationId);
  if (!conv) return { ok: false, error: 'conversation_not_found' };
  if (!canSeeStaffConversation(session, conv, conv.participants.map((p) => p.userId))) {
    return { ok: false, error: 'forbidden' };
  }
  const afterDate = args.after ? new Date(args.after) : null;
  const validAfter = afterDate && !isNaN(afterDate.getTime()) ? afterDate : null;
  const rows = await prisma.staffMessage.findMany({
    where: { conversationId: conv.id, ...(validAfter ? { createdAt: { gt: validAfter } } : {}) },
    select: {
      id: true, authorId: true, body: true, attachmentPath: true, attachmentName: true,
      scanStatus: true, createdAt: true,
      author: { select: { name: true } },
      reactions: { select: { userId: true, emoji: true } }
    },
    orderBy: { createdAt: 'asc' },
    take: 200
  });
  return {
    ok: true,
    rows: rows.map((m) => {
      const byEmoji = new Map<string, { count: number; mine: boolean }>();
      for (const r of m.reactions) {
        const agg = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
        agg.count += 1;
        if (r.userId === session.sub) agg.mine = true;
        byEmoji.set(r.emoji, agg);
      }
      return {
        id: m.id,
        authorId: m.authorId,
        authorName: m.author.name ?? '',
        body: m.body,
        hasAttachment: m.attachmentPath !== null, // сырой путь наружу не отдаём
        attachmentName: m.attachmentName,
        scanStatus: m.scanStatus,
        createdAt: m.createdAt,
        reactions: [...byEmoji.entries()].map(([emoji, a]) => ({ emoji, count: a.count, mine: a.mine }))
      };
    })
  };
}

export type ToggleReactionResult =
  | { ok: true; reacted: boolean }
  | { ok: false; error: 'forbidden' | 'invalid' | 'message_not_found' };

export async function toggleReaction(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { messageId: string; emoji: string }
): Promise<ToggleReactionResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  if (!(STAFF_REACTION_EMOJI as readonly string[]).includes(args.emoji)) return { ok: false, error: 'invalid' };
  const message = await prisma.staffMessage.findUnique({
    where: { id: args.messageId },
    select: {
      id: true,
      conversation: { select: { id: true, kind: true, companyId: true, participants: { select: { userId: true } } } }
    }
  });
  if (!message) return { ok: false, error: 'message_not_found' };
  const conv = message.conversation;
  if (!canSeeStaffConversation(session, conv, conv.participants.map((p) => p.userId))) {
    return { ok: false, error: 'forbidden' };
  }
  const existing = await prisma.staffReaction.findUnique({
    where: { messageId_userId_emoji: { messageId: args.messageId, userId: session.sub, emoji: args.emoji } },
    select: { id: true }
  });
  if (existing) {
    await prisma.staffReaction.delete({ where: { id: existing.id } });
    return { ok: true, reacted: false };
  }
  await prisma.staffReaction.create({ data: { messageId: args.messageId, userId: session.sub, emoji: args.emoji } });
  return { ok: true, reacted: true };
}
```

- [ ] **Step 5: `AuditEntity`** — открыть `src/lib/auth/audit.ts`; если тип entity — закрытый union, добавить `'staff_conversation'`. Если свободная строка — ничего не делать.

- [ ] **Step 6: Run + typecheck + покрытие** (`staffChat/**` 100%; дописать при пробелах).

- [ ] **Step 7: Commit**
```bash
git add src/lib/services/staffChat src/lib/auth/audit.ts src/__tests__/services.staff-chat.messages.unit.test.ts src/__tests__/services.staff-chat.mentions.unit.test.ts
git commit -m "feat(m4): staff messages + reactions + mentions + no-spam notifications"
```

---

## Task 4: Вложения + расширение scan-конвейера

**Files:** Create `src/lib/services/staffChat/attachments.ts`; Modify `src/lib/jobs/types.ts`, `src/worker/processors/scan-document.ts`, `src/lib/services/scan/backfill.ts`; Test `src/__tests__/services.staff-chat.attachments.unit.test.ts`, расширить `src/__tests__/worker.scan-document.test.ts` и тест backfill (`grep` его имя: тест, покрывающий `scan/backfill.ts`).

- [ ] **Step 1: `ScanDocumentTarget`** — в `src/lib/jobs/types.ts` добавить `'staff_attachment'`:
```ts
export type ScanDocumentTarget = 'document' | 'leadAttachment' | 'inbound_attachment' | 'call_recording' | 'staff_attachment';
```

- [ ] **Step 2: Ветки процессора** — в `src/worker/processors/scan-document.ts`:
  - `loadTarget`: `case 'staff_attachment': { const m = await db.staffMessage.findUnique({ where: { id }, select: { id: true, attachmentPath: true } }); return m?.attachmentPath ? { id: m.id, path: m.attachmentPath } : null; }`
  - `persistResult`: `case 'staff_attachment': await db.staffMessage.update({ where: { id }, data: { scanStatus, scanReason } });` — только если у StaffMessage есть scanReason-колонка; **её нет** → обновлять только `{ scanStatus }` (зеркало call_recording; причина остаётся в SyncLog).

- [ ] **Step 3: Backfill sweep** — в `src/lib/services/scan/backfill.ts` добавить `backfillTable('staff_attachment', ...)` по образцу `inbound_attachment`: выборка `staffMessage.findMany({ where: { scanStatus: 'pending', attachmentPath: { not: null } }, select: { id: true }, ... })` + поле в `BackfillResult`.

- [ ] **Step 4: Тесты процессора/бэкфилла** — расширить `worker.scan-document.test.ts` кейсом `staff_attachment` (clean + infected + missing target) и тест backfill новым sweep'ом. Guardrail `worker.processor-coverage` остаётся зелёным (процессор уже импортируется).

- [ ] **Step 5: Падающий тест attachments-сервиса**

`src/__tests__/services.staff-chat.attachments.unit.test.ts` — по образцу существующего chat-attachments теста (`grep components/chat attachments test`): мок `@/lib/storage` (`getObjectStorage`), кейсы: не-staff → forbidden; чужая беседа → forbidden; >20 МБ → too_large; мим вне списка → invalid_mime; успех → путь `staff-chat/<convId>/<uuid>-<safe>`; presigned: not_found/forbidden/`pending`→forbidden-семантика 404, `infected` → infected (роут отдаст 410), `clean` → url.

- [ ] **Step 6: Реализовать `attachments.ts`** — зеркало `chat/attachments.ts` (то же MIME-множество: pdf/jpeg/png/doc/docx/xls/xlsx; 20 МБ cap; `validateMagicBytes` из `@/lib/storage/mimeValidator`; sanitize `/[^a-zA-Z0-9._-]/g→'_'`), отличия: префикс `staff-chat/{conversationId}/`, доступ через `canSeeStaffConversation`, download отдаёт url только при `scanStatus === 'clean'` (`pending|error` → `not_ready`, `infected` → `infected`):

```ts
export type UploadStaffAttachmentResult =
  | { ok: true; attachmentPath: string }
  | { ok: false; error: 'forbidden' | 'conversation_not_found' | 'too_large' | 'invalid_mime' | 'storage' };
export async function uploadStaffAttachment(
  prisma: PrismaClient, session: SessionPayload,
  args: { conversationId: string; file: { name: string; size: number; mimeType: string; buffer: Buffer } }
): Promise<UploadStaffAttachmentResult>;

export type StaffAttachmentUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'not_ready' | 'infected' | 'storage' };
export async function getStaffAttachmentSignedUrl(
  prisma: PrismaClient, session: SessionPayload, args: { messageId: string }
): Promise<StaffAttachmentUrlResult>; // TTL 600 c, opts.download = attachmentName
```
(Полные тела — зеркально `chat/attachments.ts`, имплементор сверяется с ним построчно.)

- [ ] **Step 7: Run + typecheck + покрытие затронутых файлов 100%; commit**
```bash
git add src/lib/services/staffChat/attachments.ts src/lib/jobs/types.ts src/worker/processors/scan-document.ts src/lib/services/scan/backfill.ts src/__tests__
git commit -m "feat(m4): staff attachments via AV pipeline (kind staff_attachment) + backfill sweep"
```

---

## Task 5: API-роуты `/api/staff-chat/*`

**Files:** Create 8 route-файлов (см. карту); Test `src/__tests__/api.staff-chat.routes.test.ts`.

Каждый хендлер — преамбула (эталон `api/messages`):
```ts
import { requireSession, requireRole } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';

const off = notFoundIfDisabled('staff_chat');
if (off) return off;
const sess = await requireSession();
if (!sess.ok) return sess.response;
const staff = requireRole(sess.value, ['admin', 'manager']);
if (!staff.ok) return staff.response;
```

- [ ] **Step 1: Падающий тест роутов** — `api.staff-chat.routes.test.ts` по образцу существующих api-тестов (`vi.hoisted` моки сервисов + `@/lib/auth/guard` + `@/lib/featureFlags`): flag-off → 404 для КАЖДОГО роута; не-staff роль → 403; happy-path каждого; мапинг ошибок.

- [ ] **Step 2: Реализовать роуты** (мапинг кодов):

| Route | Method | Вход | Сервис | Ошибки → HTTP |
|---|---|---|---|---|
| `conversations` | GET | — | `listConversations` | — (always ok) |
| `messages` | GET | `?conversationId=&after=` | `listStaffMessages` | forbidden→403, else→404 |
| `messages` | POST | JSON `{conversationId, body, attachmentPath?, attachmentName?, attachmentMime?}` | `sendStaffMessage` | forbidden→403, conversation_not_found→404, too_large→413, empty_body→400; 201 |
| `read` | POST | JSON `{conversationId}` | `markStaffRead` | forbidden→403, else→404 |
| `reactions` | POST | JSON `{messageId, emoji}` | `toggleReaction` | forbidden→403, message_not_found→404, invalid→400 |
| `dm` | POST | JSON `{targetUserId}` | `openDm` | forbidden→403, target_not_found→404; 201 |
| `colleagues` | GET | — | `listColleagues` | — |
| `unread` | GET | — | `staffUnreadCount` | — |
| `attachment` | POST multipart `{file, conversationId}` | `uploadStaffAttachment` | forbidden→403, conversation_not_found→404, too_large→413, invalid_mime→415, storage→500; 201 |
| `attachment` | GET `?messageId=` | `getStaffAttachmentSignedUrl` | forbidden→403, not_found→404, not_ready→409, infected→410, storage→502; успех → `Response.redirect(url, 302)` |

Malformed JSON: `await req.json().catch(() => null)` → 400 `bad_request`. GET attachment ошибки — `new Response(null, { status })`.

- [ ] **Step 3: Run + typecheck + lint; покрытие роутов 100%; commit**
```bash
git add src/app/api/staff-chat src/__tests__/api.staff-chat.routes.test.ts
git commit -m "feat(m4): /api/staff-chat/* thin routes (staff-gated, flag-gated)"
```

---

## Task 6: UI — секция «Чат команды» + поллинг + бейдж

**Files:** Create `src/components/staff-chat/*` (5 файлов), `src/hooks/useStaffChatPolling.ts`; Modify `src/app/manager/messages/page.tsx`, `src/app/admin/messages/page.tsx`; Test `components.staff-chat.test.tsx`, `hooks.useStaffChatPolling.test.ts`, обновить `pages.manager-messages.test.tsx`, `pages.admin-messages.test.tsx`.

**Референсы для имплементора (читать перед кодом):** `src/components/chat/order-thread-inbox.tsx` (двухпанельная раскладка list+thread, variant), `src/components/chat/unread-badge.tsx` + `useClientResource`, `src/hooks/useThreadPolling.ts` (зеркалить механику), `src/__tests__/pages.manager-messages.test.tsx` (паттерн обновления page-тестов).

- [ ] **Step 1: Hook `useStaffChatPolling`** — сиблинг `useThreadPolling` (та же механика: cursorRef/onNewRef, visibility-gate, interval 7000), URL `/api/staff-chat/messages?conversationId=...&after=...`. Тест — зеркало `hooks.useThreadPolling.test.ts` (jsdom, fake timers).

- [ ] **Step 2: Компоненты** (все под `src/components/staff-chat/`, project-примитивы `ui/`, русские строки):
  - `staff-unread-badge.tsx` — зеркало `UnreadBadge`, но URL `/api/staff-chat/unread` (aria-label «Непрочитанные сообщения команды»).
  - `staff-conversation-list.tsx` — пресентационный: rows `StaffConversationRow[]`, active id, `onSelect`; # Общий первым (kind general), у admin с ≥2 компаниями подпись `companyName`; кнопка «+ Новое сообщение» открывает пикер коллег (`colleagues` без себя).
  - `staff-thread-view.tsx` — лента: пузыри свой/чужой, дата-разделители, реакции-чипы (klik → `POST /api/staff-chat/reactions`, optimistic не нужен — рефетч), вложение: имя + состояние (`pending` → «⏳ проверяется», `clean` → ссылка на `GET /api/staff-chat/attachment?messageId=`, `infected` → «⛔ заражён»), автоскролл вниз.
  - `staff-composer.tsx` — textarea + @-автокомплит (по `colleagues`, подстановка `@Имя `), 📎 файл (upload → `attachmentPath` → send), Enter-send/Shift+Enter перенос; ошибки — `errorMessageRu`/toast.
  - `staff-chat-section.tsx` — `'use client'` клей: грузит conversations (`useClientResource`, 15 c), держит active, поллинг сообщений хуком, markRead при открытии/новых, композер. Props: `{ currentUserId: string }`.

- [ ] **Step 3: Wiring страниц** — в `src/app/manager/messages/page.tsx` после chat-секции:
```tsx
const staffChatEnabled = isFeatureEnabled('staff_chat');
...
{staffChatEnabled && (
  <section className='mt-8'>
    <h2 className='mb-3 text-lg font-medium text-gray-700'>Чат команды <StaffUnreadBadge /></h2>
    <StaffChatSection currentUserId={session.sub} />
  </section>
)}
```
Аналогично в `src/app/admin/messages/page.tsx` (после chat-блока/фолбэка).

- [ ] **Step 4: Тесты** — component-тесты каждого компонента (jsdom, паттерны фазы 3: fireEvent + waitFor; fetch мокать глобально), обновить оба page-теста (мок `isFeatureEnabled` per-flag: `chat` on/off × `staff_chat` on/off — секция рендерится только при staff_chat on).

- [ ] **Step 5: Run + typecheck + lint; 100% на новых/изменённых файлах; commit**
```bash
git add src/components/staff-chat src/hooks/useStaffChatPolling.ts src/app/manager/messages/page.tsx src/app/admin/messages/page.tsx src/__tests__
git commit -m "feat(m4): staff chat UI (list+thread+composer+reactions+badge) on messages pages"
```

---

## Task 7: Упоминания в заметках сделки (M1-долг)

**Files:** Modify `src/lib/services/manager/dealNotes.ts`; Test — расширить `src/__tests__/services.deal-notes.unit.test.ts`.

- [ ] **Step 1: Падающий тест** — дописать в существующий файл (моки `@/lib/notifications` добавить через `vi.hoisted`):
```ts
it('mentions in note body notify mentioned staff (not the author), note stays staff-only', async () => {
  getOrder.mockResolvedValue({ id: 'o1', companyId: 'c1' });
  const create = vi.fn().mockResolvedValue({ id: 'n1' });
  const findMany = vi.fn().mockResolvedValue([{ id: 'u2', name: 'Пётр', role: 'manager' }]);
  const prisma = { dealNote: { create }, user: { findMany } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: 'согласуй с @Пётр скидку' });
  expect(res).toEqual({ ok: true, id: 'n1' });
  expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', type: 'deal_note_mention' }));
  expect(deliverNotificationToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', url: '/manager/orders/o1' }));
});
it('note without mentions sends no notifications', async () => { /* deliverNotificationToUser not called */ });
```

- [ ] **Step 2: Реализовать** — после `dealNote.create` + audit в `addDealNote`:
```ts
// M4 (§2.5): @упоминания в заметке → уведомление упомянутым staff. Best-effort (§3).
try {
  const colleagues = await listColleagues(prisma, session);
  const mentioned = extractMentions(body, colleagues.rows).filter((id) => id !== session.sub);
  if (mentioned.length) {
    const recipients = await prisma.user.findMany({ where: { id: { in: mentioned } }, select: { id: true, role: true } });
    const excerpt = body.slice(0, 200);
    for (const r of recipients) {
      const row = await createNotification({
        userId: r.id, type: 'deal_note_mention',
        title: 'Вас упомянули в заметке по заказу', body: excerpt,
        meta: { orderId: args.orderId, noteId: note.id }
      });
      await deliverNotificationToUser({
        userId: r.id, title: 'Вас упомянули в заметке по заказу', body: excerpt,
        type: 'deal_note_mention',
        ...(r.role === 'admin' ? {} : { url: `/manager/orders/${args.orderId}` }),
        dedupKey: row.id
      });
    }
  }
} catch (err) {
  log.warn('[dealNotes/addDealNote] mention notify failed', { noteId: note.id, error: err instanceof Error ? err.message : String(err) });
}
```
(admin-получатель — без url: у admin нет `/manager/orders/*`; in-app строка остаётся.) Импорты: `extractMentions`, `listColleagues` из `@/lib/services/staffChat/mentions`; `createNotification`, `deliverNotificationToUser` из `@/lib/notifications`; `log` из `@/lib/logging`.

- [ ] **Step 3: Run (весь deal-notes файл) + typecheck; 100%; commit**
```bash
git add src/lib/services/manager/dealNotes.ts src/__tests__/services.deal-notes.unit.test.ts
git commit -m "feat(m4): @mentions in deal notes notify staff (closes M1 deferral)"
```

---

## Task 8: Интеграционные регрессы + close-out

**Files:** Test `src/__tests__/services.staff-chat.isolation.integration.test.ts` (`new PrismaClient()` → авто-integration); Create `docs/superpowers/plans/2026-07-17-m4-staff-chat-DONE.md`.

- [ ] **Step 1: Integration-тест** (шаблон — `services.deal-activity.idor.integration.test.ts`; сиды минимальные, cleanup в `afterAll` по FK-порядку):
1. **C8-изоляция:** менеджер компании A не видит general компании B (`listConversations` не содержит; `listStaffMessages` по id → forbidden); admin видит оба general.
2. **dmKey-гонка:** `Promise.all([openDm(m1→m2), openDm(m2→m1)])` → ровно одна StaffConversation (вторая через P2002-ветку возвращает тот же id).
3. **general-гонка:** `Promise.all([ensureGeneral(c1), ensureGeneral(c1)])` → одна строка (партиальный unique).
4. **Cross-company DM:** m1(c1) → m9(c2) = forbidden.
5. **Клиентские роли:** partner/organization session → listConversations пуст, sendStaffMessage forbidden.
6. **Reaction unique:** два toggleReaction подряд → реакция снята (0 строк).
7. **First-unread:** два сообщения подряд в ЛС → ровно одна Notification `staff_dm_message` у получателя.

- [ ] **Step 2: Прогоны** — `npm run gate` (или `test:integration` при живом PG) → зелёный; M4 unit-набор целиком; `npm run typecheck && npm run lint`.

- [ ] **Step 3: Close-out** `2026-07-17-m4-staff-chat-DONE.md` (формат M1-DONE): что отгружено по задачам; отложено (именованные каналы/группы, realtime, поиск→M6, edit/delete, emoji-picker, push, ретеншн); статус гейтов (полный `test:coverage`+`build` — на контроллере); список коммитов.

- [ ] **Step 4: Commit**
```bash
git add src/__tests__/services.staff-chat.isolation.integration.test.ts docs/superpowers/plans/2026-07-17-m4-staff-chat-DONE.md
git commit -m "test(m4): C8 isolation + dm/general races + first-unread integration; M4 close-out"
```

---

## Порядок и зависимости

Task 1 — фундамент. Task 2 → 3 → 4 последовательно (сервисный слой). Task 5 зависит от 2–4; Task 6 — от 5; Task 7 — от 3 (mentions), независим от 5/6; Task 8 — финал. Рекомендуемо: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (7 можно параллельно с 5/6, но субагенты идут последовательно — не парallelить).

## Self-review (спека ↔ план)

- §2.1 (5 моделей + партиальный unique + back-relations) → Task 1 ✅. §2.2 (policy, Model A, sentinel) → Task 2 ✅. §2.3 (флаг, 3 точки) → Task 1 (регистрация) + Task 5 (роуты) + Task 6 (секции+бейдж) ✅. §2.4 (сервисы) → Tasks 2–4 ✅ (unreadCount без raw-SQL — осознанное упрощение: не дублируем scopeSql-ловушку клиентского чата; staff-объёмы малы). §2.5 (mentions + colleagues) → Task 3 + Task 7 ✅. §2.6 (no-spam уведомления) → Task 3 ✅. §2.7 (API) → Task 5 ✅ (`not_ready`→409 — добавленный код сверх спеки, фиксируется в close-out). §2.8 (UI) → Task 6 ✅ (секции вместо табов — задокументированное решение агента). §3-инварианты → Task 8 ✅.
- Типы согласованы: `StaffConversationRow`/`StaffMessageRow`/Result-униoны в Tasks 2–3 совпадают с использованием в Tasks 5–6; `dmKeyFor`/`NO_COMPANY_SENTINEL` экспортированы там, где импортируются.
- Плейсхолдеров нет; в Task 4 Step 6 тела `attachments.ts` даны сигнатурами с указанием построчного зеркала `chat/attachments.ts` — это референс на существующий код репо, не TBD.
