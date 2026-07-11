# Журнал доступа к ПДн (§25.7) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append-only журнал чтений ПДн сотрудниками (admin/manager/leader) с поимённым составом выдачи и admin-страницей просмотра — по спеке [2026-07-11-pii-access-journal-design.md](../specs/2026-07-11-pii-access-journal-design.md).

**Architecture:** Отдельная Prisma-модель `PiiAccessEvent` (GIN по `subjectIds`); реестр контекстов `src/lib/pii/contexts.ts`; never-throws хелпер `recordPiiAccess` (awaited, fail-open §3), вызываемый из 12 контекстов сервис-слоя; guardrail-тест полноты; страница `/admin/pii-access` (Model A). Флаг `pii_access_log` — opt-out; в тестовом env глушится setup-файлом.

**Tech Stack:** Next.js 15 App Router, Prisma 5 + PostgreSQL (GIN), Vitest (unit + integration), renderServerComponent-harness для страниц.

**Ветка:** `claude/pii-access-journal` (от tip `claude/release-hardening-r0`). PR целить в main; НЕ мержить раньше PR #196.

**Правила для исполнителя:**
- Каждая задача — коммит(ы) сразу по зелёному локальному прогону её тестов.
- Коммитить pathspec'ом (`git commit -- <пути>`), длинные хук-прогоны — `--no-verify` только после ручного прогона указанной команды задачи.
- `npm run prisma:generate` после любых правок schema.prisma.
- Полный `npm run test:unit` гонять НЕ в каждой задаче — только в задачах, где это указано (иначе цикл затянется).

---

### Task 1: Тест-окружение — флаг журнала выключен по умолчанию

Существующие ~700 unit-тестов зовут сервисы с mock-prisma без `piiAccessEvent`; чтобы после инструментирования (Tasks 5-10) они не получили шумовые `log.error` и не поломали console-spy регрессы, тестовый env глушит флаг. Тесты журнала включают его явно.

**Files:**
- Create: `src/__tests__/helpers/vitest.setup.ts`
- Modify: `vitest.config.ts` (блок `test:`)

- [x] **Step 1: Создать setup-файл**

```ts
// src/__tests__/helpers/vitest.setup.ts
// Глушим журнал ПДн в тестовом env: прод-семантика флага — opt-out (default ON),
// но сотни существующих unit-тестов зовут сервисы с mock-prisma без
// `piiAccessEvent` — без этой строки каждый такой вызов давал бы шумовой
// log.error из recordPiiAccess (fail-open) и ломал console-spy регрессы.
// Тесты самого журнала выставляют FEATURE_PII_ACCESS_LOG='1' явно.
process.env.FEATURE_PII_ACCESS_LOG ??= '0';
```

- [x] **Step 2: Подключить в vitest.config.ts**

В `defineConfig(({ mode }) => ({ test: { ... } }))` добавить строку рядом с `environment: 'node'`:

```ts
    environment: 'node',
    setupFiles: ['src/__tests__/helpers/vitest.setup.ts'],
```

Внимание: каталог `src/__tests__/helpers/` уже содержит `renderServerComponent.tsx`; setup-файл не оканчивается на `.test.ts`, в прогоны не попадает.

- [x] **Step 3: Проверить, что прогон не сломан**

Run: `npx vitest run --mode=unit src/__tests__/featureFlags.test.ts`
Expected: PASS (featureFlags-тесты сами чистят FEATURE_*-env в beforeEach — setup им не мешает).

- [x] **Step 4: Commit**

```bash
git add src/__tests__/helpers/vitest.setup.ts vitest.config.ts
git commit --no-verify -m "test(pii): vitest setup глушит pii_access_log в тестовом env" -- src/__tests__/helpers/vitest.setup.ts vitest.config.ts
```

---

### Task 2: Флаг `pii_access_log` (opt-out)

**Files:**
- Modify: `src/lib/featureFlags.ts:45-46` (конец массива FEATURE_FLAGS; НЕ добавлять в OPT_IN_FLAGS)
- Test: `src/__tests__/featureFlags.test.ts`

- [x] **Step 1: Написать падающий тест**

В `src/__tests__/featureFlags.test.ts` добавить в конец файла (файл уже имеет beforeEach, чистящий FEATURE_*-env):

```ts
describe('pii_access_log (§25.7)', () => {
  it('opt-out: включён при пустом env', () => {
    expect(isFeatureEnabled('pii_access_log')).toBe(true);
  });

  it('kill-switch: FEATURE_PII_ACCESS_LOG=0 выключает', () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    expect(isFeatureEnabled('pii_access_log')).toBe(false);
  });
});
```

- [x] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run --mode=unit src/__tests__/featureFlags.test.ts`
Expected: FAIL — TS-ошибка/`'pii_access_log'` не входит в тип `FeatureFlag`.

- [x] **Step 3: Добавить флаг**

В `src/lib/featureFlags.ts` в конец массива `FEATURE_FLAGS` (после `'staff_2fa'`):

```ts
  // §25.7: журнал доступа сотрудников к ПДн. Поведенческий opt-out флаг —
  // комплаенс-механизм не может быть opt-in (забытый env = журнал молча не
  // ведётся). Точки чтения: recordPiiAccess (no-op при off) + баннер на
  // /admin/pii-access. Выключение = пауза журнала, только на время инцидента.
  'pii_access_log',
```

В `OPT_IN_FLAGS` НЕ добавлять (это и делает его opt-out).

- [x] **Step 4: Прогнать тест**

Run: `npx vitest run --mode=unit src/__tests__/featureFlags.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git commit --no-verify -m "feat(pii): opt-out флаг pii_access_log" -- src/lib/featureFlags.ts src/__tests__/featureFlags.test.ts
```

---

### Task 3: Модель `PiiAccessEvent` + миграция

**Files:**
- Modify: `prisma/schema.prisma` — back-relation в `model User` (рядом с `auditLogs AuditLog[]`, строка ~161) + новая модель после `model AuditLog` (после строки ~859)

- [x] **Step 1: Поднять Postgres, если не запущен**

Run: `docker compose up -d db`
Expected: контейнер `db` (postgres:16-alpine, порт 5432) healthy. Если порт 5432 занят WinNAT — см. memory: override-compose на 15432.

- [x] **Step 2: Добавить модель в schema.prisma**

После закрывающей скобки `model AuditLog { ... }`:

```prisma
/// §25.7: журнал доступа сотрудников к ПДн физлиц клиентского контура.
/// Append-only: приложение никогда не обновляет и не удаляет строки.
/// subjectIds хранит id строк (Student.id, Call.id, ...), не сами ПДн;
/// meta НИКОГДА не содержит сырых поисковых строк (только hasQuery/take/cursor).
model PiiAccessEvent {
  id           String   @id @default(cuid())
  createdAt    DateTime @default(now())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  userRole     String // снапшот на момент доступа: admin | manager | leader
  companyId    String? // снапшот C8-скоупа сессии
  context      String // ключ PII_CONTEXTS (src/lib/pii/contexts.ts)
  action       String // list | view
  subjectType  String // student | lead | enrollment_request | user | caller | inbound_sender
  subjectIds   String[] // точный поимённый состав выдачи (естественный cap: take<=100)
  subjectCount Int // = subjectIds.length (денорм для сводок)
  meta         Json?

  @@index([subjectIds], type: Gin) // обратный поиск «кто смотрел субъекта X»
  @@index([userId, createdAt]) // трейл по сотруднику
  @@index([subjectType, createdAt])
  @@index([createdAt])
}
```

В `model User` рядом со строкой `auditLogs AuditLog[]` добавить:

```prisma
  piiAccessEvents              PiiAccessEvent[]
```

- [x] **Step 3: Создать миграцию + сгенерировать клиент**

Run: `npm run prisma:migrate -- --name pii_access_event && npm run prisma:generate`
Expected: новая папка `prisma/migrations/<timestamp>_pii_access_event/` с `CREATE TABLE "PiiAccessEvent"` и `CREATE INDEX ... USING GIN`; `prisma generate` зелёный. Применённые миграции не трогать.

- [x] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit --no-verify -m "feat(pii): модель PiiAccessEvent + GIN-индекс по subjectIds" -- prisma/schema.prisma prisma/migrations
```

---

### Task 4: Реестр контекстов `src/lib/pii/contexts.ts`

**Files:**
- Create: `src/lib/pii/contexts.ts`
- Test: `src/__tests__/pii.contexts.test.ts`

- [x] **Step 1: Написать падающий тест**

```ts
// src/__tests__/pii.contexts.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PII_CONTEXTS } from '@/lib/pii/contexts';

const SUBJECT_TYPES = new Set([
  'student', 'lead', 'enrollment_request', 'user', 'caller', 'inbound_sender'
]);

describe('PII_CONTEXTS registry', () => {
  const entries = Object.entries(PII_CONTEXTS);

  it('содержит все 12 контекстов v1', () => {
    expect(entries.map(([k]) => k).sort()).toEqual([
      'admin_user_view', 'admin_users_list', 'calls_list', 'certificates_list',
      'enrollments_list', 'inbox_list', 'manager_lead_view',
      'manager_student_view', 'manager_students_list', 'order_items_list',
      'org_card_calls', 'org_card_inbound'
    ]);
  });

  it.each(entries)('%s: валидные subjectType/action/labelRu/callSite', (_key, ctx) => {
    expect(SUBJECT_TYPES.has(ctx.subjectType)).toBe(true);
    expect(['list', 'view']).toContain(ctx.action);
    expect(ctx.labelRu.length).toBeGreaterThan(0);
    expect(existsSync(path.join(process.cwd(), ctx.callSite))).toBe(true);
  });
});
```

- [x] **Step 2: Убедиться, что падает**

Run: `npx vitest run --mode=unit src/__tests__/pii.contexts.test.ts`
Expected: FAIL — модуль `@/lib/pii/contexts` не существует.

- [x] **Step 3: Реализовать реестр**

