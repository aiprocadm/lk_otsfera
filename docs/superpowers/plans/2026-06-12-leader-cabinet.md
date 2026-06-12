# Кабинет руководителя — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Шестой полноценный кабинет `/leader/*` для руководителя менеджеров (вариант А спеки [2026-06-11-leader-cabinet-design.md](../specs/2026-06-11-leader-cabinet-design.md)): своя «Сводка по команде», company-wide заказы/организации/финансы с комиссией, переезд «Команды», переключатель «Мои заказы».

**Architecture:** Новый route-префикс `/leader` (роль `manager` + суб-роль `managerRole='leader'`, гард `requireManagerLeader`), opt-in флаг `leader_cabinet` с тремя точками гейтинга. Выборки — company-wide **всегда** через явный `teamModeOverride: true` поверх существующих manager-сервисов (toggle компании не трогаем; C8 cross-company изоляция сохраняется). Шелл/сайдбар — siblings `Leader*` от manager-версий, меню — из канона `cabinet.ts` (ключ `'leader'`). Деталей заказа в `/leader` нет — ссылки ведут в `/manager/orders/[id]`, для этого гард детали получает правило «лидер видит любой заказ своей компании».

**Tech Stack:** Next.js 15 App Router, Prisma, Vitest (`npx vitest run --mode=unit <файл>`); pre-commit hook сам гоняет lint+typecheck+test:changed (первый прогон долгий — норма, `--no-verify` нельзя).

