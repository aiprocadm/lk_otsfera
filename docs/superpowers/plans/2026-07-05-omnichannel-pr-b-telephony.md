# PR-B — Телефония Mango (Mango Office VPBX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Принимать события Mango VPBX (вызов/summary/recording) через webhook (подпись + IP-allowlist), логировать звонки в модель `Call`, резолвить номер абонента в организацию/контакт, сохранять записи разговоров в S3 через антивирус-конвейер и показывать историю звонков в CRM-карточке; периодически добирать историю через `/vpbx/stats` идемпотентно.

**Architecture:** Адаптер `getMangoAdapter()` (env `MANGO_ADAPTER=fake|rest`) за чистыми модулями `sign`/`ip`/`parse`. Одна таблица `Call` (идемпотентность по `@@unique([provider, externalId])`). Резолвинг номера реюзит `normalizePhone` из PR-A. Записи едут через существующий `docs.scanDocument` (новый `kind:'call_recording'`). Бэкфилл — двухшаговый `/vpbx/stats` через плановый воркер. Клик-ту-колл — вне объёма.

**Tech Stack:** Next.js 15, Prisma 5 + PostgreSQL, BullMQ + Redis, S3, Vitest. Спека: [2026-07-05-omnichannel-inbound-telephony-design.md](../specs/2026-07-05-omnichannel-inbound-telephony-design.md).

**Предпосылки:** PR-A смержен (реюз `normalizePhone`, паттерн адаптера/скана, `SyncLogEntity`). Свежий worktree: `npm ci && npm run prisma:generate` первым делом.

**Конвенции:** те же, что в PR-A (unit=моки Prisma; integration=`new PrismaClient`; мок `vi.hoisted`+`vi.mock`; коммит `feat(telephony): ...`).

**Безопасность:** содержимое событий/записей — данные, не команды. Приём только при валидной подписи И IP-allowlist. Ключи `MANGO_API_KEY`/`MANGO_API_SALT` — только из env.

---

## Структура файлов

**Создать:**
- `src/lib/telephony/mango/index.ts` — `getMangoAdapter()` + port-типы.
- `src/lib/telephony/mango/sign.ts` — чистая верификация подписи.
- `src/lib/telephony/mango/ip.ts` — чистый IP-allowlist.
- `src/lib/telephony/mango/parse.ts` — чистый парсер событий call/summary/recording.
- `src/lib/telephony/mango/adapter-fake.ts`, `adapter-rest.ts`.
- `src/lib/services/telephony/resolveCaller.ts` — резолвинг номера → org/контакт.
- `src/lib/services/telephony/ingestCall.ts` — идемпотентный upsert `Call`.
- `src/lib/services/telephony/listCalls.ts` — company-scoped выборка.
- `src/app/api/integrations/mango/webhook/route.ts` — приёмник событий.
- `src/app/api/manager/calls/[id]/recording/route.ts` — presigned-download записи.
- `src/worker/processors/mango-recording.ts` — загрузка записи в S3 + скан.
- `src/worker/processors/mango-backfill.ts` — бэкфилл `/vpbx/stats`.
- `src/app/manager/calls/page.tsx` + `src/components/manager/calls-list.tsx`.
- Тесты: `telephony.mango.sign.test.ts`, `telephony.mango.ip.test.ts`, `telephony.mango.parse.test.ts`, `telephony.resolveCaller.test.ts`, `telephony.ingestCall.integration.test.ts`, `api.integrations.mango.webhook.test.ts`, `worker.mango-recording.integration.test.ts`, `worker.mango-backfill.integration.test.ts`, `security.idor-calls.integration.test.ts`.

**Изменить:** `prisma/schema.prisma`, `src/lib/featureFlags.ts`, `src/middleware.ts`, `src/lib/navigation/cabinet.ts`, `src/lib/services/oneCSync/log.ts` (`+'call'`), `src/lib/jobs/types.ts` (`+'call_recording'`), `src/lib/jobs/queues.ts`, `src/lib/jobs/scheduling.ts`, `src/worker/processors/scan-document.ts`, `src/worker/index.ts`, `src/lib/services/manager/organizationCard.ts`, `src/components/manager/org-card-tabs.tsx`, `src/app/manager/organizations/[id]/page.tsx`.

