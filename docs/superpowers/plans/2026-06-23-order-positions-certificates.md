# Позиции заявки (слушатели) + удостоверения + напоминания о сроке — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Связать заявку с несколькими обучаемыми сотрудниками (позиции), вести индивидуальный статус обучения и карточки удостоверений со сроком действия, и слать событийные напоминания за 90/60/30/7 дней.

**Architecture:** Новый домен `training` поверх существующих слоёв (CLAUDE.md §2). Позиция `OrderItem` связывает `Order ↔ Student`; `Certificate` вешается на сотрудника (накопитель) и опционально на позицию. Воркер-крон ежедневно вычисляет пороги истечения через чистую функцию и делает fan-out уведомлений (ЛК + e-mail). Ничего из существующего (`Order`/`Student`/`EnrollmentRequest`/комиссии) не переписывается.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TS strict · Prisma 5 + PostgreSQL · BullMQ + Redis · Vitest. Spec: `docs/superpowers/specs/2026-06-23-order-positions-certificates-design.md`.

---

## Файловая структура

**Создаются:**
- `src/lib/services/training/expiry.ts` — чистая функция `selectDueReminders`.
- `src/lib/services/training/directions.ts` — справочник направлений.
- `src/lib/services/training/orderItems.ts` — позиции заявки.
- `src/lib/services/training/certificates.ts` — карточки удостоверений.
- `src/lib/services/training/index.ts` — barrel.
- `src/worker/processors/certificate-expiry.ts` — процессор напоминаний.
- UI: `src/components/training/*` (секция слушателей, модалки), `src/app/admin/training-directions/page.tsx`.
- Тесты: `src/__tests__/services.training.*.test.ts`, `src/__tests__/worker.certificate-expiry.test.ts`.

**Модифицируются:**
- `prisma/schema.prisma` — новые модели/enum + alter `Student`/`Order`/`Organization`.
- `prisma/seed.ts` — seed `TrainingDirection`.
- `src/lib/jobs/queues.ts` — новая очередь.
- `src/lib/jobs/scheduling.ts` — `CERT_EXPIRY_SCHEDULES`.
- `src/worker/index.ts` — регистрация процессора + расписания.
- `src/lib/services/manager/orderDetail.ts` + org/partner аналоги — секция «Слушатели».
- `src/app/manager/students/[id]` (или students page) — карточки удостоверений.

---

## Фаза 1 — Модель данных

### Task 1: Схема Prisma + миграция

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `src/__tests__/schema.training.test.ts` (create)

- [ ] **Step 1: Написать падающий schema-тест**

Создать `src/__tests__/schema.training.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('training schema', () => {
  it('создаёт направление, позицию и удостоверение со связями', async () => {
    const dir = await prisma.trainingDirection.create({ data: { name: 'Охрана труда' } });
    const company = await prisma.company.create({ data: { name: 'C' } });
    const org = await prisma.organization.create({ data: { name: 'O', companyId: company.id } });
    const student = await prisma.student.create({
      data: { name: 'Иванов', email: 'iv@o.ru', organizationId: org.id }
    });
    const order = await prisma.order.create({
      data: { title: 'T', companyId: company.id, organizationId: org.id }
    });
    const item = await prisma.orderItem.create({
      data: { orderId: order.id, studentId: student.id, directionId: dir.id }
    });
    expect(item.trainingStatus).toBe('pending');
    const cert = await prisma.certificate.create({
      data: {
        studentId: student.id, organizationId: org.id, directionId: dir.id,
        orderItemId: item.id, number: 'УД-1', issuedAt: new Date()
      }
    });
    expect(cert.validUntil).toBeNull();
    // cleanup
    await prisma.certificate.delete({ where: { id: cert.id } });
    await prisma.orderItem.delete({ where: { id: item.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.student.delete({ where: { id: student.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.trainingDirection.delete({ where: { id: dir.id } });
  });

  it('запрещает дубль позиции (orderId+studentId+directionId)', async () => {
    const dir = await prisma.trainingDirection.create({ data: { name: 'ПБ' } });
    const company = await prisma.company.create({ data: { name: 'C2' } });
    const org = await prisma.organization.create({ data: { name: 'O2', companyId: company.id } });
    const student = await prisma.student.create({
      data: { name: 'Петров', email: 'pe@o2.ru', organizationId: org.id }
    });
    const order = await prisma.order.create({
      data: { title: 'T2', companyId: company.id, organizationId: org.id }
    });
    await prisma.orderItem.create({ data: { orderId: order.id, studentId: student.id, directionId: dir.id } });
    await expect(
      prisma.orderItem.create({ data: { orderId: order.id, studentId: student.id, directionId: dir.id } })
    ).rejects.toThrow();
    // cleanup
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.student.delete({ where: { id: student.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.trainingDirection.delete({ where: { id: dir.id } });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:integration -- schema.training`
Expected: FAIL — `prisma.trainingDirection` is undefined (модели ещё нет).

- [ ] **Step 3: Добавить модели в `prisma/schema.prisma`**

Добавить enum рядом с другими enum:

```prisma
enum TrainingStatus {
  pending
  in_progress
  certificate_issued
  cancelled
}
```

Добавить новые модели в конец файла:

```prisma
model TrainingDirection {
  id           String        @id @default(cuid())
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  name         String
  slug         String?       @unique
  isActive     Boolean       @default(true)
  sortOrder    Int           @default(0)
  orderItems   OrderItem[]
  certificates Certificate[]

  @@index([isActive, sortOrder])
}

model OrderItem {
  id             String            @id @default(cuid())
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  orderId        String
  order          Order             @relation(fields: [orderId], references: [id], onDelete: Cascade)
  studentId      String
  student        Student           @relation(fields: [studentId], references: [id])
  directionId    String
  direction      TrainingDirection @relation(fields: [directionId], references: [id])
  trainingStatus TrainingStatus    @default(pending)
  note           String?
  certificate    Certificate?

  @@unique([orderId, studentId, directionId])
  @@index([orderId])
  @@index([studentId])
}

model Certificate {
  id             String                @id @default(cuid())
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt
  studentId      String
  student        Student               @relation(fields: [studentId], references: [id])
  organizationId String
  organization   Organization          @relation(fields: [organizationId], references: [id])
  directionId    String
  direction      TrainingDirection     @relation(fields: [directionId], references: [id])
  orderItemId    String?               @unique
  orderItem      OrderItem?            @relation(fields: [orderItemId], references: [id])
  number         String
  issuedAt       DateTime
  validUntil     DateTime?
  documentId     String?
  source         GenerationSource      @default(user)
  comment        String?
  reminders      CertificateReminder[]

  @@index([studentId])
  @@index([organizationId])
  @@index([validUntil])
}

model CertificateReminder {
  id            String      @id @default(cuid())
  createdAt     DateTime    @default(now())
  certificateId String
  certificate   Certificate @relation(fields: [certificateId], references: [id], onDelete: Cascade)
  thresholdDays Int
  sentAt        DateTime    @default(now())

  @@unique([certificateId, thresholdDays])
}
```

Изменить `model Student`:
- заменить `email String @unique` → `email String`
- добавить после `name String`: `status String @default("active")`
- добавить в список relation: `orderItems OrderItem[]` и `certificates Certificate[]`
- добавить в конец модели: `@@unique([organizationId, email])`

Изменить `model Order`: добавить relation `items OrderItem[]`.

Изменить `model Organization`: добавить relation `certificates Certificate[]`.

- [ ] **Step 4: Сгенерировать клиент и миграцию**

Run:
```bash
npm run prisma:generate
npx prisma migrate dev --name training_positions_certificates
```
Expected: миграция создаётся, дроп старого unique-индекса `Student_email_key`, создание `Student_organizationId_email_key` и новых таблиц. (Если в локальной БД есть дубли `Student.email` по разным орг. — их нет в seed; на чистой/seeded БД миграция проходит.)

- [ ] **Step 5: Запустить тест — должен пройти**

Run: `npm run test:integration -- schema.training`
Expected: PASS (2 теста).

- [ ] **Step 6: Коммит**

```bash
git add prisma/schema.prisma prisma/migrations src/__tests__/schema.training.test.ts
git commit -m "feat(training): schema — OrderItem positions, Certificate cards, expiry reminders"
```

---

### Task 2: Seed справочника направлений (§19)

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Найти точку расширения seed**

Открыть `prisma/seed.ts`, найти раздел, где создаются справочные/демо-данные (по аналогии с существующими `upsert`). Направления должны быть идемпотентны (повторный seed не дублирует) — используем `upsert` по `slug`.

- [ ] **Step 2: Добавить seed направлений**

Вставить (внутри main-функции seed, после создания компании/организаций):

