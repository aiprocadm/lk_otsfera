# Витрина оплат менеджера (C-a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать менеджеру/руководителю страницу `/manager/finance` (+ admin-зеркало `/admin/finance`) с витриной реальных оплат, сгруппированных по организациям, и блоком «проценты посредника» под гейтом «руководитель+админ».

**Architecture:** Новый сервис `manager/finance.ts` — тонкий агрегатор поверх готового `organization/finance.ts` (`Promise.all` по орг в scope). Гейт комиссии — внутри сервиса (field-level: для рядового менеджера расчёт маржи не выполняется). UI переиспользует презентационные `OrgFinanceKpisGrid`/`OrgFinanceCommission`; для таблицы оплат — manager-сиблинг (org-версия хардкодит ссылку на `/organization/orders`).

**Tech Stack:** Next.js 15 server components, Prisma 5, Vitest, react-dom/server (component tests).

**Spec:** [2026-06-09-manager-finance-view-design.md](../specs/2026-06-09-manager-finance-view-design.md)

**Branch:** `claude/manager-finance-view` (создана от `main`).

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/lib/services/manager/finance.ts` | `getManagerFinanceOverview` — scope-резолв + агрегатор поверх org-finance | New |
| `src/__tests__/services.manager.finance.test.ts` | unit: scope, гейт комиссии, агрегация | New |
| `src/components/manager/manager-finance-payments.tsx` | таблица оплат (ссылка `/manager/orders`, гасит null orderId) | New |
| `src/components/manager/manager-finance-view.tsx` | обёртка: сводка + секции по орг | New |
| `src/__tests__/components.manager-finance.test.tsx` | render: гейт-блок, ссылки | New |
| `src/app/manager/finance/page.tsx` | manager entry (`requireManager`, читает teamMode) | New |
| `src/app/admin/finance/page.tsx` | admin mirror (`requireAdmin`, unscoped) | New |
| `src/lib/navigation/cabinet.ts` | nav «Финансы» в manager + admin | Modify |
| `src/__tests__/navigation.cabinet.partner.test.ts` | расширить: manager/admin finance nav | Modify |
| `src/__tests__/services.manager.finance.integration.test.ts` | integration: cross-company инвариант, org-level оплата, комиссия лидера | New |

---

## Phase 1 — Сервис-агрегатор

### Task 1.1: `getManagerFinanceOverview` + unit-тест

**Files:**
- Create: `src/lib/services/manager/finance.ts`
- Test: `src/__tests__/services.manager.finance.test.ts`

- [ ] **Step 1: Написать падающий unit-тест**

Создать `src/__tests__/services.manager.finance.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const orgFinance = vi.hoisted(() => ({
  getOrgFinanceKpis: vi.fn(),
  listOrgPayments: vi.fn(),
  getOrgIntermediaryCommission: vi.fn()
}));
vi.mock('@/lib/services/organization/finance', () => orgFinance);

import { getManagerFinanceOverview } from '@/lib/services/manager/finance';

const session = (over: Partial<SessionPayload>): SessionPayload =>
  ({ sub: 'm1', role: 'manager', email: 'm@x', ...over } as unknown as SessionPayload);

function fakePrisma(orgs: Array<{ id: string; name: string }>) {
  return { organization: { findMany: vi.fn().mockResolvedValue(orgs) } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  orgFinance.getOrgFinanceKpis.mockResolvedValue({ billed: '100.00', paid: '40.00', outstanding: '60.00' });
  orgFinance.listOrgPayments.mockResolvedValue([
    { id: 'p1', amount: '40.00', paidAt: new Date('2026-04-01'), method: null, isRefund: false, note: null, orderId: null, orderNumber: null }
  ]);
  orgFinance.getOrgIntermediaryCommission.mockResolvedValue({ effectiveRate: '0.1', totalCommission: '10.00', perOrder: [] });
});

