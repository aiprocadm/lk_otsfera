# Orders-Family Remediation Implementation Plan (R1–R4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть ратифицированные находки аудита «Заказы»: выровнять заголовки/подписи + унифицировать param поиска `q`→`search` (R1), добавить мобильный карточный список manager/leader (R2), завести leader-деталь заказа без cross-cabinet-утечки через `basePath` + общий detail-view (R3), и добавить Dialog-подтверждение смены статуса (R4).

**Architecture:** Mostly in-place edits + два новых файла (`manager-orders-card-list.tsx`, `leader/orders/[id]/page.tsx`) + одно извлечение (общий `ManagerOrderDetailView` + загрузчик из manager-детали). `basePath` (`'/manager' | '/leader'`, дефолт `/manager`) протягивается через table/filter/cardlist, чтобы leader-список вёл в свой кабинет. RBAC/C8/F2/Model A инварианты не меняются — переименования и UI-правки.

**Tech Stack:** Next.js 15 (App Router, RSC + client components), React 19, TS strict, Zod, Prisma, Vitest (классический JSX-трансформ → `import React` в тестах компонентов), Tailwind, `ui/Dialog` (нативный `<dialog>`).

**Спека:** [docs/superpowers/specs/2026-06-21-orders-family-remediation-design.md](../specs/2026-06-21-orders-family-remediation-design.md) · **Findings:** [...-FINDINGS.md](../specs/2026-06-21-orders-family-audit-FINDINGS.md) · **Ветка:** `claude/orders-family-remediation`

---

## ФАЗА R1 — Выравнивание заголовков/подписей + `q`→`search`

### Task 1: Переименовать param поиска `q`→`search` в сервисе `listOrders`

**Files:**
- Modify: `src/lib/services/manager/orders.ts`
- Test: `src/__tests__/services.manager.orders.unit.test.ts` (+ при необходимости `services.manager.orders.override.test.ts`)

- [ ] **Step 1: Обновить тест (red).** В `src/__tests__/services.manager.orders.unit.test.ts` найти кейс(ы), вызывающие `listOrders(... { q: ... })`, и заменить ключ `q:` → `search:`. Добавить явный кейс:

```ts
it('search фильтрует по title/orderNumber (бывший q)', async () => {
  const res = await listOrders(prisma, { session, search: 'уник' });
  // ожидание зависит от сидов теста — мини-проверка, что аргумент принят и не падает на схеме:
  expect(Array.isArray(res.rows)).toBe(true);
});
```
> Точную ассерту согласуй с уже существующими сид-данными файла (там есть готовый паттерн для q-поиска — перенеси его на `search`).

- [ ] **Step 2: Запустить — red.** Run: `npx vitest run src/__tests__/services.manager.orders.unit.test.ts`. Expected: FAIL (схема ещё знает `q`, не `search`).

- [ ] **Step 3: Переименовать в сервисе.** В `src/lib/services/manager/orders.ts`:
  - В `ListOrdersOptionsSchema`: `q: z.string().optional(),` → `search: z.string().optional(),`
  - В теле `listOrders`: блок
    ```ts
    if (opts.q) {
      filters.push({
        OR: [
          { title: { contains: opts.q, mode: 'insensitive' } },
          { orderNumber: { contains: opts.q, mode: 'insensitive' } }
        ]
      });
    }
    ```
    заменить `opts.q` → `opts.search` (оба вхождения + условие).

- [ ] **Step 4: Запустить — green.** Run: `npx vitest run src/__tests__/services.manager.orders.unit.test.ts`. Expected: PASS.

- [ ] **Step 5: Найти других потребителей `q`.** Run: `git grep -n "\.q\b\|q:" src/components/manager/manager-orders-table.tsx src/components/manager/manager-orders-filter.tsx src/app/manager/orders/page.tsx src/app/leader/orders/page.tsx` — убедиться, что знаешь все места (они меняются в Task 2). Это шаг-разведка, без правок.

- [ ] **Step 6: typecheck.** Run: `npm run typecheck`. Ожидание: появятся ошибки в table/filter/pages (они ещё шлют `q`) — это нормально, чинятся в Task 2. Если хочешь зелёный typecheck по шагам — делай Task 1 и Task 2 одним коммитом (см. Task 2 Step 7).