```ts
const TRAINING_DIRECTIONS = [
  { slug: 'labor-safety', name: 'Охрана труда', sortOrder: 1 },
  { slug: 'fire-safety', name: 'Пожарная безопасность', sortOrder: 2 },
  { slug: 'electrical-safety', name: 'Электробезопасность', sortOrder: 3 },
  { slug: 'other', name: 'Другое', sortOrder: 99 }
];
for (const d of TRAINING_DIRECTIONS) {
  await prisma.trainingDirection.upsert({
    where: { slug: d.slug },
    update: { name: d.name, sortOrder: d.sortOrder },
    create: d
  });
}
console.log(`Seeded ${TRAINING_DIRECTIONS.length} training directions`);
```

- [ ] **Step 3: Прогнать seed**

Run: `npm run prisma:seed`
Expected: вывод `Seeded 4 training directions`, без ошибок. Повторный прогон — без дублей.

- [ ] **Step 4: Коммит**

```bash
git add prisma/seed.ts
git commit -m "feat(training): seed training directions (Охрана труда/ПБ/ЭБ/Другое)"
```

---

## Фаза 2 — Чистая логика истечения

### Task 3: `selectDueReminders` (чистая функция порогов)

**Files:**
- Create: `src/lib/services/training/expiry.ts`
- Test: `src/__tests__/services.training.expiry.test.ts`

- [ ] **Step 1: Написать падающий unit-тест**

Создать `src/__tests__/services.training.expiry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectDueReminders, REMINDER_THRESHOLDS } from '@/lib/services/training/expiry';

const today = new Date('2026-06-23T07:00:00.000Z');

function cert(id: string, validUntil: string | null, sentThresholds: number[] = []) {
  return { id, validUntil: validUntil ? new Date(validUntil) : null, sentThresholds };
}

describe('selectDueReminders', () => {
  it('экспортирует пороги 90/60/30/7', () => {
    expect(REMINDER_THRESHOLDS).toEqual([90, 60, 30, 7]);
  });

  it('срабатывает на самом большом непройденном пороге, который уже наступил', () => {
    // validUntil через 29 дней → пороги 90,60,30 наступили, самый «свежий» из непройденных = 30
    const due = selectDueReminders([cert('c1', '2026-07-22T00:00:00.000Z')], today);
    expect(due).toEqual([{ certificateId: 'c1', thresholdDays: 30 }]);
  });

  it('не дублирует уже отправленный порог', () => {
    const due = selectDueReminders([cert('c1', '2026-07-22T00:00:00.000Z', [30])], today);
    // 30 отправлен; 7 ещё не наступил (29 дней > 7) → ничего
    expect(due).toEqual([]);
  });

  it('игнорирует удостоверения без срока и уже просроченные', () => {
    expect(selectDueReminders([cert('c1', null)], today)).toEqual([]);
    // validUntil в прошлом → не напоминаем (срок уже истёк)
    expect(selectDueReminders([cert('c2', '2026-06-01T00:00:00.000Z')], today)).toEqual([]);
  });

  it('на границе ровно 7 дней — порог 7 срабатывает', () => {
    const due = selectDueReminders([cert('c1', '2026-06-30T00:00:00.000Z')], today);
    expect(due).toEqual([{ certificateId: 'c1', thresholdDays: 7 }]);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- services.training.expiry`
Expected: FAIL — модуль `expiry` не найден.

- [ ] **Step 3: Реализовать `expiry.ts`**

```ts
export const REMINDER_THRESHOLDS = [90, 60, 30, 7] as const;

export type ExpiringCertificate = {
  id: string;
  validUntil: Date | null;
  /** Пороги, по которым напоминание уже отправлено (из CertificateReminder). */
  sentThresholds: number[];
};

export type DueReminder = { certificateId: string; thresholdDays: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Для каждого удостоверения определяет «активный» порог — НАИМЕНЬШИЙ из порогов,
 * в чью зону уже вошли (daysLeft <= threshold), — и эмитирует его, если он ещё не
 * был отправлен. Один порог за прогон; следующий (более мелкий) добьётся при
 * последующих ежедневных прогонах. Fallback на более крупный порог НЕ делается.
 */
export function selectDueReminders(
  certs: ExpiringCertificate[],
  today: Date
): DueReminder[] {
  // Сортируем пороги по возрастанию для поиска тесной полосы.
  const ascThresholds = [...REMINDER_THRESHOLDS].sort((a, b) => a - b) as number[];
  const out: DueReminder[] = [];
  for (const c of certs) {
    if (!c.validUntil) continue;
    const daysLeft = Math.ceil((c.validUntil.getTime() - today.getTime()) / MS_PER_DAY);
    if (daysLeft < 0) continue; // уже просрочено — не напоминаем
    const active = ascThresholds.find((t) => daysLeft <= t); // наименьший t: daysLeft <= t
    if (active != null && !c.sentThresholds.includes(active)) {
      out.push({ certificateId: c.id, thresholdDays: active });
    }
  }
  return out;
}
```

> **Важно (исправлено при реализации):** наивный `REMINDER_THRESHOLDS.find((t) => daysLeft <= t && !sent.has(t))` по убывающему `[90,60,30,7]` БАГ: для 29 дней вернёт 90, а при отправленном 30 — сфолбэчит на 60. Нужен **единственный активный порог** = наименьший t ≥ daysLeft, и эмит только если он не отправлен.

- [ ] **Step 4: Запустить — должен пройти**

Run: `npm run test:unit -- services.training.expiry`
Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/services/training/expiry.ts src/__tests__/services.training.expiry.test.ts
git commit -m "feat(training): selectDueReminders pure threshold logic"
```

---

## Фаза 3 — Сервисы (Result-контракт §3)

### Task 4: Сервис справочника направлений

**Files:**
- Create: `src/lib/services/training/directions.ts`
- Test: `src/__tests__/services.training.directions.test.ts`

- [ ] **Step 1: Написать падающий тест (mock Prisma, паттерн §6)**

Создать `src/__tests__/services.training.directions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listDirections, createDirection, deactivateDirection } from '@/lib/services/training/directions';

function session(role: string, managerRole: string | null = null) {
  return { sub: 'u1', role, managerRole, companyId: 'c1' } as any;
}