---

## Task 0: Флаг `telephony_mango` + `Call` модель + SyncLog

**Files:** `src/lib/featureFlags.ts`, `src/middleware.ts`, `src/lib/navigation/cabinet.ts`, `prisma/schema.prisma`, `src/lib/services/oneCSync/log.ts`

- [ ] **Step 1:** `npm ci && npm run prisma:generate`.
- [ ] **Step 2:** В `featureFlags.ts` добавить `'telephony_mango'` в `FEATURE_FLAGS` и `OPT_IN_FLAGS`.
- [ ] **Step 3:** В `middleware.ts` `FEATURE_PREFIXES` += `{ prefix: '/manager/calls', flag: 'telephony_mango' }`. В `cabinet.ts` в `manager` += `{ href: '/manager/calls', label: 'Звонки', icon: '☎️', flag: 'telephony_mango' }`.
- [ ] **Step 4:** В `schema.prisma` добавить модель `Call` (поля — спека §2.1) + back-relations `calls Call[]` на `Organization`/`User`/`Company`:
```prisma
model Call {
  id                  String   @id @default(cuid())
  createdAt           DateTime @default(now())
  provider            String   @default("mango")
  externalId          String
  direction           String
  callerNumber        String
  internalNumber      String?
  startedAt           DateTime?
  answeredAt          DateTime?
  finishedAt          DateTime?
  durationSec         Int?
  status              String
  recordingId         String?
  recordingPath       String?
  recordingScanStatus String   @default("none")
  resolvedOrgId       String?
  resolvedUserId      String?
  threadId            String?
  companyId           String?

  resolvedOrg  Organization? @relation("OrgCalls", fields: [resolvedOrgId], references: [id])
  resolvedUser User?         @relation("UserCalls", fields: [resolvedUserId], references: [id])
  company      Company?      @relation(fields: [companyId], references: [id])

  @@unique([provider, externalId])
  @@index([companyId, createdAt])
  @@index([resolvedOrgId, createdAt])
  @@index([callerNumber, createdAt])
}
```
Затем `SyncLogEntity` в `log.ts` += `| 'call'`.
- [ ] **Step 5:** `npm run prisma:migrate -- --name call_journal` (ревью SQL: только `CREATE TABLE`/индексы, аддитивно); `npm run typecheck`; коммит:
```bash
git add src/lib/featureFlags.ts src/middleware.ts src/lib/navigation/cabinet.ts prisma/ src/lib/services/oneCSync/log.ts
git commit -m "feat(telephony): telephony_mango flag + Call model + migration"
```

---

## Task 1: Подпись Mango (чистая верификация)

**Files:** Create `src/lib/telephony/mango/sign.ts`; Test `src/__tests__/telephony.mango.sign.test.ts` (unit)

- [ ] **Step 1: Падающий тест**
```ts
import { describe, it, expect } from 'vitest';
import { computeMangoSign, verifyMangoSign } from '@/lib/telephony/mango/sign';

it('sign = sha256(api_key + json + api_salt)', () => {
  const s = computeMangoSign('KEY', '{"a":1}', 'SALT');
  expect(s).toHaveLength(64);
  expect(verifyMangoSign({ apiKey: 'KEY', salt: 'SALT', json: '{"a":1}', sign: s })).toBe(true);
  expect(verifyMangoSign({ apiKey: 'KEY', salt: 'SALT', json: '{"a":1}', sign: 'bad' })).toBe(false);
});
```
- [ ] **Step 2: FAIL** → `npx vitest run src/__tests__/telephony.mango.sign.test.ts`
- [ ] **Step 3: Реализовать**
```ts
import { createHash, timingSafeEqual } from 'node:crypto';
export function computeMangoSign(apiKey: string, json: string, salt: string): string {
  return createHash('sha256').update(apiKey + json + salt).digest('hex');
}
export function verifyMangoSign(args: { apiKey: string; salt: string; json: string; sign: string }): boolean {
  const expected = computeMangoSign(args.apiKey, args.json, args.salt);
  const a = Buffer.from(expected); const b = Buffer.from(args.sign ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
```
- [ ] **Step 4: PASS** → `npx vitest run src/__tests__/telephony.mango.sign.test.ts`
- [ ] **Step 5: Коммит** — `feat(telephony): mango sign verification`

