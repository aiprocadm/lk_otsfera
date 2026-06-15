# Coverage Phase 1 — Logic Tail → 100% Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести покрытие тестами всех **не-React логических** файлов (`lib/**` кроме `.tsx`-шаблонов, `worker/**`, `server-actions/**`, `app/api/**`, `middleware.ts`) до 100% по line/branch/function, и включить per-glob порог-гейт на эти слои.

**Architecture:** Покрытие-driven цикл по файлам: прогнать coverage на файле → открыть HTML-отчёт → увидеть красные строки/ветки → дописать тест, бьющий именно их → повторить до 100%. Стартовый тест-код для тяжёлых файлов дан в плане; длинный хвост однотипных файлов бьётся по эталонному паттерну батчами. Никакой новой тест-инфраструктуры — только существующие `vi.hoisted`+`vi.mock` (unit) и живой Postgres (integration), см. CLAUDE.md §6.

**Tech Stack:** Vitest 2 + `@vitest/coverage-v8`, Prisma 5 (mock или живой PG), TypeScript strict.

**Scope (из baseline 2026-06-15):** 114 файлов, 2084 строки. Из них в ЭТОТ план НЕ входят (отложены в фазу 2, нужен рендер-харнесс): `lib/email/templates/**/*.tsx` (8 файлов), `lib/email/send.tsx`, `hooks/*.ts` (useThreadPolling/useClientResource/useFormAction → `lib/ui/useFormAction.ts`). Они помечены `// PHASE-2` ниже.

---

## Метод (применять в КАЖДОЙ задаче ниже)

Покрытие одного файла проверяется так:

```bash
# HTML-отчёт по конкретному файлу после прогона:
npx vitest run --coverage <путь к тест-файлу(ам)>
# затем открыть coverage/index.html и найти файл — красное = непокрытые строки/ветки.
```

Для unit-файлов (мок prisma) достаточно `--mode=unit`. Для сервисов, которые покрываются только через живой Postgres, тест помечается integration автоматически (содержит `new PrismaClient(` — см. vitest.config.ts), и проверяется через `npm run test:integration` (нужен PG на :5432, см. memory `project-running-locally`).

**Критерий готовности файла:** в HTML-отчёте по нему все четыре столбца = 100%. Точечный `/* v8 ignore next -- <причина> */` допустим ТОЛЬКО для логически недостижимых строк (например defensive `throw` в исчерпанном switch) с комментарием-обоснованием.

---

## Task 1: Завершить фундамент (Фаза 0)

**Files:**
- Modify: `package.json` (scripts)
- Modify: `vitest.config.ts` (применить exclude из спеки §3)

- [ ] **Step 1: Добавить npm-скрипты покрытия**

В `package.json` в блок `scripts` добавить:

```json
    "test:coverage": "vitest run --coverage",
    "test:coverage:unit": "vitest run --mode=unit --coverage",
```

- [ ] **Step 2: Применить exclude-границу (спека §3) в `vitest.config.ts`**

Заменить блок `coverage.exclude` на:

```ts
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/e2e/**', // Playwright specs — not executed by Vitest
        'src/**/*.d.ts',
        // Беслогичные фреймворк-шеллы Next (спека §3):
        'src/**/{layout,loading,error,not-found,global-error,template}.tsx'
      ],
```

- [ ] **Step 3: Прогнать unit-coverage, убедиться, что конфиг валиден**

Run: `npm run test:coverage:unit`
Expected: прогон зелёный, в конце таблица Coverage summary (цифры не важны на этом шаге).

- [ ] **Step 4: Commit (включая отложенный тулинг фазы 0)**

```bash
git add package.json package-lock.json vitest.config.ts scripts/coverage-by-layer.mjs
git commit -m "test(coverage): vitest v8 coverage tooling + scripts + exclude boundary"
```

---

## Task 2: `lib/services/partner/finance.ts` → 100% (unit, эталон)

Чистые read-функции, сейчас 0% (API-тест мокает сервис). Полностью покрываемо unit-тестом с мок-prisma.