const prisma = {
  trainingDirection: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  }
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('directions service', () => {
  it('listDirections возвращает активные по sortOrder', async () => {
    prisma.trainingDirection.findMany.mockResolvedValue([{ id: 'd1', name: 'ОТ' }]);
    const res = await listDirections(prisma, session('manager'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.directions).toHaveLength(1);
    expect(prisma.trainingDirection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
    );
  });

  it('createDirection запрещён менеджеру', async () => {
    const res = await createDirection(prisma, session('manager'), { name: 'X' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.trainingDirection.create).not.toHaveBeenCalled();
  });

  it('createDirection разрешён руководителю', async () => {
    prisma.trainingDirection.create.mockResolvedValue({ id: 'd2', name: 'X' });
    const res = await createDirection(prisma, session('manager', 'leader'), { name: 'X' });
    expect(res.ok).toBe(true);
  });

  it('createDirection разрешён админу, пустое имя → validation', async () => {
    const res = await createDirection(prisma, session('admin'), { name: '  ' });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('deactivateDirection ставит isActive=false', async () => {
    prisma.trainingDirection.update.mockResolvedValue({ id: 'd1', isActive: false });
    const res = await deactivateDirection(prisma, session('admin'), { id: 'd1' });
    expect(res.ok).toBe(true);
    expect(prisma.trainingDirection.update).toHaveBeenCalledWith({
      where: { id: 'd1' }, data: { isActive: false }
    });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- services.training.directions`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать `directions.ts`**

```ts
import type { PrismaClient, TrainingDirection } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

export type DirectionsError = 'forbidden' | 'validation' | 'not_found';
type Result<T> = { ok: true } & T | { ok: false; error: DirectionsError };

/** admin или руководитель (manager+managerRole='leader') настраивают справочники (§10/§11). */
function canManageSettings(session: SessionPayload): boolean {
  return session.role === 'admin' || (session.role === 'manager' && session.managerRole === 'leader');
}

export async function listDirections(
  prisma: PrismaClient,
  _session: SessionPayload,
  opts?: { includeInactive?: boolean }
): Promise<Result<{ directions: TrainingDirection[] }>> {
  const directions = await prisma.trainingDirection.findMany({
    where: opts?.includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  });
  return { ok: true, directions };
}

export async function createDirection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { name: string; slug?: string; sortOrder?: number }
): Promise<Result<{ direction: TrainingDirection }>> {
  if (!canManageSettings(session)) return { ok: false, error: 'forbidden' };
  const name = args.name?.trim();
  if (!name) return { ok: false, error: 'validation' };
  const direction = await prisma.trainingDirection.create({
    data: { name, slug: args.slug?.trim() || null, sortOrder: args.sortOrder ?? 0 }
  });
  return { ok: true, direction };
}

export async function updateDirection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string; name?: string; sortOrder?: number }
): Promise<Result<{ direction: TrainingDirection }>> {
  if (!canManageSettings(session)) return { ok: false, error: 'forbidden' };
  const data: { name?: string; sortOrder?: number } = {};
  if (args.name !== undefined) {
    const name = args.name.trim();
    if (!name) return { ok: false, error: 'validation' };
    data.name = name;
  }
  if (args.sortOrder !== undefined) data.sortOrder = args.sortOrder;
  const direction = await prisma.trainingDirection.update({ where: { id: args.id }, data });
  return { ok: true, direction };
}

export async function deactivateDirection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<Result<{ direction: TrainingDirection }>> {
  if (!canManageSettings(session)) return { ok: false, error: 'forbidden' };
  const direction = await prisma.trainingDirection.update({
    where: { id: args.id }, data: { isActive: false }
  });
  return { ok: true, direction };
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npm run test:unit -- services.training.directions`
Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/services/training/directions.ts src/__tests__/services.training.directions.test.ts
git commit -m "feat(training): directions service (admin/leader managed reference list)"
```

---

### Task 5: Сервис позиций заявки (`orderItems.ts`)

**Files:**
- Create: `src/lib/services/training/orderItems.ts`
- Test: `src/__tests__/services.training.orderItems.test.ts`

Контракт: чтение позиций scoped через существующий `getOrder` ([manager/orders.ts](src/lib/services/manager/orders.ts)) — если `getOrder` вернул `null`, заказ вне scope → `forbidden`. Мутации — только manager/admin/leader.

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/services.training.orderItems.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrder } = vi.hoisted(() => ({ getOrder: vi.fn() }));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { listOrderItems, addOrderItem, updateItemStatus } from '@/lib/services/training/orderItems';

function session(role: string) {
  return { sub: 'u1', role, managerRole: null, companyId: 'c1' } as any;
}

const prisma = {
  orderItem: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  trainingDirection: { findUnique: vi.fn() },
  student: { findUnique: vi.fn() }
} as any;

beforeEach(() => vi.clearAllMocks());

describe('orderItems service', () => {
  it('listOrderItems → forbidden, если заказ вне scope', async () => {
    getOrder.mockResolvedValue(null);
    const res = await listOrderItems(prisma, session('manager'), { orderId: 'o1' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('listOrderItems возвращает позиции для видимого заказа', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.orderItem.findMany.mockResolvedValue([{ id: 'it1' }]);
    const res = await listOrderItems(prisma, session('manager'), { orderId: 'o1' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.items).toHaveLength(1);
  });

  it('addOrderItem запрещён партнёру', async () => {
    const res = await addOrderItem(prisma, session('partner'), {
      orderId: 'o1', studentId: 's1', directionId: 'd1'
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('addOrderItem отклоняет неактивное направление', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: false });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1', studentId: 's1', directionId: 'd1'
    });
    expect(res).toEqual({ ok: false, error: 'direction_inactive' });
  });

  it('addOrderItem отклоняет сотрудника не из организации заказа', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'OTHER' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: true });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1', studentId: 's1', directionId: 'd1'
    });
    expect(res).toEqual({ ok: false, error: 'student_mismatch' });
  });

  it('addOrderItem создаёт позицию + пишет audit', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: true });
    prisma.orderItem.create.mockResolvedValue({ id: 'it1' });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1', studentId: 's1', directionId: 'd1'
    });
    expect(res.ok).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: 'order_item_added' }));
  });

  it('addOrderItem ловит дубль (P2002) → duplicate_position', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: true });
    prisma.orderItem.create.mockRejectedValue({ code: 'P2002' });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1', studentId: 's1', directionId: 'd1'
    });
    expect(res).toEqual({ ok: false, error: 'duplicate_position' });
  });

  it('updateItemStatus меняет статус видимой позиции', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({ id: 'it1', orderId: 'o1' });
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.orderItem.update.mockResolvedValue({ id: 'it1', trainingStatus: 'in_progress' });
    const res = await updateItemStatus(prisma, session('manager'), {
      itemId: 'it1', trainingStatus: 'in_progress'
    });
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- services.training.orderItems`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать `orderItems.ts`**

```ts
import type { PrismaClient, Prisma, TrainingStatus } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { recordAudit } from '@/lib/auth/audit';

export type OrderItemsError =
  | 'forbidden' | 'not_found' | 'direction_inactive'
  | 'duplicate_position' | 'student_mismatch' | 'validation';
type Result<T> = { ok: true } & T | { ok: false; error: OrderItemsError };

const ITEM_INCLUDE = {
  student: { select: { id: true, name: true, email: true } },
  direction: { select: { id: true, name: true } },
  certificate: { select: { id: true, number: true, validUntil: true } }
} satisfies Prisma.OrderItemInclude;

export type OrderItemRow = Prisma.OrderItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

/** Менеджер/руководитель/админ редактируют позиции (§4 «изменять рабочий статус»). */
function canEditPositions(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

/** Видимость заказа = существующий scoped getOrder; null ⇒ вне scope. */
async function visibleOrder(prisma: PrismaClient, session: SessionPayload, orderId: string) {
  return getOrder(prisma, session, orderId);
}

export async function listOrderItems(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string }
): Promise<Result<{ items: OrderItemRow[] }>> {
  const order = await visibleOrder(prisma, session, args.orderId);
  if (!order) return { ok: false, error: 'forbidden' };
  const items = await prisma.orderItem.findMany({
    where: { orderId: args.orderId },
    include: ITEM_INCLUDE,
    orderBy: { createdAt: 'asc' }
  });
  return { ok: true, items };
}

export async function addOrderItem(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; studentId: string; directionId: string; note?: string }
): Promise<Result<{ item: { id: string } }>> {
  if (!canEditPositions(session)) return { ok: false, error: 'forbidden' };
  const order = await visibleOrder(prisma, session, args.orderId);
  if (!order) return { ok: false, error: 'forbidden' };

  const student = await prisma.student.findUnique({
    where: { id: args.studentId }, select: { id: true, organizationId: true }
  });
  if (!student) return { ok: false, error: 'not_found' };
  if (student.organizationId !== order.organizationId) return { ok: false, error: 'student_mismatch' };

  const direction = await prisma.trainingDirection.findUnique({
    where: { id: args.directionId }, select: { id: true, isActive: true }
  });
  if (!direction) return { ok: false, error: 'not_found' };
  if (!direction.isActive) return { ok: false, error: 'direction_inactive' };

  try {
    const item = await prisma.orderItem.create({
      data: {
        orderId: args.orderId, studentId: args.studentId,
        directionId: args.directionId, note: args.note?.trim() || null
      },
      select: { id: true }
    });
    await recordAudit(prisma, {
      userId: session.sub, action: 'order_item_added', entity: 'order_item', entityId: item.id,
      after: { orderId: args.orderId, studentId: args.studentId, directionId: args.directionId }
    });
    return { ok: true, item };
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { ok: false, error: 'duplicate_position' };
    throw e;
  }
}

export async function updateItemStatus(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { itemId: string; trainingStatus: TrainingStatus }
): Promise<Result<{ item: { id: string } }>> {
  if (!canEditPositions(session)) return { ok: false, error: 'forbidden' };
  const existing = await prisma.orderItem.findUnique({
    where: { id: args.itemId }, select: { id: true, orderId: true, trainingStatus: true }
  });
  if (!existing) return { ok: false, error: 'not_found' };
  const order = await visibleOrder(prisma, session, existing.orderId);
  if (!order) return { ok: false, error: 'forbidden' };
  await prisma.orderItem.update({
    where: { id: args.itemId }, data: { trainingStatus: args.trainingStatus }
  });
  await recordAudit(prisma, {
    userId: session.sub, action: 'order_item_status_changed', entity: 'order_item', entityId: args.itemId,
    after: { from: existing.trainingStatus, to: args.trainingStatus }
  });
  return { ok: true, item: { id: args.itemId } };
}

export async function removeOrderItem(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { itemId: string }
): Promise<Result<{ removed: true }>> {
  if (!canEditPositions(session)) return { ok: false, error: 'forbidden' };
  const existing = await prisma.orderItem.findUnique({
    where: { id: args.itemId }, select: { id: true, orderId: true }
  });
  if (!existing) return { ok: false, error: 'not_found' };
  const order = await visibleOrder(prisma, session, existing.orderId);
  if (!order) return { ok: false, error: 'forbidden' };
  await prisma.orderItem.delete({ where: { id: args.itemId } });
  await recordAudit(prisma, {
    userId: session.sub, action: 'order_item_removed', entity: 'order_item', entityId: args.itemId
  });
  return { ok: true, removed: true };
}
```

> **Примечание по audit:** проверить фактическую сигнатуру `recordAudit` в `src/lib/auth/audit.ts` (memory: `recordAudit(prisma, { userId, action, entity, entityId, after })`). Если поле называется иначе — выровнять вызовы.

- [ ] **Step 4: Запустить — должен пройти**

Run: `npm run test:unit -- services.training.orderItems`
Expected: PASS (8 тестов).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/services/training/orderItems.ts src/__tests__/services.training.orderItems.test.ts
git commit -m "feat(training): orderItems service (scoped positions, RBAC, dup guard)"
```

