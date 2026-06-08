# Role Consistency — P3 (унификация навигации организации) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Свести навигацию кабинета организации к **единому источнику** `navByRole.organization` (ось 2 аудита): убрать мёртвую заглушку + хардкод-список `OrgSidebar.ITEMS`, сделать `navByRole.organization` каноном из 8 пунктов и потреблять его в `OrgSidebar` через проп от server-шелла.

**Architecture:** `OrgSidebar` остаётся client-компонентом (нужен per-org switcher: cookie `org_ctx` + query `?org=` + `useRouter`/`usePathname`). Но пункты меню больше не хардкодятся: server-компонент `OrgAppShell` вызывает `navItemsFor('organization')` (флаг-фильтрация `chat`) и передаёт результат пропом `items` в `OrgSidebar`, который делает только viewerRole-фильтрацию (`orgAdminOrLeaderOnly` → Команда) + active-state + icons. Это устраняет второй источник правды, сохраняя client-поведение и defense-in-depth §4 (доступ к страницам по-прежнему гарантируют middleware + page-гарды + сервис-скоуп; меню — только видимость).

**Tech Stack:** Next.js 15 (App Router; server↔client component boundary), TypeScript strict, Vitest (`renderToString` для client-компонента, `import React` обязателен — см. CLAUDE.md memory о classic JSX transform).

**Источник:** [role-consistency-audit spec](../specs/2026-06-07-role-consistency-audit-design.md) §3 ось 2, §6 строка 6, §7 (e2e org-проект). Предшественники: [P1](2026-06-07-role-consistency-p1.md), [P2](2026-06-08-role-consistency-p2.md).

**Продуктовое решение (пользователь, 2026-06-08):** канон org-меню = **8 пунктов** — Главная, Заказы, Документы, Финансы, Сотрудники, Команда (admin|leader), **Сообщения** (флаг `chat`), **Кабинет слушателя** (`/student`). Добавление «Сообщения» закрывает gap (страница `/organization/messages` существует и chat-gated, но ссылки в меню не было); «Кабинет слушателя» закрывает spec C-c.

---

## Контекст: как устроено сейчас (зафиксировано до плана)

- Каждая `/organization/*` страница: `getOrgPageContext(searchParams)` (server, `src/lib/auth/orgPageContext.ts`) → резолвит `session`/`activeOrgId`/`memberships`/`viewerRole` (`admin|leader|member`) → оборачивает в `OrgAppShell` (`src/components/organization/org-app-shell.tsx`) → рендерит `OrgSidebar` (`src/components/organization/org-sidebar.tsx`, `'use client'`).
- `OrgSidebar` хардкодит `ITEMS` (6 пунктов; «Команда» = `adminOnly`, видна admin|leader) + сам делает switcher/active-state/icons.
- `navByRole.organization` (`src/lib/navigation/cabinet.ts`) — **мёртвая заглушка** (dashboard `organization_cabinet`, `/student`, messages `chat`), рендерится нигде (org идёт через `OrgAppShell`, а не generic `AppShell`). НО частично под тестом: `navigation.cabinet.partner.test.ts` проверяет `navByRole.organization` messages-пункт (flag `chat`) через `navItemsFor('organization')`.
- Конфликт двух источников: `components.org-sidebar.test.tsx` ждёт 6/5/6 пунктов; `navigation.cabinet.partner.test.ts` ждёт messages в `navByRole.organization`.

---

## File Structure

| Файл | Роль в P3 | Задача |
|---|---|---|
| `src/lib/navigation/cabinet.ts` | `NavItem` + `icon?` + `orgAdminOrLeaderOnly?`; `navByRole.organization` = канон 8 пунктов | Task 1 |
| `src/__tests__/navigation.cabinet.partner.test.ts` | новый describe для канона `navByRole.organization` (+ существующие chat-тесты остаются зелёными) | Task 1 |
| `src/components/organization/org-sidebar.tsx` | проп `items: NavItem[]`; убрать хардкод `ITEMS`; фильтр `orgAdminOrLeaderOnly` по `viewerRole` | Task 2 |
| `src/components/organization/org-app-shell.tsx` | вычислить `navItemsFor('organization')` (server, флаг-фильтр) → проп `items` | Task 2 |
| `src/__tests__/components.org-sidebar.test.tsx` | передавать `items`; новые счётчики (admin/leader/member) | Task 2 |
| spec §6 + close-out | пометить P3 done | Task 3 |