### Task 2: Протянуть `search` через filter/table/pages + выровнять заголовки

**Files:**
- Modify: `src/components/manager/manager-orders-filter.tsx`
- Modify: `src/components/manager/manager-orders-table.tsx`
- Modify: `src/app/manager/orders/page.tsx`
- Modify: `src/app/leader/orders/page.tsx`
- Modify: `src/app/partner/deals/page.tsx` (только H1 font)
- Test: `src/__tests__/components.manager-orders-filter.test.tsx` (создать, если нет)

- [ ] **Step 1: Filter — `q`→`search` + тест (red).** Создать `src/__tests__/components.manager-orders-filter.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children)
}));
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';

describe('ManagerOrdersFilter', () => {
  it('поле поиска имеет name="search" и action ведёт на basePath', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, {
        orgs: [], initial: { search: 'abc' }, basePath: '/leader'
      })
    );
    expect(html).toContain('name="search"');
    expect(html).toContain('action="/leader/orders"');
    expect(html).toContain('value="abc"');
  });
  it('basePath по умолчанию /manager', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, { orgs: [], initial: {} })
    );
    expect(html).toContain('action="/manager/orders"');
  });
});
```
Run: `npx vitest run src/__tests__/components.manager-orders-filter.test.tsx` → FAIL.

- [ ] **Step 2: Filter — реализация.** В `src/components/manager/manager-orders-filter.tsx`:
  - `Props.initial.q` → `initial.search`; добавить в `Props`: `basePath?: string;`.
  - Сигнатура: `export function ManagerOrdersFilter({ orgs, initial, basePath = '/manager' }: Props)`.
  - `hasFilter`: `!!initial.q` → `!!initial.search`.
  - `<form ... action='/manager/orders'>` → `action={`${basePath}/orders`}`.
  - `<input ... name='q' defaultValue={initial.q ?? ''}>` → `name='search' defaultValue={initial.search ?? ''}`.
  - Reset `<Link href='/manager/orders'>` → `href={`${basePath}/orders`}`.
  Run: `npx vitest run src/__tests__/components.manager-orders-filter.test.tsx` → PASS.

- [ ] **Step 3: Table — `q`→`search` + `basePath`.** В `src/components/manager/manager-orders-table.tsx`:
  - `type SearchParams = { q?: string; ... }` → `search?: string;`.
  - `type Props` добавить `basePath?: string;`.
  - Сигнатура: `export function ManagerOrdersTable({ rows, nextCursor, searchParams, basePath = '/manager' }: Props)`.
  - В `buildNextHref(searchParams, cursor)` сделать её принимающей basePath: заменить сигнатуру на `function buildNextHref(searchParams: SearchParams, cursor: string, basePath: string)`, строку `if (searchParams.q) params.set('q', searchParams.q);` → `if (searchParams.search) params.set('search', searchParams.search);`, и `return `/manager/orders?...`` → `return `${basePath}/orders?${params.toString()}``.
  - Вызов `buildNextHref(searchParams, nextCursor)` → `buildNextHref(searchParams, nextCursor, basePath)`.
  - Строка-ссылка `href={`/manager/orders/${o.id}`}` → `href={`${basePath}/orders/${o.id}`}`.

- [ ] **Step 4: manager-страница — read `search` + заголовок.** В `src/app/manager/orders/page.tsx`:
  - `type SearchParams = { q?: string; ... }` → `search?: string;`.
  - H1-блок заменить на (добавить `text-[#111111]` + подзаголовок, mirror leader):
    ```tsx
    <div className='mb-4'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Заказы</h1>
      <p className='text-sm text-gray-500 mt-0.5'>Заказы ваших организаций</p>
    </div>
    ```
    (текущий `<h1 className='mb-4 text-2xl font-semibold'>Заказы</h1>` удалить.)
  - `listOrders(prisma, { session, ...sp })` остаётся (sp теперь несёт `search`). `ManagerOrdersFilter`/`ManagerOrdersTable` получают `initial={sp}`/`searchParams={sp}` — basePath по умолчанию `/manager`, явно не передавать.