---

## Task 2: IP-allowlist (чистый)

**Files:** Create `src/lib/telephony/mango/ip.ts`; Test `src/__tests__/telephony.mango.ip.test.ts` (unit)

- [ ] **Step 1: Падающий тест**
```ts
import { describe, it, expect } from 'vitest';
import { isMangoIpAllowed } from '@/lib/telephony/mango/ip';
it('default allowlist', () => {
  expect(isMangoIpAllowed('81.88.80.132')).toBe(true);
  expect(isMangoIpAllowed('81.88.82.36')).toBe(true);
  expect(isMangoIpAllowed('1.2.3.4')).toBe(false);
  expect(isMangoIpAllowed('81.88.80.132', '9.9.9.9')).toBe(false); // override env-строкой
});
```
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Реализовать**
```ts
const DEFAULT = '81.88.80.132,81.88.80.133,81.88.82.36';
export function isMangoIpAllowed(ip: string, allowlist = process.env.MANGO_ALLOWED_IPS ?? DEFAULT): boolean {
  const set = new Set(allowlist.split(',').map((s) => s.trim()).filter(Boolean));
  return set.has((ip ?? '').trim());
}
/** Извлекает клиентский IP из заголовков (x-forwarded-for первый). */
export function clientIpFrom(headers: Headers): string {
  return (headers.get('x-forwarded-for')?.split(',')[0] ?? headers.get('x-real-ip') ?? '').trim();
}
```
- [ ] **Step 4: PASS**
- [ ] **Step 5: Коммит** — `feat(telephony): mango IP allowlist`

---

## Task 3: Парсер событий (чистый)

**Files:** Create `src/lib/telephony/mango/parse.ts`; Test `src/__tests__/telephony.mango.parse.test.ts` (unit)

- [ ] **Step 1: Падающий тест** — на три формы (`call`, `summary` с `call_direction`, `recording` с `recording_state=Completed` → `recording_id`); неизвестное/битое → `null`.
```ts
import { describe, it, expect } from 'vitest';
import { parseMangoEvent } from '@/lib/telephony/mango/parse';
it('summary → normalized call event', () => {
  const e = parseMangoEvent('summary', { entry_id: 'C1', call_direction: 1, from: { number: '79990001122' }, to: { number: '4951234567' }, duration: 42 });
  expect(e).toMatchObject({ kind: 'summary', externalId: 'C1', direction: 'inbound', callerNumber: '+79990001122', durationSec: 42 });
});
it('recording Completed → recording event', () => {
  const e = parseMangoEvent('recording', { entry_id: 'C1', recording_state: 'Completed', recording_id: 'R9' });
  expect(e).toMatchObject({ kind: 'recording', externalId: 'C1', recordingId: 'R9' });
});
it('recording not-completed → null', () => {
  expect(parseMangoEvent('recording', { entry_id: 'C1', recording_state: 'InProgress' })).toBeNull();
});
```
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Реализовать** `parseMangoEvent(type, json)` → discriminated union `{ kind:'call'|'summary'|'recording', externalId, direction?, callerNumber?, internalNumber?, durationSec?, status?, recordingId? }` или `null`. `call_direction` 1→'inbound', 2→'outbound'. Телефоны — через `normalizePhone` (импорт из PR-A `@/lib/services/inbound/resolve`). Защитный парсинг: любое отсутствие обязательного поля → `null`.
- [ ] **Step 4: PASS**
- [ ] **Step 5: Коммит** — `feat(telephony): mango event parser`

