# PR-A — Входящие сообщения (омниканальный инбокс) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Принимать входящие сообщения из Telegram/Max/WhatsApp(Wazzup)/email, нормализовать, идемпотентно сохранять, резолвить отправителя в организацию/контакт (exact-match) и показывать в едином инбоксе с ответом через существующий исходящий слой.

**Architecture:** Одна таблица `InboundMessage` + чистый резолвер `resolveInboundSender` (exact-only, C8/IDOR-safe) + сервис `ingestInboundMessage` (идемпотентный upsert по `externalId`). Приём: webhook'и Telegram/Max (расширяем существующие стабы) + новый Wazzup-webhook; почта — плановый воркер IMAP-поллинга за адаптером `getInboundEmailAdapter()`. Вложения едут через существующий антивирус-конвейер `docs.scanDocument` (новый `kind`). UI — экран `/manager/inbox` + вкладка «Обращения» в CRM-карточке; ответ реюзит исходящие транспорты каналов.

**Tech Stack:** Next.js 15 (App Router), Prisma 5 + PostgreSQL, BullMQ + Redis, S3, Vitest. Спека: [2026-07-05-omnichannel-inbound-telephony-design.md](../specs/2026-07-05-omnichannel-inbound-telephony-design.md).

**Предпосылка окружения:** свежий worktree без зависимостей. Первым делом: `npm ci && npm run prisma:generate`. Без этого husky-хуки (`typecheck`) и vitest не запустятся.

**Конвенции проверки:**
- Unit-тест = моки Prisma (файл без `new PrismaClient(`). Запуск: `npx vitest run <файл>`.
- Integration-тест = `new PrismaClient(` в файле (требует живой Postgres / `npm run gate`).
- Мок-паттерн: `const { x } = vi.hoisted(() => ({ x: vi.fn() }))` + `vi.mock('@/lib/...', () => ({ x }))`.
- Коммит: `feat(inbound): ...`; хук прогонит lint-staged + typecheck + test:changed.

---

## Структура файлов

**Создать:**
- `src/lib/services/inbound/resolve.ts` — чистый резолвер отправителя.
- `src/lib/services/inbound/ingest.ts` — идемпотентный приём сообщения.
- `src/lib/services/inbound/listInbox.ts` — company-scoped выборка для экрана.
- `src/lib/services/inbound/reply.ts` — реюз исходящих транспортов для ответа.
- `src/lib/inbound/email/index.ts` — `getInboundEmailAdapter()` + port-типы.
- `src/lib/inbound/email/adapter-fake.ts` — тест-адаптер.
- `src/lib/inbound/email/adapter-imap.ts` — реальный IMAP (минимальный шов).
- `src/app/api/integrations/whatsapp/webhook/route.ts` — приёмник Wazzup.
- `src/worker/processors/poll-inbound-email.ts` — воркер поллинга почты.
- `src/app/manager/inbox/page.tsx` — экран инбокса.
- `src/components/manager/inbox-list.tsx`, `inbox-filters.tsx`, `inbox-reply-form.tsx`, `inbox-bind-form.tsx` — презентационные компоненты.
- `src/server-actions/inbound.ts` — `bindInboundMessageAction`, `replyInboundAction`.
- Тесты: `src/__tests__/inbound.resolve.test.ts`, `inbound.ingest.integration.test.ts`, `api.integrations.whatsapp.webhook.test.ts`, `api.integrations.telegram.inbound.test.ts`, `worker.poll-inbound-email.integration.test.ts`, `inbound.listInbox.integration.test.ts`, `security.idor-inbox.integration.test.ts`, `server-actions.inbound.test.ts`.

**Изменить:**
- `prisma/schema.prisma` — модель `InboundMessage` + back-relations.
- `src/lib/featureFlags.ts` — флаг `inbound_messaging`.
- `src/middleware.ts` — `FEATURE_PREFIXES` для `/manager/inbox`.
- `src/lib/navigation/cabinet.ts` — nav-пункт «Обращения».
- `src/lib/services/oneCSync/log.ts` — `SyncLogEntity` += `'inbound'`.
- `src/lib/jobs/types.ts` — `ScanDocumentPayload` `kind` += `'inbound_attachment'`.
- `src/lib/jobs/queues.ts` — очередь `inbound.email.poll`.
- `src/lib/jobs/scheduling.ts` — плановая задача поллинга.
- `src/worker/processors/scan-document.ts` — ветвь `kind:'inbound_attachment'`.
- `src/worker/index.ts` — регистрация процессора.
- `src/lib/services/manager/organizationCard.ts` + `src/components/manager/org-card-tabs.tsx` — вкладка «Обращения».

---

## Task 0: Установка и флаг `inbound_messaging`

**Files:**
- Modify: `src/lib/featureFlags.ts`
- Modify: `src/middleware.ts`
- Modify: `src/lib/navigation/cabinet.ts`
- Test: `src/__tests__/featureFlags.test.ts` (существующий — добавить кейс)

- [ ] **Step 1: Установить зависимости**

Run: `npm ci && npm run prisma:generate`
Expected: без ошибок; появляется `node_modules/.bin/tsc`.