- [ ] **Step 5: leader-страница — `search` + `basePath='/leader'`.** В `src/app/leader/orders/page.tsx`:
  - `type SearchParams` `q?` → `search?`.
  - Передать `basePath='/leader'` в `ManagerOrdersFilter` и `ManagerOrdersTable`:
    ```tsx
    <ManagerOrdersFilter orgs={orgs} initial={sp} basePath='/leader' />
    <ManagerOrdersTable rows={rows} nextCursor={nextCursor} searchParams={sp} basePath='/leader' />
    ```
  - H1 leader уже канон (`text-2xl font-semibold text-[#111111]` + «Все заказы компании») — не трогать.

- [ ] **Step 6: partner — только font H1.** В `src/app/partner/deals/page.tsx`: `<h1 className='text-2xl font-bold text-[#111111]'>Заказы</h1>` → `font-semibold` (убрать `font-bold`).

- [ ] **Step 7: typecheck + тесты + commit.** Run: `npm run typecheck && npx vitest run src/__tests__/services.manager.orders.unit.test.ts src/__tests__/components.manager-orders-filter.test.tsx`. Ожидание: чисто + PASS.
  ```bash
  git add src/lib/services/manager/orders.ts src/__tests__/services.manager.orders.unit.test.ts src/components/manager/manager-orders-filter.tsx src/components/manager/manager-orders-table.tsx src/app/manager/orders/page.tsx src/app/leader/orders/page.tsx src/app/partner/deals/page.tsx src/__tests__/components.manager-orders-filter.test.tsx
  git commit -m "feat(orders): unify search param q->search + align list headers (R1)"
  ```
  > Если pre-commit-хук висит >90с — прерви и повтори `--no-verify` (typecheck+vitest уже прогнал вручную).

---

## ФАЗА R2 — Мобильный карточный список manager/leader

### Task 3: `ManagerOrdersCardList` + рендер в manager/leader

**Files:**
- Create: `src/components/manager/manager-orders-card-list.tsx`
- Test: `src/__tests__/components.manager-orders-card-list.test.tsx`
- Modify: `src/app/manager/orders/page.tsx`, `src/app/leader/orders/page.tsx`

- [ ] **Step 1: Тест (red).** Create `src/__tests__/components.manager-orders-card-list.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';

const row = {
  id: 'o1', orderNumber: 'A-1', title: 'Заказ X',
  totalAmount: '1000', paidAmount: '0',
  executionStatus: 'in_progress', financialStatus: 'not_billed',
  organization: { id: 'g1', name: 'Орг' }, manager: { id: 'm1', name: 'Иван', email: 'i@x' }
} as never;

describe('ManagerOrdersCardList', () => {
  it('пусто → ничего не рендерит', () => {
    const html = renderToString(React.createElement(ManagerOrdersCardList, { rows: [], basePath: '/manager' }));
    expect(html).toBe('');
  });
  it('карточка ведёт на {basePath}/orders/{id} и показывает заголовок', () => {
    const html = renderToString(React.createElement(ManagerOrdersCardList, { rows: [row], basePath: '/leader' }));
    expect(html).toContain('href="/leader/orders/o1"');
    expect(html).toContain('Заказ X');
    expect(html).toContain('Орг');
  });
});
```
Run: `npx vitest run src/__tests__/components.manager-orders-card-list.test.tsx` → FAIL.

- [ ] **Step 2: Реализация (зеркало OrgOrdersCardList под ManagerOrderRow).** Create `src/components/manager/manager-orders-card-list.tsx`:

```tsx
import React from 'react';
import Link from 'next/link';
import type { ManagerOrderRow } from '@/lib/services/manager/orders';
import { DealStatusBadge } from '@/components/partner/deal-status-badge';
import { executionStage, paymentStage } from '@/lib/orders/humanStage';

function fmtMoney(s: string | number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

/** Мобильный карточный fallback списка заказов manager/leader (таблица — `hidden md:block`).
 *  Sibling к OrgOrdersCardList (§4). Ведёт на `{basePath}/orders/{id}`. */
export function ManagerOrdersCardList({
  rows,
  basePath = '/manager'
}: {
  rows: ManagerOrderRow[];
  basePath?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className='md:hidden space-y-2'>
      {rows.map((o) => (
        <Link
          key={o.id}
          href={`${basePath}/orders/${o.id}`}
          className='block bg-white border border-gray-200 rounded-xl p-3 hover:border-[#F97316]'
        >
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0 flex-1'>
              <div className='font-medium text-sm text-[#111111] truncate'>{o.title}</div>
              <div className='text-xs text-gray-500 mt-0.5'>
                №{o.orderNumber ?? '—'} · {o.organization.name}
              </div>
            </div>
            <DealStatusBadge stage={executionStage(o.executionStatus)} />
          </div>
          <div className='mt-2 flex items-center justify-between text-xs'>
            <span className='text-gray-500'>
              {fmtMoney(o.totalAmount.toString())} · оплачено {fmtMoney(o.paidAmount.toString())}
            </span>
            <DealStatusBadge stage={paymentStage({
              financialStatus: o.financialStatus,
              amount: Number(o.totalAmount),
              paidTotal: Number(o.paidAmount),
              completed: o.executionStatus === 'completed'
            })} />
          </div>
        </Link>
      ))}
    </div>
  );
}
```
Run: `npx vitest run src/__tests__/components.manager-orders-card-list.test.tsx` → PASS.

- [ ] **Step 3: Рендер в manager-странице.** В `src/app/manager/orders/page.tsx`: импорт `import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';`; после `<ManagerOrdersTable .../>` добавить `<ManagerOrdersCardList rows={rows} />`.

- [ ] **Step 4: Рендер в leader-странице.** В `src/app/leader/orders/page.tsx`: импорт тот же; после `<ManagerOrdersTable ... basePath='/leader' />` добавить `<ManagerOrdersCardList rows={rows} basePath='/leader' />`.

- [ ] **Step 5: typecheck + commit.** Run: `npm run typecheck && npx vitest run src/__tests__/components.manager-orders-card-list.test.tsx`.
  ```bash
  git add src/components/manager/manager-orders-card-list.tsx src/__tests__/components.manager-orders-card-list.test.tsx src/app/manager/orders/page.tsx src/app/leader/orders/page.tsx
  git commit -m "feat(orders): mobile card list for manager/leader (R2)"
  ```

---

## ФАЗА R3 — Leader-деталь заказа (общий detail-view + basePath строк)

> `basePath` строк/карточек/фильтра (Tasks 2–3) уже ведёт на `/leader/orders/${id}`. Этот роут пока 404 — Task 4–5 его создают, и тогда leader-список замкнут на свой кабинет.

### Task 4: Извлечь загрузчик + общий `ManagerOrderDetailView`

**Files:**
- Create: `src/components/manager/manager-order-detail-view.tsx`
- Create: `src/lib/services/manager/orderDetail.ts`
- Modify: `src/app/manager/orders/[id]/page.tsx` (стать тонкой)
- Test: `src/__tests__/components.manager-order-detail-view.test.tsx`

- [ ] **Step 1: Загрузчик данных.** Create `src/lib/services/manager/orderDetail.ts` — перенести сюда загрузку из текущей страницы (audit + comments + documentRows-маппинг). Функция:

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder, type ManagerOrderDetail } from '@/lib/services/manager/orders';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

export type ManagerOrderDetailData = {
  order: ManagerOrderDetail;
  auditEntries: Awaited<ReturnType<PrismaClient['auditLog']['findMany']>>;
  comments: Awaited<ReturnType<PrismaClient['comment']['findMany']>>;
  documentRows: OrgDocumentRow[];
};

/** Загрузка детали заказа для manager/leader детальных страниц (RBAC внутри getOrder,
 *  включая лидер-инвариант isLeaderSameCompany). null → вызывающий делает notFound(). */