```ts
// src/lib/pii/contexts.ts
/**
 * §25.7: реестр контекстов доступа к ПДн — единая точка правды.
 * Кормит: (1) guardrail-тест полноты call-sites, (2) RU-лейблы фильтров
 * /admin/pii-access, (3) subjectType/action события (хелпер recordPiiAccess
 * берёт их отсюда — рассинхрон невозможен).
 * Новое staff-чтение ПДн физлиц клиентского контура ОБЯЗАНО зарегистрировать
 * контекст здесь и вызвать recordPiiAccess (CLAUDE.md §12).
 */

export type PiiSubjectType =
  | 'student'
  | 'lead'
  | 'enrollment_request'
  | 'user'
  | 'caller'
  | 'inbound_sender';

export type PiiAction = 'list' | 'view';

export type PiiContext = {
  subjectType: PiiSubjectType;
  action: PiiAction;
  labelRu: string;
  /** Файл сервиса, обязанный вызывать recordPiiAccess с этим контекстом. */
  callSite: string;
};

export const PII_CONTEXTS = {
  manager_students_list: { subjectType: 'student', action: 'list', labelRu: 'Список слушателей', callSite: 'src/lib/services/manager/students.ts' },
  manager_student_view: { subjectType: 'student', action: 'view', labelRu: 'Карточка слушателя', callSite: 'src/lib/services/manager/students.ts' },
  manager_lead_view: { subjectType: 'lead', action: 'view', labelRu: 'Карточка лида (контакты)', callSite: 'src/lib/services/manager/leads.ts' },
  enrollments_list: { subjectType: 'enrollment_request', action: 'list', labelRu: 'Заявки на обучение', callSite: 'src/lib/services/enrollments/list.ts' },
  org_card_inbound: { subjectType: 'inbound_sender', action: 'list', labelRu: 'Карточка организации: входящие', callSite: 'src/lib/services/manager/organizationCard.ts' },
  org_card_calls: { subjectType: 'caller', action: 'list', labelRu: 'Карточка организации: звонки', callSite: 'src/lib/services/manager/organizationCard.ts' },
  inbox_list: { subjectType: 'inbound_sender', action: 'list', labelRu: 'Инбокс: входящие', callSite: 'src/lib/services/inbound/listInbox.ts' },
  calls_list: { subjectType: 'caller', action: 'list', labelRu: 'Журнал звонков', callSite: 'src/lib/services/telephony/listCalls.ts' },
  certificates_list: { subjectType: 'student', action: 'list', labelRu: 'Удостоверения', callSite: 'src/lib/services/training/certificates.ts' },
  order_items_list: { subjectType: 'student', action: 'list', labelRu: 'Слушатели заказа', callSite: 'src/lib/services/training/orderItems.ts' },
  admin_users_list: { subjectType: 'user', action: 'list', labelRu: 'Пользователи (список)', callSite: 'src/lib/services/admin/users/queries.ts' },
  admin_user_view: { subjectType: 'user', action: 'view', labelRu: 'Карточка пользователя', callSite: 'src/lib/services/admin/users/queries.ts' }
} as const satisfies Record<string, PiiContext>;

export type PiiContextKey = keyof typeof PII_CONTEXTS;
```

- [x] **Step 4: Прогнать тест**

Run: `npx vitest run --mode=unit src/__tests__/pii.contexts.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/pii/contexts.ts src/__tests__/pii.contexts.test.ts
git commit --no-verify -m "feat(pii): реестр PII_CONTEXTS — 12 контекстов v1" -- src/lib/pii/contexts.ts src/__tests__/pii.contexts.test.ts
```

---

### Task 5: Хелпер `recordPiiAccess` / `recordPiiAccessMany`

**Files:**
- Create: `src/lib/pii/record.ts`
- Test: `src/__tests__/pii.record.unit.test.ts`

- [x] **Step 1: Написать падающие тесты**

```ts
// src/__tests__/pii.record.unit.test.ts
/**
 * Unit tests for src/lib/pii/record.ts — never-throws запись журнала ПДн.
 * Флаг в тестовом env заглушён setup-файлом; здесь включаем явно.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordPiiAccess, recordPiiAccessMany } from '@/lib/pii/record';
import type { SessionPayload } from '@/lib/auth/jwt';

const MANAGER: SessionPayload = { sub: 'u-mgr', role: 'manager', companyId: 'co-1' };
const LEADER: SessionPayload = { sub: 'u-led', role: 'manager', managerRole: 'leader', companyId: 'co-1' };
const ADMIN: SessionPayload = { sub: 'u-adm', role: 'admin' };
const PARTNER: SessionPayload = { sub: 'u-par', role: 'partner' };

function makePrisma() {
  return {
    piiAccessEvent: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 2 })
    }
  } as never;
}

beforeEach(() => {
  process.env.FEATURE_PII_ACCESS_LOG = '1';
});

afterEach(() => {
  process.env.FEATURE_PII_ACCESS_LOG = '0';
  vi.restoreAllMocks();
});

describe('recordPiiAccess', () => {
  it('пишет событие: контекст задаёт action/subjectType, роль и companyId снапшотятся', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, {
      session: MANAGER,
      context: 'manager_students_list',
      subjectIds: ['s1', 's2'],
      meta: { take: 50, hasQuery: true }
    });
    expect((p as any).piiAccessEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'u-mgr',
        userRole: 'manager',
        companyId: 'co-1',
        context: 'manager_students_list',
        action: 'list',
        subjectType: 'student',
        subjectIds: ['s1', 's2'],
        subjectCount: 2,
        meta: { take: 50, hasQuery: true }
      }
    });
  });

  it('leader-снапшот: manager с managerRole=leader пишется как leader', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, { session: LEADER, context: 'enrollments_list', subjectIds: ['e1'] });
    expect((p as any).piiAccessEvent.create.mock.calls[0][0].data.userRole).toBe('leader');
  });

  it('admin без companyId → companyId: null; meta отсутствует, если не передана', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, { session: ADMIN, context: 'admin_user_view', subjectIds: ['u9'] });
    const data = (p as any).piiAccessEvent.create.mock.calls[0][0].data;
    expect(data.companyId).toBeNull();
    expect(data).not.toHaveProperty('meta');
  });

  it('no-op: флаг выключен', async () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    const p = makePrisma();
    await recordPiiAccess(p, { session: MANAGER, context: 'calls_list', subjectIds: ['c1'] });
    expect((p as any).piiAccessEvent.create).not.toHaveBeenCalled();
  });

  it('no-op: не-staff сессия (partner)', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, { session: PARTNER, context: 'enrollments_list', subjectIds: ['e1'] });
    expect((p as any).piiAccessEvent.create).not.toHaveBeenCalled();
  });

  it('no-op: пустая выдача', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, { session: MANAGER, context: 'inbox_list', subjectIds: [] });
    expect((p as any).piiAccessEvent.create).not.toHaveBeenCalled();
  });

  it('fail-open: сбой insert проглатывается с log.error, данные не блокируются', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = makePrisma();
    (p as any).piiAccessEvent.create.mockRejectedValue(new Error('db down'));
    await expect(
      recordPiiAccess(p, { session: MANAGER, context: 'calls_list', subjectIds: ['c1'] })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'pii_access_log_write_failed',
      expect.objectContaining({ contexts: ['calls_list'], count: 1, error: 'db down' })
    );
  });

  it('fail-open: не-Error rejection стрингифицируется', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = makePrisma();
    (p as any).piiAccessEvent.create.mockRejectedValue('boom');
    await recordPiiAccess(p, { session: MANAGER, context: 'calls_list', subjectIds: ['c1'] });
    expect(errorSpy).toHaveBeenCalledWith(
      'pii_access_log_write_failed',
      expect.objectContaining({ error: 'boom' })
    );
  });
});

describe('recordPiiAccessMany', () => {
  it('несколько событий → один createMany', async () => {
    const p = makePrisma();
    await recordPiiAccessMany(p, [
      { session: MANAGER, context: 'org_card_inbound', subjectIds: ['m1', 'm2'] },
      { session: MANAGER, context: 'org_card_calls', subjectIds: ['c1'] }
    ]);
    expect((p as any).piiAccessEvent.createMany).toHaveBeenCalledTimes(1);
    const { data } = (p as any).piiAccessEvent.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0].subjectType).toBe('inbound_sender');
    expect(data[1].subjectType).toBe('caller');
  });

  it('пустые/не-staff элементы отфильтровываются; все пустые → no-op', async () => {
    const p = makePrisma();
    await recordPiiAccessMany(p, [
      { session: MANAGER, context: 'org_card_inbound', subjectIds: [] },
      { session: PARTNER, context: 'org_card_calls', subjectIds: ['c1'] }
    ]);
    expect((p as any).piiAccessEvent.create).not.toHaveBeenCalled();
    expect((p as any).piiAccessEvent.createMany).not.toHaveBeenCalled();
  });

  it('один выживший элемент → create, не createMany', async () => {
    const p = makePrisma();
    await recordPiiAccessMany(p, [
      { session: MANAGER, context: 'org_card_inbound', subjectIds: [] },
      { session: MANAGER, context: 'org_card_calls', subjectIds: ['c1'] }
    ]);
    expect((p as any).piiAccessEvent.create).toHaveBeenCalledTimes(1);
    expect((p as any).piiAccessEvent.createMany).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Убедиться, что падают**

Run: `npx vitest run --mode=unit src/__tests__/pii.record.unit.test.ts`
Expected: FAIL — модуль `@/lib/pii/record` не существует.

- [x] **Step 3: Реализовать хелпер**

```ts
// src/lib/pii/record.ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';
import { PII_CONTEXTS, type PiiContextKey } from './contexts';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/** meta события — только счётчики/флаги. Сырые поисковые строки ЗАПРЕЩЕНЫ
 *  (могут содержать ФИО/email — журнал не должен сам копить ПДн). */
export type PiiAccessMeta = { take?: number; hasQuery?: boolean; cursor?: boolean };

export type PiiAccessArgs = {
  session: SessionPayload;
  context: PiiContextKey;
  /** id строк выдачи (Student.id, Call.id, ...) — НЕ сами ПДн. */
  subjectIds: string[];
  meta?: PiiAccessMeta;
};

function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

function roleSnapshot(session: SessionPayload): string {
  return session.role === 'manager' && session.managerRole === 'leader'
    ? 'leader'
    : session.role;
}

function toRow(args: PiiAccessArgs) {
  const ctx = PII_CONTEXTS[args.context];
  const meta: Prisma.JsonObject = {};
  if (args.meta?.take !== undefined) meta.take = args.meta.take;
  if (args.meta?.hasQuery !== undefined) meta.hasQuery = args.meta.hasQuery;
  if (args.meta?.cursor !== undefined) meta.cursor = args.meta.cursor;
  return {
    userId: args.session.sub,
    userRole: roleSnapshot(args.session),
    companyId: args.session.companyId ?? null,
    context: args.context,
    action: ctx.action,
    subjectType: ctx.subjectType,
    subjectIds: args.subjectIds,
    subjectCount: args.subjectIds.length,
    ...(Object.keys(meta).length > 0 ? { meta } : {})
  };
}

/**
 * §25.7: запись события доступа к ПДн. Awaited и never-throws (fail-open §3):
 * сбой журнала логируется алертным log.error и НЕ блокирует выдачу данных.
 * No-op при выключенном флаге, не-staff сессии или пустой выдаче.
 */