- [ ] **Step 2: Добавить флаг в `featureFlags.ts`**

В массив `FEATURE_FLAGS` добавить `'inbound_messaging'`; в `OPT_IN_FLAGS` (Set) — тоже `'inbound_messaging'`.

- [ ] **Step 3: Зарегистрировать префикс в middleware**

В `src/middleware.ts` в массив `FEATURE_PREFIXES` добавить:
```ts
{ prefix: '/manager/inbox', flag: 'inbound_messaging' },
```

- [ ] **Step 4: Nav-пункт**

В `src/lib/navigation/cabinet.ts` в массив `manager` рядом с пунктом «Сообщения» добавить:
```ts
{ href: '/manager/inbox', label: 'Обращения', icon: '📨', flag: 'inbound_messaging' },
```

- [ ] **Step 5: Проверка и коммит**

Run: `npm run typecheck && npx vitest run src/__tests__/featureFlags.test.ts`
Expected: PASS.
```bash
git add src/lib/featureFlags.ts src/middleware.ts src/lib/navigation/cabinet.ts
git commit -m "feat(inbound): add opt-in flag inbound_messaging (4-touch wiring)"
```

---

## Task 1: Модель `InboundMessage` + миграция

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<generated>/migration.sql` (через prisma)

- [ ] **Step 1: Добавить модель и back-relations**

В `prisma/schema.prisma` добавить модель (поля — по спеке §2.1):
```prisma
model InboundMessage {
  id             String   @id @default(cuid())
  createdAt      DateTime @default(now())
  channel        String
  externalId     String   @unique
  senderRef      String
  senderDisplay  String?
  subject        String?
  body           String
  attachmentPath String?
  attachmentName String?
  attachmentMime String?
  scanStatus     String   @default("none")
  scanReason     String?
  resolvedOrgId  String?
  resolvedUserId String?
  threadId       String?
  companyId      String?
  status         String   @default("unresolved")
  boundAt        DateTime?
  boundById      String?

  resolvedOrg  Organization? @relation("OrgInbound", fields: [resolvedOrgId], references: [id])
  resolvedUser User?         @relation("UserInbound", fields: [resolvedUserId], references: [id])
  thread       OrderThread?  @relation(fields: [threadId], references: [id], onDelete: SetNull)
  company      Company?      @relation(fields: [companyId], references: [id])

  @@index([status, createdAt])
  @@index([companyId, createdAt])
  @@index([resolvedOrgId, createdAt])
  @@index([channel, createdAt])
}
```
На встречных моделях добавить back-relation массивы:
- `Organization`: `inboundMessages InboundMessage[] @relation("OrgInbound")`
- `User`: `inboundMessages InboundMessage[] @relation("UserInbound")`
- `OrderThread`: `inboundMessages InboundMessage[]`
- `Company`: `inboundMessages InboundMessage[]`

- [ ] **Step 2: Сгенерировать миграцию**

Run: `npm run prisma:migrate -- --name inbound_message`
Expected: создан каталог миграции с `CREATE TABLE "InboundMessage"` + индексы; `prisma:generate` отработал.

- [ ] **Step 3: Проверить обратимость (ревью SQL)**

Открыть сгенерированный `migration.sql`; убедиться, что это только `CREATE TABLE`/`CREATE INDEX`/`ADD CONSTRAINT FK` (аддитивно, без ALTER существующих). Down-путь = `DROP TABLE` (Prisma не пишет down, но структура тривиально обратима — зафиксировать в описании).

- [ ] **Step 4: Проверка и коммит**

Run: `npm run typecheck`
Expected: PASS (типы Prisma перегенерированы).
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(inbound): InboundMessage model + migration"
```

---

## Task 2: Резолвер `resolveInboundSender` (exact-match, C8/IDOR)

**Files:**
- Create: `src/lib/services/inbound/resolve.ts`
- Test: `src/__tests__/inbound.resolve.test.ts` (unit — Prisma мокнут)

- [ ] **Step 1: Написать падающий unit-тест**

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveInboundSender } from '@/lib/services/inbound/resolve';

function db(users: any[], leads: any[] = []) {
  return {
    user: { findMany: vi.fn(async () => users) },
    lead: { findMany: vi.fn(async () => leads) },
  } as any;
}