---

## Task 4: Адаптер `getMangoAdapter()` (fake/rest)

**Files:** Create `src/lib/telephony/mango/index.ts`, `adapter-fake.ts`, `adapter-rest.ts`

- [ ] **Step 1:** Port-интерфейс в `index.ts`:
```ts
export interface MangoAdapter {
  fetchRecording(recordingId: string): Promise<{ buffer: Buffer; contentType: string } | null>;
  requestStats(range: { from: string; to: string }): Promise<{ key: string }>;
  fetchStatsResult(key: string): Promise<{ ready: boolean; rows: unknown[] }>;
}
let cached: MangoAdapter | null = null;
export function getMangoAdapter(): MangoAdapter {
  if (cached) return cached;
  const kind = (process.env.MANGO_ADAPTER ?? 'fake').trim().toLowerCase();
  if (kind === 'fake') { const { FakeMangoAdapter } = require('./adapter-fake'); return (cached = new FakeMangoAdapter()); }
  if (kind === 'rest') { const { RestMangoAdapter } = require('./adapter-rest'); return (cached = new RestMangoAdapter()); }
  throw new Error(`Unknown MANGO_ADAPTER: ${kind}`);
}
export function __resetMangoAdapter() { cached = null; }
```
- [ ] **Step 2:** `adapter-fake.ts` — управляем env-ручками (`FAKE_MANGO_RECORDING` base64, `FAKE_MANGO_STATS` JSON); `adapter-rest.ts` — реальные POST на `MANGO_VPBX_BASE_URL` с form-полями `vpbx_api_key`+`sign`+`json` (сеть только здесь; в тестах не вызывается). Записать `writeSyncLog` на ошибках в rest.
- [ ] **Step 3:** typecheck.
- [ ] **Step 4:** Коммит — `feat(telephony): mango adapter (fake/rest) env-keyed`

---

## Task 5: Резолвинг номера + `ingestCallEvent` (B2)

**Files:** Create `src/lib/services/telephony/resolveCaller.ts`, `ingestCall.ts`; Test `telephony.resolveCaller.test.ts` (unit), `telephony.ingestCall.integration.test.ts`

- [ ] **Step 1: Падающий unit-тест резолвера** — точное совпадение по `User.whatsappPhone`; при отсутствии — по `Lead.clientContactPhone`; >1 → unresolved; нормализация номера.
- [ ] **Step 2:** Реализовать `resolveCaller(prisma, phoneRaw)` → `{ matchType, userId?, orgId?, companyId? }`:
```ts
import type { PrismaClient } from '@prisma/client';
import { normalizePhone } from '@/lib/services/inbound/resolve';

export async function resolveCaller(prisma: PrismaClient, phoneRaw: string) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { matchType: 'unresolved' as const };
  const users = await prisma.user.findMany({ where: { whatsappPhone: phone }, select: { id: true, organization: { select: { id: true, companyId: true } } }, take: 2 });
  if (users.length === 1 && users[0].organization?.companyId) {
    return { matchType: 'exact' as const, userId: users[0].id, orgId: users[0].organization.id, companyId: users[0].organization.companyId };
  }
  const leads = await prisma.lead.findMany({ where: { clientContactPhone: phone }, select: { organizationId: true, organization: { select: { companyId: true } } }, take: 2 });
  if (leads.length === 1 && leads[0].organizationId && leads[0].organization?.companyId) {
    return { matchType: 'exact' as const, orgId: leads[0].organizationId, companyId: leads[0].organization.companyId };
  }
  return { matchType: 'unresolved' as const };
}
```
- [ ] **Step 3: Падающий integration-тест `ingestCallEvent`** — идемпотентность по `@@unique([provider, externalId])` (повтор не двоит), summary мёржит длительность/статус в существующую строку, unresolved → companyId null.
- [ ] **Step 4:** Реализовать `ingestCallEvent(prisma, event)` — `upsert` по `{ provider_externalId: { provider:'mango', externalId } }`; на `summary` дополнять `durationSec/status/direction/finishedAt`; резолвинг через `resolveCaller`; `writeSyncLog({ entity:'call' })`; на `recording`-событии — записать `recordingId` и вернуть флаг «нужна загрузка записи» (enqueue делает вызывающий webhook, Task 6).
- [ ] **Step 5: PASS + коммит** — `feat(telephony): caller resolver + idempotent ingestCallEvent (B2)`