**Порядок:** 1 (источник данных) → 2 (потребление в UI) → 3 (финал). Task 1 не меняет UX (OrgSidebar пока на хардкоде); Task 2 переключает рендер на единый источник.

---

## Task 1: Единый источник — `NavItem` + `navByRole.organization` (канон 8 пунктов)

**Контекст:** расширяем `NavItem` под нужды org (иконка + гейтинг «admin|leader»), заполняем `navByRole.organization` каноном. `navItemsFor` уже фильтрует по `flag` — `chat` на «Сообщения» заработает. `orgAdminOrLeaderOnly` НЕ фильтруется в `navItemsFor` (там нет `viewerRole`) — это делает `OrgSidebar` (Task 2); документируем.

**Files:**
- Modify: `src/lib/navigation/cabinet.ts:4` (тип `NavItem`), `:35-39` (`navByRole.organization`)
- Test: `src/__tests__/navigation.cabinet.partner.test.ts`

- [ ] **Step 1: Написать падающий тест канона `navByRole.organization`**

В `src/__tests__/navigation.cabinet.partner.test.ts` добавить в конец файла новый describe (рядом с существующим `navItemsFor — chat flag (organization)`):

```ts
describe('navByRole.organization — единый источник (канон 8 пунктов)', () => {
  it('содержит 6 базовых пунктов + Сообщения + Кабинет слушателя', () => {
    const hrefs = navByRole.organization.map((i) => i.href);
    expect(hrefs).toEqual([
      '/organization/dashboard',
      '/organization/orders',
      '/organization/documents',
      '/organization/finance',
      '/organization/students',
      '/organization/team',
      '/organization/messages',
      '/student'
    ]);
  });

  it('«Команда» помечена orgAdminOrLeaderOnly', () => {
    const team = navByRole.organization.find((i) => i.href === '/organization/team');
    expect(team?.orgAdminOrLeaderOnly).toBe(true);
  });

  it('каждый пункт имеет иконку', () => {
    expect(navByRole.organization.every((i) => typeof i.icon === 'string' && i.icon.length > 0)).toBe(true);
  });

  it('«Кабинет слушателя» указывает на /student', () => {
    const student = navByRole.organization.find((i) => i.href === '/student');
    expect(student?.label).toBe('Кабинет слушателя');
    expect(student?.flag).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/__tests__/navigation.cabinet.partner.test.ts -t "единый источник"`
Expected: FAIL — заглушка содержит 3 пункта, нет `icon`/`orgAdminOrLeaderOnly`.

- [ ] **Step 3: Расширить тип `NavItem`**

В `src/lib/navigation/cabinet.ts` строка 4 заменить:

```ts
export type NavItem = { href: string; label: string; disabled?: boolean; flag?: FeatureFlag; leaderOnly?: boolean; partnerAdminOnly?: boolean };
```

на:

```ts
export type NavItem = {
  href: string;
  label: string;
  disabled?: boolean;
  flag?: FeatureFlag;
  leaderOnly?: boolean;
  partnerAdminOnly?: boolean;
  /** Иконка для org-sidebar (emoji). Прочие шеллы её игнорируют. */
  icon?: string;
  /** Виден только org-admin и org-leader (фильтруется в OrgSidebar по viewerRole, НЕ в navItemsFor). */
  orgAdminOrLeaderOnly?: boolean;
};
```

- [ ] **Step 4: Заполнить `navByRole.organization` каноном**

В `src/lib/navigation/cabinet.ts` заменить блок (строки 35-39):

```ts
  organization: [
    { href: '/organization/dashboard', label: 'Dashboard организации', flag: 'organization_cabinet' },
    { href: '/student', label: 'Кабинет слушателя' },
    { href: '/organization/messages', label: 'Сообщения', flag: 'chat' }
  ],
```