**Ветка:** `claude/leader-cabinet` **от `main` ПОСЛЕ мержа [PR #118](https://github.com/aiprocadm/lk_otsfera/pull/118)** (зависимость: канон навигации, items-prop сайдбары, LogoutButton). Если #118 ещё не влит — НЕ начинать (урок стек-аварии tier2).

**Утверждённые решения (не пересматривать):** отдельный кабинет (вариант А); «играющий тренер» — доступ в оба кабинета; комиссия видна только партнёру/руководителю/админу; admin в `/leader` не входит (Model A).

**Отклонение от спеки (зафиксировано здесь):** пункт «Сообщения» в меню руководителя ведёт на существующий `/manager/messages` (личный inbox комментариев + чат), а не на дубль-страницу `/leader/messages` — сообщения персональны (видимость ≠ таргетинг, CLAUDE.md §5), дубль не добавил бы функции (YAGNI).

---

### Task 1: Флаг `leader_cabinet` (opt-in)

**Files:**
- Modify: `src/lib/featureFlags.ts`
- Test: `src/__tests__/featureFlags.leader.test.ts`

- [ ] **Step 1: Падающий тест** (по образцу `src/__tests__/featureFlags.manager.test.ts` — открой его и скопируй структуру save/restore env):

```ts
// src/__tests__/featureFlags.leader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isFeatureEnabled } from '@/lib/featureFlags';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FEATURE_LEADER_CABINET;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('leader_cabinet flag (opt-in)', () => {
  it('выключен по умолчанию (env не задан)', () => {
    expect(isFeatureEnabled('leader_cabinet')).toBe(false);
  });
  it('включается только явным truthy', () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    expect(isFeatureEnabled('leader_cabinet')).toBe(true);
  });
  it('off/0 выключают', () => {
    process.env.FEATURE_LEADER_CABINET = 'off';
    expect(isFeatureEnabled('leader_cabinet')).toBe(false);
  });
});
```

- [ ] **Step 2:** `npx vitest run --mode=unit src/__tests__/featureFlags.leader.test.ts` → FAIL (TS: `'leader_cabinet'` не входит в FeatureFlag).

- [ ] **Step 3:** В `featureFlags.ts`: добавить `'leader_cabinet',` в массив `FEATURE_FLAGS` и в `OPT_IN_FLAGS` (рядом с `manager_cabinet`).

- [ ] **Step 4:** Тест → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/featureFlags.ts src/__tests__/featureFlags.leader.test.ts
git commit -m "feat(flags): opt-in leader_cabinet flag"
```

---

### Task 2: Доступ — префикс, middleware-гейт, leader-редирект «домой»

**Files:**
- Modify: `src/lib/auth/access.ts`
- Modify: `src/middleware.ts`
- Test: `src/__tests__/auth.middleware.leader.test.ts` (новый; образец моков — `src/__tests__/auth.middleware.test.ts`)

- [ ] **Step 1: access.ts.** В `protectedPrefixes` добавить (с комментарием):

```ts
  // /leader — кабинет руководителя: только role=manager; суб-роль managerRole='leader'
  // бьётся серверным гардом requireManagerLeader на layout (middleware суб-роль не режет).
  '/leader': ['manager'],
```

ВАЖНО: вставить ключ `'/leader'` ПЕРЕД... — порядок в объекте не важен (цикл `startsWith` по всем), но `/leader` не пересекается с другими префиксами. `roleHome` НЕ трогаем (роль manager остаётся на `/manager/dashboard` — leader-редирект решается в middleware, Step 2).

- [ ] **Step 2: middleware.ts.** Три правки:

1. В `FEATURE_PREFIXES` добавить (ПЕРЕД строкой `{ prefix: '/manager', flag: 'manager_cabinet' }` — порядок не критичен, префиксы не пересекаются):

```ts
  { prefix: '/leader', flag: 'leader_cabinet' },
```

2. После `const role = payload.role as Role;` добавить вычисление «домашней» страницы:

```ts
    // Руководитель менеджеров при включённом кабинете попадает в /leader.
    // managerRole — контрактный claim JWT (C8); флаг проверяем здесь же,
    // чтобы при выключенном leader_cabinet редирект вёл в обычный кабинет.
    const isLeader = role === 'manager' && (payload as { managerRole?: string }).managerRole === 'leader';
    const home = isLeader && isFeatureEnabled('leader_cabinet') ? '/leader/dashboard' : roleHome[role];
```

3. Заменить оба использования `roleHome[role]` на `home` (редирект с auth-страниц, строка ~49, и редирект `/` + `/dashboard`, строка ~70).

- [ ] **Step 3: Падающий тест.** Открой `src/__tests__/auth.middleware.test.ts`, скопируй setup (генерация JWT, NextRequest-моки) в новый файл и добавь кейсы:

```ts
describe('middleware — leader cabinet', () => {
  it('менеджер-лидер при FEATURE_LEADER_CABINET=1: / -> /leader/dashboard', async () => { /* token c role=manager, managerRole='leader' */ });
  it('менеджер-лидер при выключенном флаге: / -> /manager/dashboard', async () => {});
  it('рядовой менеджер при включённом флаге: / -> /manager/dashboard (managerRole отсутствует)', async () => {});
  it('partner на /leader/dashboard -> /forbidden (protectedPrefixes)', async () => {});
  it('менеджер на /leader/team при ВЫКЛЮЧЕННОМ флаге -> 404 (FEATURE_PREFIXES)', async () => {});
  it('менеджер (не лидер) на /leader/team при включённом флаге -> next (суб-роль бьёт серверный гард, не middleware)', async () => {});
});
```

Каждый кейс — полноценный (создай токен с нужными claims, вызови `middleware(req)`, проверь `Location`/status по образцу существующего файла).

- [ ] **Step 4:** FAIL → внести правки Step 1-2 → PASS. Также прогнать старый `auth.middleware.test.ts` (не должен сломаться).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/access.ts src/middleware.ts src/__tests__/auth.middleware.leader.test.ts
git commit -m "feat(leader): /leader prefix, middleware flag-gate, leader home redirect"
```

---

### Task 3: Канон навигации — ключ `leader` + перекрёстные пункты

**Files:**
- Modify: `src/lib/navigation/cabinet.ts`
- Test: `src/__tests__/navigation.cabinet.leader.test.ts`
- Modify: `src/__tests__/navigation.cabinet.partner.test.ts` (если ассерты по manager-длине)

- [ ] **Step 1: cabinet.ts.** Три правки:

1. `NavItem` — новое поле:

```ts
  /** Скрыть пункт, когда флаг ВКЛЮЧЁН (обратный гейт: «Команда» менеджера уезжает в /leader). */
  hiddenWhenFlag?: FeatureFlag;
```

2. Тип канона и сигнатура: `navByRole: Record<Role | 'leader', NavItem[]>`; `navItemsFor(role: Role | 'leader', opts?: ...)`. `'leader'` — НЕ новая JWT-роль (роль manager + managerRole='leader'); ключ существует только в канонe меню.

3. Содержимое:

```ts
  leader: [
    { href: '/leader/dashboard', label: 'Сводка', icon: '⌂' },
    { href: '/leader/team', label: 'Команда', icon: '⚙' },
    { href: '/leader/finance', label: 'Финансы', icon: '₽' },
    { href: '/leader/orders', label: 'Заказы', icon: '📋' },
    { href: '/leader/organizations', label: 'Организации', icon: '🏢' },
    // Личный inbox (комментарии+чат) живёт в кабинете менеджера — см. план, «Отклонение от спеки».
    { href: '/manager/messages', label: 'Сообщения', icon: '💬' },
    // Переключатель «играющего тренера» в личный кабинет менеджера.
    { href: '/manager/dashboard', label: 'Мои заказы', icon: '↩' }
  ],
```

(Пункты leader-меню БЕЗ flag: внутрь пускает middleware+layout; флаг на каждом пункте дал бы пустой сайдбар при выключении — бессмысленно.)

В `navByRole.manager`:
- у пункта `/manager/team` («Команда», leaderOnly) добавить `hiddenWhenFlag: 'leader_cabinet'`;
- добавить ПОСЛЕ него пункт-вход: `{ href: '/leader/dashboard', label: 'Кабинет руководителя', icon: '⚙', flag: 'leader_cabinet', leaderOnly: true }`.

В `navItemsFor` — фильтр после существующих:

```ts
    if (item.hiddenWhenFlag && isFeatureEnabled(item.hiddenWhenFlag)) return false;
```

- [ ] **Step 2: Тест** `navigation.cabinet.leader.test.ts` (env save/restore как в partner-тесте):

```ts
describe('канон leader', () => {
  it('7 пунктов: сводка/команда/финансы/заказы/организации/сообщения/мои заказы', () => {
    expect(navByRole.leader.map((i) => i.href)).toEqual([
      '/leader/dashboard', '/leader/team', '/leader/finance',
      '/leader/orders', '/leader/organizations', '/manager/messages', '/manager/dashboard'
    ]);
  });
});

describe('меню менеджера при включённом leader_cabinet', () => {
  it('лидер: «Команда» уезжает, появляется «Кабинет руководителя»', () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager', { isManagerLeader: true }).map((i) => i.label);
    expect(labels).not.toContain('Команда');
    expect(labels).toContain('Кабинет руководителя');
  });
  it('при выключенном флаге всё как раньше: «Команда» у лидера, входа в /leader нет', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager', { isManagerLeader: true }).map((i) => i.label);
    expect(labels).toContain('Команда');
    expect(labels).not.toContain('Кабинет руководителя');
  });
  it('рядовой менеджер не видит ни «Команду», ни «Кабинет руководителя» ни при каком флаге', () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    process.env.FEATURE_MANAGER_CABINET = '1';
    const labels = navItemsFor('manager').map((i) => i.label);
    expect(labels).not.toContain('Команда');
    expect(labels).not.toContain('Кабинет руководителя');
  });
});
```

- [ ] **Step 3:** FAIL → правки → PASS; прогнать также `navigation.cabinet.partner.test.ts` и оба sidebar-теста (Record-ключ добавился — typecheck).

- [ ] **Step 4: Commit**

```bash
git add src/lib/navigation/cabinet.ts src/__tests__/navigation.cabinet.leader.test.ts
git commit -m "feat(nav): leader cabinet canon + cross-links in manager menu"
```

---

### Task 4: Шелл и layout кабинета руководителя

**Files:**
- Create: `src/components/leader/leader-sidebar.tsx`, `src/components/leader/leader-app-shell.tsx`
- Create: `src/app/leader/layout.tsx`
- Test: `src/__tests__/components.leader-sidebar.test.tsx`

- [ ] **Step 1: LeaderSidebar** — скопировать [manager-sidebar.tsx](../../src/components/manager/manager-sidebar.tsx) (items-prop версию после PR #118) с заменами: заголовок `Менеджер` → `Руководитель`, подзаголовок `Промтехносфера` остаётся, `data-testid={'leader-nav-...'}`. Никакой своей логики.

- [ ] **Step 2: LeaderAppShell** — скопировать `manager-app-shell.tsx` с заменами: `<LeaderSidebar items={navItemsFor('leader')} />` (без opts — leader-меню не фильтруется по суб-роли), шапка `Кабинет руководителя`, `LogoutButton` как есть.

- [ ] **Step 3: layout** `src/app/leader/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { LeaderAppShell } from '@/components/leader/leader-app-shell';

export default async function LeaderLayout({ children }: { children: ReactNode }) {
  // Третья точка гейтинга (после middleware и nav): прямой заход при выключенном флаге -> 404.
  if (!isFeatureEnabled('leader_cabinet')) notFound();
  const session = await requireManagerLeader();
  return <LeaderAppShell session={session}>{children}</LeaderAppShell>;
}
```

(`session` нужен шеллу для будущего; если LeaderAppShell его не использует — не передавать, проверь по факту после Step 2.)

- [ ] **Step 4: Тест сайдбара** — по образцу `components.manager-sidebar.test.tsx`: рендер с `items: navByRole.leader`, ассерты на 7 ссылок (включая `/manager/messages` и `/manager/dashboard`), заголовок «Руководитель». `import React` обязателен (vitest без react-плагина).

- [ ] **Step 5:** `npm run typecheck` + тест → PASS. Commit:

```bash
git add src/components/leader src/app/leader/layout.tsx src/__tests__/components.leader-sidebar.test.tsx
git commit -m "feat(leader): app shell, sidebar, flag-gated layout"
```

---

### Task 5: Company-wide данные — `teamModeOverride` + «лидер открывает любой заказ компании»

**Files:**
- Modify: `src/lib/services/manager/orders.ts` (`listOrders`, `getOrder`), `src/lib/services/manager/organizations.ts` (`listOrganizations`), `src/lib/services/manager/dashboard/{kpis,attention,events}.ts`
- Modify: `src/lib/auth/requireRole.ts` (`requireManagerForOrder`)
- Tests: `src/__tests__/services.manager.orders.override.test.ts` (новый), правки в `src/__tests__/auth.requireManager.test.ts`

Сейчас каждый из этих сервисов вычисляет scope сам: `const teamMode = await getCompanyTeamVisibility(prisma, session.companyId)`. Кабинет руководителя должен быть company-wide **независимо от toggle**, при этом личный кабинет менеджера у лидера остаётся скоупным (решение «играющий тренер»).

- [ ] **Step 1: Падающий тест** `services.manager.orders.override.test.ts` (mock-паттерн `vi.hoisted` как в `services.manager.finance.test.ts`):

```ts
describe('listOrders teamModeOverride', () => {
  it('override=true даёт company-wide where даже при выключенном toggle', async () => {
    // мок getCompanyTeamVisibility -> false; session companyId='c1', managedOrgIds=[]
    // вызов listOrders(prisma, { session, teamModeOverride: true })
    // ассерт: prisma.order.findMany вызван с where, содержащим { companyId: 'c1' } (не OR-скоуп)
  });
  it('без override поведение прежнее (toggle решает)', async () => { /* override отсутствует -> читается getCompanyTeamVisibility */ });
});
```

- [ ] **Step 2: Реализация override.** В каждом из 5 сервисов добавить опциональный параметр и одну строку:

`listOrders(prisma, opts)` — в тип opts добавить `teamModeOverride?: boolean;`, строку 47 заменить на:
```ts
  const teamMode = opts.teamModeOverride ?? (await getCompanyTeamVisibility(prisma, opts.session.companyId));
```

`listOrganizations`, `kpis`, `attention`-модуль, `events`-модуль — у них session-параметр; добавить третий опциональный аргумент `teamModeOverride?: boolean` и ту же подстановку (`teamModeOverride ?? await ...`). Существующие вызовы не меняются (параметр опционален).

- [ ] **Step 3: Гард детали заказа.** В `requireManagerForOrder` ([requireRole.ts:119](../../src/lib/auth/requireRole.ts)) после загрузки `order` добавить leader-правило ПЕРЕД three-way проверкой:

```ts
  // Руководитель открывает любой заказ своей компании (лидер-инвариант C8:
  // граница — компания). Личные СПИСКИ менеджера это не расширяет — только деталь.
  if (isManagerLeader(session) && session.companyId && order.companyId === session.companyId) {
    return { session, order };
  }
```

(импорт `isManagerLeader` из managerPolicy). Симметрично в `getOrder` (`services/manager/orders.ts:94`): после загрузки order — `if (isManagerLeader(session) && session.companyId && order.companyId === session.companyId) { /* пропустить canSeeOrder-проверку */ }` — встроить в существующую проверку: `const leaderSameCompany = isManagerLeader(session) && !!session.companyId && order.companyId === session.companyId; if (!leaderSameCompany && !canSeeOrder(...)) return null;`

КРИТИЧНО: cross-company инвариант — лидер компании A НЕ видит заказ компании B: правило требует `order.companyId === session.companyId`, при `companyId=null` у лидера — deny (правило не срабатывает, дальше обычный путь).

- [ ] **Step 4: Тесты гарда.** В `auth.requireManager.test.ts` (или рядом) добавить кейсы: лидер + заказ своей компании (toggle OFF) → ok; лидер + заказ ЧУЖОЙ компании → notFound; лидер с companyId=null → правило не срабатывает (обычный three-way).

- [ ] **Step 5:** `npm run typecheck` + новые/затронутые тесты + `npx vitest run --mode=unit src/__tests__/services.manager.finance.test.ts src/__tests__/auth.managerPolicy.test.ts` → PASS. Commit:

```bash
git add -A
git commit -m "feat(leader): teamModeOverride in manager services + leader opens any company order"
```

---

### Task 6: Переезд «Команды» — `/leader/team` + redirect со старого адреса

**Files:**
- Create: `src/app/leader/team/page.tsx`
- Modify: `src/app/manager/team/page.tsx`

- [ ] **Step 1:** `src/app/leader/team/page.tsx` — содержимое текущей [manager/team/page.tsx](../../src/app/manager/team/page.tsx) как есть (гард `requireManagerLeader` там уже стоит; layout добавляет флаг-гейт). Компоненты `TeamVisibilityToggle`/`ManagerRosterPanel` переиспользуются без изменений — они в `components/manager/`, это тот же домен (лидер = manager-роль), sibling-правило §4 не нарушается.

- [ ] **Step 2:** `src/app/manager/team/page.tsx` заменить на:

```tsx
import { redirect, notFound } from 'next/navigation';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { requireManagerLeader } from '@/lib/auth/requireRole';

// «Команда» переехала в кабинет руководителя. Старый адрес остаётся
// redirect-ом, чтобы закладки/ссылки не ломались. При выключенном
// leader_cabinet страница работает по-старому — см. git-историю этого файла.
export default async function ManagerTeamPage() {
  if (isFeatureEnabled('leader_cabinet')) {
    await requireManagerLeader();
    redirect('/leader/team');
  }
  // ↓ прежнее содержимое страницы (toggle + roster) — НЕ удалять, пока флаг не выпилен
  ...
}
```

То есть: НЕ удалять старый рендер — обернуть его веткой «флаг выключен» (старое поведение полностью сохраняется до постоянного включения флага). Импорты объединить.

- [ ] **Step 3:** `npm run typecheck`; ручная проверка в dev (флаг on: /manager/team → /leader/team; флаг off: прежняя страница). Commit:

```bash
git add src/app/leader/team/page.tsx src/app/manager/team/page.tsx
git commit -m "feat(leader): move team hub to /leader/team with legacy redirect"
```

---

### Task 7: Сервис «Сводка по команде»

**Files:**
- Create: `src/lib/services/leader/dashboard.ts`
- Test: `src/__tests__/services.leader.dashboard.test.ts`

- [ ] **Step 1: Падающий тест** (mock-паттерн `vi.hoisted`; мокать `getManagerFinanceOverview` и prisma):

```ts
import { describe, it, expect, vi } from 'vitest';

const { financeMock } = vi.hoisted(() => ({ financeMock: vi.fn() }));
vi.mock('@/lib/services/manager/finance', () => ({ getManagerFinanceOverview: financeMock }));

import { leaderDashboard } from '@/lib/services/leader/dashboard';

describe('leaderDashboard', () => {
  it('собирает KPI: менеджеры, активные заказы, долг, комиссия за месяц', async () => {
    // prisma-мок: user.count -> 4; order.count -> 17; order.groupBy -> строки per-manager
    // financeMock -> { summary: { billed: '1000', paid: '400', outstanding: '600' },
    //                  sections: [{ commission: { amount: '90' } }, { commission: null }], canSeeCommission: true }
    // ассерты: kpis.managers=4, kpis.activeOrders=17, kpis.debt='600', kpis.commission='90'
  });
  it('perManager: строки агрегируются по managerId с именами из ростера', async () => { /* groupBy + user-роста join */ });
  it('companyId=null -> пустой результат, не падение', async () => {});
});
```

- [ ] **Step 2: Реализация:**

```ts
// src/lib/services/leader/dashboard.ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { listCompanyManagers } from '@/lib/services/manager/team';

export type LeaderKpis = {
  managers: number;
  activeOrders: number;
  /** Decimal-суммы сериализуем строками (контракт сервисов). */
  debt: string;
  commission: string | null; // null когда комиссии нет ни по одной организации
};

export type LeaderManagerRow = {
  managerId: string;
  name: string;
  email: string;
  activeOrders: number;
  totalAmount: string;
  paidAmount: string;
  overdue: number; // заказы с deadline < now и executionStatus не completed/cancelled
};

export type LeaderDashboard = {
  kpis: LeaderKpis;
  perManager: LeaderManagerRow[];
};

/**
 * «Сводка по команде» руководителя. Company-wide ВСЕГДА (инвариант C8: граница
 * — компания; toggle managerTeamVisibility на кабинет руководителя не влияет).
 * Финансовые агрегаты — через getManagerFinanceOverview(teamMode:true), чтобы
 * расчёт комиссии жил в одном месте (field-gate уже там).
 */
export async function leaderDashboard(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<LeaderDashboard> {
  const companyId = session.companyId;
  if (!companyId) {
    return { kpis: { managers: 0, activeOrders: 0, debt: '0.00', commission: null }, perManager: [] };
  }

  const ACTIVE = { in: ['pending', 'in_progress'] as const };

  const [managers, activeOrders, grouped, overdueGrouped, finance] = await Promise.all([
    listCompanyManagers(prisma, companyId),
    prisma.order.count({ where: { companyId, executionStatus: ACTIVE } }),
    prisma.order.groupBy({
      by: ['managerId'],
      where: { companyId },
      _count: { _all: true },
      _sum: { totalAmount: true, paidAmount: true }
    }),
    prisma.order.groupBy({
      by: ['managerId'],
      where: { companyId, deadline: { lt: new Date() }, executionStatus: ACTIVE },
      _count: { _all: true }
    }),
    getManagerFinanceOverview(prisma, session, { teamMode: true })
  ]);

  const overdueBy = new Map(overdueGrouped.map((g) => [g.managerId, g._count._all]));
  const aggBy = new Map(grouped.map((g) => [g.managerId, g]));

  const perManager: LeaderManagerRow[] = managers.map((m) => {
    const agg = aggBy.get(m.id);
    return {
      managerId: m.id,
      name: m.name,
      email: m.email,
      activeOrders: agg?._count._all ?? 0,
      totalAmount: String(agg?._sum.totalAmount ?? '0'),
      paidAmount: String(agg?._sum.paidAmount ?? '0'),
      overdue: overdueBy.get(m.id) ?? 0
    };
  });

  let commissionTotal = 0;
  let hasCommission = false;
  for (const s of finance.sections) {
    if (s.commission) {
      hasCommission = true;
      commissionTotal += Number(s.commission.amount);
    }
  }

  return {
    kpis: {
      managers: managers.length,
      activeOrders,
      debt: finance.summary.outstanding,
      commission: hasCommission ? commissionTotal.toFixed(2) : null
    },
    perManager
  };
}
```

ПРОВЕРЬ ПЕРЕД НАПИСАНИЕМ: фактическую форму `OrgIntermediaryCommission` (поле суммы может называться не `amount` — открой `src/lib/services/organization/finance.ts` и подставь реальное имя); `_count: { _all: true }` синтаксис groupBy; `activeOrders` в perManager считается по ВСЕМ заказам менеджера компании (`_count._all` от общего groupBy) — если хочется только активных, нужен третий groupBy с ACTIVE-фильтром: сделай именно так, чтобы колонка совпадала по смыслу с KPI (активные заказы).

- [ ] **Step 3:** Тест → PASS; `npm run typecheck`. Commit:

```bash
git add src/lib/services/leader src/__tests__/services.leader.dashboard.test.ts
git commit -m "feat(leader): team summary dashboard service (company-wide aggregates)"
```

---

### Task 8: Страницы — Сводка, Заказы, Организации, Финансы

**Files:**
- Create: `src/app/leader/dashboard/page.tsx`, `src/app/leader/orders/page.tsx`, `src/app/leader/organizations/page.tsx`, `src/app/leader/finance/page.tsx`
- Create: `src/components/leader/leader-managers-table.tsx`
- Test: `src/__tests__/components.leader-managers-table.test.tsx`

Все четыре страницы — тонкие: гард уже в layout (`requireManagerLeader` + флаг). Каждая страница повторно вызывает `requireManagerLeader()` (принцип №6 — page-level canSee*-чек, как у организации).

- [ ] **Step 1: Сводка** `src/app/leader/dashboard/page.tsx`:

```tsx
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { leaderDashboard } from '@/lib/services/leader/dashboard';
import { StatCard } from '@/components/dashboard/stat-card';
import { fmtMoney } from '@/lib/format';
import { LeaderManagersTable } from '@/components/leader/leader-managers-table';

export const dynamic = 'force-dynamic';

export default async function LeaderDashboardPage() {
  const session = await requireManagerLeader();
  const data = await leaderDashboard(prisma, session);
  return (
    <div className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Сводка по команде</h1>
        <p className='text-sm text-gray-500 mt-0.5'>Все менеджеры и заказы компании</p>
      </div>
      <div className='grid gap-3 grid-cols-2 md:grid-cols-4'>
        <StatCard title='Менеджеров' value={data.kpis.managers} href='/leader/team' />
        <StatCard title='Заказы в работе' value={data.kpis.activeOrders} href='/leader/orders' />
        <StatCard title='Долг клиентов' value={fmtMoney(data.kpis.debt)} href='/leader/finance' />
        <StatCard
          title='Комиссия (оценка)'
          value={data.kpis.commission === null ? '—' : fmtMoney(data.kpis.commission)}
          href='/leader/finance'
          accent
        />
      </div>
      <LeaderManagersTable rows={data.perManager} />
      <ManagerEventsFeed events={events} />
    </div>
  );
}
```

События команды: страница дополнительно вызывает events-модуль менеджерского дашборда с override (Task 5 его добавил) и переиспользует `ManagerEventsFeed` (ссылки событий ведут в `/manager/orders/[id]` — работает по leader-правилу Task 5). Открой `src/lib/services/manager/dashboard/events.ts`, возьми фактическое имя экспортируемой функции и её сигнатуру (как на manager/dashboard/page.tsx), добавь в `Promise.all` страницы рядом с `leaderDashboard`:

```tsx
import { ManagerEventsFeed } from '@/components/manager/manager-events-feed';
// + фактический импорт events-функции из '@/lib/services/manager/dashboard'
// const [data, events] = await Promise.all([leaderDashboard(...), <events>(prisma, session, /* teamModeOverride */ true)]);
```

- [ ] **Step 2: Таблица по менеджерам** `leader-managers-table.tsx` — серверный презентационный компонент на table-примитивах из `@/components/ui` (как 21 существующая таблица; образец — `manager-students-table.tsx`): колонки «Менеджер (имя+email)», «Активных заказов», «Сумма», «Оплачено», «Просрочено» (значение >0 — красным `text-red-700`); деньги через `fmtMoney`; пустой ростер → `<EmptyState icon='👥' message='В компании пока нет менеджеров.' />`. Тест: рендер с 2 строками (ассерты на имя, суммы с NBSP, красную просрочку) + пустой кейс.

- [ ] **Step 3: Заказы** `src/app/leader/orders/page.tsx` — копия manager/orders/page.tsx с тремя отличиями: гард `requireManagerLeader`, оба вызова с override:

```tsx
  const [{ rows, nextCursor }, orgs] = await Promise.all([
    listOrders(prisma, { session, ...sp, teamModeOverride: true }),
    listOrganizations(prisma, session, true)
  ]);
```

подзаголовок `<p className='text-sm text-gray-500'>Все заказы компании</p>`. `ManagerOrdersFilter`/`ManagerOrdersTable` переиспользуются как есть (ссылки строк ведут в `/manager/orders/[id]` — работает благодаря leader-правилу из Task 5). ВНИМАНИЕ: проверь фактическую сигнатуру `listOrganizations` после Task 5 (позиционный или opts-параметр) и согласуй.

- [ ] **Step 4: Организации** `src/app/leader/organizations/page.tsx` — копия manager/organizations/page.tsx (открой её) с гардом `requireManagerLeader` и `teamModeOverride: true`; переиспользовать её компоненты.

- [ ] **Step 5: Финансы** `src/app/leader/finance/page.tsx`:

```tsx
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

export const dynamic = 'force-dynamic';

export default async function LeaderFinancePage() {
  const session = await requireManagerLeader();
  // teamMode: true — company-wide всегда; комиссия видна (isManagerLeader -> canSeeCommission в сервисе).
  const data = await getManagerFinanceOverview(prisma, session, { teamMode: true });
  return (
    <>
      <h1 className='mb-1 text-2xl font-semibold text-[#111111]'>Финансы</h1>
      <p className='text-sm text-gray-500 mb-6'>Оплаты и комиссия по всем организациям компании</p>
      <ManagerFinanceView data={data} />
    </>
  );
}
```

- [ ] **Step 6:** `npm run typecheck` + тест таблицы → PASS. Commit:

```bash
git add src/app/leader src/components/leader src/__tests__/components.leader-managers-table.test.tsx
git commit -m "feat(leader): dashboard, orders, organizations, finance pages"
```

---

### Task 9: Seed-руководитель + кнопка «Руководитель» в демо-входе

**Files:**
- Modify: `prisma/seed.ts` (после блока manager@demo.local)
- Modify: `src/app/(auth)/login/page.tsx` (DEMO_LOGINS)

- [ ] **Step 1: Seed.** После manager-блока добавить:

```ts
  // ─── Demo: manager-leader (кнопка «Руководитель» на /login) ─────────
  // ВАЖНО: companyId обязателен — company-wide scope лидера выводится из него
  // (companyId=null деградирует в deny/скоуп, см. managerPolicy).
  await prisma.user.upsert({
    where: { email: 'leader@demo.local' },
    update: { role: 'manager', managerRole: 'leader', isActive: true, passwordHash, name: 'Demo Leader', companyId: company.id },
    create: {
      email: 'leader@demo.local',
      name: 'Demo Leader',
      passwordHash,
      role: 'manager',
      managerRole: 'leader',
      companyId: company.id
    }
  });
```

И строку вывода: `console.log('  - leader@demo.local (manager-leader, company-wide)');`

ПРОВЕРКА ДАННЫХ: company-wide выборки лидера фильтруют по `Order.companyId === user.companyId`. Убедись (временным скриптом `scripts/tmp-check-leader.ts`, удалить после), что synced-заказы сида имеют `companyId === 'demo-company'`; если нет (другая company) —在 seed выставить лидеру `companyId` той компании, к которой привязаны заказы (вывести фактический `order.companyId` и использовать его). Несовпадение = пустой кабинет руководителя на демо — обнаружить сейчас, не в smoke.

Заодно: у `manager@demo.local` в seed НЕТ `companyId` — для консистентности команды добавить ему `companyId` тем же значением в `update`/`create` (иначе лидер увидит в ростере 0 менеджеров — `listCompanyManagers` фильтрует по `User.companyId`).

- [ ] **Step 2: Кнопка.** В `DEMO_LOGINS` добавить после «Менеджер»:

```ts
  { label: 'Руководитель', email: 'leader@demo.local', password: 'Password123!' },
```

- [ ] **Step 3:** Прогнать сид (`npm run prisma:seed`; процесс не завершается сам — BullMQ, убить после `[seed] done`), проверить tmp-скриптом лидера и companyId заказов, удалить tmp-скрипт. Commit:

```bash
git add prisma/seed.ts "src/app/(auth)/login/page.tsx"
git commit -m "feat(demo): leader demo account + login shortcut"
```

---

### Task 10: Финальная верификация + smoke

**Files:** только прогоны и ручная проверка (плюс мелкие фиксы, если всплывут).

- [ ] **Step 1:** Полные ворота:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Всё зелёное (build предупреждает про BullMQ critical-dependency — известный warning).

- [ ] **Step 2: Smoke с включёнными флагами** (в `.env`: `FEATURE_LEADER_CABINET=1`, `FEATURE_MANAGER_CABINET=1`; dev + сид):

1. Вход кнопкой «Руководитель» → попадаем на `/leader/dashboard` (а не /manager).
2. Меню: 7 пунктов; «Сводка» активна; KPI-плитки кликабельны и числа ненулевые (если сид-данные совпали по companyId).
3. «Команда»: ростер менеджеров компании + toggle видимости работает (это перенесённая страница).
4. «Финансы»: блок комиссии ВИДЕН (лидер); сравнить сумму с KPI «Комиссия (оценка)».
5. «Заказы»: видны заказы всей компании при ВЫКЛЮЧЕННОМ toggle managerTeamVisibility; клик по строке открывает деталь в /manager/orders/[id] без notFound.
6. «Мои заказы» → личный кабинет менеджера; в его меню есть «Кабинет руководителя» и НЕТ «Команды»; «Финансы» менеджера — без комиссии.
7. Вход `manager@demo.local` (рядовой): прямой заход на `/leader/dashboard` → /forbidden; пункта «Кабинет руководителя» в меню нет.
8. Вход `org@demo.local`: `/leader/dashboard` → /forbidden (middleware, роль).
9. Cross-company инвариант (код-уровень, без второй компании в сиде): убедиться, что в `requireManagerForOrder` leader-правило сравнивает companyId (покрыто unit-тестом Task 5) — отметить в отчёте.

- [ ] **Step 3: Smoke с ВЫКЛЮЧЕННЫМ `leader_cabinet`:**

1. Вход «Руководитель» → `/manager/dashboard` (старое поведение).
2. В меню менеджера у лидера снова «Команда» → `/manager/team` работает по-старому (toggle+ростер).
3. Прямой `/leader/dashboard` → 404.

- [ ] **Step 4:** Если smoke выявил несоответствия — чинить и перепрогонять ворота. Затем close-out `docs/superpowers/plans/2026-06-12-leader-cabinet-DONE.md` (по конвенции §8: companion-файл, не переименование) и commit:

```bash
git add -A
git commit -m "chore(leader): final verification + close-out"
```

---

## Definition of Done

- Три точки гейтинга `leader_cabinet` на месте: middleware (404), nav (пункт «Кабинет руководителя» + hiddenWhenFlag «Команды»), layout (`notFound()`).
- `rg "teamModeOverride" src/lib/services` — ровно 5 сервисов; `rg "leader_cabinet" src` — флаг, middleware, cabinet.ts, layout, seed-нет (seed флаг не читает).
- Лидер при toggle OFF видит company-wide в `/leader/*` и личный скоуп в `/manager/*`; рядовой менеджер в `/leader` → /forbidden; чужая роль → /forbidden; флаг off → 404 и старое поведение «Команды».
- Комиссия видна в `/leader/finance` и НЕ видна в `/manager/finance` рядового менеджера (существующий тест-инвариант не сломан).
- typecheck / lint / test:unit / build зелёные; smoke-чеклист Task 10 пройден.