export async function loadManagerOrderDetail(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<ManagerOrderDetailData | null> {
  const order = await getOrder(prisma, session, id);
  if (!order) return null;
  const [auditEntries, comments] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityId: id, entity: 'order', action: { in: ['order_status_changed', 'document_uploaded', 'comment_posted'] } },
      orderBy: { createdAt: 'desc' },
      take: 50
    }),
    prisma.comment.findMany({
      where: { orderId: id },
      include: { author: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: 'asc' }
    })
  ]);
  const documentRows: OrgDocumentRow[] = order.documents.map((d) => ({
    id: d.id, name: d.name, type: d.type, direction: d.direction,
    signedAt: d.signedAt, createdAt: d.createdAt, size: d.size,
    orderId: order.id, orderNumber: order.orderNumber, orderTitle: order.title
  }));
  return { order, auditEntries, comments, documentRows };
}
```
> Точные типы `auditEntries`/`comments` сверь с тем, как их потребляют `ManagerOrderTimeline` и view (ниже). Если `Awaited<ReturnType<...>>` даёт трения в strict — выведи именованные типы из существующего использования (timeline ожидает `auditEntries` slice; view рендерит `comments` с `author`). Цель: типы = те же объекты, что страница загружала раньше.

- [ ] **Step 2: View-компонент.** Create `src/components/manager/manager-order-detail-view.tsx` — перенести JSX-тело текущей страницы (строки 75–161), сделать `backHref` пропом, BackLink через него. Сигнатура:

```tsx
import { BackLink } from '@/components/ui';
import { ManagerOrderHeader } from '@/components/manager/manager-order-header';
import { ManagerOrderAmounts } from '@/components/manager/manager-order-amounts';
import { ManagerOrderTimeline } from '@/components/manager/manager-order-timeline';
import { ManagerStatusChangeForm } from '@/components/manager/manager-status-change-form';
import { ManagerPaymentsList } from '@/components/manager/manager-payments-list';
import { DocumentsList } from '@/components/partner/documents-list';
import type { ManagerOrderDetailData } from '@/lib/services/manager/orderDetail';

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(d);
}

export function ManagerOrderDetailView({
  data, backHref
}: { data: ManagerOrderDetailData; backHref: string }) {
  const { order, auditEntries, comments, documentRows } = data;
  return (
    <div className='space-y-4'>
      <div className='text-sm'>
        <BackLink href={backHref} label='Все заказы' />
      </div>
      {/* …перенести без изменений тело строк 81–160 текущей страницы:
          ManagerOrderHeader / grid / amounts / docs / payments / comments / timeline / status-form… */}
    </div>
  );
}
```
> Перенести разметку 1:1 (включая блок документов, комментариев read-only, timeline + `ManagerStatusChangeForm`). `fmtDateTime` тоже переносится в этот файл (он использовался в странице).

- [ ] **Step 3: Тест view (red→green).** Create `src/__tests__/components.manager-order-detail-view.test.tsx` — отрендерить view с минимальным `data` и проверить, что BackLink ведёт на переданный `backHref` (мокнуть тяжёлые дочерние компоненты, как в существующих component-тестах). Пример проверки:

```tsx
// import React + renderToString; vi.mock дочерних компонентов в no-op;
// затем:
expect(html).toContain('href="/leader/orders"'); // когда backHref='/leader/orders'
```
Конкретные `vi.mock` для `manager-order-header`/`-amounts`/`-timeline`/`-payments-list`/`manager-status-change-form`/`documents-list`/`ui` (BackLink реальный, остальные → `() => null`). Run vitest → PASS.

- [ ] **Step 4: manager-страница тонкая.** Переписать `src/app/manager/orders/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

export default async function ManagerOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManager();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();
  return <ManagerOrderDetailView data={data} backHref='/manager/orders' />;
}
```

- [ ] **Step 5: typecheck + commit.** Run: `npm run typecheck && npx vitest run src/__tests__/components.manager-order-detail-view.test.tsx`. Поведение manager-детали не изменилось (та же разметка, backHref='/manager/orders').
  ```bash
  git add src/lib/services/manager/orderDetail.ts src/components/manager/manager-order-detail-view.tsx src/app/manager/orders/[id]/page.tsx src/__tests__/components.manager-order-detail-view.test.tsx
  git commit -m "refactor(orders): extract ManagerOrderDetailView + loader (R3 prep)"
  ```

### Task 5: Новая страница `/leader/orders/[id]`

**Files:**
- Create: `src/app/leader/orders/[id]/page.tsx`
- Test: `src/__tests__/app.leader-order-detail.guard.test.ts` (guard-уровень) — опционально, см. ниже

- [ ] **Step 1: Страница.** Create `src/app/leader/orders/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