export async function recordPiiAccess(prisma: PrismaLike, args: PiiAccessArgs): Promise<void> {
  await recordPiiAccessMany(prisma, [args]);
}

/** Пакетная запись (напр. organizationCard: inbound + calls) одним round-trip. */
export async function recordPiiAccessMany(prisma: PrismaLike, argsList: PiiAccessArgs[]): Promise<void> {
  if (!isFeatureEnabled('pii_access_log')) return;
  const rows = argsList
    .filter((a) => isStaff(a.session) && a.subjectIds.length > 0)
    .map(toRow);
  if (rows.length === 0) return;
  try {
    if (rows.length === 1) {
      await prisma.piiAccessEvent.create({ data: rows[0] });
    } else {
      await prisma.piiAccessEvent.createMany({ data: rows });
    }
  } catch (e) {
    log.error('pii_access_log_write_failed', {
      contexts: rows.map((r) => r.context),
      count: rows.length,
      error: e instanceof Error ? e.message : String(e)
    });
  }
}
```

- [x] **Step 4: Прогнать тесты**

Run: `npx vitest run --mode=unit src/__tests__/pii.record.unit.test.ts`
Expected: PASS (10 тестов). Примечание: в dev/test логгер — console-passthrough verbatim, поэтому spy на `console.error` ловит вызов `log.error` с теми же аргументами.

- [x] **Step 5: Commit**

```bash
git add src/lib/pii/record.ts src/__tests__/pii.record.unit.test.ts
git commit --no-verify -m "feat(pii): recordPiiAccess — awaited never-throws запись журнала" -- src/lib/pii/record.ts src/__tests__/pii.record.unit.test.ts
```

---

### Task 6: Слушатели — `listStudents` + новый `getStudent` + рефактор страницы

**Files:**
- Modify: `src/lib/services/manager/students.ts` (вставка в `listStudents` перед return ~строка 75; новая функция `getStudent`)
- Modify: `src/app/manager/students/[id]/page.tsx:17-37` (замена инлайн-prisma на `getStudent`)
- Test: `src/__tests__/services.manager.students.unit.test.ts`, `src/__tests__/pages.manager-students-id.test.tsx`

- [x] **Step 1: Написать падающие unit-тесты сервиса**

В `src/__tests__/services.manager.students.unit.test.ts` добавить мок модуля записи (рядом с существующими vi.mock):

```ts
const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));
```

и новые тесты в конец файла (импорт `getStudent` добавить к существующему импорту `listStudents`):

```ts
describe('PII journal capture', () => {
  it('listStudents журналирует выдачу с точным составом ids', async () => {
    const p = makePrisma([studentRow('s1'), studentRow('s2')]);
    await listStudents(p, { session: SESSION, q: 'ив' });
    expect(recordPiiAccess).toHaveBeenCalledWith(p, {
      session: SESSION,
      context: 'manager_students_list',
      subjectIds: ['s1', 's2'],
      meta: { take: 50, hasQuery: true, cursor: false }
    });
  });
});

describe('getStudent', () => {
  function makeDetailPrisma(student: unknown, orgCompanyId?: string) {
    return {
      student: { findUnique: vi.fn().mockResolvedValue(student) },
      organization: { findUnique: vi.fn().mockResolvedValue(orgCompanyId ? { companyId: orgCompanyId } : null) },
      company: { findUnique: vi.fn() }
    } as never;
  }
  const STUDENT = { id: 's1', name: 'Иван', email: 'i@x.ru', organizationId: 'org-1', createdAt: new Date(), organization: { id: 'org-1', name: 'Org' } };

  it('teamMode=OFF: отдаёт студента из managed-org и журналирует view', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    managedOrgIds.mockReturnValue(['org-1']);
    const p = makeDetailPrisma(STUDENT);
    const res = await getStudent(p, SESSION, 's1');
    expect(res).toEqual(STUDENT);
    expect(recordPiiAccess).toHaveBeenCalledWith(p, {
      session: SESSION,
      context: 'manager_student_view',
      subjectIds: ['s1']
    });
  });

  it('teamMode=OFF: чужая организация → null, журнал не пишется', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    managedOrgIds.mockReturnValue(['org-2']);
    const res = await getStudent(makeDetailPrisma(STUDENT), SESSION, 's1');
    expect(res).toBeNull();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('teamMode=ON: пускает по companyId организации', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const res = await getStudent(makeDetailPrisma(STUDENT, 'co-1'), SESSION, 's1');
    expect(res).toEqual(STUDENT);
  });

  it('teamMode=ON: чужая company → null', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const res = await getStudent(makeDetailPrisma(STUDENT, 'co-OTHER'), SESSION, 's1');
    expect(res).toBeNull();
  });

  it('несуществующий студент → null', async () => {
    const res = await getStudent(makeDetailPrisma(null), SESSION, 'nope');
    expect(res).toBeNull();
  });
});
```

- [x] **Step 2: Убедиться, что падают**

Run: `npx vitest run --mode=unit src/__tests__/services.manager.students.unit.test.ts`
Expected: FAIL — `getStudent` не экспортируется; assert на recordPiiAccess не проходит.

- [x] **Step 3: Реализовать в сервисе**

В `src/lib/services/manager/students.ts`: импорт наверху `import { recordPiiAccess } from '@/lib/pii/record';`. В `listStudents` перед `return { rows: sliced, nextCursor };`:

```ts
  await recordPiiAccess(prisma, {
    session: opts.session,
    context: 'manager_students_list',
    subjectIds: sliced.map((s) => s.id),
    meta: { take: opts.take, hasQuery: opts.q !== undefined, cursor: opts.cursor !== undefined }
  });
```

Новая функция в конце файла (селект и scope-чек перенесены 1:1 со страницы, см. `src/app/manager/students/[id]/page.tsx:20-37`):

```ts
const DETAIL_SELECT = {
  id: true,
  name: true,
  email: true,
  organizationId: true,
  createdAt: true,
  organization: { select: { id: true, name: true } }
} satisfies Prisma.StudentSelect;

export type ManagerStudentDetail = Prisma.StudentGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * Карточка слушателя. Scope — тот же, что у listStudents (C8 teamMode-aware):
 * при teamMode=ON граница — companyId организации студента, при OFF — явное
 * назначение OrganizationManager. Успешная выдача журналируется (§25.7).
 */
export async function getStudent(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<ManagerStudentDetail | null> {
  const student = await prisma.student.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!student) return null;

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  if (teamMode) {
    const org = await prisma.organization.findUnique({
      where: { id: student.organizationId },
      select: { companyId: true }
    });
    if (!org || !session.companyId || org.companyId !== session.companyId) return null;
  } else if (!managedOrgIds(session).includes(student.organizationId)) {
    return null;
  }

  await recordPiiAccess(prisma, {
    session,
    context: 'manager_student_view',
    subjectIds: [student.id]
  });
  return student;
}
```

- [x] **Step 4: Прогнать unit-тесты сервиса**

Run: `npx vitest run --mode=unit src/__tests__/services.manager.students.unit.test.ts`
Expected: PASS.

- [x] **Step 5: Рефактор страницы**

В `src/app/manager/students/[id]/page.tsx`: заменить блок строк 20-37 (findUnique + scope-чек) на:

```ts
  const student = await getStudent(prisma, session, id);
  if (!student) notFound();
```

Импорт: `import { getStudent } from '@/lib/services/manager/students';` (убрать ставшие ненужными импорты `getCompanyTeamVisibility`/`managedOrgIds`, если их больше никто на странице не использует — проверить остальной код страницы).

- [x] **Step 6: Обновить page-тест**

В `src/__tests__/pages.manager-students-id.test.tsx`: заменить мок prisma-выборки студента на мок сервиса. Убрать `studentFindUnique`/`organizationFindUnique` из vi.hoisted-блока prisma (оставить то, что страница ещё реально использует), добавить:

```ts
const { getStudent } = vi.hoisted(() => ({ getStudent: vi.fn() }));
vi.mock('@/lib/services/manager/students', () => ({ getStudent }));
```

и в тестах `getStudent.mockResolvedValue(STUDENT)` / `mockResolvedValue(null)` вместо прежних prisma-моков. Ветки scope-чека страницы (teamMode ON/OFF) исчезли — соответствующие page-тесты удалить (их логика теперь покрыта unit-тестами `getStudent` из Step 1; смысловой перенос зафиксировать в коммит-сообщении).

- [x] **Step 7: Прогнать page-тест + typecheck**

Run: `npx vitest run --mode=unit src/__tests__/pages.manager-students-id.test.tsx && npm run typecheck`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git commit --no-verify -m "feat(pii): students — журнал list/view; getStudent вынесен из RSC-инлайна (канон §2)" -- src/lib/services/manager/students.ts "src/app/manager/students/[id]/page.tsx" src/__tests__/services.manager.students.unit.test.ts src/__tests__/pages.manager-students-id.test.tsx
```

---

### Task 7: Лиды — сигнатура `getManagerLead` + журнал карточки

**Files:**
- Modify: `src/lib/services/manager/leads.ts:114-151`
- Modify: `src/app/manager/leads/[id]/page.tsx:14-17`, `src/app/api/manager/leads/[id]/route.ts:17-20`
- Test: `src/__tests__/services.manager.leads.unit.test.ts` (реальные вызовы, строки ~150-202), `src/__tests__/api.manager.leads.test.ts`, `src/__tests__/pages.manager-leads-id.test.tsx`, `src/__tests__/cov.api-misc.test.ts` (мокают модуль — правка не нужна, если мок не типизирован; проверить)

- [x] **Step 1: Обновить unit-тест сервиса (падающий)**

В `src/__tests__/services.manager.leads.unit.test.ts`: добавить мок журнала:

```ts
const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));
```

Определить сессию (если в файле нет готовой): `const SESSION = { sub: 'mgr-1', role: 'manager' as const, companyId: 'co-1' };`
Заменить 4 вызова `getManagerLead(db, 'L1'|'nonexistent')` на `getManagerLead(db, SESSION, 'L1'|...)`. Добавить тест в describe('getManagerLead'):

```ts
  it('журналирует выдачу контактных ПДн (view)', async () => {
    const db = fullRow();
    await getManagerLead(db, SESSION, 'L1');
    expect(recordPiiAccess).toHaveBeenCalledWith(db, {
      session: SESSION,
      context: 'manager_lead_view',
      subjectIds: ['L1']
    });
  });

  it('null-ветка: журнал не пишется', async () => {
    const db = { lead: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    await getManagerLead(db, SESSION, 'nope');
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
```