**Files:**
- Create: `src/__tests__/services.partner.finance.test.ts`
- Target: `src/lib/services/partner/finance.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFinanceKpis, listStatements, getStatementWithItems } from '@/lib/services/partner/finance';

const { findMany, findFirst } = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));
const prisma = { commissionStatement: { findMany, findFirst } } as never;

beforeEach(() => vi.clearAllMocks());

describe('getFinanceKpis', () => {
  it('распределяет суммы по earned/pending/paid согласно статусу', async () => {
    findMany.mockResolvedValue([
      { status: 'draft', totalCommissionAmount: 100 },
      { status: 'approved', totalCommissionAmount: 200 },
      { status: 'paid', totalCommissionAmount: 50 }
    ]);
    const r = await getFinanceKpis(prisma, 'p1');
    expect(r).toEqual({ earnedTotal: 250, pendingTotal: 300, paidTotal: 50 });
    expect(findMany).toHaveBeenCalledWith({
      where: { partnerId: 'p1', supersededBy: null },
      select: { status: true, totalCommissionAmount: true }
    });
  });

  it('возвращает нули на пустом наборе', async () => {
    findMany.mockResolvedValue([]);
    expect(await getFinanceKpis(prisma, 'p1')).toEqual({ earnedTotal: 0, pendingTotal: 0, paidTotal: 0 });
  });
});

describe('listStatements', () => {
  beforeEach(() => findMany.mockResolvedValue([
    { id: 's1', status: 'paid', _count: { items: 3 } }
  ]));

  it('без фильтров: дефолтные skip/take, маппит itemCount', async () => {
    const r = await listStatements(prisma, { partnerId: 'p1' });
    expect(r).toEqual([{ id: 's1', status: 'paid', itemCount: 3 }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { partnerId: 'p1', supersededBy: null }, skip: 0, take: 20
    }));
  });

  it('со статусом и диапазоном from/to строит where.periodFrom', async () => {
    const from = new Date('2026-01-01'); const to = new Date('2026-02-01');
    await listStatements(prisma, { partnerId: 'p1', status: 'approved', from, to, skip: 5, take: 10 });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('approved');
    expect(arg.where.periodFrom).toEqual({ gte: from, lte: to });
    expect(arg.skip).toBe(5); expect(arg.take).toBe(10);
  });

  it('только from (без to)', async () => {
    const from = new Date('2026-01-01');
    await listStatements(prisma, { partnerId: 'p1', from });
    expect(findMany.mock.calls[0][0].where.periodFrom).toEqual({ gte: from });
  });

  it('только to (без from)', async () => {
    const to = new Date('2026-02-01');
    await listStatements(prisma, { partnerId: 'p1', to });
    expect(findMany.mock.calls[0][0].where.periodFrom).toEqual({ lte: to });
  });
});

describe('getStatementWithItems', () => {
  it('пробрасывает findFirst с include items', async () => {
    findFirst.mockResolvedValue({ id: 's1', items: [] });
    const r = await getStatementWithItems(prisma, 's1', 'p1');
    expect(r).toEqual({ id: 's1', items: [] });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 's1', partnerId: 'p1' },
      include: { items: { orderBy: { organizationName: 'asc' } } }
    });
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает (до этого тест-файла не было)**

Run: `npx vitest run --mode=unit src/__tests__/services.partner.finance.test.ts`
Expected: при первом запуске может пройти сразу (тест против реального кода). Цель — проверить, что код исполняется; смотрим coverage на следующем шаге.

- [ ] **Step 3: Проверить покрытие файла**

Run: `npx vitest run --coverage --mode=unit src/__tests__/services.partner.finance.test.ts`
Expected: открыть `coverage/index.html` → `finance.ts` = 100/100/100/100. Если ветка красная — добавить кейс по методу выше.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/services.partner.finance.test.ts
git commit -m "test(partner/finance): unit cover getFinanceKpis/listStatements/getStatementWithItems to 100%"
```

---

## Task 3: `lib/services/partner/leadAttachments.ts` → 100% (unit, крупнейший — 350 строк)