describe('getManagerFinanceOverview', () => {
  it('plain manager: scoped to managedOrgIds, commission NOT computed', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }]);
    const res = await getManagerFinanceOverview(prisma, session({ managedOrgIds: ['o1', 'o2'], companyId: 'c1' }), { teamMode: false });

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['o1', 'o2'] } } })
    );
    expect(orgFinance.getOrgIntermediaryCommission).not.toHaveBeenCalled();
    expect(res.canSeeCommission).toBe(false);
    expect(res.sections).toHaveLength(2);
    expect(res.sections.every((s) => s.commission === null)).toBe(true);
    // summary = sum of 2 orgs
    expect(res.summary).toEqual({ billed: '200.00', paid: '80.00', outstanding: '120.00' });
  });

  it('leader with teamMode=ON: company-wide scope + commission computed', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }]);
    const res = await getManagerFinanceOverview(prisma, session({ managerRole: 'leader', companyId: 'c1' }), { teamMode: true });

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } })
    );
    expect(orgFinance.getOrgIntermediaryCommission).toHaveBeenCalledWith(prisma, 'o1');
    expect(res.canSeeCommission).toBe(true);
    expect(res.sections[0].commission).toEqual({ effectiveRate: '0.1', totalCommission: '10.00', perOrder: [] });
  });

  it('admin: unscoped (no where) + commission computed', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }]);
    const res = await getManagerFinanceOverview(prisma, session({ role: 'admin' }), { teamMode: false });

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
    expect(res.canSeeCommission).toBe(true);
    expect(orgFinance.getOrgIntermediaryCommission).toHaveBeenCalledTimes(1);
  });

  it('empty scope → no sections, zero summary', async () => {
    const prisma = fakePrisma([]);
    const res = await getManagerFinanceOverview(prisma, session({ managedOrgIds: [], companyId: 'c1' }), { teamMode: false });
    expect(res.sections).toEqual([]);
    expect(res.summary).toEqual({ billed: '0.00', paid: '0.00', outstanding: '0.00' });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- services.manager.finance`
Expected: FAIL — модуль `@/lib/services/manager/finance` не найден.

- [ ] **Step 3: Реализовать сервис**

Создать `src/lib/services/manager/finance.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrgScope, isManagerLeader } from '@/lib/auth/managerPolicy';
import {
  getOrgFinanceKpis,
  listOrgPayments,
  getOrgIntermediaryCommission,
  type OrgFinanceKpis,
  type OrgPaymentRow,
  type OrgIntermediaryCommission
} from '@/lib/services/organization/finance';

export type ManagerOrgFinanceSection = {
  orgId: string;
  orgName: string;
  kpis: OrgFinanceKpis;
  payments: OrgPaymentRow[];
  commission: OrgIntermediaryCommission | null;
};

export type ManagerFinanceOverview = {
  summary: OrgFinanceKpis;
  sections: ManagerOrgFinanceSection[];
  canSeeCommission: boolean;
};

/**
 * Финансовая витрина менеджера/руководителя: оплаты по организациям в scope +
 * (для руководителя/админа) проценты посредника. Тонкий агрегатор поверх
 * organization/finance.ts. Гейт комиссии — здесь (§4 service-layer): рядовой
 * менеджер физически не вызывает расчёт маржи (field-level).
 */
export async function getManagerFinanceOverview(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: { teamMode: boolean }
): Promise<ManagerFinanceOverview> {
  const unscoped = session.role === 'admin';
  const canSeeCommission = unscoped || isManagerLeader(session);

  const orgs = await prisma.organization.findMany({
    where: unscoped ? undefined : managerOrgScope(session, opts.teamMode),
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  const sections = await Promise.all(
    orgs.map(async (org): Promise<ManagerOrgFinanceSection> => {
      const [kpis, payments, commission] = await Promise.all([
        getOrgFinanceKpis(prisma, org.id),
        listOrgPayments(prisma, { organizationId: org.id }),
        canSeeCommission ? getOrgIntermediaryCommission(prisma, org.id) : Promise.resolve(null)
      ]);
      return { orgId: org.id, orgName: org.name, kpis, payments, commission };
    })
  );

  let billed = 0;
  let paid = 0;
  for (const s of sections) {
    billed += Number(s.kpis.billed);
    paid += Number(s.kpis.paid);
  }
  const summary: OrgFinanceKpis = {
    billed: billed.toFixed(2),
    paid: paid.toFixed(2),
    outstanding: (billed - paid).toFixed(2)
  };

  return { summary, sections, canSeeCommission };
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm run test:unit -- services.manager.finance`
Expected: PASS (4 теста).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/lib/services/manager/finance.ts src/__tests__/services.manager.finance.test.ts
git commit -m "feat(manager-finance): scope-aware overview aggregator + gated commission"
```

---

## Phase 2 — Презентационные компоненты

### Task 2.1: `ManagerFinancePayments` (manager-сиблинг таблицы оплат)

**Files:**
- Create: `src/components/manager/manager-finance-payments.tsx`
- Test: `src/__tests__/components.manager-finance.test.tsx` (создаётся здесь, дополняется в 2.2)

> Почему сиблинг, а не переиспользование `OrgFinancePayments`: org-версия рендерит `<Link href={'/organization/orders/${p.orderId}'}>` безусловно — в кабинете менеджера ссылка вела бы в чужой кабинет, и для org-level оплат (`orderId: null`) ссылка битая. Manager-версия линкует на `/manager/orders` и гасит null orderId.

- [ ] **Step 1: Написать падающий render-тест**

Создать `src/__tests__/components.manager-finance.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ManagerFinancePayments } from '@/components/manager/manager-finance-payments';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';

const rows: OrgPaymentRow[] = [
  { id: 'p1', amount: '40.00', paidAt: new Date('2026-04-01'), method: 'wire', isRefund: false, note: null, orderId: 'ord-1', orderNumber: 'A-1' },
  { id: 'p2', amount: '10.00', paidAt: new Date('2026-04-02'), method: null, isRefund: false, note: null, orderId: null, orderNumber: null }
];

describe('ManagerFinancePayments', () => {
  it('links order rows to /manager/orders and renders order number', () => {
    const html = renderToString(<ManagerFinancePayments payments={rows} />);
    expect(html).toContain('/manager/orders/ord-1');
    expect(html).toContain('A-1');
  });

  it('renders org-level payment (null orderId) without a broken link', () => {
    const html = renderToString(<ManagerFinancePayments payments={rows} />);
    expect(html).not.toContain('/manager/orders/null');
  });

  it('renders empty state when no payments', () => {
    const html = renderToString(<ManagerFinancePayments payments={[]} />);
    expect(html).toContain('Платежей пока нет');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- components.manager-finance`
Expected: FAIL — модуль компонента не найден.

- [ ] **Step 3: Реализовать компонент**

Создать `src/components/manager/manager-finance-payments.tsx`:

```tsx
import Link from 'next/link';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}

export function ManagerFinancePayments({ payments }: { payments: OrgPaymentRow[] }) {
  if (payments.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-8 text-center'>
        <p className='text-gray-500 text-sm'>Платежей пока нет.</p>
      </div>
    );
  }
  return (
    <div className='bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Дата</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Заказ</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Способ</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className='border-b border-gray-50 last:border-b-0 hover:bg-[#FFF7ED]'>
              <td className='px-4 py-2.5 text-gray-500'>{fmtDate(p.paidAt)}</td>
              <td className='px-4 py-2.5'>
                {p.orderId ? (
                  <Link href={`/manager/orders/${p.orderId}`} className='text-[#F97316] hover:underline'>
                    {p.orderNumber ?? '—'}
                  </Link>
                ) : (
                  <span className='text-gray-400'>—</span>
                )}
              </td>
              <td className='px-4 py-2.5 text-gray-600'>
                {p.isRefund ? <span className='text-red-600'>Возврат</span> : (p.method ?? '—')}
              </td>
              <td className={`px-4 py-2.5 text-right font-medium ${p.isRefund ? 'text-red-600' : 'text-gray-800'}`}>
                {p.isRefund ? '−' : ''}
                {fmtMoney(p.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm run test:unit -- components.manager-finance`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add src/components/manager/manager-finance-payments.tsx src/__tests__/components.manager-finance.test.tsx
git commit -m "feat(manager-finance): payments table sibling (manager routes, null-order safe)"
```

### Task 2.2: `ManagerFinanceView` (обёртка: сводка + секции)

**Files:**
- Create: `src/components/manager/manager-finance-view.tsx`
- Test: `src/__tests__/components.manager-finance.test.tsx` (дополнить)

- [ ] **Step 1: Дополнить тест падающими кейсами**

Добавить в конец `src/__tests__/components.manager-finance.test.tsx`:

```tsx
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';
import type { ManagerFinanceOverview } from '@/lib/services/manager/finance';

const baseSection = {
  orgId: 'o1',
  orgName: 'ООО Ромашка',
  kpis: { billed: '100.00', paid: '40.00', outstanding: '60.00' },
  payments: rows,
  commission: null as ManagerFinanceOverview['sections'][number]['commission']
};

describe('ManagerFinanceView', () => {
  const overview: ManagerFinanceOverview = {
    summary: { billed: '100.00', paid: '40.00', outstanding: '60.00' },
    sections: [baseSection],
    canSeeCommission: false
  };

  it('renders org name and summary', () => {
    const html = renderToString(<ManagerFinanceView data={overview} />);
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Выставлено');
  });

  it('hides commission block when section.commission is null', () => {
    const html = renderToString(<ManagerFinanceView data={overview} />);
    expect(html).not.toContain('Комиссия посредника');
  });

  it('shows commission block when section.commission is present', () => {
    const withCommission: ManagerFinanceOverview = {
      ...overview,
      canSeeCommission: true,
      sections: [{ ...baseSection, commission: { effectiveRate: '0.1', totalCommission: '10.00', perOrder: [] } }]
    };
    const html = renderToString(<ManagerFinanceView data={withCommission} />);
    expect(html).toContain('Комиссия посредника');
  });

  it('renders empty state when no sections', () => {
    const empty: ManagerFinanceOverview = {
      summary: { billed: '0.00', paid: '0.00', outstanding: '0.00' },
      sections: [],
      canSeeCommission: false
    };
    const html = renderToString(<ManagerFinanceView data={empty} />);
    expect(html).toContain('Нет организаций');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- components.manager-finance`
Expected: FAIL — `ManagerFinanceView` не найден.

- [ ] **Step 3: Реализовать обёртку**

Создать `src/components/manager/manager-finance-view.tsx`:

```tsx
import { OrgFinanceKpisGrid } from '@/components/organization/org-finance-kpis';
import { OrgFinanceCommission } from '@/components/organization/org-finance-commission';
import { ManagerFinancePayments } from './manager-finance-payments';
import type { ManagerFinanceOverview } from '@/lib/services/manager/finance';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

export function ManagerFinanceView({ data }: { data: ManagerFinanceOverview }) {
  if (data.sections.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <p className='text-gray-500 text-sm'>Нет организаций в вашей зоне видимости.</p>
      </div>
    );
  }
  return (
    <div className='space-y-8'>
      <section className='space-y-3'>
        <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider'>Итого по всем организациям</h2>
        <OrgFinanceKpisGrid kpis={data.summary} />
      </section>

      {data.sections.map((s) => (
        <section key={s.orgId} className='space-y-3'>
          <div className='flex items-baseline justify-between gap-3 border-b border-gray-100 pb-2'>
            <h3 className='text-lg font-semibold text-[#111111]'>{s.orgName}</h3>
            <span className='text-xs text-gray-500'>
              Выставлено {fmtMoney(s.kpis.billed)} · Оплачено {fmtMoney(s.kpis.paid)} · Долг {fmtMoney(s.kpis.outstanding)}
            </span>
          </div>
          {s.commission && <OrgFinanceCommission data={s.commission} />}
          <ManagerFinancePayments payments={s.payments} />
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm run test:unit -- components.manager-finance`
Expected: PASS (все кейсы 2.1 + 2.2).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/components/manager/manager-finance-view.tsx src/__tests__/components.manager-finance.test.tsx
git commit -m "feat(manager-finance): overview view (summary + per-org sections, gated commission)"
```

---

## Phase 3 — Страницы и навигация

### Task 3.1: Страницы `/manager/finance` и `/admin/finance`

**Files:**
- Create: `src/app/manager/finance/page.tsx`
- Create: `src/app/admin/finance/page.tsx`

> Manager-страницы возвращают фрагмент (шелл даёт `app/manager/layout.tsx`); admin-страницы — `div.space-y-*` (шелл даёт `app/admin/layout.tsx`). См. эталоны `app/manager/import/page.tsx` и `app/admin/import/page.tsx`.

- [ ] **Step 1: Реализовать manager-страницу**

Создать `src/app/manager/finance/page.tsx`:

```tsx
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

export const dynamic = 'force-dynamic';

export default async function ManagerFinancePage() {
  const session = await requireManager();
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const data = await getManagerFinanceOverview(prisma, session, { teamMode });
  return (
    <>
      <h1 className='mb-1 text-2xl font-semibold text-[#111111]'>Финансы</h1>
      <p className='text-sm text-gray-500 mb-6'>Оплаты по вашим организациям</p>
      <ManagerFinanceView data={data} />
    </>
  );
}
```

- [ ] **Step 2: Реализовать admin-страницу (зеркало, unscoped)**

Создать `src/app/admin/finance/page.tsx`:

```tsx
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

export const dynamic = 'force-dynamic';

export default async function AdminFinancePage() {
  const session = await requireAdmin();
  // admin → unscoped внутри сервиса (session.role==='admin'); teamMode игнорируется.
  const data = await getManagerFinanceOverview(prisma, session, { teamMode: false });
  return (
    <div className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Финансы</h1>
        <p className='text-sm text-gray-500 mt-0.5'>Оплаты по всем организациям</p>
      </div>
      <ManagerFinanceView data={data} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/manager/finance/page.tsx src/app/admin/finance/page.tsx
git commit -m "feat(manager-finance): /manager/finance + /admin/finance pages"
```

### Task 3.2: Навигация + nav-тест

**Files:**
- Modify: `src/lib/navigation/cabinet.ts`
- Test: `src/__tests__/navigation.cabinet.partner.test.ts` (catch-all nav-тест; дополнить)

- [ ] **Step 1: Написать падающие nav-кейсы**

Добавить в конец `src/__tests__/navigation.cabinet.partner.test.ts`:

```ts
describe('navByRole — Финансы (manager + admin)', () => {
  it('manager содержит /manager/finance с флагом manager_cabinet', () => {
    const item = navByRole.manager.find((i) => i.href === '/manager/finance');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Финансы');
    expect(item!.flag).toBe('manager_cabinet');
  });

  it('admin содержит /admin/finance без флага', () => {
    const item = navByRole.admin.find((i) => i.href === '/admin/finance');
    expect(item).toBeDefined();
    expect(item!.label).toBe('Финансы');
    expect(item!.flag).toBeUndefined();
  });

  it('manager /manager/finance стоит после Организации', () => {
    const hrefs = navByRole.manager.map((i) => i.href);
    expect(hrefs.indexOf('/manager/finance')).toBeGreaterThan(hrefs.indexOf('/manager/organizations'));
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test:unit -- navigation.cabinet`
Expected: FAIL — пункты отсутствуют.

- [ ] **Step 3: Добавить пункты в `navByRole`**

В `src/lib/navigation/cabinet.ts`:

В массив `admin` добавить (после `commission-statements`):
```ts
    { href: '/admin/finance', label: 'Финансы' },
```

В массив `manager` добавить (после `organizations`, до `import`):
```ts
    { href: '/manager/finance', label: 'Финансы', flag: 'manager_cabinet' },
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm run test:unit -- navigation.cabinet`
Expected: PASS.

> Примечание: тест в `navigation.cabinet.partner.test.ts` уже проверяет «import стоит после Организации и до Документы». После вставки `finance` между `organizations` и `import` этот инвариант сохраняется (importIdx всё ещё > orgIdx и < docsIdx). Убедиться, что оба теста зелёные.

- [ ] **Step 5: Commit**

```bash
git add src/lib/navigation/cabinet.ts src/__tests__/navigation.cabinet.partner.test.ts
git commit -m "feat(manager-finance): nav items (manager + admin Финансы)"
```

---

## Phase 4 — Integration + верификация

### Task 4.1: Integration-тест (cross-company инвариант, org-level оплата, комиссия лидера)

**Files:**
- Create: `src/__tests__/services.manager.finance.integration.test.ts` (содержит `new PrismaClient(` → авто-integration, §6)

- [ ] **Step 1: Написать integration-тест**

Создать `src/__tests__/services.manager.finance.integration.test.ts`. Сначала прочитать существующий integration-тест менеджера (например `src/__tests__/services.manager.teamVisibility.test.ts`) и переиспользовать его паттерн seed/cleanup (создание Company, User, Organization, Payment). Затем:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const TAG = 'mgrfin-it';

let companyA = '';
let companyB = '';
let orgA = '';
let mgrA: SessionPayload;
let mgrB: SessionPayload;

beforeAll(async () => {
  const cA = await prisma.company.create({ data: { name: `${TAG}-A` } });
  const cB = await prisma.company.create({ data: { name: `${TAG}-B` } });
  companyA = cA.id;
  companyB = cB.id;
  const oA = await prisma.organization.create({ data: { name: `${TAG}-orgA`, companyId: companyA } });
  orgA = oA.id;

  // org-level payment (orderId null) on orgA
  await prisma.payment.create({
    data: { organizationId: orgA, orderId: null, amount: '500.00', paidAt: new Date('2026-04-15'), isRefund: false }
  });

  mgrA = { sub: `${TAG}-mA`, role: 'manager', email: 'a@x', companyId: companyA, managedOrgIds: [orgA] } as unknown as SessionPayload;
  mgrB = { sub: `${TAG}-mB`, role: 'manager', email: 'b@x', companyId: companyB, managedOrgIds: [] } as unknown as SessionPayload;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe('getManagerFinanceOverview (integration)', () => {
  it('manager sees own org org-level payment (null orderId)', async () => {
    const res = await getManagerFinanceOverview(prisma, mgrA, { teamMode: false });
    const section = res.sections.find((s) => s.orgId === orgA);
    expect(section).toBeDefined();
    expect(section!.payments.some((p) => p.orderId === null && p.amount === '500.00')).toBe(true);
  });

  it('cross-company invariant: manager B sees nothing of company A even with teamMode=ON', async () => {
    const res = await getManagerFinanceOverview(prisma, mgrB, { teamMode: true });
    expect(res.sections.find((s) => s.orgId === orgA)).toBeUndefined();
  });
});
```

> Если у `Organization`/`Payment`/`Company` есть обязательные поля, не покрытые выше (например `Order.companyId`), seed их по образцу соседнего integration-теста. `Payment.amount` — `Decimal`; передаём строкой, Prisma приведёт.

- [ ] **Step 2: Запустить против живого PG**

Run: `npm run gate` (поднимает Docker-PG) **или** `npm run test:integration -- services.manager.finance.integration` при живом локальном PG.
Expected: PASS (2 теста). Cross-company инвариант зелёный.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/services.manager.finance.integration.test.ts
git commit -m "test(manager-finance): integration — cross-company invariant + org-level payment"
```

### Task 4.2: Полный гейт + ручная проверка

- [ ] **Step 1:** `npm run typecheck` → clean.
- [ ] **Step 2:** `npm run lint` → clean.
- [ ] **Step 3:** `npm run test:unit` → всё зелёное (новые unit-специи включены).
- [ ] **Step 4:** `npm run build` → успех (ловит коллизии слагов/роутов — см. [project-phase8-dev-server-broken]).
- [ ] **Step 5 (ручная):** `npm run dev`, на seed-данных:
  - зайти `/manager/finance` рядовым менеджером → видна витрина оплат, **нет** блока «Комиссия посредника»;
  - зайти `/manager/finance` руководителем (`managerRole='leader'`) → блок комиссии **есть**;
  - зайти `/admin/finance` админом → все организации + комиссия.
- [ ] **Step 6 (гейт комиссии, проверка field-level):** подтвердить в коде/тесте, что для рядового менеджера `getOrgIntermediaryCommission` не вызывается (уже покрыто unit-тестом Task 1.1) — данные о марже не достигают клиента.

---

## Self-Review notes

- **Spec coverage:** маршруты `/manager/finance`+`/admin/finance` ✓ Task 3.1; сервис-агрегатор ✓ 1.1; гейт комиссии внутри сервиса (`unscoped || isManagerLeader`) ✓ 1.1; группировка по орг + сводный итог ✓ 1.1/2.2; переиспользование KpisGrid/Commission + manager-сиблинг payments ✓ 2.1/2.2; RBAC 3 точки (middleware есть, page `requireManager`/`requireAdmin`, service scope) ✓ 3.1/1.1; teamMode свежий ✓ 3.1; nav оба кабинета ✓ 3.2; cross-company инвариант ✓ 4.1; тест-стратегия unit/integration/component ✓.
- **Type consistency:** `ManagerFinanceOverview`/`ManagerOrgFinanceSection` определены в 1.1 и используются в 2.2/3.x идентично; `OrgFinanceKpis`/`OrgPaymentRow`/`OrgIntermediaryCommission` импортируются из `organization/finance.ts` (не переопределяются); компонент назван `ManagerFinanceView` (не конфликтует с типом `ManagerFinanceOverview`).
- **No placeholders:** все шаги содержат полный код/команды/ожидаемый результат.
- **Open items (из спеки):** батч-оптимизация комиссии при десятках орг у лидера — отложена (порог фиксируется при ревью, не преждевременно).