- [x] **Step 2: Убедиться, что падает**

Run: `npx vitest run --mode=unit src/__tests__/services.manager.leads.unit.test.ts`
Expected: FAIL (TS: лишний аргумент).

- [x] **Step 3: Сменить сигнатуру и инструментировать**

В `src/lib/services/manager/leads.ts`: импорт `recordPiiAccess`; тип `SessionPayload` уже импортирован (используется `listManagerLeads`). Сигнатура:

```ts
export async function getManagerLead(
  prisma: PrismaClient,
  session: SessionPayload,
  leadId: string
): Promise<ManagerLeadDetail | null> {
```

Перед `return { id: l.id, ... }` (после `if (!l) return null;`):

```ts
  await recordPiiAccess(prisma, {
    session,
    context: 'manager_lead_view',
    subjectIds: [l.id]
  });
```

- [x] **Step 4: Обновить продовые call-sites**

`src/app/manager/leads/[id]/page.tsx:14-16` — захватить session:

```ts
  const session = await requireManager();
  const { id } = await params;
  const lead = await getManagerLead(prisma, session, id);
```

`src/app/api/manager/leads/[id]/route.ts:17-19` (GET) — аналогично:

```ts
  const session = await requireManager();
  const { id } = await params;
  const lead = await getManagerLead(prisma, session, id);
```

- [x] **Step 5: Прогнать все затронутые тесты + typecheck**

Run: `npx vitest run --mode=unit src/__tests__/services.manager.leads.unit.test.ts src/__tests__/api.manager.leads.test.ts src/__tests__/pages.manager-leads-id.test.tsx src/__tests__/cov.api-misc.test.ts && npm run typecheck`
Expected: PASS. (`api.manager.leads` / `pages.manager-leads-id` / `cov.api-misc` мокают модуль целиком `vi.fn()` без типизации аргументов — как правило, правка им не нужна; если typecheck укажет на mockResolvedValue-типы, поправить точечно.)

- [x] **Step 6: Commit**

```bash
git commit --no-verify -m "feat(pii): getManagerLead(prisma, session, leadId) + журнал карточки лида" -- src/lib/services/manager/leads.ts "src/app/manager/leads/[id]/page.tsx" "src/app/api/manager/leads/[id]/route.ts" src/__tests__/services.manager.leads.unit.test.ts src/__tests__/api.manager.leads.test.ts src/__tests__/pages.manager-leads-id.test.tsx src/__tests__/cov.api-misc.test.ts
```

---

### Task 8: Заявки, удостоверения, слушатели заказа (session уже в сигнатурах)

**Files:**
- Modify: `src/lib/services/enrollments/list.ts` (перед return ~строка 80), `src/lib/services/training/certificates.ts` (между строками 77-78), `src/lib/services/training/orderItems.ts` (между строками 38-39)
- Test: `src/__tests__/services.enrollments.test.ts`, `src/__tests__/services.training.certificates.test.ts`, `src/__tests__/services.training.orderItems.test.ts`

- [x] **Step 1: Падающие тесты — по одному assert-тесту в каждый файл**

В каждый из трёх тест-файлов добавить мок (в стиле файла, vi.hoisted):

```ts
const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));
```

`services.enrollments.test.ts` (staff-сессию взять/собрать по образцу существующих в файле; функция режет страницу до `take`):

```ts
  it('PII: журналирует состав выдачи для staff-вызова', async () => {
    // использовать существующий в файле хелпер makePrisma/фикстуры;
    // rows: два request'а R1, R2
    await listEnrollmentRequests(prisma, MANAGER_SESSION, {});
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, expect.objectContaining({
      context: 'enrollments_list',
      subjectIds: ['R1', 'R2']
    }));
  });
```

`services.training.certificates.test.ts` — assert `context: 'certificates_list'`, `subjectIds: [<studentId каждого cert>]`;
`services.training.orderItems.test.ts` — assert `context: 'order_items_list'`, `subjectIds: [<studentId каждого item>]` и **отсутствие** вызова на ветке `forbidden`.

(Точные имена фикстур — из самих файлов; assert-структура выше обязательна.)

- [x] **Step 2: Убедиться, что падают**

Run: `npx vitest run --mode=unit src/__tests__/services.enrollments.test.ts src/__tests__/services.training.certificates.test.ts src/__tests__/services.training.orderItems.test.ts`
Expected: FAIL (recordPiiAccess не вызывается).

- [x] **Step 3: Инструментировать три сервиса**

`src/lib/services/enrollments/list.ts` — импорт + между `const page = ...` и `return {`:

```ts
  await recordPiiAccess(prisma, {
    session,
    context: 'enrollments_list',
    subjectIds: page.map((r) => r.id),
    meta: { take, cursor: opts.cursor !== undefined }
  });
```

`src/lib/services/training/certificates.ts` — перед `return { ok: true, certificates };`:

```ts
  await recordPiiAccess(prisma, {
    session,
    context: 'certificates_list',
    subjectIds: certificates.map((c) => c.studentId)
  });
```

`src/lib/services/training/orderItems.ts` — перед `return { ok: true, items };`:

```ts
  await recordPiiAccess(prisma, {
    session,
    context: 'order_items_list',
    subjectIds: items.map((i) => i.studentId)
  });
```

Хелпер сам отсекает partner/org-сессии (общие сервисы) и пустые выдачи — ветвления в сервисах не нужны.

- [x] **Step 4: Прогнать тесты + typecheck**

Run: `npx vitest run --mode=unit src/__tests__/services.enrollments.test.ts src/__tests__/services.training.certificates.test.ts src/__tests__/services.training.orderItems.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git commit --no-verify -m "feat(pii): журнал enrollments/certificates/orderItems" -- src/lib/services/enrollments/list.ts src/lib/services/training/certificates.ts src/lib/services/training/orderItems.ts src/__tests__/services.enrollments.test.ts src/__tests__/services.training.certificates.test.ts src/__tests__/services.training.orderItems.test.ts
```

---

### Task 9: Инбокс и звонки

У этих сервисов нет unit-тестов (только integration) — строковые ассерты на живой PG придут в Task 14; здесь только инструментирование + typecheck.

**Files:**
- Modify: `src/lib/services/inbound/listInbox.ts` (между строками 85-87), `src/lib/services/telephony/listCalls.ts` (между строками 87-89)

- [x] **Step 1: Инструментировать**

`listInbox.ts` — импорт + перед `return { items: rows, total };`:

```ts
  await recordPiiAccess(prisma, {
    session,
    context: 'inbox_list',
    subjectIds: rows.map((r) => r.id)
  });
```

`listCalls.ts` — перед `return { items, total };`:

```ts
  await recordPiiAccess(prisma, {
    session,
    context: 'calls_list',
    subjectIds: items.map((i) => i.id)
  });
```

- [x] **Step 2: Typecheck + существующие integration-тесты не трогаем**

Run: `npm run typecheck`
Expected: PASS. (Integration-тесты этих сервисов работают при заглушённом флаге из Task 1 — поведение не меняется.)

- [x] **Step 3: Commit**

```bash
git commit --no-verify -m "feat(pii): журнал inbox_list/calls_list" -- src/lib/services/inbound/listInbox.ts src/lib/services/telephony/listCalls.ts
```

---

### Task 10: Карточка организации — два события одним createMany

**Files:**
- Modify: `src/lib/services/manager/organizationCard.ts` (после Promise.all ~строка 149, перед финальным return)

- [x] **Step 1: Инструментировать**

Импорт `recordPiiAccessMany`. После блока `Promise.all`, где доступны массивы `inboundMessages` и `calls` (перед финальным `return`):

```ts
  await recordPiiAccessMany(prisma, [
    {
      session,
      context: 'org_card_inbound',
      subjectIds: inboundMessages.map((m) => m.id)
    },
    {
      session,
      context: 'org_card_calls',
      subjectIds: calls.map((c) => c.id)
    }
  ]);
```