---

## Task 6: Webhook Mango (B1) + постановка загрузки записи

**Files:** Create `src/app/api/integrations/mango/webhook/route.ts`; Test `api.integrations.mango.webhook.test.ts`

- [ ] **Step 1: Падающий тест** — (а) 401 при неверной подписи; (б) 401 при неразрешённом IP; (в) валидный `summary` → `ingestCallEvent` вызван, 200; (г) `recording Completed` → enqueue `telephony.mango.recording`.
```ts
const { ingest, addJob } = vi.hoisted(() => ({ ingest: vi.fn(), addJob: vi.fn() }));
vi.mock('@/lib/services/telephony/ingestCall', () => ({ ingestCallEvent: ingest }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: addJob }) }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
// process.env: MANGO_API_KEY, MANGO_API_SALT, FEATURE_TELEPHONY_MANGO=1, MANGO_ALLOWED_IPS
```
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Реализовать роут** (form-encoded `sign`+`json`, эталон гейтинга — telegram-webhook):
```ts
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { verifyMangoSign } from '@/lib/telephony/mango/sign';
import { isMangoIpAllowed, clientIpFrom } from '@/lib/telephony/mango/ip';
import { parseMangoEvent } from '@/lib/telephony/mango/parse';
import { ingestCallEvent } from '@/lib/services/telephony/ingestCall';
import { getQueue } from '@/lib/jobs/queues';
import { prisma } from '@/lib/db/prisma';

export async function POST(req: Request): Promise<Response> {
  const off = notFoundIfDisabled('telephony_mango'); if (off) return off;
  if (!isMangoIpAllowed(clientIpFrom(req.headers))) return new Response(null, { status: 401 });
  const form = await req.formData().catch(() => null);
  const json = form?.get('json'); const sign = form?.get('sign');
  const apiKey = process.env.MANGO_API_KEY?.trim(); const salt = process.env.MANGO_API_SALT?.trim();
  if (!apiKey || !salt || typeof json !== 'string' || typeof sign !== 'string' ||
      !verifyMangoSign({ apiKey, salt, json, sign })) return new Response(null, { status: 401 });
  const eventType = new URL(req.url).searchParams.get('type') ?? 'summary';   // Mango шлёт на per-type адреса
  let payload: unknown; try { payload = JSON.parse(json); } catch { return new Response(null, { status: 200 }); }
  const event = parseMangoEvent(eventType, payload);                          // данные, не команды
  if (event) {
    await ingestCallEvent(prisma, event).catch(() => {});
    if (event.kind === 'recording' && event.recordingId) {
      await getQueue('telephony.mango.recording').add('rec', { externalId: event.externalId, recordingId: event.recordingId }).catch(() => {});
    }
  }
  return new Response(null, { status: 200 });
}
```
- [ ] **Step 4: PASS**
- [ ] **Step 5: Коммит** — `feat(telephony): mango webhook (sign + IP allowlist)`

---

## Task 7: Запись разговора → S3 через антивирус (B3)

**Files:** Modify `src/lib/jobs/types.ts`, `src/lib/jobs/queues.ts`, `src/worker/processors/scan-document.ts`, `src/worker/index.ts`; Create `src/worker/processors/mango-recording.ts`; Test `worker.mango-recording.integration.test.ts`