Result-контракт с storage/queue/audit. Мокаем всё внешнее, как в эталоне `services.manager.uploads.test.ts`.

**Files:**
- Create: `src/__tests__/services.partner.leadAttachments.test.ts`
- Target: `src/lib/services/partner/leadAttachments.ts`

- [ ] **Step 1: Написать тест-скелет с моками (бьёт основные ветки)**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  leadFindFirst, attFindFirst, attFindMany, attCreate, attDelete, auditCreate,
  storageUpload, storageRemove, storageSigned, queueAdd,
  validateMagicBytes, extensionFor, isPartnerAdmin, recordAudit
} = vi.hoisted(() => ({
  leadFindFirst: vi.fn(), attFindFirst: vi.fn(), attFindMany: vi.fn(),
  attCreate: vi.fn(), attDelete: vi.fn(), auditCreate: vi.fn(),
  storageUpload: vi.fn(), storageRemove: vi.fn(), storageSigned: vi.fn(), queueAdd: vi.fn(),
  validateMagicBytes: vi.fn(), extensionFor: vi.fn(), isPartnerAdmin: vi.fn(), recordAudit: vi.fn()
}));

vi.mock('@/lib/storage/supabase', () => ({
  documentBucket: 'documents',
  getServerClient: () => ({ storage: { from: () => ({
    upload: storageUpload, remove: storageRemove, createSignedUrl: storageSigned
  }) } })
}));
vi.mock('@/lib/storage/mimeValidator', () => ({ validateMagicBytes, extensionFor }));
vi.mock('@/lib/auth/policy', () => ({ isPartnerAdmin }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: queueAdd }) }));
vi.mock('@/lib/services/scan/visibility', () => ({ INFECTED_HIDDEN_WHERE: { scanStatus: { not: 'infected' } } }));

import {
  uploadLeadAttachment, deleteLeadAttachment, getLeadAttachmentDownloadUrl,
  listLeadAttachments, LeadAttachmentError, __testing
} from '@/lib/services/partner/leadAttachments';

function prismaMock() {
  const tx = { leadAttachment: { create: attCreate, delete: attDelete }, auditLog: { create: auditCreate } };
  return {
    lead: { findFirst: leadFindFirst },
    leadAttachment: { findFirst: attFindFirst, findMany: attFindMany },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx))
  } as never;
}

const goodFile = () => ({ buffer: new Uint8Array([1, 2, 3]), name: 'doc.pdf', declaredMimeType: 'application/pdf', size: 1024 });
const session = (sub = 'u1') => ({ sub, role: 'partner' }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  validateMagicBytes.mockReturnValue({ ok: true, mime: 'application/pdf' });
  extensionFor.mockReturnValue('pdf');
  storageUpload.mockResolvedValue({ error: null });
  storageRemove.mockResolvedValue({ error: null });
  storageSigned.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null });
  attCreate.mockResolvedValue({ id: 'att-1' });
});

describe('uploadLeadAttachment', () => {
  const input = () => ({ leadId: 'l1', partnerId: 'p1', uploadedByUserId: 'u1', file: goodFile() });

  it('успех: создаёт вложение, аудит, ставит scan в очередь', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toEqual({ ok: true, attachment: { id: 'att-1' } });
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'leadAttachment', id: 'att-1' });
    expect(recordAudit).toHaveBeenCalled();
  });

  it('FILE_TOO_LARGE при превышении размера', async () => {
    const r = await uploadLeadAttachment(prismaMock(), { ...input(), file: { ...goodFile(), size: 999_000_000 } });
    expect(r).toMatchObject({ ok: false, error: 'FILE_TOO_LARGE' });
  });

  it('INVALID_FILENAME на пустом имени', async () => {
    const r = await uploadLeadAttachment(prismaMock(), { ...input(), file: { ...goodFile(), name: '   ' } });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_FILENAME' });
  });

  it('UNSUPPORTED_MEDIA_TYPE при провале magic-bytes', async () => {
    validateMagicBytes.mockReturnValue({ ok: false, reason: 'bad' });
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('NOT_FOUND если заявка вне scope', async () => {
    leadFindFirst.mockResolvedValue(null);
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('LEAD_NOT_EDITABLE если статус не редактируемый', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'converted' });
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'LEAD_NOT_EDITABLE' });
  });

  it('STORAGE_FAILURE при ошибке загрузки', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    storageUpload.mockResolvedValue({ error: { message: 'down' } });
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });

  it('проглатывает ошибку enqueue, но возвращает ok', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    queueAdd.mockRejectedValue(new Error('redis down'));
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: true });
  });

  it('компенсирует storage.remove и пробрасывает неожиданную ошибку из транзакции', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    const p = prismaMock();
    (p as { $transaction: ReturnType<typeof vi.fn> }).$transaction = vi.fn(async () => { throw new Error('db boom'); });
    await expect(uploadLeadAttachment(p, input())).rejects.toThrow('db boom');
    expect(storageRemove).toHaveBeenCalled();
  });
});