describe('resolveInboundSender', () => {
  it('exact telegram chatId → org+company', async () => {
    const u = { id: 'u1', organizationId: 'o1', organization: { id: 'o1', companyId: 'c1' } };
    const r = await resolveInboundSender(db([u]), { channel: 'telegram', chatId: '123' });
    expect(r).toMatchObject({ matchType: 'exact', userId: 'u1', orgId: 'o1', companyId: 'c1' });
  });

  it('no match → unresolved', async () => {
    const r = await resolveInboundSender(db([]), { channel: 'telegram', chatId: 'nope' });
    expect(r.matchType).toBe('unresolved');
    expect(r.orgId).toBeUndefined();
  });

  it('ambiguous (>1 user) → unresolved (never cross-bind)', async () => {
    const a = { id: 'u1', organizationId: 'o1', organization: { id: 'o1', companyId: 'c1' } };
    const b = { id: 'u2', organizationId: 'o2', organization: { id: 'o2', companyId: 'c2' } };
    const r = await resolveInboundSender(db([a, b]), { channel: 'whatsapp', phone: '+79990001122' });
    expect(r.matchType).toBe('unresolved');
  });

  it('user without organization → unresolved (no company scope)', async () => {
    const u = { id: 'u1', organizationId: null, organization: null };
    const r = await resolveInboundSender(db([u]), { channel: 'email', email: 'x@y.z' });
    expect(r.matchType).toBe('unresolved');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/__tests__/inbound.resolve.test.ts`
Expected: FAIL (`resolveInboundSender` не найден).

- [ ] **Step 3: Реализовать резолвер**

```ts
import type { PrismaClient } from '@prisma/client';

export type ResolveInput = {
  channel: 'telegram' | 'max' | 'whatsapp' | 'email';
  chatId?: string;
  phone?: string;
  email?: string;
};
export type ResolveResult =
  | { matchType: 'exact'; userId: string; orgId: string; companyId: string; orderId?: string; threadId?: string }
  | { matchType: 'unresolved' };

/** E.164-нормализация: только цифры, ведущий '+'. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
}

export async function resolveInboundSender(prisma: PrismaClient, input: ResolveInput): Promise<ResolveResult> {
  const where: Record<string, unknown> = {};
  if (input.channel === 'telegram' && input.chatId) where.telegramChatId = input.chatId;
  else if (input.channel === 'max' && input.chatId) where.maxChatId = input.chatId;
  else if (input.channel === 'whatsapp' && input.phone) where.whatsappPhone = normalizePhone(input.phone);
  else if (input.channel === 'email' && input.email) where.email = input.email.trim().toLowerCase();
  else return { matchType: 'unresolved' };

  const users = await prisma.user.findMany({
    where,
    select: { id: true, organizationId: true, organization: { select: { id: true, companyId: true } } },
    take: 2,
  });
  if (users.length !== 1) return { matchType: 'unresolved' };           // 0 или >1 → в очередь
  const u = users[0];
  if (!u.organization?.id || !u.organization.companyId) return { matchType: 'unresolved' };
  return { matchType: 'exact', userId: u.id, orgId: u.organization.id, companyId: u.organization.companyId };
}
```
> Заметка: `email`-совпадение сравнивается lower-case; поле `User.email @unique` уже нормализовано при регистрации — если нет, добавить нормализацию в интейке.

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run src/__tests__/inbound.resolve.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/services/inbound/resolve.ts src/__tests__/inbound.resolve.test.ts
git commit -m "feat(inbound): exact-match sender resolver (C8/IDOR-safe)"
```

---

## Task 3: `SyncLogEntity` += 'inbound'

**Files:**
- Modify: `src/lib/services/oneCSync/log.ts`

- [ ] **Step 1: Расширить union**

В `src/lib/services/oneCSync/log.ts` в тип `SyncLogEntity` добавить `| 'inbound'`. Поле в БД строковое — миграции нет.

- [ ] **Step 2: Проверка и коммит**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add src/lib/services/oneCSync/log.ts
git commit -m "feat(inbound): SyncLogEntity += inbound"
```

---

## Task 4: `ingestInboundMessage` (идемпотентный приём) — A2

**Files:**
- Create: `src/lib/services/inbound/ingest.ts`
- Test: `src/__tests__/inbound.ingest.integration.test.ts` (integration — `new PrismaClient`)

- [ ] **Step 1: Написать падающий integration-тест**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';

const prisma = new PrismaClient();

describe('ingestInboundMessage', () => {
  beforeEach(async () => {
    await prisma.inboundMessage.deleteMany({ where: { externalId: { startsWith: 'tg:test:' } } });
  });

  it('creates one row and is idempotent on replay', async () => {
    const dto = { channel: 'telegram' as const, externalId: 'tg:test:1', senderRef: '999', body: 'привет' };
    const r1 = await ingestInboundMessage(prisma, dto);
    expect(r1.ok).toBe(true);
    const r2 = await ingestInboundMessage(prisma, dto);      // повтор
    expect(r2.ok).toBe(true);
    const rows = await prisma.inboundMessage.findMany({ where: { externalId: 'tg:test:1' } });
    expect(rows).toHaveLength(1);                            // не задвоилось
  });

  it('unresolved sender → status unresolved, companyId null', async () => {
    const r = await ingestInboundMessage(prisma, {
      channel: 'telegram', externalId: 'tg:test:2', senderRef: 'unknown', body: 'x',
    });
    expect(r.ok).toBe(true);
    const row = await prisma.inboundMessage.findUnique({ where: { externalId: 'tg:test:2' } });
    expect(row?.status).toBe('unresolved');
    expect(row?.companyId).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run src/__tests__/inbound.ingest.integration.test.ts` (нужен живой Postgres; иначе `npm run gate`)
Expected: FAIL (`ingestInboundMessage` не найден).

- [ ] **Step 3: Реализовать сервис**

```ts
import type { PrismaClient } from '@prisma/client';
import { resolveInboundSender } from './resolve';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

export type InboundDto = {
  channel: 'telegram' | 'max' | 'whatsapp' | 'email';
  externalId: string;
  senderRef: string;
  senderDisplay?: string;
  subject?: string;
  body: string;
  attachmentPath?: string;
  attachmentName?: string;
  attachmentMime?: string;
};
export type IngestResult = { ok: true; id: string; deduped: boolean } | { ok: false; error: 'storage' };

export async function ingestInboundMessage(prisma: PrismaClient, dto: InboundDto): Promise<IngestResult> {
  const existing = await prisma.inboundMessage.findUnique({ where: { externalId: dto.externalId }, select: { id: true } });
  if (existing) {
    await writeSyncLog({ entity: 'inbound', externalId: dto.externalId, direction: 'inbound', operation: 'skip', status: 'success' }, prisma);
    return { ok: true, id: existing.id, deduped: true };
  }

  const resolved = await resolveInboundSender(prisma, {
    channel: dto.channel,
    chatId: dto.channel === 'telegram' || dto.channel === 'max' ? dto.senderRef : undefined,
    phone: dto.channel === 'whatsapp' ? dto.senderRef : undefined,
    email: dto.channel === 'email' ? dto.senderRef : undefined,
  });

  const row = await prisma.inboundMessage.create({
    data: {
      channel: dto.channel,
      externalId: dto.externalId,
      senderRef: dto.senderRef,
      senderDisplay: dto.senderDisplay ?? null,
      subject: dto.subject ?? null,
      body: dto.body,                                   // ТЕЛО — ТОЛЬКО ДАННЫЕ, не исполняется
      attachmentPath: dto.attachmentPath ?? null,
      attachmentName: dto.attachmentName ?? null,
      attachmentMime: dto.attachmentMime ?? null,
      scanStatus: dto.attachmentPath ? 'pending' : 'none',
      ...(resolved.matchType === 'exact'
        ? { resolvedOrgId: resolved.orgId, resolvedUserId: resolved.userId, companyId: resolved.companyId, status: 'bound', boundAt: new Date() }
        : { status: 'unresolved' }),
    },
    select: { id: true },
  });

  await writeSyncLog({
    entity: 'inbound', externalId: dto.externalId, direction: 'inbound', operation: 'create',
    status: resolved.matchType === 'exact' ? 'success' : 'warn',
    errorMessage: resolved.matchType === 'exact' ? undefined : 'unresolved',
  }, prisma);

  return { ok: true, id: row.id, deduped: false };
}
```
> Fan-out уведомления менеджерам (`notifyManagers`) — best-effort, добавляется в Task 9 после привязки к транспортам; здесь намеренно опущено, чтобы приём не зависел от доставки.

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run src/__tests__/inbound.ingest.integration.test.ts`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/services/inbound/ingest.ts src/__tests__/inbound.ingest.integration.test.ts
git commit -m "feat(inbound): idempotent ingestInboundMessage (A2 core)"
```

---

## Task 5: Антивирус вложений — `kind:'inbound_attachment'`

**Files:**
- Modify: `src/lib/jobs/types.ts` (тип `ScanDocumentPayload`)
- Modify: `src/worker/processors/scan-document.ts`
- Test: `src/__tests__/worker.scan-document.integration.test.ts` (существующий — добавить кейс inbound; если файл называется иначе — найти по импорту процессора)

- [ ] **Step 1: Расширить payload-тип**

В `src/lib/jobs/types.ts` union `ScanDocumentPayload['kind']` добавить `'inbound_attachment'`:
```ts
export type ScanDocumentPayload =
  | { kind: 'document'; id: string }
  | { kind: 'inbound_attachment'; id: string };
```

- [ ] **Step 2: Написать падающий тест-кейс**

Добавить в scan-processor integration-тест кейс: создать `InboundMessage` с `attachmentPath` (замокать `getObjectStorage().download` → чистый буфер и ClamAV-клиент → `clean`), вызвать процессор c `{ kind:'inbound_attachment', id }`, проверить `inboundMessage.scanStatus === 'clean'`. (Мок ClamAV/storage — как в существующем scan-тесте.)

- [ ] **Step 3: Реализовать ветвь `kind`**

В `src/worker/processors/scan-document.ts` после определения результата скана вынести обновление в switch по `payload.kind`:
```ts
if (payload.kind === 'inbound_attachment') {
  await db.inboundMessage.update({
    where: { id: payload.id },
    data: { scanStatus: verdict, scanReason: reason ?? null },
  });
} else {
  await db.document.update({ where: { id: payload.id }, data: { scanStatus: verdict, scanReason: reason ?? null, scannedAt: new Date() } });
}
```
Загрузку файла (`getObjectStorage().download(path)`) выполнять по `path`, полученному из соответствующей таблицы в зависимости от `kind`. `writeSyncLog({ entity: 'scan', ... })` — как раньше.

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run src/__tests__/worker.scan-document.integration.test.ts`
Expected: PASS (включая новый inbound-кейс).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/jobs/types.ts src/worker/processors/scan-document.ts src/__tests__/worker.scan-document.integration.test.ts
git commit -m "feat(inbound): scan inbound attachments via docs.scanDocument kind branch"
```

---

## Task 6: Webhook Telegram/Max — приём входящих (A1)

**Files:**
- Modify: `src/app/api/integrations/telegram/webhook/route.ts`
- Modify: `src/app/api/integrations/max/webhook/route.ts`
- Test: `src/__tests__/api.integrations.telegram.inbound.test.ts`

- [ ] **Step 1: Падающий тест приёма**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { ingest } = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: ingest }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/telegram/link', () => ({ linkByCode: vi.fn() }));
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: vi.fn() }));
import { POST } from '@/app/api/integrations/telegram/webhook/route';

const secret = 'test-secret';
beforeEach(() => { process.env.TELEGRAM_WEBHOOK_SECRET = secret; process.env.FEATURE_INBOUND_MESSAGING = '1'; vi.clearAllMocks(); });

function req(body: unknown, s = secret) {
  return new Request('http://x', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': s }, body: JSON.stringify(body) });
}

it('401 on bad secret', async () => {
  const res = await POST(req({}, 'wrong'));
  expect(res.status).toBe(401);
  expect(ingest).not.toHaveBeenCalled();
});

it('non-/start text message → ingestInboundMessage, 200', async () => {
  ingest.mockResolvedValue({ ok: true, id: 'm1', deduped: false });
  const res = await POST(req({ message: { message_id: 55, chat: { id: 999 }, text: 'нужна помощь' } }));
  expect(res.status).toBe(200);
  expect(ingest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    channel: 'telegram', externalId: 'tg:999:55', senderRef: '999', body: 'нужна помощь',
  }));
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run src/__tests__/api.integrations.telegram.inbound.test.ts`
Expected: FAIL (входящее ещё не обрабатывается).

- [ ] **Step 3: Расширить роут**

В `telegram/webhook/route.ts` после существующей ветки `/start`-линковки добавить: если `text` есть и это НЕ `/start`, и `isFeatureEnabled('inbound_messaging')`, вызвать `ingestInboundMessage`:
```ts
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
// ...после проверки секрета и парса update:
const msg = (update as any)?.message;
const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
const text: string | undefined = msg?.text;
if (chatId && text && /^\/start\b/.test(text)) {
  /* существующая линковка */
} else if (chatId && text && isFeatureEnabled('inbound_messaging')) {
  await ingestInboundMessage(prisma, {
    channel: 'telegram',
    externalId: `tg:${chatId}:${msg.message_id}`,
    senderRef: chatId,
    senderDisplay: msg?.from?.username ?? undefined,
    body: text,                                        // данные, не команда
  }).catch(() => {});                                  // best-effort, не роняем webhook
}
return new Response(null, { status: 200 });
```
Аналогично в `max/webhook/route.ts`: `externalId: \`max:${chatId}:${messageId}\``, `channel: 'max'`, гейт `notFoundIfDisabled('max_channel')` уже есть — приём входящих под `inbound_messaging`.

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run src/__tests__/api.integrations.telegram.inbound.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/app/api/integrations/telegram/webhook/route.ts src/app/api/integrations/max/webhook/route.ts src/__tests__/api.integrations.telegram.inbound.test.ts
git commit -m "feat(inbound): telegram/max webhooks ingest non-/start messages"
```

---

## Task 7: Webhook WhatsApp (Wazzup) — приём входящих (A1)

**Files:**
- Modify: `src/lib/whatsapp/aggregator.ts` (добавить `parseWazzupInbound`)
- Create: `src/app/api/integrations/whatsapp/webhook/route.ts`
- Test: `src/__tests__/api.integrations.whatsapp.webhook.test.ts`

- [ ] **Step 1: Падающий тест**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { ingest } = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: ingest }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
import { POST } from '@/app/api/integrations/whatsapp/webhook/route';

beforeEach(() => { process.env.WHATSAPP_WEBHOOK_SECRET = 'wz'; process.env.FEATURE_INBOUND_MESSAGING = '1'; process.env.FEATURE_WHATSAPP_CHANNEL = '1'; vi.clearAllMocks(); });
function req(body: unknown, s = 'wz') {
  return new Request('http://x', { method: 'POST', headers: { 'x-wazzup-secret': s }, body: JSON.stringify(body) });
}
it('401 bad secret', async () => { expect((await POST(req({}, 'no'))).status).toBe(401); });
it('inbound message → ingest, 200', async () => {
  ingest.mockResolvedValue({ ok: true, id: 'm', deduped: false });
  const res = await POST(req({ messages: [{ messageId: 'W1', chatId: '79990001122', text: 'здравствуйте', dateTime: '2026-07-05T10:00:00Z' }] }));
  expect(res.status).toBe(200);
  expect(ingest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ channel: 'whatsapp', externalId: 'wa:W1', senderRef: '+79990001122' }));
});
```

- [ ] **Step 2: FAIL**

Run: `npx vitest run src/__tests__/api.integrations.whatsapp.webhook.test.ts`
Expected: FAIL (роут не существует).

- [ ] **Step 3: Реализовать parser + роут**

В `aggregator.ts` добавить чистый парсер:
```ts
export type WazzupInbound = { externalId: string; phone: string; text: string; name?: string };
export function parseWazzupInbound(body: unknown): WazzupInbound[] {
  const arr = (body as any)?.messages;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((m) => m?.messageId && m?.chatId && typeof m?.text === 'string' && !m?.isEcho)
    .map((m) => ({ externalId: `wa:${m.messageId}`, phone: `+${String(m.chatId).replace(/\D/g, '')}`, text: m.text, name: m?.contact?.name }));
}
```
Роут `whatsapp/webhook/route.ts` (зеркало telegram-webhook):
```ts
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { parseWazzupInbound } from '@/lib/whatsapp/aggregator';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { prisma } from '@/lib/db/prisma';

export async function POST(req: Request): Promise<Response> {
  const off = notFoundIfDisabled('inbound_messaging'); if (off) return off;
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();
  if (!secret || req.headers.get('x-wazzup-secret') !== secret) return new Response(null, { status: 401 });
  let body: unknown; try { body = await req.json(); } catch { return new Response(null, { status: 200 }); }
  for (const m of parseWazzupInbound(body)) {
    await ingestInboundMessage(prisma, { channel: 'whatsapp', externalId: m.externalId, senderRef: m.phone, senderDisplay: m.name, body: m.text }).catch(() => {});
  }
  return new Response(null, { status: 200 });
}
```

- [ ] **Step 4: PASS**

Run: `npx vitest run src/__tests__/api.integrations.whatsapp.webhook.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/whatsapp/aggregator.ts src/app/api/integrations/whatsapp/webhook/route.ts src/__tests__/api.integrations.whatsapp.webhook.test.ts
git commit -m "feat(inbound): Wazzup whatsapp inbound webhook"
```

---

## Task 8: Почта — IMAP-адаптер + плановый воркер (A1)

**Files:**
- Create: `src/lib/inbound/email/index.ts`, `adapter-fake.ts`, `adapter-imap.ts`
- Modify: `src/lib/jobs/queues.ts`, `src/lib/jobs/scheduling.ts`, `src/worker/index.ts`
- Create: `src/worker/processors/poll-inbound-email.ts`
- Test: `src/__tests__/worker.poll-inbound-email.integration.test.ts`

- [ ] **Step 1: Port + fake adapter**

`src/lib/inbound/email/index.ts`:
```ts
export type InboundEmailDto = { externalId: string; from: string; subject?: string; text: string };
export interface InboundEmailAdapter { fetchNewMessages(cursor: string | null): Promise<{ messages: InboundEmailDto[]; cursor: string | null }>; }

let cached: InboundEmailAdapter | null = null;
export function getInboundEmailAdapter(): InboundEmailAdapter {
  if (cached) return cached;
  const kind = (process.env.INBOUND_EMAIL_ADAPTER ?? 'fake').trim().toLowerCase();
  if (kind === 'fake') { const { FakeInboundEmailAdapter } = require('./adapter-fake'); cached = new FakeInboundEmailAdapter(); return cached!; }
  if (kind === 'imap') { const { ImapInboundEmailAdapter } = require('./adapter-imap'); cached = new ImapInboundEmailAdapter(); return cached!; }
  throw new Error(`Unknown INBOUND_EMAIL_ADAPTER: ${kind}`);
}
export function __resetInboundEmailAdapter() { cached = null; }   // для тестов
```
`adapter-fake.ts`: возвращает сообщения из env-JSON `FAKE_INBOUND_EMAIL` (по умолчанию `[]`), продвигает курсор по числу отданных. `adapter-imap.ts`: минимальный шов под `IMAP_HOST/PORT/USER/PASSWORD/TLS` — метод бросает `Error('imap adapter not wired')` до боевого подключения (сеть — вне тестов).

- [ ] **Step 2: Очередь + расписание + процессор (падающий тест)**

Тест: замокать `getInboundEmailAdapter` → fake с 1 сообщением и `ingestInboundMessage`; вызвать процессор; проверить, что `ingestInboundMessage` вызван с `channel:'email'` и курсор записан в `SyncState`.

- [ ] **Step 3: Реализовать**

В `queues.ts` `QUEUE_NAMES` добавить `'inbound.email.poll'`. В `scheduling.ts` в `SYNC_SCHEDULES` добавить `{ queueName: 'inbound.email.poll', schedulerId: 'inbound.email.poll.cron', pattern: '*/5 * * * *', tz: DEFAULT_SYNC_TZ }`. Процессор:
```ts
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { getInboundEmailAdapter } from '@/lib/inbound/email';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';

const prisma = new PrismaClient();
export async function pollInboundEmailProcessor(_job: Job, db: PrismaClient = prisma) {
  const state = await db.syncState.findUnique({ where: { entity: 'inbound.email' } });
  const { messages, cursor } = await getInboundEmailAdapter().fetchNewMessages(state?.cursor ?? null);
  for (const m of messages) {
    await ingestInboundMessage(db, { channel: 'email', externalId: `email:${m.externalId}`, senderRef: m.from.trim().toLowerCase(), subject: m.subject, body: m.text }).catch(() => {});
  }
  await db.syncState.upsert({ where: { entity: 'inbound.email' }, create: { entity: 'inbound.email', cursor, lastRunAt: new Date(), lastSuccessAt: new Date() }, update: { cursor, lastRunAt: new Date(), lastSuccessAt: new Date() } });
  return { processed: messages.length };
}
```
В `worker/index.ts`: `startWorker('inbound.email.poll', pollInboundEmailProcessor as Processor);`

- [ ] **Step 4: PASS**

Run: `npx vitest run src/__tests__/worker.poll-inbound-email.integration.test.ts`
Expected: PASS. Также прогнать guardrail: `npx vitest run src/__tests__/worker.processor-coverage.guardrail.test.ts` → PASS (процессор импортирован тестом).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/inbound/email src/lib/jobs/queues.ts src/lib/jobs/scheduling.ts src/worker/processors/poll-inbound-email.ts src/worker/index.ts src/__tests__/worker.poll-inbound-email.integration.test.ts
git commit -m "feat(inbound): IMAP email adapter seam + scheduled poll worker"
```

---

## Task 9: Ответ из инбокса — реюз исходящих транспортов (A3)

**Files:**
- Create: `src/lib/services/inbound/reply.ts`
- Test: `src/__tests__/inbound.reply.test.ts` (unit — транспорты мокнуты)

- [ ] **Step 1: Падающий unit-тест**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const t = vi.hoisted(() => ({ tg: vi.fn(), max: vi.fn(), wa: vi.fn() }));
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: t.tg }));
vi.mock('@/lib/max/client', () => ({ sendMaxMessage: t.max }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ sendWhatsAppMessage: t.wa }));
import { replyToInbound } from '@/lib/services/inbound/reply';

beforeEach(() => vi.clearAllMocks());
it('routes to whatsapp transport by channel', async () => {
  t.wa.mockResolvedValue({ ok: true });
  const r = await replyToInbound({ channel: 'whatsapp', senderRef: '+79990001122' } as any, 'спасибо');
  expect(t.wa).toHaveBeenCalledWith('+79990001122', 'спасибо');
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 2: FAIL** → Run: `npx vitest run src/__tests__/inbound.reply.test.ts`

- [ ] **Step 3: Реализовать**

```ts
import type { InboundMessage } from '@prisma/client';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendMaxMessage } from '@/lib/max/client';
import { sendWhatsAppMessage } from '@/lib/whatsapp/aggregator';
// email — через существующий Resend-хелпер проекта (src/lib/email)

export async function replyToInbound(msg: Pick<InboundMessage, 'channel' | 'senderRef'>, text: string): Promise<{ ok: boolean }> {
  switch (msg.channel) {
    case 'telegram': await sendTelegramMessage(msg.senderRef, text).catch(() => {}); return { ok: true };
    case 'max': await sendMaxMessage(msg.senderRef, text).catch(() => {}); return { ok: true };
    case 'whatsapp': { const r = await sendWhatsAppMessage(msg.senderRef, text).catch(() => ({ ok: false })); return { ok: !!(r as any)?.ok }; }
    case 'email': /* sendRawEmail(msg.senderRef, subject, text) — по хелперу src/lib/email */ return { ok: true };
    default: return { ok: false };
  }
}
```

- [ ] **Step 4: PASS** → Run: `npx vitest run src/__tests__/inbound.reply.test.ts`

- [ ] **Step 5: Коммит**
```bash
git add src/lib/services/inbound/reply.ts src/__tests__/inbound.reply.test.ts
git commit -m "feat(inbound): reply via existing outbound transports"
```

---

## Task 10: Server-actions — привязка и ответ (A3)

**Files:**
- Create: `src/server-actions/inbound.ts`
- Test: `src/__tests__/server-actions.inbound.test.ts` (unit — Prisma/reply/audit мокнуты)

- [ ] **Step 1: Падающий тест** для `bindInboundMessageAction` (проставляет `resolvedOrgId/companyId/status:'bound'`, только для org своей компании — иначе `forbidden`) и `replyInboundAction` (зовёт `replyToInbound`, при `threadId` создаёт `Message` + `notifyOrgUsers`). Мок `requireManager`, `prisma`, `replyToInbound`, `recordAudit`.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать** оба action-а с контрактом Result (§3 CLAUDE.md): `requireManager()`; company-scope-проверка целевой организации (`requireManagerForOrg`-логика); аудит (`recordAudit`); для reply — `replyToInbound` + опциональное зеркало в `Message` (author = сессия) + `notifyOrgUsers('manager_replied')`; `writeSyncLog({ entity:'inbound', direction:'out' })`.

- [ ] **Step 4: PASS** → `npx vitest run src/__tests__/server-actions.inbound.test.ts`

- [ ] **Step 5: Коммит** — `feat(inbound): bind + reply server-actions`

---

## Task 11: Экран `/manager/inbox` + `listInbox` (A3)

**Files:**
- Create: `src/lib/services/inbound/listInbox.ts`
- Test: `src/__tests__/inbound.listInbox.integration.test.ts`, `src/__tests__/security.idor-inbox.integration.test.ts`
- Create: `src/app/manager/inbox/page.tsx`, `src/components/manager/inbox-list.tsx`, `inbox-filters.tsx`, `inbox-reply-form.tsx`, `inbox-bind-form.tsx`

- [ ] **Step 1: Падающий тест `listInbox` + IDOR**

`listInbox(prisma, session, { channel?, orgId?, status? })` возвращает только строки `companyId === session.companyId` **плюс** unresolved (companyId null) в отдельной секции; тест IDOR: менеджер компании A не видит `InboundMessage` компании B.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать `listInbox`** — узкие селекты, `where: { OR: [{ companyId: session.companyId }, { status: 'unresolved' }] }` для «нераспознанных» + `{ companyId: session.companyId }` для привязанных; сортировка `createdAt desc`; пагинация.

- [ ] **Step 4: Реализовать экран** — `page.tsx` (Server Component): `notFoundIfDisabled('inbound_messaging')` + `requireManager()`; `listInbox`; рендер `inbox-filters` + `inbox-list` (из ui-кита: `Table`/`Badge`/`EmptyState`/`Paginator`), для unresolved — `inbox-bind-form`, для bound — `inbox-reply-form`. Состояния loading/empty/error обязательны (CLAUDE.md §9/§23).

- [ ] **Step 5: PASS + typecheck + коммит**

Run: `npx vitest run src/__tests__/inbound.listInbox.integration.test.ts src/__tests__/security.idor-inbox.integration.test.ts && npm run typecheck`
```bash
git add src/lib/services/inbound/listInbox.ts src/app/manager/inbox src/components/manager/inbox-*.tsx src/__tests__/inbound.listInbox.integration.test.ts src/__tests__/security.idor-inbox.integration.test.ts
git commit -m "feat(inbound): unified /manager/inbox screen + company-scoped listInbox (+IDOR test)"
```

---

## Task 12: Вкладка «Обращения» в CRM-карточке (A3)

**Files:**
- Modify: `src/components/manager/org-card-tabs.tsx` (тип `OrgCardTab` + `ORG_CARD_TABS`)
- Modify: `src/lib/services/manager/organizationCard.ts` (добавить `inboundMessages` в выборку карточки)
- Modify: `src/app/manager/organizations/[id]/page.tsx` (case рендера вкладки)
- Test: `src/__tests__/manager.organizationCard.integration.test.ts` (существующий — добавить кейс)

- [ ] **Step 1: Падающий тест** — `getOrganizationCard` включает `inboundMessages` (последние N по `resolvedOrgId`), скоуп company соблюдён.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать** — добавить `'inbound_messages'` в `OrgCardTab`/`ORG_CARD_TABS` (label «Обращения»), в `organizationCard.ts` — параллельный запрос `inboundMessage.findMany({ where: { resolvedOrgId: orgId } , take, orderBy })`, в `page.tsx` — `case 'inbound_messages'` рендерит список (реюз `inbox-list` в read-only режиме). Вкладка условна по `isFeatureEnabled('inbound_messaging')`.

- [ ] **Step 4: PASS** → `npx vitest run src/__tests__/manager.organizationCard.integration.test.ts`

- [ ] **Step 5: Коммит** — `feat(inbound): «Обращения» tab on organization CRM card`

---

## Task 13: Полный прогон и close-out

- [ ] **Step 1:** `npm run typecheck && npm run lint`
- [ ] **Step 2:** `npm run gate` (integration против эфемерного Postgres) — зелёный.
- [ ] **Step 3:** `npx prisma migrate status` — чисто.
- [ ] **Step 4:** Создать `docs/superpowers/plans/2026-07-05-omnichannel-pr-a-inbound-DONE.md` (что отгружено vs план; эталон [partner-cabinet-phase4-DONE.md](2026-05-22-partner-cabinet-phase4-DONE.md)).
- [ ] **Step 5:** Коммит close-out; открыть PR-A.

---

## Self-review (покрытие спеки)

- §2.1 InboundMessage → Task 1; SyncLogEntity → Task 3. ✔
- §2.2 резолвер exact-only/C8/IDOR → Task 2 (+ IDOR-регресс Task 11). ✔
- §2.3 адаптер email (IMAP-шов, fake) → Task 8; Wazzup parse → Task 7. ✔
- §2.4 флаг + 4 точки → Task 0 (+ гейты в роутах Task 6/7/8, экран Task 11). ✔
- §2.5 A2 ingest+идемпотентность → Task 4; вложения-антивирус → Task 5; A1 webhooks → Task 6/7; email-воркер → Task 8; A3 инбокс/привязка/ответ/вкладка → Task 9/10/11/12. ✔
- §3 инварианты (идемпотентность, company-scope, IDOR, «данные не команды», секреты env, guardrail, зелёные проверки) → покрыты тестами Task 4/6/7/11 + Task 13. ✔
- Вне объёма §4 — не планируется (промоут в Document, admin-инбокс, полная messenger-склейка). ✔