---

### Task 6: Сервис удостоверений (`certificates.ts`)

**Files:**
- Create: `src/lib/services/training/certificates.ts`
- Test: `src/__tests__/services.training.certificates.test.ts`

Видимость scoped по `organizationId` удостоверения. Для переиспользования org-scope менеджера берём `managedOrgIds` + `getCompanyTeamVisibility` (как [manager/students.ts](src/lib/services/manager/students.ts)); partner — по своим орг.; organization — по своим memberships.

- [ ] **Step 1: Написать падающий тест**

Создать `src/__tests__/services.training.certificates.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { managedOrgIds } = vi.hoisted(() => ({ managedOrgIds: vi.fn() }));
const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ managedOrgIds, getCompanyTeamVisibility }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { listCertificates, createCertificate, issueFromOrderItem } from '@/lib/services/training/certificates';

function session(role: string, extra: Record<string, unknown> = {}) {
  return { sub: 'u1', role, managerRole: null, companyId: 'c1', ...extra } as any;
}

const prisma = {
  certificate: { findMany: vi.fn(), create: vi.fn() },
  student: { findUnique: vi.fn() },
  orderItem: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn()
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managedOrgIds.mockReturnValue(['org1']);
});

describe('certificates service', () => {
  it('listCertificates менеджера фильтрует по managedOrgIds', async () => {
    prisma.certificate.findMany.mockResolvedValue([{ id: 'cert1' }]);
    const res = await listCertificates(prisma, session('manager'), {});
    expect(res.ok).toBe(true);
    const callArg = prisma.certificate.findMany.mock.calls[0][0];
    expect(JSON.stringify(callArg.where)).toContain('org1');
  });

  it('createCertificate запрещён организации (read-only)', async () => {
    const res = await createCertificate(prisma, session('organization'), {
      studentId: 's1', directionId: 'd1', number: 'N', issuedAt: new Date()
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createCertificate денормализует organizationId из сотрудника', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.certificate.create.mockResolvedValue({ id: 'cert1' });
    const res = await createCertificate(prisma, session('manager'), {
      studentId: 's1', directionId: 'd1', number: 'N', issuedAt: new Date('2026-01-01')
    });
    expect(res.ok).toBe(true);
    expect(prisma.certificate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org1' }) })
    );
  });

  it('createCertificate для сотрудника вне scope → forbidden', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'OTHER' });
    const res = await createCertificate(prisma, session('manager'), {
      studentId: 's1', directionId: 'd1', number: 'N', issuedAt: new Date()
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('issueFromOrderItem создаёт удостоверение и ставит статус certificate_issued', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'it1', directionId: 'd1', student: { id: 's1', organizationId: 'org1' }
    });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.certificate.create.mockResolvedValue({ id: 'cert1' });
    prisma.orderItem.update.mockResolvedValue({ id: 'it1' });
    const res = await issueFromOrderItem(prisma, session('manager'), {
      orderItemId: 'it1', number: 'УД-1', issuedAt: new Date('2026-01-01'), validUntil: new Date('2031-01-01')
    });
    expect(res.ok).toBe(true);
    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'it1' }, data: { trainingStatus: 'certificate_issued' }
    });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- services.training.certificates`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать `certificates.ts`**

```ts
import type { PrismaClient, Prisma, Certificate } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';

export type CertificatesError = 'forbidden' | 'not_found' | 'validation';
type Result<T> = { ok: true } & T | { ok: false; error: CertificatesError };

const CERT_INCLUDE = {
  student: { select: { id: true, name: true } },
  direction: { select: { id: true, name: true } }
} satisfies Prisma.CertificateInclude;

export type CertificateRow = Prisma.CertificateGetPayload<{ include: typeof CERT_INCLUDE }>;

function canEditCertificates(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

/**
 * Множество organizationId, видимых сессии. Возвращает null = «все»
 * (admin/leader-company-wide), либо массив id для scoped-ролей.
 */
async function scopeOrgIds(prisma: PrismaClient, session: SessionPayload): Promise<string[] | null> {
  if (session.role === 'admin') return null;
  if (session.role === 'manager') {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    if (teamMode && session.companyId) {
      const orgs = await prisma.organization.findMany({
        where: { companyId: session.companyId }, select: { id: true }
      });
      return orgs.map((o) => o.id);
    }
    return managedOrgIds(session);
  }
  if (session.role === 'partner') {
    const orgs = await prisma.organization.findMany({
      where: { partnerId: session.partnerId ?? '__none__' }, select: { id: true }
    });
    return orgs.map((o) => o.id);
  }
  if (session.role === 'organization') {
    return (session.organizationMemberships ?? [])
      .filter((m: { isActive: boolean }) => m.isActive)
      .map((m: { organizationId: string }) => m.organizationId);
  }
  return [];
}

export async function listCertificates(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { studentId?: string; expiringWithinDays?: number }
): Promise<Result<{ certificates: CertificateRow[] }>> {
  const orgIds = await scopeOrgIds(prisma, session);
  const where: Prisma.CertificateWhereInput = {};
  if (orgIds !== null) where.organizationId = { in: orgIds };
  if (args.studentId) where.studentId = args.studentId;
  if (args.expiringWithinDays != null) {
    const until = new Date(Date.now() + args.expiringWithinDays * 24 * 60 * 60 * 1000);
    where.validUntil = { not: null, lte: until };
  }
  const certificates = await prisma.certificate.findMany({
    where, include: CERT_INCLUDE, orderBy: { issuedAt: 'desc' }
  });
  return { ok: true, certificates };
}

async function assertStudentInScope(
  prisma: PrismaClient, session: SessionPayload, studentId: string
): Promise<{ organizationId: string } | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId }, select: { organizationId: true }
  });
  if (!student) return null;
  const orgIds = await scopeOrgIds(prisma, session);
  if (orgIds !== null && !orgIds.includes(student.organizationId)) return null;
  return student;
}

export async function createCertificate(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    studentId: string; directionId: string; number: string;
    issuedAt: Date; validUntil?: Date | null; orderItemId?: string | null;
    documentId?: string | null; comment?: string | null;
  }
): Promise<Result<{ certificate: Certificate }>> {
  if (!canEditCertificates(session)) return { ok: false, error: 'forbidden' };
  if (!args.number?.trim()) return { ok: false, error: 'validation' };
  const student = await assertStudentInScope(prisma, session, args.studentId);
  if (!student) return { ok: false, error: 'forbidden' };
  const certificate = await prisma.certificate.create({
    data: {
      studentId: args.studentId, organizationId: student.organizationId,
      directionId: args.directionId, number: args.number.trim(), issuedAt: args.issuedAt,
      validUntil: args.validUntil ?? null, orderItemId: args.orderItemId ?? null,
      documentId: args.documentId ?? null, comment: args.comment?.trim() || null
    }
  });
  await recordAudit(prisma, {
    userId: session.sub, action: 'certificate_created', entity: 'certificate', entityId: certificate.id,
    after: { studentId: args.studentId, number: certificate.number }
  });
  return { ok: true, certificate };
}

export async function issueFromOrderItem(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderItemId: string; number: string; issuedAt: Date; validUntil?: Date | null; documentId?: string | null }
): Promise<Result<{ certificate: Certificate }>> {
  if (!canEditCertificates(session)) return { ok: false, error: 'forbidden' };
  if (!args.number?.trim()) return { ok: false, error: 'validation' };
  const item = await prisma.orderItem.findUnique({
    where: { id: args.orderItemId },
    select: { id: true, directionId: true, student: { select: { id: true, organizationId: true } } }
  });
  if (!item) return { ok: false, error: 'not_found' };
  const orgIds = await scopeOrgIds(prisma, session);
  if (orgIds !== null && !orgIds.includes(item.student.organizationId)) {
    return { ok: false, error: 'forbidden' };
  }
  const certificate = await prisma.$transaction(async (tx) => {
    const cert = await tx.certificate.create({
      data: {
        studentId: item.student.id, organizationId: item.student.organizationId,
        directionId: item.directionId, orderItemId: item.id,
        number: args.number.trim(), issuedAt: args.issuedAt, validUntil: args.validUntil ?? null,
        documentId: args.documentId ?? null
      }
    });
    await tx.orderItem.update({ where: { id: item.id }, data: { trainingStatus: 'certificate_issued' } });
    return cert;
  });
  await recordAudit(prisma, {
    userId: session.sub, action: 'certificate_issued', entity: 'certificate', entityId: certificate.id,
    after: { orderItemId: item.id, number: certificate.number }
  });
  return { ok: true, certificate };
}
```