- [x] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git commit --no-verify -m "feat(pii): журнал карточки организации (inbound+calls, один createMany)" -- src/lib/services/manager/organizationCard.ts
```

---

### Task 11: Admin users — сигнатуры + журнал

**Files:**
- Modify: `src/lib/services/admin/users/queries.ts` (`getUser` строки 61-64, `listUsers` строки 105-108)
- Modify: `src/app/admin/users/page.tsx:36`, `src/app/admin/users/[id]/page.tsx:17` (session уже захвачен в обоих)
- Test: `src/__tests__/services.admin.users.test.ts`, `src/__tests__/pages.admin-users.test.tsx`, `src/__tests__/pages.admin-users-id.test.tsx`

- [x] **Step 1: Падающие тесты**

В `services.admin.users.test.ts`: мок `@/lib/pii/record` (vi.hoisted, как в Task 6), `const ADMIN_SESSION = { sub: 'adm', role: 'admin' as const };`, обновить существующие вызовы `listUsers(prisma, filters)` → `listUsers(prisma, ADMIN_SESSION, filters)` и `getUser(prisma, id)` → `getUser(prisma, ADMIN_SESSION, id)`. Добавить:

```ts
  it('listUsers журналирует состав выдачи', async () => {
    // существующий makePrisma с rows U1, U2
    await listUsers(prisma, ADMIN_SESSION, {});
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, expect.objectContaining({
      context: 'admin_users_list',
      subjectIds: ['U1', 'U2']
    }));
  });

  it('getUser журналирует карточку; null-ветка — нет', async () => {
    await getUser(prismaWithUser, ADMIN_SESSION, 'U1');
    expect(recordPiiAccess).toHaveBeenCalledWith(prismaWithUser, expect.objectContaining({
      context: 'admin_user_view',
      subjectIds: ['U1']
    }));
    recordPiiAccess.mockClear();
    await getUser(prismaWithoutUser, ADMIN_SESSION, 'nope');
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
```

- [x] **Step 2: Убедиться, что падают**

Run: `npx vitest run --mode=unit src/__tests__/services.admin.users.test.ts`
Expected: FAIL.

- [x] **Step 3: Сменить сигнатуры и инструментировать**

`src/lib/services/admin/users/queries.ts`: импорты `recordPiiAccess`, `SessionPayload`.

```ts
export async function getUser(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<UserDetail | null> {
```
— перед успешным `return { id: u.id, ... }` (после `if (!u) return null;`):

```ts
  await recordPiiAccess(prisma, { session, context: 'admin_user_view', subjectIds: [u.id] });
```

```ts
export async function listUsers(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: UserFilters
): Promise<{ rows: UserRow[]; total: number }> {
```
— между маппингом `rows` и `return { rows, total };`:

```ts
  await recordPiiAccess(prisma, {
    session,
    context: 'admin_users_list',
    subjectIds: rows.map((u) => u.id),
    meta: { hasQuery: filters.q !== undefined }
  });
```
(если в `UserFilters` нет поля `q` — проверить фактические имена фильтров и передать `hasQuery` по текстовому фильтру файла; если текстового фильтра нет вовсе — meta опустить.)

- [x] **Step 4: Обновить страницы**

`src/app/admin/users/page.tsx:36`: `const { rows, total } = await listUsers(prisma, session, filters);`
`src/app/admin/users/[id]/page.tsx:17`: `const user = await getUser(prisma, session, id);`

- [x] **Step 5: Прогнать тесты + typecheck**

Run: `npx vitest run --mode=unit src/__tests__/services.admin.users.test.ts src/__tests__/pages.admin-users.test.tsx src/__tests__/pages.admin-users-id.test.tsx src/__tests__/server-actions.admin.users.test.ts && npm run typecheck`
Expected: PASS (page-тесты мокают сервис-модуль — при необходимости поправить только typing моков).

- [x] **Step 6: Commit**

```bash
git commit --no-verify -m "feat(pii): admin users — сигнатуры с session + журнал list/view" -- src/lib/services/admin/users/queries.ts src/app/admin/users/page.tsx "src/app/admin/users/[id]/page.tsx" src/__tests__/services.admin.users.test.ts src/__tests__/pages.admin-users.test.tsx src/__tests__/pages.admin-users-id.test.tsx src/__tests__/server-actions.admin.users.test.ts
```

---

### Task 12: Guardrail полноты call-sites

Пишется ПОСЛЕ инструментирования (Tasks 6-11) — сразу зелёный, дальше защищает от дрейфа.

**Files:**
- Create: `src/__tests__/pii.capture-coverage.guardrail.test.ts`

- [x] **Step 1: Написать guardrail (по образцу worker.processor-coverage.guardrail.test.ts)**

```ts
// src/__tests__/pii.capture-coverage.guardrail.test.ts
/**
 * §25.7 guardrail: каждый контекст PII_CONTEXTS реально вызывается из своего
 * callSite-файла, и ни один сервис не использует контекст мимо реестра.
 * Ограничение (задокументировано в спеке): проверяются только известные
 * реестру файлы — новый сервис, читающий ПДн без регистрации контекста,
 * ловится ревью + правилом CLAUDE.md §12, не этим тестом.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PII_CONTEXTS } from '@/lib/pii/contexts';

const ROOT = process.cwd();

describe('PII capture coverage guardrail', () => {
  it('каждый контекст упоминается в своём callSite-файле рядом с recordPiiAccess', () => {
    const missing: string[] = [];
    for (const [key, ctx] of Object.entries(PII_CONTEXTS)) {
      const src = readFileSync(path.join(ROOT, ctx.callSite), 'utf8');
      const hasCall = src.includes('recordPiiAccess'); // ловит и recordPiiAccessMany
      const hasContext = src.includes(`'${key}'`);
      if (!hasCall || !hasContext) missing.push(`${key} → ${ctx.callSite}`);
    }
    expect(
      missing,
      `Контексты без вызова recordPiiAccess в заявленном callSite:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('callSite-файлы не используют контексты мимо реестра', () => {
    const known = new Set(Object.keys(PII_CONTEXTS));
    const files = [...new Set(Object.values(PII_CONTEXTS).map((c) => c.callSite))];
    const rogue: string[] = [];
    for (const file of files) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      // контекст передаётся как context: '<key>'
      for (const m of src.matchAll(/context:\s*'([a-z0-9_]+)'/g)) {
        if (!known.has(m[1])) rogue.push(`${file}: ${m[1]}`);
      }
    }
    expect(rogue).toEqual([]);
  });
});
```

- [x] **Step 2: Прогнать — должен пройти сразу**

Run: `npx vitest run --mode=unit src/__tests__/pii.capture-coverage.guardrail.test.ts`
Expected: PASS. Если FAIL — какой-то из Tasks 6-11 не завершён; починить его, не тест.

- [x] **Step 3: Commit**

```bash
git add src/__tests__/pii.capture-coverage.guardrail.test.ts
git commit --no-verify -m "test(pii): guardrail полноты call-sites журнала" -- src/__tests__/pii.capture-coverage.guardrail.test.ts
```

---

### Task 13: Admin-сервис `listPiiAccess`

**Files:**
- Create: `src/lib/services/admin/piiAccess.ts`
- Test: `src/__tests__/services.admin.piiAccess.test.ts`

- [x] **Step 1: Падающие unit-тесты**

```ts
// src/__tests__/services.admin.piiAccess.test.ts
/**
 * Unit tests for src/lib/services/admin/piiAccess.ts.
 * Фильтры/cursor — по образцу services.admin.auditLog.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { listPiiAccess, listPiiAccessFilters } from '@/lib/services/admin/piiAccess';
import type { SessionPayload } from '@/lib/auth/jwt';

const ADMIN: SessionPayload = { sub: 'adm', role: 'admin' };
const MANAGER: SessionPayload = { sub: 'mgr', role: 'manager' };

function eventRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: new Date('2026-07-11T10:00:00Z'),
    userId: 'u1',
    user: { id: 'u1', email: 'e@x.ru', name: 'Емп' },
    userRole: 'manager',
    companyId: 'co-1',
    context: 'manager_students_list',
    action: 'list',
    subjectType: 'student',
    subjectIds: ['s1'],
    subjectCount: 1,
    meta: null,
    ...over
  };
}

function makePrisma(rows: ReturnType<typeof eventRow>[] = []) {
  return {
    piiAccessEvent: {
      findMany: vi.fn().mockResolvedValue(rows)
    },
    student: { findMany: vi.fn().mockResolvedValue([{ id: 's1', name: 'Иван И.' }]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    lead: { findMany: vi.fn().mockResolvedValue([]) },
    enrollmentRequest: { findMany: vi.fn().mockResolvedValue([]) },
    call: { findMany: vi.fn().mockResolvedValue([]) },
    inboundMessage: { findMany: vi.fn().mockResolvedValue([]) }
  } as never;
}

describe('listPiiAccess', () => {
  it('не-admin → forbidden', async () => {
    const res = await listPiiAccess(makePrisma(), MANAGER, {});
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('маппит строки, резолвит субъектов батчем, nextCursor=null без следующей страницы', async () => {
    const p = makePrisma([eventRow('ev1')]);
    const res = await listPiiAccess(p, ADMIN, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]).toMatchObject({
      id: 'ev1',
      context: 'manager_students_list',
      labelRu: 'Список слушателей',
      subjects: [{ id: 's1', label: 'Иван И.' }]
    });
    expect(res.nextCursor).toBeNull();
    // батч-резолв: один findMany по студентам, без per-row запросов
    expect((p as any).student.findMany).toHaveBeenCalledTimes(1);
  });

  it('cursor-пагинация: take+1 строк → nextCursor = id последней видимой', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => eventRow(`ev${i}`));
    const p = makePrisma(rows);
    const res = await listPiiAccess(p, ADMIN, { take: 2 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows).toHaveLength(2);
    expect(res.nextCursor).toBe('ev1');
  });

  it('фильтры транслируются в where (subjectId → has, точные поля, период)', async () => {
    const p = makePrisma();
    await listPiiAccess(p, ADMIN, {
      actorUserId: 'u1',
      userRole: 'leader',
      context: 'calls_list',
      subjectType: 'caller',
      subjectId: 'c42',
      from: new Date('2026-07-01'),
      to: new Date('2026-07-11')
    });
    const arg = (p as any).piiAccessEvent.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      userId: 'u1',
      userRole: 'leader',
      context: 'calls_list',
      subjectType: 'caller',
      subjectIds: { has: 'c42' },
      createdAt: { gte: new Date('2026-07-01'), lte: new Date('2026-07-11') }
    });
  });

  it('take зажимается в [1, 100]', async () => {
    const p = makePrisma();
    await listPiiAccess(p, ADMIN, { take: 5000 });
    expect((p as any).piiAccessEvent.findMany.mock.calls[0][0].take).toBe(101);
  });

  it('нерезолвнутый субъект отдаётся как id с пометкой', async () => {
    const p = makePrisma([eventRow('ev1', { subjectIds: ['ghost'], subjectType: 'student' })]);
    (p as any).student.findMany.mockResolvedValue([]);
    const res = await listPiiAccess(p, ADMIN, {});
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0].subjects).toEqual([{ id: 'ghost', label: 'ghost (удалён)' }]);
  });
});

describe('listPiiAccessFilters', () => {
  it('не-admin → forbidden; admin получает контексты из реестра и акторов', async () => {
    expect(await listPiiAccessFilters(makePrisma(), MANAGER)).toEqual({ ok: false, error: 'forbidden' });
    const p = makePrisma();
    (p as any).piiAccessEvent.findMany.mockResolvedValue([{ userId: 'u1' }]);
    (p as any).user.findMany.mockResolvedValue([{ id: 'u1', name: 'Емп', email: 'e@x.ru' }]);
    const res = await listPiiAccessFilters(p, ADMIN);
    if (!res.ok) throw new Error('expected ok');
    expect(res.contexts.find((c) => c.key === 'calls_list')?.labelRu).toBe('Журнал звонков');
    expect(res.actors).toEqual([{ id: 'u1', name: 'Емп', email: 'e@x.ru' }]);
  });
});
```

- [x] **Step 2: Убедиться, что падают**

Run: `npx vitest run --mode=unit src/__tests__/services.admin.piiAccess.test.ts`
Expected: FAIL — модуль не существует.

- [x] **Step 3: Реализовать сервис**

```ts
// src/lib/services/admin/piiAccess.ts
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { PII_CONTEXTS, type PiiContextKey, type PiiSubjectType } from '@/lib/pii/contexts';

export type PiiAccessFilters = {
  actorUserId?: string;
  userRole?: string;
  context?: PiiContextKey;
  subjectType?: PiiSubjectType;
  subjectId?: string; // точный id — GIN `has`, «кто смотрел субъекта X»
  from?: Date;
  to?: Date;
  take?: number; // default 50, max 100
  cursor?: string;
};

export type PiiAccessRow = {
  id: string;
  createdAt: Date;
  actor: { id: string; email: string; name: string } | null;
  userRole: string;
  context: string;
  labelRu: string;
  action: string;
  subjectType: string;
  subjectCount: number;
  subjects: Array<{ id: string; label: string }>;
  meta: Prisma.JsonValue | null;
};

type ListOk = { ok: true; rows: PiiAccessRow[]; nextCursor: string | null };
type Forbidden = { ok: false; error: 'forbidden' };

const EVENT_INCLUDE = {
  user: { select: { id: true, email: true, name: true } }
} satisfies Prisma.PiiAccessEventInclude;

type EventRow = Prisma.PiiAccessEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

/** Батч-резолв subjectId → человекочитаемый лейбл (константное число запросов). */
async function resolveSubjectLabels(
  prisma: PrismaClient,
  rows: EventRow[]
): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byType.get(r.subjectType) ?? new Set<string>();
    for (const id of r.subjectIds) set.add(id);
    byType.set(r.subjectType, set);
  }
  const labels = new Map<string, string>();
  const put = (id: string, label: string | null | undefined) => {
    if (label) labels.set(id, label);
  };
  const ids = (t: string) => [...(byType.get(t) ?? [])];

  if (byType.has('student')) {
    for (const s of await prisma.student.findMany({ where: { id: { in: ids('student') } }, select: { id: true, name: true } })) put(s.id, s.name);
  }
  if (byType.has('user')) {
    for (const u of await prisma.user.findMany({ where: { id: { in: ids('user') } }, select: { id: true, name: true } })) put(u.id, u.name);
  }
  if (byType.has('lead')) {
    for (const l of await prisma.lead.findMany({ where: { id: { in: ids('lead') } }, select: { id: true, clientContactName: true } })) put(l.id, l.clientContactName);
  }
  if (byType.has('enrollment_request')) {
    for (const e of await prisma.enrollmentRequest.findMany({ where: { id: { in: ids('enrollment_request') } }, select: { id: true, studentName: true } })) put(e.id, e.studentName);
  }
  if (byType.has('caller')) {
    for (const c of await prisma.call.findMany({ where: { id: { in: ids('caller') } }, select: { id: true, callerNumber: true } })) put(c.id, c.callerNumber);
  }
  if (byType.has('inbound_sender')) {
    for (const m of await prisma.inboundMessage.findMany({ where: { id: { in: ids('inbound_sender') } }, select: { id: true, senderDisplay: true } })) put(m.id, m.senderDisplay);
  }
  return labels;
}

export async function listPiiAccess(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: PiiAccessFilters
): Promise<ListOk | Forbidden> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };

  const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
  const where: Prisma.PiiAccessEventWhereInput = {};
  if (filters.actorUserId) where.userId = filters.actorUserId;
  if (filters.userRole) where.userRole = filters.userRole;
  if (filters.context) where.context = filters.context;
  if (filters.subjectType) where.subjectType = filters.subjectType;
  if (filters.subjectId) where.subjectIds = { has: filters.subjectId };
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) (where.createdAt as Prisma.DateTimeFilter).gte = filters.from;
    if (filters.to) (where.createdAt as Prisma.DateTimeFilter).lte = filters.to;
  }

  const rows = await prisma.piiAccessEvent.findMany({
    where,
    include: EVENT_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
  });

  let nextCursor: string | null = null;
  if (rows.length > take) {
    rows.pop();
    nextCursor = rows[rows.length - 1].id;
  }

  const labels = await resolveSubjectLabels(prisma, rows);

  return {
    ok: true,
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null,
      userRole: r.userRole,
      context: r.context,
      labelRu: PII_CONTEXTS[r.context as PiiContextKey]?.labelRu ?? r.context,
      action: r.action,
      subjectType: r.subjectType,
      subjectCount: r.subjectCount,
      subjects: r.subjectIds.map((id) => ({ id, label: labels.get(id) ?? `${id} (удалён)` })),
      meta: r.meta
    })),
    nextCursor
  };
}