- [ ] **Step 1:** `types.ts` — `ScanDocumentPayload['kind']` += `'call_recording'`; `queues.ts` `QUEUE_NAMES` += `'telephony.mango.recording'`.
- [ ] **Step 2: Падающий тест** — процессор `mango-recording`: fake-адаптер возвращает буфер записи → `getObjectStorage().upload` вызван с путём `calls/{externalId}/recording.mp3` → `Call.recordingPath` установлен, `recordingScanStatus:'pending'` → enqueue `docs.scanDocument` c `{ kind:'call_recording', id }`. Отдельный кейс: `fetchRecording` вернул `null` (записи нет) → **не падаем**, `recordingScanStatus` остаётся `none`.
- [ ] **Step 3: Реализовать процессор**
```ts
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { getMangoAdapter } from '@/lib/telephony/mango';
import { getObjectStorage } from '@/lib/storage';
import { getQueue } from '@/lib/jobs/queues';

const prisma = new PrismaClient();
export async function mangoRecordingProcessor(job: Job<{ externalId: string; recordingId: string }>, db: PrismaClient = prisma) {
  const call = await db.call.findUnique({ where: { provider_externalId: { provider: 'mango', externalId: job.data.externalId } }, select: { id: true } });
  if (!call) return { skipped: 'no_call' };
  const rec = await getMangoAdapter().fetchRecording(job.data.recordingId);
  if (!rec) return { skipped: 'no_recording' };                     // звонок без записи — валидно
  const path = `calls/${job.data.externalId}/recording.mp3`;
  await getObjectStorage().upload(path, rec.buffer, { contentType: rec.contentType });
  await db.call.update({ where: { id: call.id }, data: { recordingId: job.data.recordingId, recordingPath: path, recordingScanStatus: 'pending' } });
  await getQueue('docs.scanDocument').add('scan', { kind: 'call_recording', id: call.id }).catch(() => {});
  return { stored: true };
}
```
- [ ] **Step 4:** В `scan-document.ts` добавить ветвь `kind:'call_recording'` (обновляет `call.recordingScanStatus`); в `worker/index.ts` — `startWorker('telephony.mango.recording', mangoRecordingProcessor as Processor)`.
- [ ] **Step 5: PASS** (+ guardrail) и коммит — `feat(telephony): store recording in S3 via AV pipeline`

---

## Task 8: Бэкфилл `/vpbx/stats` (B5)

**Files:** Modify `src/lib/jobs/queues.ts`, `src/lib/jobs/scheduling.ts`, `src/worker/index.ts`; Create `src/worker/processors/mango-backfill.ts`; Test `worker.mango-backfill.integration.test.ts`

- [ ] **Step 1:** `QUEUE_NAMES` += `'telephony.mango.backfill'`; в `SYNC_SCHEDULES` += `{ queueName:'telephony.mango.backfill', schedulerId:'telephony.mango.backfill.cron', pattern:'0 * * * *', tz: DEFAULT_SYNC_TZ }`.
- [ ] **Step 2: Падающий integration-тест идемпотентности** — fake-адаптер `requestStats`→key, `fetchStatsResult`→rows (2 звонка); прогнать процессор дважды; проверить, что `Call` создан по одному на externalId (реюз `ingestCallEvent` по unique-ключу), курсор/окно в `SyncState`.
- [ ] **Step 3: Реализовать процессор** — двухшаговый: `requestStats(window)` → поллинг `fetchStatsResult(key)` до `ready` (с ограничением попыток) → каждая строка через `parseMangoEvent('summary', row)` → `ingestCallEvent` (идемпотентно против живых событий B1); окно из `SyncState('telephony.mango')`; `writeSyncLog({ entity:'call', operation:'import' })`.
- [ ] **Step 4:** `worker/index.ts` — `startWorker('telephony.mango.backfill', mangoBackfillProcessor as Processor)`.
- [ ] **Step 5: PASS** (+ guardrail) и коммит — `feat(telephony): idempotent /vpbx/stats backfill worker`