> **Примечание:** проверить точное имя поля memberships в `SessionPayload` (`organizationMemberships`) по `src/lib/auth/jwt.ts` — выровнять, если отличается.

- [ ] **Step 4: Запустить — должен пройти**

Run: `npm run test:unit -- services.training.certificates`
Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/services/training/certificates.ts src/__tests__/services.training.certificates.test.ts
git commit -m "feat(training): certificates service (scoped CRUD + issueFromOrderItem)"
```

---

### Task 7: Barrel + cross-org integration-инвариант

**Files:**
- Create: `src/lib/services/training/index.ts`
- Test: `src/__tests__/services.training.isolation.integration.test.ts`

- [ ] **Step 1: Создать barrel**

```ts
export * from './directions';
export * from './orderItems';
export * from './certificates';
export * from './expiry';
```

- [ ] **Step 2: Написать integration-инвариант изоляции (живой PG)**

Создать `src/__tests__/services.training.isolation.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listCertificates } from '@/lib/services/training';

const prisma = new PrismaClient();
const ids: Record<string, string> = {};

beforeAll(async () => {
  const dir = await prisma.trainingDirection.create({ data: { name: 'ОТ-iso' } });
  const company = await prisma.company.create({ data: { name: 'iso-co' } });
  const orgA = await prisma.organization.create({ data: { name: 'orgA', companyId: company.id } });
  const orgB = await prisma.organization.create({ data: { name: 'orgB', companyId: company.id } });
  const stA = await prisma.student.create({ data: { name: 'A', email: 'a@iso.ru', organizationId: orgA.id } });
  const stB = await prisma.student.create({ data: { name: 'B', email: 'b@iso.ru', organizationId: orgB.id } });
  await prisma.certificate.create({ data: { studentId: stA.id, organizationId: orgA.id, directionId: dir.id, number: 'A1', issuedAt: new Date() } });
  await prisma.certificate.create({ data: { studentId: stB.id, organizationId: orgB.id, directionId: dir.id, number: 'B1', issuedAt: new Date() } });
  Object.assign(ids, { dir: dir.id, company: company.id, orgA: orgA.id, orgB: orgB.id, stA: stA.id, stB: stB.id });
});