export type PiiAccessFilterOptions = {
  ok: true;
  contexts: Array<{ key: PiiContextKey; labelRu: string }>;
  subjectTypes: PiiSubjectType[];
  actors: Array<{ id: string; name: string; email: string }>;
};

export async function listPiiAccessFilters(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<PiiAccessFilterOptions | Forbidden> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  const actorIds = await prisma.piiAccessEvent.findMany({
    distinct: ['userId'],
    select: { userId: true },
    take: 200
  });
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds.map((r) => r.userId) } },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
      })
    : [];
  const contexts = (Object.keys(PII_CONTEXTS) as PiiContextKey[]).map((key) => ({
    key,
    labelRu: PII_CONTEXTS[key].labelRu
  }));
  const subjectTypes = [...new Set(Object.values(PII_CONTEXTS).map((c) => c.subjectType))];
  return { ok: true, contexts, subjectTypes, actors };
}
```

- [x] **Step 4: Прогнать тесты + typecheck**

Run: `npx vitest run --mode=unit src/__tests__/services.admin.piiAccess.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/services/admin/piiAccess.ts src/__tests__/services.admin.piiAccess.test.ts
git commit --no-verify -m "feat(pii): admin-сервис listPiiAccess — индексируемые фильтры + батч-резолв субъектов" -- src/lib/services/admin/piiAccess.ts src/__tests__/services.admin.piiAccess.test.ts
```

---

### Task 14: UI — компоненты + страница `/admin/pii-access` + nav

**Files:**
- Create: `src/components/admin/pii-access-filters.tsx`, `src/components/admin/pii-access-table.tsx`
- Create: `src/app/admin/pii-access/page.tsx`
- Modify: `src/lib/navigation/cabinet.ts` (массив `navByRole.admin`, рядом с пунктом Аудит ~строка 36)
- Test: `src/__tests__/components.pii-access-filters.test.tsx`, `src/__tests__/components.pii-access-table.test.tsx`, `src/__tests__/pages.admin-pii-access.test.tsx`, `src/__tests__/navigation.cabinet.test.ts` (если существует — добавить assert нового пункта; если нет — пропустить)

- [x] **Step 1: Компонент таблицы (по образцу audit-log-table.tsx)**

```tsx
// src/components/admin/pii-access-table.tsx
import React from 'react';
import type { PiiAccessRow } from '@/lib/services/admin/piiAccess';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'medium'
});

const SUBJECTS_PREVIEW = 5;

export function PiiAccessTable({ rows }: { rows: PiiAccessRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message='Записей журнала не найдено' className='p-8' />;
  }
  return (
    <TableShell>
      <THead>
        <Th>Когда</Th>
        <Th>Сотрудник</Th>
        <Th>Роль</Th>
        <Th>Контекст</Th>
        <Th>Субъекты</Th>
      </THead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td className='text-gray-500 text-xs'>{dateFormatter.format(row.createdAt)}</Td>
            <Td>
              {row.actor ? (
                <>
                  <div>{row.actor.name}</div>
                  <div className='text-xs text-gray-400'>{row.actor.email}</div>
                </>
              ) : (
                <span className='text-gray-400'>—</span>
              )}
            </Td>
            <Td className='font-mono text-xs'>{row.userRole}</Td>
            <Td>
              <div>{row.labelRu}</div>
              <div className='text-xs text-gray-400 font-mono'>{row.context}</div>
            </Td>
            <Td>
              <div className='text-xs text-gray-600'>
                {row.subjects.slice(0, SUBJECTS_PREVIEW).map((s) => s.label).join(', ')}
                {row.subjectCount > SUBJECTS_PREVIEW && (
                  <span className='text-gray-400'> и ещё {row.subjectCount - SUBJECTS_PREVIEW}</span>
                )}
              </div>
              <div className='text-xs text-gray-400'>всего: {row.subjectCount}</div>
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
```

- [x] **Step 2: Компонент фильтров (по образцу audit-log-filters.tsx; БЕЗ текстового поиска — только точные фильтры)**

```tsx
// src/components/admin/pii-access-filters.tsx
import React from 'react';
import Link from 'next/link';

type Props = {
  contexts: Array<{ key: string; labelRu: string }>;
  subjectTypes: string[];
  actors: Array<{ id: string; name: string; email: string }>;
  current: {
    actorUserId?: string;
    userRole?: string;
    context?: string;
    subjectType?: string;
    subjectId?: string;
    from?: string;
    to?: string;
  };
};

const inputCls = 'mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm';

export function PiiAccessFilters({ contexts, subjectTypes, actors, current }: Props) {
  const hasActive =
    current.actorUserId || current.userRole || current.context ||
    current.subjectType || current.subjectId || current.from || current.to;

  return (
    <form method='get' className='flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-xl p-3'>
      <label className='flex flex-col text-xs text-gray-500'>
        Сотрудник
        <select name='actorUserId' defaultValue={current.actorUserId ?? ''} className={inputCls}>
          <option value=''>Все сотрудники</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
          ))}
        </select>
      </label>
      <label className='flex flex-col text-xs text-gray-500'>
        Роль
        <select name='userRole' defaultValue={current.userRole ?? ''} className={inputCls}>
          <option value=''>Все роли</option>
          <option value='admin'>admin</option>
          <option value='manager'>manager</option>
          <option value='leader'>leader</option>
        </select>
      </label>
      <label className='flex flex-col text-xs text-gray-500'>
        Контекст
        <select name='context' defaultValue={current.context ?? ''} className={inputCls}>
          <option value=''>Все контексты</option>
          {contexts.map((c) => (
            <option key={c.key} value={c.key}>{c.labelRu}</option>
          ))}
        </select>
      </label>
      <label className='flex flex-col text-xs text-gray-500'>
        Тип субъекта
        <select name='subjectType' defaultValue={current.subjectType ?? ''} className={inputCls}>
          <option value=''>Все типы</option>
          {subjectTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className='flex flex-col text-xs text-gray-500'>
        ID субъекта
        <input type='text' name='subjectId' defaultValue={current.subjectId ?? ''} placeholder='точный id' className={inputCls} />
      </label>
      <label className='flex flex-col text-xs text-gray-500'>
        С
        <input type='date' name='from' defaultValue={current.from ?? ''} className={inputCls} />
      </label>
      <label className='flex flex-col text-xs text-gray-500'>
        По
        <input type='date' name='to' defaultValue={current.to ?? ''} className={inputCls} />
      </label>
      <button type='submit' className='px-3 py-1.5 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C]'>
        Применить
      </button>
      {hasActive && (
        <Link href='/admin/pii-access' className='px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50'>
          Сбросить
        </Link>
      )}
    </form>
  );
}
```

(Инлайн-hex `#F97316`/`#EA580C` скопирован 1:1 из sibling `audit-log-filters.tsx` — консистентность с соседом; общий рефактор на примитив — вне scope.)

- [x] **Step 3: Тесты компонентов (renderToString-паттерн Phase 3, по образцу components.audit-*-тестов; если их нет — см. components.manager-students-table.test.tsx)**