---

## Task 9: Вкладка «Звонки» + список `/manager/calls` + скачивание записи (B4)

**Files:** Create `src/lib/services/telephony/listCalls.ts`, `src/app/manager/calls/page.tsx`, `src/components/manager/calls-list.tsx`, `src/app/api/manager/calls/[id]/recording/route.ts`; Modify `organizationCard.ts`, `org-card-tabs.tsx`, `organizations/[id]/page.tsx`; Test `telephony.listCalls.integration.test.ts`, `security.idor-calls.integration.test.ts`, `api.manager.calls.recording.test.ts`

- [ ] **Step 1: Падающий тест `listCalls` + IDOR** — company-scoped выборка; менеджер компании A не видит `Call` компании B.
- [ ] **Step 2:** Реализовать `listCalls(prisma, session, filters)` (узкие селекты, `where: { companyId: session.companyId }`, фильтр по orgId/direction), экран `/manager/calls` (`notFoundIfDisabled('telephony_mango')` + `requireManager`, состояния loading/empty/error), `calls-list.tsx` из ui-кита.
- [ ] **Step 3: Падающий тест download-роута** — `GET /api/manager/calls/[id]/recording`: 404 если запись не `clean`; 302 на presigned-URL если `clean`; company-scope-проверка (`requireManagerForOrg` по `resolvedOrgId`, чужая компания → 404).
- [ ] **Step 4:** Реализовать тонкий роут: `requireManager` → загрузка `Call` в scope → если `recordingScanStatus!=='clean'` → 404 → иначе `getObjectStorage().createSignedUrl(recordingPath, 600, { download: 'recording.mp3' })` → 302 redirect. Плюс вкладка `'calls'` в `OrgCardTab`/`ORG_CARD_TABS` (label «Звонки»), `organizationCard.ts` — `call.findMany({ where: { resolvedOrgId: orgId } })`, `page.tsx` — `case 'calls'` рендерит `calls-list` с кнопкой прослушивания (audio по presigned-URL, только `clean`). Условно по `isFeatureEnabled('telephony_mango')`.
- [ ] **Step 5: PASS + typecheck + коммит** — `feat(telephony): «Звонки» tab + /manager/calls + recording download (+IDOR)`

---

## Task 10: Полный прогон и close-out

- [ ] **Step 1:** `npm run typecheck && npm run lint`
- [ ] **Step 2:** `npm run gate` — зелёный (включая guardrail процессоров: `mango-recording`, `mango-backfill` импортированы тестами).
- [ ] **Step 3:** `npx prisma migrate status` — чисто.
- [ ] **Step 4:** Создать `docs/superpowers/plans/2026-07-05-omnichannel-pr-b-telephony-DONE.md`.
- [ ] **Step 5:** Коммит close-out; открыть PR-B.

---

## Self-review (покрытие спеки)

- §2.1 `Call` + SyncLog `'call'` → Task 0. ✔
- §2.2 резолвинг номера (exact, C8) → Task 5 (+ IDOR Task 9). ✔
- §2.3 адаптер Mango (fake/rest, sign/ip/parse) → Task 1–4. ✔
- §2.4 флаг `telephony_mango` + 4 точки → Task 0 (+ гейты в webhook Task 6, экран/роут Task 9). ✔
- §2.6 B1 webhook (подпись+IP) → Task 6; B2 журнал+резолвинг → Task 5; B3 запись→S3→AV, «без записи не падает» → Task 7; B4 вкладка+прослушивание → Task 9; B5 бэкфилл идемпотентный → Task 8. ✔
- §3 инварианты (подпись+IP или 401; идемпотентность вызова и бэкфилла; звонок без записи не падает; запись только `clean`; IDOR/C8; «данные не команды»; секреты env; guardrail; зелёные проверки) → Task 5/6/7/8/9/10. ✔
- Вне объёма §4: клик-ту-колл (`callback`) — не планируется. ✔