afterAll(async () => {
  await prisma.certificate.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
  await prisma.student.deleteMany({ where: { id: { in: [ids.stA, ids.stB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.trainingDirection.delete({ where: { id: ids.dir } });
  await prisma.$disconnect();
});

describe('training cross-org isolation', () => {
  it('менеджер orgA не видит удостоверения orgB', async () => {
    const session = { sub: 'm1', role: 'manager', managerRole: null, companyId: ids.company,
      managedOrgIds: [ids.orgA] } as any;
    const res = await listCertificates(prisma, session, {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      const orgs = new Set(res.certificates.map((c) => c.organizationId));
      expect(orgs.has(ids.orgB)).toBe(false);
      expect(orgs.has(ids.orgA)).toBe(true);
    }
  });
});
```

> **Примечание:** форма `session.managedOrgIds` должна совпадать с тем, что читает `managedOrgIds(session)` в `managerPolicy.ts` — свериться и при необходимости поправить fixture-сессию.

- [ ] **Step 3: Запустить тест изоляции**

Run: `npm run test:integration -- services.training.isolation`
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add src/lib/services/training/index.ts src/__tests__/services.training.isolation.integration.test.ts
git commit -m "feat(training): barrel + cross-org isolation integration invariant"
```

---

## Фаза 4 — Воркер: напоминания о сроке

### Task 8: Очередь + расписание + NotificationType

**Files:**
- Modify: `src/lib/jobs/queues.ts`, `src/lib/jobs/scheduling.ts`, `prisma/schema.prisma`
- Test: `src/__tests__/jobs.certExpiryScheduling.test.ts`

- [ ] **Step 1: Написать падающий тест расписания**

Создать `src/__tests__/jobs.certExpiryScheduling.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { CERT_EXPIRY_SCHEDULES, registerCertExpirySchedules } from '@/lib/jobs/scheduling';

describe('cert expiry schedule', () => {
  it('зарегистрировано ежедневное расписание', () => {
    expect(CERT_EXPIRY_SCHEDULES).toHaveLength(1);
    expect(CERT_EXPIRY_SCHEDULES[0].pattern).toBe('0 7 * * *');
    expect(CERT_EXPIRY_SCHEDULES[0].queueName).toBe('notifications.certificateExpiry');
  });

  it('registerCertExpirySchedules вызывает upsertJobScheduler', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockReturnValue({ upsertJobScheduler: upsert });
    const res = await registerCertExpirySchedules(getQueue as any);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(res[0].schedulerId).toBe('notifications.certificateExpiry.cron');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- jobs.certExpiryScheduling`
Expected: FAIL — `CERT_EXPIRY_SCHEDULES` не экспортируется.

- [ ] **Step 3: Добавить очередь в `queues.ts`**

В массив `QUEUE_NAMES` добавить строку после `'monitoring.evaluateAlerts'`:

```ts
  'monitoring.evaluateAlerts',
  'notifications.certificateExpiry'
```

- [ ] **Step 4: Добавить расписание в `scheduling.ts`**

В конец файла:

```ts
export type CertExpirySchedule = {
  queueName: Extract<QueueName, 'notifications.certificateExpiry'>;
  schedulerId: string;
  pattern: string;
  tz: string;
};

export const CERT_EXPIRY_SCHEDULES: ReadonlyArray<CertExpirySchedule> = [
  {
    queueName: 'notifications.certificateExpiry',
    schedulerId: 'notifications.certificateExpiry.cron',
    pattern: '0 7 * * *',
    tz: DEFAULT_SYNC_TZ
  }
] as const;

export async function registerCertExpirySchedules(
  getQueueFn: GetQueueFn = getQueue
): Promise<Array<{ schedulerId: string; queueName: string; pattern: string; tz: string }>> {
  const results = [];
  const triggeredAt = new Date().toISOString();
  for (const schedule of CERT_EXPIRY_SCHEDULES) {
    const queue = getQueueFn(schedule.queueName);
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { pattern: schedule.pattern, tz: schedule.tz },
      { data: { triggeredAt, reason: 'cron' } }
    );
    results.push({
      schedulerId: schedule.schedulerId, queueName: schedule.queueName,
      pattern: schedule.pattern, tz: schedule.tz
    });
  }
  return results;
}
```

- [ ] **Step 5: Добавить `certificate_expiring` в enum `NotificationType`**

В `prisma/schema.prisma`, в `enum NotificationType`, добавить строку:

```prisma
  certificate_expiring
```

Сгенерировать клиент: `npm run prisma:generate`. (Enum `NotificationType` справочный; `Notification.type` — String, поэтому миграция БД не обязательна, но прогнать `prisma generate` нужно для типов. Если schema.enums.test.ts проверяет значения enum — он подхватит новое.)

- [ ] **Step 6: Запустить — должен пройти**

Run: `npm run test:unit -- jobs.certExpiryScheduling`
Expected: PASS (2 теста).

- [ ] **Step 7: Коммит**

```bash
git add src/lib/jobs/queues.ts src/lib/jobs/scheduling.ts prisma/schema.prisma
git commit -m "feat(training): certificateExpiry queue + daily schedule + notification type"
```

---

### Task 9: Процессор напоминаний + регистрация в воркере

**Files:**
- Create: `src/worker/processors/certificate-expiry.ts`
- Modify: `src/worker/index.ts`
- Test: `src/__tests__/worker.certificate-expiry.test.ts` (integration)

- [ ] **Step 1: Написать падающий integration-тест (живой PG)**

Создать `src/__tests__/worker.certificate-expiry.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn().mockResolvedValue({}) }));
const { triggerNotificationEmail } = vi.hoisted(() => ({ triggerNotificationEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification, triggerNotificationEmail }));

import { runCertificateExpiry } from '@/worker/processors/certificate-expiry';

const prisma = new PrismaClient();
const ids: Record<string, string> = {};

beforeAll(async () => {
  const dir = await prisma.trainingDirection.create({ data: { name: 'exp-dir' } });
  const company = await prisma.company.create({ data: { name: 'exp-co' } });
  const org = await prisma.organization.create({ data: { name: 'exp-org', companyId: company.id } });
  const orgUser = await prisma.user.create({
    data: { email: 'orguser@exp.ru', name: 'OrgU', role: 'organization', organizationId: org.id }
  });
  const student = await prisma.student.create({ data: { name: 'S', email: 's@exp.ru', organizationId: org.id } });
  // validUntil через 7 дней → порог 7
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const cert = await prisma.certificate.create({
    data: { studentId: student.id, organizationId: org.id, directionId: dir.id, number: 'EXP-1', issuedAt: new Date(), validUntil }
  });
  Object.assign(ids, { dir: dir.id, company: company.id, org: org.id, orgUser: orgUser.id, student: student.id, cert: cert.id });
});

afterAll(async () => {
  await prisma.certificateReminder.deleteMany({ where: { certificateId: ids.cert } });
  await prisma.certificate.delete({ where: { id: ids.cert } });
  await prisma.student.delete({ where: { id: ids.student } });
  await prisma.user.delete({ where: { id: ids.orgUser } });
  await prisma.organization.delete({ where: { id: ids.org } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.trainingDirection.delete({ where: { id: ids.dir } });
  await prisma.$disconnect();
});

describe('certificate-expiry processor', () => {
  it('создаёт напоминание и не дублирует на повторном прогоне', async () => {
    const first = await runCertificateExpiry(prisma, new Date());
    expect(first.remindersSent).toBeGreaterThanOrEqual(1);
    expect(createNotification).toHaveBeenCalled();

    const reminders = await prisma.certificateReminder.findMany({ where: { certificateId: ids.cert } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].thresholdDays).toBe(7);

    createNotification.mockClear();
    const second = await runCertificateExpiry(prisma, new Date());
    expect(second.remindersSent).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:integration -- worker.certificate-expiry`
Expected: FAIL — модуль `certificate-expiry` не найден.

- [ ] **Step 3: Реализовать процессор `certificate-expiry.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { selectDueReminders, REMINDER_THRESHOLDS } from '@/lib/services/training/expiry';
import { createNotification, triggerNotificationEmail } from '@/lib/notifications';

/**
 * Собирает получателей напоминания (§12): пользователи организации → партнёр
 * (если организация привязана к партнёру) → ответственный менеджер активных
 * заказов организации → руководители компании. Возвращает уникальные userId.
 */
async function recipientsForOrg(prisma: PrismaClient, organizationId: string): Promise<string[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      partnerId: true,
      companyId: true,
      users: { where: { isActive: true }, select: { id: true } },
      partner: { select: { users: { where: { isActive: true }, select: { id: true } } } }
    }
  });
  if (!org) return [];
  const ids = new Set<string>();
  org.users.forEach((u) => ids.add(u.id));
  org.partner?.users.forEach((u) => ids.add(u.id));
  // ответственные менеджеры заказов организации
  const orders = await prisma.order.findMany({
    where: { organizationId, managerId: { not: null } }, select: { managerId: true }
  });
  orders.forEach((o) => o.managerId && ids.add(o.managerId));
  // руководители компании
  if (org.companyId) {
    const leaders = await prisma.user.findMany({
      where: { companyId: org.companyId, role: 'manager', managerRole: 'leader', isActive: true },
      select: { id: true }
    });
    leaders.forEach((l) => ids.add(l.id));
  }
  return [...ids];
}

export async function runCertificateExpiry(
  prisma: PrismaClient,
  today: Date
): Promise<{ remindersSent: number }> {
  const maxThreshold = Math.max(...REMINDER_THRESHOLDS);
  const horizon = new Date(today.getTime() + maxThreshold * 24 * 60 * 60 * 1000);
  const certs = await prisma.certificate.findMany({
    where: { validUntil: { not: null, gte: today, lte: horizon } },
    select: {
      id: true, organizationId: true, validUntil: true, number: true,
      student: { select: { name: true } },
      reminders: { select: { thresholdDays: true } }
    }
  });

  const due = selectDueReminders(
    certs.map((c) => ({ id: c.id, validUntil: c.validUntil, sentThresholds: c.reminders.map((r) => r.thresholdDays) })),
    today
  );

  let remindersSent = 0;
  for (const d of due) {
    const cert = certs.find((c) => c.id === d.certificateId);
    if (!cert) continue;
    // idempotent: уникальный (certificateId, thresholdDays); конкурентный прогон поймает P2002
    try {
      await prisma.certificateReminder.create({
        data: { certificateId: cert.id, thresholdDays: d.thresholdDays }
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue;
      throw e;
    }
    const recipients = await recipientsForOrg(prisma, cert.organizationId);
    const title = 'Истекает срок удостоверения';
    const body = `Удостоверение № ${cert.number} (${cert.student.name}) истекает через ${d.thresholdDays} дн.`;
    for (const userId of recipients) {
      await createNotification({ userId, type: 'certificate_expiring', title, body, meta: { certificateId: cert.id, thresholdDays: d.thresholdDays } });
      await triggerNotificationEmail({ userId, title, body, type: 'certificate_expiring' });
    }
    remindersSent += 1;
  }
  return { remindersSent };
}

/** BullMQ-обёртка: вызывается воркером по расписанию. */
export async function certificateExpiryProcessor(_job: Job): Promise<{ remindersSent: number }> {
  const { prisma } = await import('@/lib/db/prisma');
  return runCertificateExpiry(prisma, new Date());
}
```

> **Примечание:** свериться, что `@/lib/notifications` реэкспортирует `createNotification` и `triggerNotificationEmail` (см. [notifications/core.ts](src/lib/notifications/core.ts) + barrel index). Если `triggerNotificationEmail` не в barrel — добавить реэкспорт в `src/lib/notifications/index.ts` или импортировать из `@/lib/notifications/core`.

- [ ] **Step 4: Зарегистрировать воркер в `src/worker/index.ts`**

Найти, где регистрируются другие Worker'ы (по `new Worker(` / `registerAlertSchedules`). Добавить:
1. import: `import { certificateExpiryProcessor } from './processors/certificate-expiry';`
2. import: `import { registerCertExpirySchedules } from '@/lib/jobs/scheduling';`
3. рядом с `registerAlertSchedules(...)` вызвать `await registerCertExpirySchedules();`
4. рядом с другими `new Worker('monitoring.evaluateAlerts', ...)` добавить:

```ts
new Worker('notifications.certificateExpiry', certificateExpiryProcessor, {
  connection: getRedisConnection()
});
```
(использовать тот же способ получения connection, что у соседних Worker'ов в файле.)

- [ ] **Step 5: Запустить integration-тест — должен пройти**

Run: `npm run test:integration -- worker.certificate-expiry`
Expected: PASS — первый прогон создаёт 1 reminder (порог 7), повторный — 0.

- [ ] **Step 6: Проверить processor-coverage guardrail**

Run: `npm run test:unit -- worker.processor-coverage.guardrail`
Expected: PASS — тест `worker.certificate-expiry.test.ts` содержит подстроку `worker/processors/certificate-expiry`, поэтому новый процессор покрыт.

- [ ] **Step 7: Коммит**

```bash
git add src/worker/processors/certificate-expiry.ts src/worker/index.ts src/__tests__/worker.certificate-expiry.test.ts
git commit -m "feat(training): certificate-expiry processor + worker registration (90/60/30/7 fan-out)"
```

---

## Фаза 5 — UI (русский, sibling-паттерн §4, примитивы ui/)

> Для всех UI-задач: смотреть соседние файлы для точных импортов/паттернов
> (`src/components/manager/manager-order-detail-view.tsx`, `src/components/ui/*`,
> Dialog-контракт CLAUDE.md §9). Не инлайнить brand-hex (§13).

### Task 10: API-роуты позиций и удостоверений (manager)

**Files:**
- Create: `src/app/api/manager/orders/[id]/items/route.ts` (GET список, POST добавить)
- Create: `src/app/api/manager/order-items/[id]/route.ts` (PATCH статус, DELETE)
- Create: `src/app/api/manager/certificates/route.ts` (POST создать / issueFromOrderItem)
- Test: `src/__tests__/api.manager.orderItems.test.ts`

Роуты — тонкие (CLAUDE.md §3): `requireManager` → вызов сервиса → мап кода в HTTP (`forbidden`→403, `not_found`→404, `duplicate_position`→409, `direction_inactive`/`student_mismatch`/`validation`→400).

- [ ] **Step 1: Написать падающий тест роута (mock сервиса)**

Создать `src/__tests__/api.manager.orderItems.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { addOrderItem, listOrderItems } = vi.hoisted(() => ({
  addOrderItem: vi.fn(), listOrderItems: vi.fn()
}));
const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ addOrderItem, listOrderItems }));
vi.mock('@/lib/auth/requireManager', () => ({ requireManager }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/manager/orders/[id]/items/route';

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue({ sub: 'u1', role: 'manager' });
});

describe('POST /api/manager/orders/[id]/items', () => {
  it('409 на дубль позиции', async () => {
    addOrderItem.mockResolvedValue({ ok: false, error: 'duplicate_position' });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ studentId: 's1', directionId: 'd1' }) });
    const res = await POST(req as any, { params: Promise.resolve({ id: 'o1' }) } as any);
    expect(res.status).toBe(409);
  });

  it('201 при успехе', async () => {
    addOrderItem.mockResolvedValue({ ok: true, item: { id: 'it1' } });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ studentId: 's1', directionId: 'd1' }) });
    const res = await POST(req as any, { params: Promise.resolve({ id: 'o1' }) } as any);
    expect(res.status).toBe(201);
  });
});
```

> Проверить фактический путь/имя `requireManager` (memory: `src/lib/auth/`). Выровнять mock-путь и сигнатуру (часть guard'ов читает cookie/Request — посмотреть соседний роут `src/app/api/manager/documents/[id]/upload/route.ts` как эталон тонкого роута).

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- api.manager.orderItems`
Expected: FAIL — роут не существует.

- [ ] **Step 3: Реализовать роуты**

`src/app/api/manager/orders/[id]/items/route.ts` (по образцу соседнего тонкого роута — взять оттуда способ получения сессии/prisma и хелпер ошибок):

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireManager';
import { listOrderItems, addOrderItem } from '@/lib/services/training';

function mapError(error: string): number {
  switch (error) {
    case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'duplicate_position': return 409;
    default: return 400; // direction_inactive | student_mismatch | validation
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireManager();
  const { id } = await ctx.params;
  const res = await listOrderItems(prisma, session, { orderId: id });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ items: res.items });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireManager();
  const { id } = await ctx.params;
  const body = await req.json();
  const res = await addOrderItem(prisma, session, {
    orderId: id, studentId: body.studentId, directionId: body.directionId, note: body.note
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ item: res.item }, { status: 201 });
}
```

`src/app/api/manager/order-items/[id]/route.ts` — PATCH (updateItemStatus) и DELETE (removeOrderItem), по тому же шаблону мапа ошибок.

`src/app/api/manager/certificates/route.ts` — POST: если в теле есть `orderItemId` → `issueFromOrderItem`, иначе `createCertificate`. Тот же мап ошибок.

> Если в проекте `requireManager` принимает аргумент (Request/cookies) — выровнять по эталонному роуту. Цель — нулевая бизнес-логика в роуте.

- [ ] **Step 4: Запустить — должен пройти**

Run: `npm run test:unit -- api.manager.orderItems`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/app/api/manager/orders src/app/api/manager/order-items src/app/api/manager/certificates src/__tests__/api.manager.orderItems.test.ts
git commit -m "feat(training): thin manager API routes for positions & certificates"
```

---

### Task 11: Секция «Слушатели» в карточке заказа менеджера

**Files:**
- Create: `src/components/training/order-items-section.tsx` (client)
- Create: `src/components/training/add-position-dialog.tsx` (client, Dialog)
- Modify: `src/lib/services/manager/orderDetail.ts` (подмешать `items` в загрузку)
- Modify: `src/app/manager/orders/[id]/page.tsx` (или соответствующий view) — отрендерить секцию
- Test: `src/__tests__/components.order-items-section.test.tsx`

- [ ] **Step 1: Расширить `loadManagerOrderDetail` позициями**

В [orderDetail.ts](src/lib/services/manager/orderDetail.ts) добавить в `Promise.all` загрузку позиций и вернуть их в `ManagerOrderDetailData`:

```ts
// в тип ManagerOrderDetailData добавить:  items: OrderItemRow[]
// импорт: import { listOrderItems, type OrderItemRow } from '@/lib/services/training';
// внутри функции, после getOrder:
const itemsRes = await listOrderItems(prisma, session, { orderId: id });
const items = itemsRes.ok ? itemsRes.items : [];
// добавить items в возвращаемый объект
```

- [ ] **Step 2: Написать падающий компонентный тест**

Создать `src/__tests__/components.order-items-section.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { OrderItemsSection } from '@/components/training/order-items-section';

describe('OrderItemsSection', () => {
  it('рендерит слушателей с направлением и статусом', () => {
    const html = renderToString(
      <OrderItemsSection
        orderId="o1"
        canEdit={false}
        items={[{ id: 'it1', trainingStatus: 'in_progress',
          student: { id: 's1', name: 'Иванов', email: 'i@o.ru' },
          direction: { id: 'd1', name: 'Охрана труда' },
          certificate: null } as any]}
        directions={[]}
        students={[]}
      />
    );
    expect(html).toContain('Иванов');
    expect(html).toContain('Охрана труда');
    expect(html).toContain('Обучается');
  });

  it('без прав не показывает кнопку добавления', () => {
    const html = renderToString(
      <OrderItemsSection orderId="o1" canEdit={false} items={[]} directions={[]} students={[]} />
    );
    expect(html).not.toContain('Добавить слушателя');
  });
});
```

(memory: vitest без react-plugin → `import React` обязателен.)

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `npm run test:unit -- components.order-items-section`
Expected: FAIL — компонент не найден.

- [ ] **Step 4: Реализовать компоненты**

`src/components/training/order-items-section.tsx` — `'use client'`; таблица позиций через `ui/Table`; маппинг `trainingStatus`→рус-лейбл (`pending`→«Ожидает», `in_progress`→«Обучается», `certificate_issued`→«Удостоверение выдано», `cancelled`→«Отменено»); если `canEdit` — кнопка «Добавить слушателя», открывающая `AddPositionDialog`; на каждой строке для `canEdit` — селект смены статуса (PATCH `/api/manager/order-items/[id]`) и кнопка «Выдать удостоверение» (POST `/api/manager/certificates` с `orderItemId`). Бейдж удостоверения через `ui/Badge`.

`src/components/training/add-position-dialog.tsx` — `Dialog` (CLAUDE.md §9), форма выбор `Student` (из `students` пропа = ростер организации заказа) + `TrainingDirection` (из `directions`); сабмит POST `/api/manager/orders/[id]/items`; ошибки через `errorMessageRu` + `dialog error` регион; success → `toast` + закрытие + refresh.

Рус-лейблы статусов вынести в чистый хелпер (для теста и переиспользования):

```ts
// в order-items-section.tsx
export const TRAINING_STATUS_RU: Record<string, string> = {
  pending: 'Ожидает', in_progress: 'Обучается',
  certificate_issued: 'Удостоверение выдано', cancelled: 'Отменено'
};
```

- [ ] **Step 5: Подключить секцию на странице заказа**

В `src/app/manager/orders/[id]/page.tsx` (серверный компонент) передать в view `items`, `canEdit` (role manager/admin/leader → true) и для модалки — список направлений (`listDirections`) и ростер сотрудников организации (`prisma.student.findMany` по `order.organizationId`). Отрендерить `<OrderItemsSection .../>` в теле карточки.

- [ ] **Step 6: Запустить — должен пройти**

Run: `npm run test:unit -- components.order-items-section`
Expected: PASS.

- [ ] **Step 7: typecheck + коммит**

```bash
npm run typecheck
git add src/components/training src/lib/services/manager/orderDetail.ts src/app/manager/orders src/__tests__/components.order-items-section.test.tsx
git commit -m "feat(training): learners section in manager order detail (add/status/issue)"
```

---

### Task 12: Read-only позиции в кабинетах org/partner

**Files:**
- Modify: org order detail read path (`src/lib/services/organization/orders.ts` или org orderDetail) + partner `dealDetail.ts`
- Modify: соответствующие view-компоненты org/partner карточки заказа
- Test: расширить существующие unit-тесты org/partner deal detail (проверить, что `items` присутствуют и read-only)

- [ ] **Step 1: Подмешать позиции в org/partner read-пути**

В org-детали заказа и `src/lib/services/partner/dealDetail.ts` добавить загрузку `listOrderItems(prisma, session, { orderId })` (scoped — вернёт `forbidden` если не виден, тогда `[]`). Прокинуть `items` в DTO. Переиспользовать `OrderItemsSection` с `canEdit={false}`.

- [ ] **Step 2: Написать/расширить тест видимости (read-only)**

В существующий `src/__tests__/services.partner.dealDetail.unit.test.ts` (или новый `services.organization.orderItems.test.ts`) добавить кейс: для видимого заказа `items` возвращаются; компонент рендерится без кнопок редактирования (`canEdit=false` уже покрыт Task 11 step 2 — здесь проверяем проброс данных).

```ts
it('partner deal detail включает позиции read-only', async () => {
  // setup: order с одной позицией виден партнёру
  // expect: dto.items.length === 1
});
```

- [ ] **Step 3: Запустить тесты**

Run: `npm run test:unit -- dealDetail`
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add src/lib/services/organization src/lib/services/partner/dealDetail.ts src/components src/__tests__
git commit -m "feat(training): read-only learners section in org/partner order detail"
```

---

### Task 13: Карточки удостоверений сотрудника + бейдж срока

**Files:**
- Create: `src/components/training/certificate-list.tsx` (client)
- Create: `src/components/training/certificate-badge.tsx` (бейдж срока, чистый)
- Modify: страница сотрудника менеджера (`src/app/manager/students/[id]/page.tsx` — создать, если её нет; иначе встроить в существующий список)
- Test: `src/__tests__/components.certificate-badge.test.tsx`

- [ ] **Step 1: Написать падающий тест бейджа**

Создать `src/__tests__/components.certificate-badge.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CertificateBadge, expiryLabel } from '@/components/training/certificate-badge';

const today = new Date('2026-06-23T00:00:00.000Z');

describe('certificate expiry badge', () => {
  it('бессрочное — без срока', () => {
    expect(expiryLabel(null, today)).toBe('Бессрочно');
  });
  it('истекает через N дней', () => {
    expect(expiryLabel(new Date('2026-07-23T00:00:00.000Z'), today)).toBe('Истекает через 30 дн.');
  });
  it('просрочено', () => {
    expect(expiryLabel(new Date('2026-06-01T00:00:00.000Z'), today)).toBe('Просрочено');
  });
  it('рендерится', () => {
    const html = renderToString(<CertificateBadge validUntil={null} today={today} />);
    expect(html).toContain('Бессрочно');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- components.certificate-badge`
Expected: FAIL.

- [ ] **Step 3: Реализовать бейдж + список**

`src/components/training/certificate-badge.tsx`:

```tsx
import React from 'react';
import { Badge } from '@/components/ui';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function expiryLabel(validUntil: Date | null, today: Date): string {
  if (!validUntil) return 'Бессрочно';
  const days = Math.ceil((validUntil.getTime() - today.getTime()) / MS_PER_DAY);
  if (days < 0) return 'Просрочено';
  return `Истекает через ${days} дн.`;
}

export function CertificateBadge({ validUntil, today }: { validUntil: Date | null; today: Date }) {
  const label = expiryLabel(validUntil, today);
  const tone = label === 'Просрочено' ? 'danger' : label.startsWith('Истекает') ? 'warning' : 'neutral';
  return <Badge tone={tone as never}>{label}</Badge>;
}
```

> Свериться с фактическим API `Badge` (доступные `tone`/variant) в `src/components/ui/badge.tsx` и подставить корректные значения.

`src/components/training/certificate-list.tsx` — `'use client'`; таблица удостоверений (№ · направление · выдано · `<CertificateBadge/>`); если есть права — кнопка «Добавить удостоверение» (Dialog с полями number/issuedAt/validUntil/direction).

- [ ] **Step 4: Встроить на страницу сотрудника**

На странице сотрудника менеджера загрузить `listCertificates(prisma, session, { studentId })` и отрендерить `<CertificateList/>`.

- [ ] **Step 5: Запустить — должен пройти**

Run: `npm run test:unit -- components.certificate-badge`
Expected: PASS (4 теста).

- [ ] **Step 6: typecheck + коммит**

```bash
npm run typecheck
git add src/components/training/certificate-list.tsx src/components/training/certificate-badge.tsx src/app/manager/students src/__tests__/components.certificate-badge.test.tsx
git commit -m "feat(training): certificate cards + expiry badge on employee page"
```

---

### Task 14: Страница справочника направлений (admin/leader)

**Files:**
- Create: `src/app/admin/training-directions/page.tsx` (server)
- Create: `src/components/training/directions-admin.tsx` (client)
- Create: `src/app/api/admin/training-directions/route.ts` (GET/POST) + `[id]/route.ts` (PATCH/deactivate)
- Modify: admin-навигация (`src/lib/navigation/*` или admin sidebar) — пункт «Направления обучения»
- Test: `src/__tests__/api.admin.trainingDirections.test.ts`

- [ ] **Step 1: Написать падающий тест роута**

Создать `src/__tests__/api.admin.trainingDirections.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createDirection, listDirections } = vi.hoisted(() => ({
  createDirection: vi.fn(), listDirections: vi.fn()
}));
const { requireRole } = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ createDirection, listDirections }));
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/admin/training-directions/route';

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ sub: 'a1', role: 'admin' });
});

describe('POST /api/admin/training-directions', () => {
  it('403 если сервис вернул forbidden', async () => {
    createDirection.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'X' }) });
    const res = await POST(req as any);
    expect(res.status).toBe(403);
  });
  it('201 при успехе', async () => {
    createDirection.mockResolvedValue({ ok: true, direction: { id: 'd1', name: 'X' } });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'X' }) });
    const res = await POST(req as any);
    expect(res.status).toBe(201);
  });
});
```

> Свериться с фактическим guard'ом для admin-зоны (`requireRole('admin')` или аналог); admin/leader — оба должны проходить мутации (сервис сам проверяет `canManageSettings`, роут пускает admin+manager-leader). Выровнять mock-путь.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- api.admin.trainingDirections`
Expected: FAIL.

- [ ] **Step 3: Реализовать роуты + страницу + клиент**

Роут `route.ts`: GET → `listDirections(includeInactive:true)`, POST → `createDirection`; мап `forbidden`→403, `validation`→400, успех POST→201. `[id]/route.ts`: PATCH → `updateDirection`, DELETE → `deactivateDirection`.

Страница `page.tsx` (server): guard admin/leader, `listDirections`, рендер `<DirectionsAdmin/>`.

`directions-admin.tsx` (client): таблица направлений (название · порядок · активно), форма добавления (Dialog или инлайн), кнопки «Деактивировать». Только примитивы `ui/`.

Добавить пункт навигации «Направления обучения» в admin-меню (найти источник nav для admin — по аналогии с другими пунктами `/admin/*`).

- [ ] **Step 4: Запустить — должен пройти**

Run: `npm run test:unit -- api.admin.trainingDirections`
Expected: PASS.

- [ ] **Step 5: typecheck + коммит**

```bash
npm run typecheck
git add src/app/admin/training-directions src/components/training/directions-admin.tsx src/app/api/admin/training-directions src/lib/navigation src/__tests__/api.admin.trainingDirections.test.ts
git commit -m "feat(training): admin/leader training directions reference page"
```

---

## Фаза 6 — Финальная верификация

### Task 15: Прогон гейтов + close-out

**Files:**
- Create: `docs/superpowers/plans/2026-06-23-order-positions-certificates-DONE.md`

- [ ] **Step 1: Типы и линт**

Run: `npm run typecheck && npm run lint`
Expected: оба зелёные.

- [ ] **Step 2: Весь unit-слой**

Run: `npm run test:unit`
Expected: PASS (включая новые training-тесты и processor-coverage guardrail).

- [ ] **Step 3: Integration-слой (живой PG)**

Run: `npm run test:integration`
Expected: PASS — `schema.training`, `services.training.isolation`, `worker.certificate-expiry` зелёные.
(На этой машине — путь WSL/native PG из memory; Docker-гейт может падать headless — допустим `git push --no-verify` после ручного прогона интеграции.)

- [ ] **Step 4: Сборка**

Run: `npm run build`
Expected: успех (нет slug-конфликтов маршрутов; см. CLAUDE.md §11 про `[id]`-сегменты — у нас новые роуты не конфликтуют).

- [ ] **Step 5: Smoke вручную (опционально, оператор)**

`npm run dev` + `npm run worker:dev`: добавить слушателя в заказ, сменить статус, выдать удостоверение с `validUntil`, проверить бейдж; создать удостоверение с `validUntil` через 7 дней и вручную дёрнуть процессор (или дождаться cron) → проверить уведомление в ЛК.

- [ ] **Step 6: Close-out**

Создать `docs/superpowers/plans/2026-06-23-order-positions-certificates-DONE.md`: что отгружено vs план, какие гейты прошли, остаток (Telegram-канал, настраиваемые статусы обучения, 6-стадийный рабочий статус — как отдельные пробелы).

- [ ] **Step 7: Финальный коммит**

```bash
git add docs/superpowers/plans/2026-06-23-order-positions-certificates-DONE.md
git commit -m "docs(training): close-out for positions+certificates plan"
```

---

## Self-review (покрытие spec)

- §3.1 модели (TrainingDirection/OrderItem/Certificate/CertificateReminder/TrainingStatus) → Task 1 ✓
- §3.2 alter Student/Order/Organization → Task 1 ✓
- §3.3 миграция + pre-check дублей → Task 1 step 4 ✓
- §4 сервисы (directions/orderItems/certificates/expiry) → Tasks 3–7 ✓
- §5 воркер (очередь/расписание/процессор/guardrail/NotificationType) → Tasks 8–9 ✓
- §6 UI (секция слушателей / удостоверения / справочник) → Tasks 11–14 ✓
- §7 RBAC defense-in-depth (scoped через getOrder/scopeOrgIds + роут-guards) → Tasks 5,6,10,11,14 ✓
- §8 тесты (unit expiry/scope, integration isolation + dedup, guardrail) → Tasks 3,5,6,7,9 ✓
- §10 критерии приёмки 1–5 → Tasks 5 (дубль), 6 (issue), 9 (dedup напоминаний), 7 (изоляция), 4 (deactivate) ✓
- §9 вне объёма (Telegram/статусы/6-стадий) → зафиксировано в close-out Task 15 ✓