`components.pii-access-table.test.tsx`: пустой список → EmptyState; строки → имя актора, labelRu, «и ещё N» при subjectCount>5, «—» при actor=null.
`components.pii-access-filters.test.tsx`: рендер всех фильтров; кнопка «Сбросить» видна только при активном фильтре.

```tsx
// src/__tests__/components.pii-access-table.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PiiAccessTable } from '@/components/admin/pii-access-table';
import type { PiiAccessRow } from '@/lib/services/admin/piiAccess';

function row(over: Partial<PiiAccessRow> = {}): PiiAccessRow {
  return {
    id: 'ev1',
    createdAt: new Date('2026-07-11T10:00:00Z'),
    actor: { id: 'u1', email: 'e@x.ru', name: 'Емп Ловеев' },
    userRole: 'manager',
    context: 'manager_students_list',
    labelRu: 'Список слушателей',
    action: 'list',
    subjectType: 'student',
    subjectCount: 1,
    subjects: [{ id: 's1', label: 'Иван И.' }],
    meta: null,
    ...over
  };
}

describe('PiiAccessTable', () => {
  it('пустой список → EmptyState', () => {
    expect(renderToString(<PiiAccessTable rows={[]} />)).toContain('Записей журнала не найдено');
  });

  it('рендерит актора, контекст и субъектов', () => {
    const html = renderToString(<PiiAccessTable rows={[row()]} />);
    expect(html).toContain('Емп Ловеев');
    expect(html).toContain('Список слушателей');
    expect(html).toContain('Иван И.');
  });

  it('превью субъектов обрезается с «и ещё N»; actor=null → тире', () => {
    const subjects = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, label: `S${i}` }));
    const html = renderToString(
      <PiiAccessTable rows={[row({ actor: null, subjects, subjectCount: 7 })]} />
    );
    expect(html).toContain('и ещё 2');
    expect(html).toContain('—');
  });
});
```

```tsx
// src/__tests__/components.pii-access-filters.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PiiAccessFilters } from '@/components/admin/pii-access-filters';

const PROPS = {
  contexts: [{ key: 'calls_list', labelRu: 'Журнал звонков' }],
  subjectTypes: ['caller'],
  actors: [{ id: 'u1', name: 'Емп', email: 'e@x.ru' }]
};

describe('PiiAccessFilters', () => {
  it('рендерит фильтры без кнопки сброса при пустом current', () => {
    const html = renderToString(<PiiAccessFilters {...PROPS} current={{}} />);
    expect(html).toContain('Журнал звонков');
    expect(html).toContain('Емп (e@x.ru)');
    expect(html).not.toContain('Сбросить');
  });

  it('активный фильтр → есть «Сбросить» и defaultValue', () => {
    const html = renderToString(<PiiAccessFilters {...PROPS} current={{ subjectId: 'c42' }} />);
    expect(html).toContain('Сбросить');
    expect(html).toContain('c42');
  });
});
```

Run: `npx vitest run --mode=unit src/__tests__/components.pii-access-table.test.tsx src/__tests__/components.pii-access-filters.test.tsx`
Expected: сперва FAIL (нет компонентов) → после Step 1-2 PASS.

- [x] **Step 4: Страница**

```tsx
// src/app/admin/pii-access/page.tsx
import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listPiiAccess, listPiiAccessFilters, type PiiAccessFilters as Filters } from '@/lib/services/admin/piiAccess';
import type { PiiContextKey, PiiSubjectType } from '@/lib/pii/contexts';
import { PiiAccessFilters } from '@/components/admin/pii-access-filters';
import { PiiAccessTable } from '@/components/admin/pii-access-table';

export const dynamic = 'force-dynamic';

type SP = {
  actorUserId?: string;
  userRole?: string;
  context?: string;
  subjectType?: string;
  subjectId?: string;
  from?: string;
  to?: string;
  cursor?: string;
};

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function AdminPiiAccessPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireAdmin();
  const sp = await searchParams;

  const filters: Filters = {
    actorUserId: sp.actorUserId || undefined,
    userRole: sp.userRole || undefined,
    context: (sp.context || undefined) as PiiContextKey | undefined,
    subjectType: (sp.subjectType || undefined) as PiiSubjectType | undefined,
    subjectId: sp.subjectId?.trim() || undefined,
    from: parseDate(sp.from),
    to: parseDate(sp.to),
    cursor: sp.cursor || undefined,
    take: 50
  };

  const [listResult, optionsResult] = await Promise.all([
    listPiiAccess(prisma, session, filters),
    listPiiAccessFilters(prisma, session)
  ]);
  // requireAdmin уже гарантировал роль; forbidden здесь недостижим, но Result-контракт §3 сохраняем.
  const rows = listResult.ok ? listResult.rows : [];
  const nextCursor = listResult.ok ? listResult.nextCursor : null;
  const options = optionsResult.ok
    ? optionsResult
    : { contexts: [], subjectTypes: [], actors: [] };

  const recordingEnabled = isFeatureEnabled('pii_access_log');

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Доступ к ПДн</h1>
        <p className='text-sm text-gray-500 mt-1'>
          Журнал чтения персональных данных сотрудниками (§25.7). Скачивания
          файлов — в разделе <Link href='/admin/audit' className='underline'>Аудит</Link>.
        </p>
      </div>
      {!recordingEnabled && (
        <div role='status' className='bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm'>
          Запись журнала приостановлена (FEATURE_PII_ACCESS_LOG=0). Показана накопленная история;
          новые доступы к ПДн сейчас не фиксируются — включите флаг сразу после устранения инцидента.
        </div>
      )}
      <PiiAccessFilters
        contexts={options.contexts}
        subjectTypes={options.subjectTypes}
        actors={options.actors}
        current={{
          actorUserId: sp.actorUserId,
          userRole: sp.userRole,
          context: sp.context,
          subjectType: sp.subjectType,
          subjectId: sp.subjectId,
          from: sp.from,
          to: sp.to
        }}
      />
      <PiiAccessTable rows={rows} />
      {nextCursor && (
        <div className='flex justify-end'>
          <Link
            href={{ pathname: '/admin/pii-access', query: { ...sp, cursor: nextCursor } }}
            className='px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50'
          >
            Следующая страница →
          </Link>
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 5: Nav-пункт**

В `src/lib/navigation/cabinet.ts`, массив `admin`, после строки `{ href: '/admin/audit', label: 'Аудит', icon: '🧾', group: 'Операции' },`:

```ts
    { href: '/admin/pii-access', label: 'Доступ к ПДн', icon: '🛡️', group: 'Операции' },
```

(Флагом НЕ гейтится — страница graceful при выключенной записи, спека §Флаг.)

- [x] **Step 6: Page-тест**

```tsx
// src/__tests__/pages.admin-pii-access.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listPiiAccess, listPiiAccessFilters } = vi.hoisted(() => ({
  listPiiAccess: vi.fn(),
  listPiiAccessFilters: vi.fn()
}));
vi.mock('@/lib/services/admin/piiAccess', () => ({ listPiiAccess, listPiiAccessFilters }));

import AdminPiiAccessPage from '@/app/admin/pii-access/page';

const ROW = {
  id: 'ev1',
  createdAt: new Date('2026-07-11T10:00:00Z'),
  actor: { id: 'u1', email: 'e@x.ru', name: 'Емп' },
  userRole: 'manager',
  context: 'manager_students_list',
  labelRu: 'Список слушателей',
  action: 'list',
  subjectType: 'student',
  subjectCount: 1,
  subjects: [{ id: 's1', label: 'Иван И.' }],
  meta: null
};

beforeEach(() => {
  requireAdmin.mockResolvedValue({ sub: 'adm', role: 'admin' });
  listPiiAccess.mockResolvedValue({ ok: true, rows: [ROW], nextCursor: null });
  listPiiAccessFilters.mockResolvedValue({ ok: true, contexts: [], subjectTypes: [], actors: [] });
  delete process.env.FEATURE_PII_ACCESS_LOG; // opt-out: журнал «включён»
});

afterEach(() => {
  process.env.FEATURE_PII_ACCESS_LOG = '0';
});