на:

```ts
  organization: [
    { href: '/organization/dashboard', label: 'Главная', icon: '⌂' },
    { href: '/organization/orders', label: 'Заказы', icon: '📋' },
    { href: '/organization/documents', label: 'Документы', icon: '📄' },
    { href: '/organization/finance', label: 'Финансы', icon: '₽' },
    { href: '/organization/students', label: 'Сотрудники', icon: '👥' },
    { href: '/organization/team', label: 'Команда', icon: '⚙', orgAdminOrLeaderOnly: true },
    { href: '/organization/messages', label: 'Сообщения', icon: '💬', flag: 'chat' },
    { href: '/student', label: 'Кабинет слушателя', icon: '🎓' }
  ],
```

> Примечание: «Главная» (не «Dashboard организации») — сохраняем live-лейбл из текущего `OrgSidebar`. `organization_cabinet`-флаг на dashboard НЕ ставим: весь `/organization` уже gated этим флагом в middleware, а внутри кабинета он всегда on (иначе сюда не попасть) — это совпадает с текущим live-меню (на 6 пунктах флагов нет).

- [ ] **Step 5: Запустить новые + существующие org-тесты**

Run: `npx vitest run src/__tests__/navigation.cabinet.partner.test.ts`
Expected: PASS — новый describe зелёный; существующий `navItemsFor — chat flag (organization)` тоже (messages по-прежнему есть, flag `chat`; `navItemsFor` фильтрует его). Partner/manager describe'ы не затронуты.

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: PASS. (Если ошибки `syncSchedulePause` на PrismaClient — сначала `npm run prisma:generate`, это несвязанный устаревший клиент.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/navigation/cabinet.ts src/__tests__/navigation.cabinet.partner.test.ts
git commit -m "feat(nav): navByRole.organization becomes the single source (8-item canon)

Ось 2 аудита: заглушка navByRole.organization заменена каноном из 8
пунктов (6 текущих + Сообщения chat-gated + Кабинет слушателя). NavItem
получил icon? и orgAdminOrLeaderOnly?. OrgSidebar переключится на этот
источник в следующем коммите.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Потребление — `OrgSidebar` через проп `items` от `OrgAppShell`

**Контекст:** `OrgSidebar` (client) больше не хардкодит `ITEMS`. Он принимает уже флаг-отфильтрованный `items: NavItem[]` (server вычисляет через `navItemsFor('organization')` — это убирает `chat`-messages, когда флаг off) и сам фильтрует `orgAdminOrLeaderOnly` по `viewerRole`. Switcher/active-state/icons сохраняются.

**Files:**
- Modify: `src/components/organization/org-sidebar.tsx`
- Modify: `src/components/organization/org-app-shell.tsx`
- Test: `src/__tests__/components.org-sidebar.test.tsx`

- [ ] **Step 1: Обновить тест `components.org-sidebar.test.tsx` (новый контракт пропа)**

Заменить три count-теста и добавить импорт источника. В начало файла (после `import { OrgSidebar, type OrgSidebarMembership }`) добавить:

```ts
import { navByRole, type NavItem } from '@/lib/navigation/cabinet';

const ALL_ORG_ITEMS: NavItem[] = navByRole.organization; // 8 пунктов (флаг-фильтрацию делает navItemsFor на сервере; здесь передаём полный список для проверки viewerRole-фильтра)
```

Заменить тест «renders 6 nav links for admin viewer»:

```ts
  it('renders all 8 nav links for admin viewer', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin'
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(8);
    expect(html).toContain('href="/organization/team"');
  });
```

Заменить тест «renders 5 nav links for member viewer (hides Команда)»:

```ts
  it('hides Команда for member viewer (7 links)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_MEMBER,
        activeOrgId: 'org-A',
        viewerRole: 'member'
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(7);
    expect(html).not.toContain('href="/organization/team"');
  });
```

Заменить тест «renders 6 nav links for leader viewer (shows Команда)»:

```ts
  it('shows Команда for leader viewer (8 links)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_LEADER,
        activeOrgId: 'org-A',
        viewerRole: 'leader'
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(8);
    expect(html).toContain('href="/organization/team"');
  });
```

В остальных 4 тестах (active-state ×2, switcher ×2) добавить `items: ALL_ORG_ITEMS,` в объект пропов `OrgSidebar` (рядом с `memberships`). Их ассерты (active на dashboard/orders, switcher) остаются валидны — эти пункты есть в каноне.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/__tests__/components.org-sidebar.test.tsx`
Expected: FAIL — `OrgSidebar` ещё не принимает `items` (TS-ошибка пропа / старые счётчики 6/5/6).

- [ ] **Step 3: Переписать `OrgSidebar` на проп `items`**

В `src/components/organization/org-sidebar.tsx`:

(a) Добавить импорт типа в начало (после `import { usePathname, useRouter, useSearchParams }`):

```ts
import type { NavItem } from '@/lib/navigation/cabinet';
```

(b) Удалить локальный тип `NavItem` (строка 7) и массив `ITEMS` (строки 9-16) целиком.

(c) Изменить сигнатуру `OrgSidebar` props — добавить `items`:

```ts
export function OrgSidebar(props: {
  items: NavItem[];
  memberships: OrgSidebarMembership[];
  activeOrgId: string;
  viewerRole: 'admin' | 'leader' | 'member';
}) {
```

(d) Заменить фильтр (строки 51-55) — c `adminOnly` на `orgAdminOrLeaderOnly`, по `props.items`:

```ts
  // orgAdminOrLeaderOnly items (Команда) видны admin И leader — оба управляют
  // командой (server action enforces per-row privilege). Флаг-фильтрация (chat)
  // уже сделана на сервере в navItemsFor — сюда приходит готовый список.
  const items = props.items.filter(
    (it) => !it.orgAdminOrLeaderOnly || props.viewerRole === 'admin' || props.viewerRole === 'leader'
  );
```

(e) В рендере иконки (строка 100) учесть, что `icon` опционален:

```tsx
                {item.icon ? <span className='text-base'>{item.icon}</span> : null}
```

(Остальное — `buildHref`, switcher, active-state, `data-testid` — без изменений.)

- [ ] **Step 4: Прокинуть `items` из `OrgAppShell` (server, флаг-фильтр)**

В `src/components/organization/org-app-shell.tsx`:

(a) Добавить импорт:

```ts
import { navItemsFor } from '@/lib/navigation/cabinet';
```

(b) В теле компонента до `return` вычислить items (server-side → `chat` фильтруется здесь):

```ts
  const items = navItemsFor('organization');
```

(c) Передать в `OrgSidebar`:

```tsx
      <OrgSidebar
        items={items}
        memberships={props.memberships}
        activeOrgId={props.activeOrgId}
        viewerRole={props.viewerRole}
      />
```

- [ ] **Step 5: Запустить тест компонента + typecheck**

Run: `npx vitest run src/__tests__/components.org-sidebar.test.tsx && npm run typecheck`
Expected: PASS — 8/7/8 + active/switcher; типы сходятся (`OrgAppShell` server вызывает `navItemsFor`, `OrgSidebar` client принимает `items`).

- [ ] **Step 6: lint + build (проверка server/client границы)**

Run: `npm run lint && npm run build`
Expected: PASS — критично: `build` подтверждает, что client-компонент `OrgSidebar` не тянет server-only код (он получает `items` пропом, а `navItemsFor`/`isFeatureEnabled` вызываются только в server-компоненте `OrgAppShell`). Если build ругается на «'use client' importing server-only» — значит где-то остался прямой импорт; убедиться, что `OrgSidebar` импортирует из `cabinet.ts` ТОЛЬКО `type NavItem` (type-only import стирается при компиляции).

- [ ] **Step 7: Commit**

```bash
git add src/components/organization/org-sidebar.tsx src/components/organization/org-app-shell.tsx src/__tests__/components.org-sidebar.test.tsx
git commit -m "refactor(org-nav): OrgSidebar consumes navByRole via items prop (single source)

Ось 2 аудита: убран хардкод OrgSidebar.ITEMS. OrgAppShell (server)
вычисляет navItemsFor('organization') (флаг-фильтр chat) и передаёт
items пропом в OrgSidebar (client), который делает только viewerRole-
фильтр (Команда) + switcher/active-state/icons. Org-меню теперь из
единого источника; пользователь видит +Сообщения (chat) +Кабинет слушателя.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Финальная верификация P3

- [ ] **Step 1: Полный unit-слой**

Run: `npm run test:unit`
Expected: PASS. Особое внимание: `components.org-sidebar`, `navigation.cabinet.partner`, `featureFlags.manager`.

- [ ] **Step 2: typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Грэп — ни одного хардкод-списка org-nav**

Run: `rg -n "organization/orders'|organization/finance'|organization/students'" src/components/organization/org-sidebar.tsx`
Expected: пусто — пункты больше не литералы в `OrgSidebar` (приходят пропом).

- [ ] **Step 4: (Опционально, вручную) e2e org visual**

Если доступны seed + dev:3000: `npm run e2e:visual` (org-проект). Org-меню теперь показывает 7-8 пунктов; при необходимости обновить baseline `npm run e2e:visual:update` (org snapshots). Если окружение недоступно — отметить как manual-pending в close-out (не блокер для PR; визуальная регрессия проверяется оператором).

- [ ] **Step 5: Пометить P3 закрытым в spec + close-out**

В `docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md` §6 пометить строку 6 (ось 2) как ✅ (DONE 2026-06-08); обновить «Статус». Создать close-out `docs/superpowers/plans/2026-06-08-role-consistency-p3-DONE.md` (что отгружено + решение про superset). Commit:

```bash
git add docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md docs/superpowers/plans/2026-06-08-role-consistency-p3-DONE.md
git commit -m "docs(spec): mark P3 (ось 2 org nav) done; audit backlog complete

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Note (L2.5 gate):** правки не трогают `prisma/`/`worker/`/`services/` — integration-gate не требуется. Push `--no-verify`, если gate-хук виснет на host :5432 (известный готча). PR — против `main`.

---

## Self-Review (выполнено при написании)

**1. Покрытие spec'а (§6 строка 6, ось 2):** единый источник → Task 1 (`navByRole.organization` канон) + Task 2 (`OrgSidebar` потребляет). Мёртвая заглушка устранена. org-switcher сохранён (client). e2e org — Task 3 Step 4. ✓

**2. Скан плейсхолдеров:** весь код и команды конкретны; нет TBD. ✓

**3. Консистентность типов/имён:** `NavItem.icon?`/`orgAdminOrLeaderOnly?` (Task 1) используются в `OrgSidebar` фильтре/рендере (Task 2) и `navByRole.organization` (Task 1). `items: NavItem[]` проп согласован между `OrgSidebar` (Task 2 Step 3), `OrgAppShell` (Task 2 Step 4) и тестом (Task 2 Step 1). `navItemsFor` сигнатура не меняется. ✓

**4. Защита §4 не ослаблена:** меняется только источник и состав ВИДИМОСТИ меню. Доступ к `/organization/*` по-прежнему: middleware (`organization_cabinet` + роль) + `requireOrganization` в layout + per-page `getOrgPageContext` + сервис-скоуп. «Команда» доступ — server action enforce (фильтр меню лишь прячет пункт). «Сообщения» — `chat` фильтруется server-side в `navItemsFor`; страница сама делает `notFound()` при off (defense-in-depth). ✓

**5. Client/server граница:** `chat`-флаг читается ТОЛЬКО в server-компоненте `OrgAppShell` (`navItemsFor`); `OrgSidebar` (client) получает готовый `items` и импортирует из `cabinet.ts` лишь `type NavItem` (type-only, стирается). `build` (Task 2 Step 6) это подтверждает — ключевая проверка корректности. ✓

**6. Поведение для пользователя:** org-меню: +«Сообщения» (при `chat`=on) +«Кабинет слушателя». Это осознанное продуктовое решение пользователя (2026-06-08), закрывает messages-gap и C-c. ✓