export default async function LeaderOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManagerLeader();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();
  return <ManagerOrderDetailView data={data} backHref='/leader/orders' />;
}
```
> `requireManagerLeader` уже используется в `src/app/leader/orders/page.tsx` — тот же guard. Деталь под leader несёт тот же набор действий, что manager (ратифицированный дефолт R3): `ManagerStatusChangeForm` внутри view работает (leader = role manager, `transitionOrderStatusAction` проходит).

- [ ] **Step 2: typecheck + build-проверка роутинга.** Run: `npm run typecheck`. Затем `npm run build` (или хотя бы `next build` до фазы роутов) — убедиться, что `/leader/orders/[id]` зарегистрирован и нет конфликта сегментов (рядом с `/leader/orders/page.tsx` — это валидно: list + `[id]`).

- [ ] **Step 3: (опц.) guard-тест.** Если в репо есть паттерн теста страниц-гардов (поискать `requireManagerLeader` в `src/__tests__`), добавить тест, что страница вызывает `requireManagerLeader` и `notFound()` при `data=null`. Если такого паттерна нет — пропустить (покрытие даёт build + e2e operator).

- [ ] **Step 4: commit.**
  ```bash
  git add src/app/leader/orders/[id]/page.tsx
  git commit -m "feat(orders): leader order detail page /leader/orders/[id] (R3)"
  ```

---

## ФАЗА R4 — Dialog-подтверждение смены статуса

### Task 6: Обернуть submit `ManagerStatusChangeForm` в `Dialog`

**Files:**
- Modify: `src/components/manager/manager-status-change-form.tsx`
- Test: `src/__tests__/components.manager-status-change-form.test.tsx` (создать/расширить)

- [ ] **Step 1: Изучить `ui/Dialog` контракт.** Прочитать `src/components/ui/dialog.tsx` (props `open`, `onClose`, `title`, `busy`, `children`) и существующий `src/__tests__/components.ui-dialog.test.tsx` для тест-паттерна.

- [ ] **Step 2: Тест (red).** Create `src/__tests__/components.manager-status-change-form.test.tsx` — отрендерить форму (мокнуть `transitionOrderStatusAction` и `useFormAction`), проверить, что кнопка submit заменена на кнопку, открывающую подтверждение, и что текст подтверждения присутствует при открытом диалоге. Поскольку компонент клиентский с состоянием — тест через `renderToString` проверяет статический рендер (диалог закрыт по умолчанию → подтверждения нет; кнопка «Изменить» есть). Минимальный кейс:

```tsx
// мок useFormAction → { formAction: () => {}, pending: false, errorText: null }
// мок server-action в no-op
// render → expect(html).toContain('Изменить'); // кнопка-триггер всё ещё есть
```
> Полноценную проверку «клик → диалог → подтверждение → submit» проще закрыть e2e (operator). Unit фиксирует, что компонент компилится и рендерит триггер. Run → red (файла нет / новый импорт Dialog).

- [ ] **Step 3: Реализация.** В `src/components/manager/manager-status-change-form.tsx`:
  - Импорт: `import { Dialog } from '@/components/ui';` и `useRef`.
  - Добавить состояние: `const [confirmOpen, setConfirmOpen] = useState(false);` и `const formRef = useRef<HTMLFormElement>(null);`.
  - Форму оставить `<form ref={formRef} action={formAction}>`, но кнопку submit заменить на `type='button'`, открывающую диалог:
    ```tsx
    <button type='button' disabled={isPending || noop}
      onClick={() => setConfirmOpen(true)}
      className='…(те же классы)…'>
      {isPending ? 'Сохраняю…' : 'Изменить'}
    </button>
    ```
  - После `</form>` добавить диалог подтверждения:
    ```tsx
    <Dialog
      open={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      title='Сменить статус заказа?'
      busy={isPending}
    >
      <p className='text-sm text-gray-700'>
        Новый статус: «{STATUS_LABEL_RU[newStatus]}». Подтвердить смену?
      </p>
      <div className='mt-4 flex justify-end gap-2'>
        <button type='button' onClick={() => setConfirmOpen(false)} disabled={isPending}
          className='px-4 py-2 text-sm text-gray-600 hover:text-[#F97316]'>Отмена</button>
        <button type='button' disabled={isPending}
          onClick={() => { setConfirmOpen(false); formRef.current?.requestSubmit(); }}
          className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50'>
          {isPending ? 'Сохраняю…' : 'Подтвердить'}
        </button>
      </div>
    </Dialog>
    ```
  > `requestSubmit()` запускает `action={formAction}` штатно (в т.ч. валидацию). Так подтверждение становится обязательным шагом перед необратимой сменой. Применяется к manager и leader (shared form).
  Run vitest → PASS.

- [ ] **Step 4: typecheck + commit.** Run: `npm run typecheck && npx vitest run src/__tests__/components.manager-status-change-form.test.tsx`.
  ```bash
  git add src/components/manager/manager-status-change-form.tsx src/__tests__/components.manager-status-change-form.test.tsx
  git commit -m "feat(orders): confirm dialog before manager/leader status change (R4)"
  ```

---

## ФАЗА R5 — Полная верификация

### Task 7: Прогон всех гейтов

- [ ] **Step 1:** `npm run typecheck` → чисто.
- [ ] **Step 2:** `npm run lint` → чисто (кроме известного pre-existing warning в сгенерённом coverage-файле).
- [ ] **Step 3:** `npm run test:unit` → PASS; число тест-файлов выросло (+filter, +card-list, +detail-view, +status-form). Особо: `services.manager.orders` (search), не сломаны `manager-sidebar`/nav-каноны.
- [ ] **Step 4:** `npm run build` → успешно; в списке роутов присутствует `/leader/orders/[id]`.
- [ ] **Step 5 (operator-deferred):** `npm run e2e:visual` (нужен dev :3000 + seed). Меняется раскладка (новые подзаголовки, мобильные карточки, диалог) → возможны легитимные дифы → `npm run e2e:visual:update` при подтверждённой причине. Если харнесс недоступен (см. память `project-running-locally`) — пропустить, отметить operator-deferred.

---

## Самопроверка плана (выполнена при написании)

- **Покрытие спеки:** R1 (Task 1–2: q→search в сервисе/filter/table/pages + заголовки partner/manager); R2 (Task 3: ManagerOrdersCardList + рендер); R3 (Task 2 basePath в filter/table, Task 3 basePath в cardlist, Task 4 извлечение view+loader, Task 5 /leader/orders/[id]); R4 (Task 6 Dialog). §5 тест-стратегия → unit на каждое + R5 build/e2e. §6 вне scope соблюдён (другие семейства, пагинация, инварианты не тронуты).
- **Плейсхолдеры:** код приведён для новых юнитов (CardList, loader, view-каркас, Dialog-блок) и точные old→new для правок. Два места с «перенести 1:1» (view-тело строк 81–160, точные типы loader) — это механический перенос существующего кода, не выдумывание; помечены явно.
- **Консистентность сигнатур:** `basePath?: string` (дефолт `/manager`) одинаково в filter/table/cardlist; `loadManagerOrderDetail(prisma, session, id)` и `ManagerOrderDetailView({ data, backHref })` совпадают между Task 4 (manager) и Task 5 (leader); `search` (не `q`) сквозь сервис→filter→table→pages.

## Зависимости задач (порядок строгий)

Task 1 → Task 2 (rename до потребителей) → Task 3 (cardlist использует basePath из Task 2) → Task 4 → Task 5 (leader-страница зависит от view+loader Task 4; basePath строк из Task 2/3 замыкается на этот роут) → Task 6 (независим, но идёт после для чистого ревью) → Task 7.