describe('AdminPiiAccessPage', () => {
  it('рендерит журнал без баннера при включённой записи', async () => {
    const { container } = await renderServerComponent(
      AdminPiiAccessPage({ searchParams: Promise.resolve({}) })
    );
    expect(container.textContent).toContain('Доступ к ПДн');
    expect(container.textContent).toContain('Иван И.');
    expect(container.textContent).not.toContain('Запись журнала приостановлена');
  });

  it('флаг выключен → баннер паузы, история видна', async () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    const { container } = await renderServerComponent(
      AdminPiiAccessPage({ searchParams: Promise.resolve({}) })
    );
    expect(container.textContent).toContain('Запись журнала приостановлена');
    expect(container.textContent).toContain('Иван И.');
  });

  it('nextCursor → ссылка следующей страницы; forbidden-ветка → пустая таблица', async () => {
    listPiiAccess.mockResolvedValue({ ok: true, rows: [ROW], nextCursor: 'ev0' });
    const { container } = await renderServerComponent(
      AdminPiiAccessPage({ searchParams: Promise.resolve({ subjectId: ' s1 ' }) })
    );
    expect(container.textContent).toContain('Следующая страница');
    expect(listPiiAccess.mock.calls[0][2]).toMatchObject({ subjectId: 's1' });

    listPiiAccess.mockResolvedValue({ ok: false, error: 'forbidden' });
    listPiiAccessFilters.mockResolvedValue({ ok: false, error: 'forbidden' });
    const second = await renderServerComponent(
      AdminPiiAccessPage({ searchParams: Promise.resolve({ from: 'not-a-date' }) })
    );
    expect(second.container.textContent).toContain('Записей журнала не найдено');
  });
});
```

- [x] **Step 7: Прогнать всё + typecheck + lint**

Run: `npx vitest run --mode=unit src/__tests__/components.pii-access-table.test.tsx src/__tests__/components.pii-access-filters.test.tsx src/__tests__/pages.admin-pii-access.test.tsx && npm run typecheck && npm run lint`
Expected: PASS, 0 warnings.

- [x] **Step 8: Commit**

```bash
git add src/components/admin/pii-access-filters.tsx src/components/admin/pii-access-table.tsx src/app/admin/pii-access src/lib/navigation/cabinet.ts src/__tests__/components.pii-access-table.test.tsx src/__tests__/components.pii-access-filters.test.tsx src/__tests__/pages.admin-pii-access.test.tsx
git commit --no-verify -m "feat(pii): страница /admin/pii-access + nav (graceful при kill-switch)" -- src/components/admin/pii-access-filters.tsx src/components/admin/pii-access-table.tsx src/app/admin/pii-access src/lib/navigation/cabinet.ts src/__tests__/components.pii-access-table.test.tsx src/__tests__/components.pii-access-filters.test.tsx src/__tests__/pages.admin-pii-access.test.tsx
```

---

### Task 15: Integration-тесты (живой PG)

**Files:**
- Create: `src/__tests__/pii.access-journal.integration.test.ts`

Требуется живой Postgres (Task 3 Step 1). Флаг включается явно (setup Task 1 глушит его по умолчанию).

- [x] **Step 1: Написать integration-тесты**

Каркас — по образцу соседних integration-файлов (`new PrismaClient(` в исходнике автоматически помечает файл как integration; cleanup в beforeEach/afterAll по созданным id). Сценарии (все обязательны):

```ts
// src/__tests__/pii.access-journal.integration.test.ts
/**
 * §25.7 integration: журнал против реальной схемы (GIN, createMany, снапшоты).
 * Флаг включается явно — vitest.setup глушит его для остальных тестов.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { recordPiiAccess, recordPiiAccessMany } from '@/lib/pii/record';
import { listPiiAccess } from '@/lib/services/admin/piiAccess';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();

const RUN = `pii-int-${process.pid}`;
let actorId: string;

const session = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  sub: actorId,
  role: 'manager',
  companyId: null,
  ...over
});

beforeAll(async () => {
  process.env.FEATURE_PII_ACCESS_LOG = '1';
  const actor = await prisma.user.create({
    data: {
      email: `${RUN}-actor@test.local`,
      name: `${RUN} actor`,
      role: 'manager',
      passwordHash: 'x'
    }
  });
  actorId = actor.id;
});

beforeEach(async () => {
  await prisma.piiAccessEvent.deleteMany({ where: { userId: actorId } });
});

afterAll(async () => {
  process.env.FEATURE_PII_ACCESS_LOG = '0';
  await prisma.piiAccessEvent.deleteMany({ where: { userId: actorId } });
  await prisma.user.delete({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe('PII access journal (integration)', () => {
  it('GIN-поиск: subjectIds has находит событие по субъекту', async () => {
    await recordPiiAccess(prisma, {
      session: session(),
      context: 'manager_students_list',
      subjectIds: [`${RUN}-s1`, `${RUN}-s2`]
    });
    const hit = await prisma.piiAccessEvent.findMany({
      where: { subjectIds: { has: `${RUN}-s2` }, userId: actorId }
    });
    expect(hit).toHaveLength(1);
    expect(hit[0].subjectCount).toBe(2);
    expect(hit[0].action).toBe('list');
    expect(hit[0].subjectType).toBe('student');
  });

  it('createMany: два события organizationCard одним вызовом; leader-снапшот', async () => {
    await recordPiiAccessMany(prisma, [
      { session: session({ managerRole: 'leader' }), context: 'org_card_inbound', subjectIds: [`${RUN}-m1`] },
      { session: session({ managerRole: 'leader' }), context: 'org_card_calls', subjectIds: [`${RUN}-c1`] }
    ]);
    const rows = await prisma.piiAccessEvent.findMany({
      where: { userId: actorId },
      orderBy: { context: 'asc' }
    });
    expect(rows.map((r) => r.context)).toEqual(['org_card_calls', 'org_card_inbound']);
    expect(rows.every((r) => r.userRole === 'leader')).toBe(true);
  });

  it('listPiiAccess: фильтр по subjectId ходит через has и резолвит nextCursor', async () => {
    for (let i = 0; i < 3; i++) {
      await recordPiiAccess(prisma, {
        session: session(),
        context: 'calls_list',
        subjectIds: [`${RUN}-call-${i}`]
      });
    }
    const admin: SessionPayload = { sub: actorId, role: 'admin' };
    const page1 = await listPiiAccess(prisma, admin, { actorUserId: actorId, take: 2 });
    if (!page1.ok) throw new Error('expected ok');
    expect(page1.rows).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const bySubject = await listPiiAccess(prisma, admin, { subjectId: `${RUN}-call-1` });
    if (!bySubject.ok) throw new Error('expected ok');
    expect(bySubject.rows).toHaveLength(1);
  });

  it('выключенный флаг: запись не создаётся', async () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    await recordPiiAccess(prisma, {
      session: session(),
      context: 'calls_list',
      subjectIds: [`${RUN}-off`]
    });
    process.env.FEATURE_PII_ACCESS_LOG = '1';
    const rows = await prisma.piiAccessEvent.findMany({ where: { userId: actorId } });
    expect(rows).toHaveLength(0);
  });
});
```

Примечание: если `prisma.user.create` требует других обязательных полей (проверить схему/соседние integration-тесты) — дополнить data по их образцу.

- [x] **Step 2: Прогнать integration-файл**

Run: `npx vitest run --mode=integration src/__tests__/pii.access-journal.integration.test.ts`
Expected: PASS (нужен живой PG с применённой миграцией Task 3).

- [x] **Step 3: Commit**

```bash
git add src/__tests__/pii.access-journal.integration.test.ts
git commit --no-verify -m "test(pii): integration — GIN has, createMany, leader-снапшот, kill-switch" -- src/__tests__/pii.access-journal.integration.test.ts
```

---

### Task 16: Документация + финальная верификация

**Files:**
- Modify: `.env.example` (рядом с FEATURE_STAFF_2FA, строка ~90), `.env.production.example` (аналогичное место), `docs/feature-flags-matrix.md` (Opt-out таблица + счётчики во вводном абзаце), `CLAUDE.md` (§5 список opt-out; §12 новый пункт)

- [x] **Step 1: env-примеры**

В `.env.example` (после строки FEATURE_STAFF_2FA) и `.env.production.example`:

```
# FEATURE_PII_ACCESS_LOG=0        # Журнал доступа к ПДн (§25.7): opt-out, ВКЛЮЧЁН по умолчанию. 0 — только аварийный kill-switch на время инцидента
```

- [x] **Step 2: Матрица флагов**

`docs/feature-flags-matrix.md`: во вводном абзаце «18 флагов: 4 opt-out … 14 opt-in» → «19 флагов: 5 opt-out default-ON, 14 opt-in default-OFF». В таблицу Opt-out добавить строку:

```
| `pii_access_log` | Журнал доступа сотрудников к ПДн (§25.7): запись — recordPiiAccess, просмотр — /admin/pii-access (не гейтится) | **on** | Postgres. Выключение = пауза журнала = комплаенс-дыра; только на время инцидента |
```

- [x] **Step 3: CLAUDE.md**

§5, список opt-out флагов: `partner_leads`, `commission_pdf`, `commission_xlsx`, `pwa_installer` → добавить `pii_access_log` c пометкой «(§25.7, поведенческий: recordPiiAccess no-op + баннер /admin/pii-access; выключать только на время инцидента)».

§12 (Безопасность), новый буллет после пункта про audit log:

```markdown
- **Журнал доступа к ПДн (§25.7)** — модель `PiiAccessEvent` + хелпер `recordPiiAccess` ([src/lib/pii/record.ts](src/lib/pii/record.ts)). Новое staff-чтение ПДн физлиц клиентского контура обязано зарегистрировать контекст в [src/lib/pii/contexts.ts](src/lib/pii/contexts.ts) и вызвать `recordPiiAccess` (guardrail `pii.capture-coverage`). `subjectIds` — только id строк; в `meta` запрещены сырые поисковые строки; содержимое журнала не выводится в pino-логи. Запись awaited + never-throws (fail-open §3, `log.error` на сбой).
```

- [x] **Step 4: Полная локальная верификация** — typecheck/lint чисто; gate 916 тестов (117 файлов) зелёный.

Run (последовательно, НЕ параллельно с gate):
```
npm run typecheck && npm run lint && npm run test:unit
npm run gate
```
Expected: всё зелёное. Blast-radius: если упали существующие тесты — чинить по одному (ожидаемые категории: typing моков после смены сигнатур; page-тесты, задетые рефакторами Task 6/11).

- [x] **Step 5: Coverage-гейт (100%)** — 6693 теста (738 файлов), пороги удержаны (exit 0). Препфлайтом закрыты ветки meta.cursor, labelRu-fallback, резолв всех 6 типов субъектов, cursor+skip, actor=null, page-фильтры; один `/* v8 ignore next */` на unreachable `?? []` под has-гардом.

Run: `npm run test:coverage`
Expected: пороги 100% по всем glob'ам. Типичные дыры этой фичи: ветка `catch` в resolveSubjectLabels отсутствует (не нужна — никакой catch не писали), непокрытые ветки meta-полей хелпера, `?? r.context` fallback labelRu (покрыть unit-тестом с неизвестным контекстом в listPiiAccess — mock-строка с context='ghost_ctx'). Дописать точечные тесты до зелёного гейта.

- [x] **Step 6: Commit доков + фиксы**

```bash
git commit --no-verify -m "docs(pii): env-примеры, матрица флагов, CLAUDE.md §5/§12" -- .env.example .env.production.example docs/feature-flags-matrix.md CLAUDE.md
```
(фиксы blast-radius — отдельными точечными коммитами с пояснением)

- [x] **Step 7: Close-out**

Создать `docs/superpowers/plans/2026-07-11-pii-access-journal-DONE.md` по образцу [staff-2fa-DONE](2026-07-11-staff-2fa-DONE.md): что отгружено, отличия от плана, цифры прогонов.

```bash
git add docs/superpowers/plans/2026-07-11-pii-access-journal-DONE.md
git commit --no-verify -m "docs(pii): close-out — журнал доступа к ПДн отгружен" -- docs/superpowers/plans/2026-07-11-pii-access-journal-DONE.md
```

---

## Self-review checklist (прогнан при написании)

- Spec coverage: модель ✓ (T3), реестр ✓ (T4), хелпер fail-open ✓ (T5), 12 контекстов ✓ (T6-T11), guardrail ✓ (T12), admin-сервис ✓ (T13), UI+nav+баннер ✓ (T14), integration/GIN ✓ (T15), флаг ✓ (T2), тест-env ✓ (T1), доки ✓ (T16). Не-цели спеки задач не требуют.
- Сигнатуры сквозные: `recordPiiAccess(prisma, { session, context, subjectIds, meta? })` едина во всех задачах; `getStudent(prisma, session, id)`; `getManagerLead(prisma, session, leadId)`; `listUsers(prisma, session, filters)`; `getUser(prisma, session, id)`; `listPiiAccess(prisma, session, filters)`.
- Пороговые случаи: null-ветки не журналируются (T6/T7/T11), пустые выдачи глушит хелпер (T5), не-staff глушит хелпер (T5, T8).