describe('deleteLeadAttachment', () => {
  const base = () => ({ attachmentId: 'att-1', partnerId: 'p1', session: session('u1') });

  it('успех для автора', async () => {
    attFindFirst.mockResolvedValue({ id: 'att-1', createdByUserId: 'u1', path: 'x', name: 'd', lead: { id: 'l1', partnerId: 'p1', status: 'new', organizationId: null } });
    const r = await deleteLeadAttachment(prismaMock(), base());
    expect(r).toEqual({ ok: true });
    expect(storageRemove).toHaveBeenCalledWith(['x']);
  });

  it('NOT_FOUND если вложение чужого партнёра', async () => {
    attFindFirst.mockResolvedValue({ lead: { partnerId: 'pX' } });
    expect(await deleteLeadAttachment(prismaMock(), base())).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('NOT_FOUND если вне scopeOrgIds', async () => {
    attFindFirst.mockResolvedValue({ id: 'a', createdByUserId: 'u1', lead: { partnerId: 'p1', status: 'new', organizationId: 'org-Z' } });
    expect(await deleteLeadAttachment(prismaMock(), { ...base(), scopeOrgIds: ['org-A'] })).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('LEAD_NOT_EDITABLE если статус закрыт', async () => {
    attFindFirst.mockResolvedValue({ id: 'a', createdByUserId: 'u1', lead: { partnerId: 'p1', status: 'converted', organizationId: null } });
    expect(await deleteLeadAttachment(prismaMock(), base())).toMatchObject({ ok: false, error: 'LEAD_NOT_EDITABLE' });
  });

  it('FORBIDDEN если не автор и не partner-admin', async () => {
    isPartnerAdmin.mockReturnValue(false);
    attFindFirst.mockResolvedValue({ id: 'a', createdByUserId: 'other', lead: { partnerId: 'p1', status: 'new', organizationId: null } });
    expect(await deleteLeadAttachment(prismaMock(), base())).toMatchObject({ ok: false, error: 'FORBIDDEN' });
  });
});

describe('getLeadAttachmentDownloadUrl', () => {
  const base = () => ({ attachmentId: 'att-1', partnerId: 'p1' });

  it('успех: возвращает signed url', async () => {
    attFindFirst.mockResolvedValue({ path: 'x', name: 'd.pdf', mimeType: 'application/pdf', scanStatus: 'clean', lead: { partnerId: 'p1', organizationId: null } });
    expect(await getLeadAttachmentDownloadUrl(prismaMock(), base())).toEqual({ ok: true, url: 'https://signed', name: 'd.pdf', mimeType: 'application/pdf' });
  });

  it('INFECTED отдаёт scanReason', async () => {
    attFindFirst.mockResolvedValue({ path: 'x', scanStatus: 'infected', scanReason: 'EICAR', lead: { partnerId: 'p1', organizationId: null } });
    expect(await getLeadAttachmentDownloadUrl(prismaMock(), base())).toMatchObject({ ok: false, error: 'INFECTED', meta: { scanReason: 'EICAR' } });
  });

  it('STORAGE_FAILURE если signed url не создался', async () => {
    attFindFirst.mockResolvedValue({ path: 'x', name: 'd', scanStatus: 'clean', lead: { partnerId: 'p1', organizationId: null } });
    storageSigned.mockResolvedValue({ data: null, error: { message: 'no' } });
    expect(await getLeadAttachmentDownloadUrl(prismaMock(), base())).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });
});

describe('listLeadAttachments', () => {
  it('NOT_FOUND если заявка вне scope', async () => {
    leadFindFirst.mockResolvedValue(null);
    expect(await listLeadAttachments(prismaMock(), { leadId: 'l1', partnerId: 'p1' })).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('маппит строки, включая null-имя автора', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    attFindMany.mockResolvedValue([
      { id: 'a1', name: 'n', size: 1, mimeType: 'application/pdf', createdAt: new Date(0), createdByUserId: 'u1', createdByUser: { name: 'Имя' } },
      { id: 'a2', name: 'n2', size: 2, mimeType: 'application/pdf', createdAt: new Date(0), createdByUserId: null, createdByUser: null }
    ]);
    const r = await listLeadAttachments(prismaMock(), { leadId: 'l1', partnerId: 'p1' });
    expect(r).toMatchObject({ ok: true, rows: [{ createdByUserName: 'Имя' }, { createdByUserName: null }] });
  });
});

describe('__testing helpers', () => {
  it('sanitizeFilename чистит спецсимволы и обрезает', () => {
    expect(__testing.sanitizeFilename('a/b:c*.pdf')).toBe('a_b_c');
    expect(__testing.sanitizeFilename('   ')).toBe('');
  });

  it('maxFileSizeBytes уважает env и падает в дефолт на мусоре', () => {
    const prev = process.env.DOCUMENT_MAX_FILE_SIZE_MB;
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = '5';
    expect(__testing.maxFileSizeBytes()).toBe(5 * 1024 * 1024);
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = 'nonsense';
    expect(__testing.maxFileSizeBytes()).toBe(10 * 1024 * 1024);
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = prev;
  });

  it('LeadAttachmentError хранит code и meta', () => {
    const e = new LeadAttachmentError('INFECTED', 'msg', { scanReason: 'x' });
    expect(e.code).toBe('INFECTED'); expect(e.meta).toEqual({ scanReason: 'x' });
  });
});
```

- [ ] **Step 2: Прогнать coverage по файлу, добить красные ветки**

Run: `npx vitest run --coverage --mode=unit src/__tests__/services.partner.leadAttachments.test.ts`
Expected: открыть HTML → `leadAttachments.ts`. Оставшиеся красные ветки (например `sanitizeFilename` без расширения, `extensionFor`-путь, scope-варианты `loadLeadInScope`) добить кейсами по методу. Цель — 100/100/100/100.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/services.partner.leadAttachments.test.ts
git commit -m "test(partner/leadAttachments): unit cover upload/delete/download/list + helpers to 100%"
```

---

## Task 4: `lib/auth/orgPageContext.ts` (0%, 59) + `lib/auth/organization.ts` (0%, 14) → 100%

**Files:**
- Create: `src/__tests__/auth.orgPageContext.test.ts`
- Targets: `src/lib/auth/orgPageContext.ts`, `src/lib/auth/organization.ts`

- [ ] **Step 1: Прочитать оба файла, выписать публичные функции и их ветки**

Run: открыть `src/lib/auth/orgPageContext.ts` и `src/lib/auth/organization.ts`. Это auth-хелперы для серверных страниц org-кабинета (резолв сессии/скоупа, редиректы). Определить, что мокать (`getSession`/`requireRole`/`redirect`/`notFound` из `next/navigation`).

- [ ] **Step 2: Написать тест по эталону `auth.requireManager.test.ts`**

Скопировать мок-структуру из `src/__tests__/auth.requireManager.test.ts` (мокает `next/navigation` redirect + session). Покрыть для каждой функции: happy-path (валидная org-сессия), запрет роли (→ redirect/forbidden), отсутствие org-контекста (→ notFound/redirect). Каждый кейс — осмысленный `expect` на возвращённое значение ИЛИ на вызов redirect с нужным аргументом.

- [ ] **Step 3: Coverage до 100% обоих файлов**

Run: `npx vitest run --coverage --mode=unit src/__tests__/auth.orgPageContext.test.ts`
Expected: `orgPageContext.ts` и `organization.ts` = 100%. Красные ветки добить.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/auth.orgPageContext.test.ts
git commit -m "test(auth): cover orgPageContext + organization helpers to 100%"
```

---

## Task 5: `worker/index.ts` (0%, 101) — решение bootstrap

`worker/index.ts` — entrypoint процесса (регистрация процессоров на очередях, graceful shutdown). Прямой unit-тест запускает реальный воркер. Два пути:

- [ ] **Step 1: Прочитать `worker/index.ts` и классифицировать**

Run: открыть `src/worker/index.ts`. Если там есть **логика регистрации** (маппинг очередь→процессор, обработка сигналов) — её надо покрыть. Если это тонкий «склеивающий» bootstrap без ветвлений — кандидат на exclude.

- [ ] **Step 2 (вариант A — есть логика): вынести регистрацию в тестируемый модуль**

Создать `src/worker/register.ts` с чистой функцией `buildWorkerRegistry()` (возвращает массив `{ queueName, processor }`), вызвать её из `index.ts`. Тест `src/__tests__/worker.register.test.ts` проверяет, что для каждой очереди из `QUEUE_NAMES` есть процессор (это уже частично стережёт `worker.processor-coverage.guardrail.test.ts` — переиспользовать его список). Тонкий остаток `index.ts` (вызов `.run()`, `process.on('SIGTERM')`) пометить `/* v8 ignore start */ … /* v8 ignore stop */` с комментарием «process bootstrap, покрывается e2e worker smoke».

- [ ] **Step 2 (вариант B — тонкий bootstrap): добавить в exclude**

В `vitest.config.ts` → `coverage.exclude` добавить `'src/worker/index.ts'` с комментарием `// process bootstrap, no branching logic`.

- [ ] **Step 3: Проверить и закоммитить**

Run: `npx vitest run --coverage --mode=unit src/__tests__/worker.register.test.ts` (вариант A) или `npm run test:coverage:unit` (вариант B).
Expected: `worker/` в отчёте не содержит непокрытого `index.ts`.

```bash
git add -A && git commit -m "test(worker): cover worker registry / exclude thin bootstrap"
```

---

## Task 6: Сервисный хвост → 100% (батч, coverage-driven)

Файлы (из baseline, все 60–96%, кроме adapter 0%) — добить непокрытые ветки. Многие уже частично покрыты integration; чаще не хватает edge/error-веток.

**Files (target → расширить существующий тест или создать unit):**
- `lib/services/manager/leads.ts` (57%), `manager/team.ts` (49%), `manager/leadLifecycle.ts` (96%), `manager/dashboard/events.ts` (76%)
- `lib/services/enrollments/list.ts` (52%), `enrollments/submit.ts` (82%)
- `lib/services/commission/statement.ts` (87%)
- `lib/services/oneCSync/adapter.ts` (0%), `oneCSync/writers.ts` (95%), `oneCSync/adapter-rest.ts` (88%)
- `lib/services/organization/dashboard.ts` (90%), `partner/dashboard.ts` (95%), `partner/deals.ts` (90%)
- `lib/services/admin/users/mutations.ts` (93%)
- `lib/services/chat/attachments.ts` (93%), `lib/services/import/parse-workbook.ts` (79%)

- [ ] **Step 1: Для каждого файла — найти его тест и красные ветки**

Run для одного файла, например:
`npx vitest run --coverage src/__tests__/services.manager.leads.*.test.ts` (или соответствующий тест; если теста нет — создать по эталону `services.admin.partners.test.ts` для unit или integration-эталону для PG-зависимых).
Открыть HTML, найти красные строки в целевом файле.

- [ ] **Step 2: Дописать кейсы на каждую красную ветку**

Для Result-сервисов — покрыть каждый `error`-код (`forbidden`/`not_found`/…) и happy-path с проверкой данных. Для `oneCSync/adapter.ts` (0%) — unit с мок-данными (это fake-адаптер, см. CLAUDE.md §5). НЕ писать пустых тестов: каждый кейс с `expect` на результат/побочный эффект.

- [ ] **Step 3: Повторять, пока каждый файл-цель не = 100% в HTML**

- [ ] **Step 4: Commit (можно по под-доменам)**

```bash
git add src/__tests__/services.*.test.ts
git commit -m "test(services): close branch gaps to 100% (manager/enrollments/commission/oneCSync/dashboards/import)"
```

---

## Task 7: Worker-процессоры → 100% (батч)

Файлы (78–79%): `worker/processors/scan-document.ts`, `sync-orders.ts`, `sync-payments.ts`, `sync-documents.ts`, `sync-organizations.ts`. Все 4 `sync-*` однотипны — общий тест-паттерн.

**Files:**
- Расширить существующие `src/__tests__/worker.*.test.ts`

- [ ] **Step 1: Прогнать coverage на worker-тестах**

Run: `npx vitest run --coverage src/__tests__/worker.*.test.ts`
Expected: HTML → процессоры. Типичные красные ветки: cursor-lag, zod-quarantine (русские enum'ы → quarantine, см. memory mock-1c), пагинация-undercount, error-retry path.

- [ ] **Step 2: Добить ветки по эталону `worker.scan-document.test.ts`**

Для `sync-*` процессоров покрыть: успешный pull, zod-валидация-провал (quarantine), пустая страница, ошибка адаптера (retry-throw). Один паттерн на все 4 — применить ко всем.

- [ ] **Step 3: 100% по каждому процессору; commit**

```bash
git add src/__tests__/worker.*.test.ts
git commit -m "test(worker/processors): cover sync-* + scan-document branches to 100%"
```

---

## Task 8: `app/api/**` route-handlers → 100% (батч)

~30 роутов (51–95%). Тонкие роуты: мапят Result-код сервиса в HTTP-статус (CLAUDE.md §3). Непокрыто обычно — ветки статусов ошибок и guard-отказы.

**Files:**
- Расширить/создать `src/__tests__/api.*.test.ts` по эталону `api.manager.documents.upload.test.ts`

Особо низкие (приоритет): `app/api/auth/logout/route.ts` (0%), `app/api/dashboard/route.ts` (0%), `app/api/notifications/route.ts` (51%), `app/api/partner/finance/statements/[id]/{pdf,xlsx}/route.ts` (20–27%), `app/api/partner/leads/[id]/attachments/route.ts` (62%).

- [ ] **Step 1: По каждому роуту — прогнать coverage, увидеть непокрытые статус-ветки**

Run: `npx vitest run --coverage src/__tests__/api.<area>.test.ts`

- [ ] **Step 2: Покрыть каждый маппинг error→status + success**

Замокать сервис (`vi.mock`), вернуть каждый `error`-код, проверить HTTP-статус ответа; плюс happy-path. Для `auth/logout` и `dashboard` (0%) — создать тест с нуля (мок session/cookies).

- [ ] **Step 3: 100% по каждому роуту; commit**

```bash
git add src/__tests__/api.*.test.ts
git commit -m "test(api): cover route-handler status mappings + guards to 100%"
```

---

## Task 9: `server-actions/**` → 100% (батч)

Файлы (83–94%): `admin/{partners,users,manager,organizations,inviteOrgAdmin}.ts`, `organization/{team,documents}.ts`, `partner/documents.ts`. Тонкие адаптеры над сервисами.

- [ ] **Step 1: Coverage на `src/__tests__/server-actions.*.test.ts`, найти красные ветки**

Run: `npx vitest run --coverage src/__tests__/server-actions.*.test.ts`

- [ ] **Step 2: Добить ветки валидации/ошибок по эталону `server-actions.admin.manager.test.ts`**

Типично непокрыто: zod-провал входа, проброс `error` из сервиса, graceful email-degradation (уже частично есть — см. baseline-логи). Каждый кейс с `expect`.

- [ ] **Step 3: 100%; commit**

```bash
git add src/__tests__/server-actions.*.test.ts
git commit -m "test(server-actions): close validation/error branches to 100%"
```

---

## Task 10: `lib/**` инфраструктура (не-React) → 100% (батч)

Файлы: `lib/auth/{jwt,policy,requireRole}.ts`, `lib/rateLimit/index.ts`, `lib/storage/supabase.ts`, `lib/jobs/{connection,scheduling,types}.ts`, `lib/email/transport.ts`, `lib/notifications/{core,manager,org,partner}.ts`, `lib/services/oneCSync/writers.ts` (если не закрыт в T6).

**Замечание по `lib/jobs/types.ts` (0%, 36):** проверить — если это только `type`/`interface`, v8 отрапортует 100% автоматически и файл уйдёт из списка; если там zod-схемы/const — покрыть unit-тестом, валидирующим схему на валидном и невалидном входе.

- [ ] **Step 1: По каждому файлу — coverage и красные ветки**

Run: `npx vitest run --coverage src/__tests__/<матчинг тест>` (jwt → `auth.jwt.*.test.ts`, policy → `auth.managerPolicy.test.ts` + создать `auth.policy.test.ts` для непокрытых guard-веток, notifications → `notifications.*` / создать).

- [ ] **Step 2: Покрыть. Для `storage/supabase.ts` и `jobs/connection.ts`** (клиенты-синглтоны) — замокать env, проверить ветки конфигурации (с/без переменных); недостижимый process-level код — `/* v8 ignore */` с обоснованием.

- [ ] **Step 3: 100% по каждому; commit**

```bash
git add src/__tests__/*.test.ts
git commit -m "test(lib): cover auth/jwt/policy, rateLimit, storage, jobs, notifications, transport to 100%"
```

---

## Task 11: Включить per-glob порог-гейт 100% на логические слои

После того как Task 1–10 закрыли все не-React логические файлы.

**Files:**
- Modify: `vitest.config.ts`
- Modify: `CLAUDE.md` (§6 — описать гейт)

- [ ] **Step 1: Добавить per-glob thresholds в `coverage`**

В `vitest.config.ts` → `coverage` добавить (проверив синтаксис per-path порогов Vitest 2 — см. спека §7 открытый вопрос):

```ts
      thresholds: {
        'src/lib/**/!(*.tsx)': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/server-actions/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/app/api/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/worker/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/middleware.ts': { lines: 100, branches: 100, functions: 100, statements: 100 }
      }
```

- [ ] **Step 2: Прогнать полный coverage — гейт должен пройти**

Run: `npm run test:coverage` (нужен живой Postgres для integration)
Expected: прогон зелёный, порог не падает. Если падает — отчёт укажет файл/строку; вернуться к соответствующей задаче.

- [ ] **Step 3: Задокументировать в CLAUDE.md §6**

Добавить строку про `npm run test:coverage` как L3-уровень и про per-glob порог 100% на логические слои (UI-слои добавятся в фазах 2–3). Указать, что гейт требует живого PG и потому только manual/pre-push, не pre-commit (стоимость прогона ~23 мин, см. спека §6 риск 5).

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts CLAUDE.md
git commit -m "test(coverage): enforce 100% threshold gate on logic layers (per-glob)"
```

---

## Self-Review checklist (для исполнителя перед закрытием плана)

- [ ] Все 114 логических файлов из baseline (минус отложенные `// PHASE-2`) = 100% в HTML-отчёте.
- [ ] Ни одного пустого теста (вызов без `expect`); каждый `/* v8 ignore */` снабжён комментарием-обоснованием.
- [ ] `npm run test:coverage` зелёный с включённым per-glob порогом.
- [ ] Отложенные в фазу 2: `lib/email/**/*.tsx`, `lib/email/send.tsx`, `hooks/*`, `lib/ui/useFormAction.ts` — зафиксированы для следующего плана.
- [ ] Создать close-out `2026-06-15-coverage-phase1-logic-tail-DONE.md` (CLAUDE.md §8).
