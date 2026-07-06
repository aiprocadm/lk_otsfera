# Фаза 3 покрытия — UI-слой (`components/**` + `app/**/*.tsx`) → 100%

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести `src/components/**/*.tsx` (167 файлов, 153 с дырами) и `src/app/**/*.tsx` страницы (90, все с дырами) до 100% v8-покрытия под ratchet-порогом, не деградируя логические слои.

**Architecture:** Два воркстрима, **отдельные PR**. W1 (компоненты) — гибрид-harness: `renderToString` (node) для презентационных веток + jsdom/`@testing-library/react` для интерактива. W2 (страницы) — новый helper `renderServerComponent` (мок `next/headers`/Prisma/`requireRole`/`next/navigation`, ассерт JSX + `redirect`/`notFound`). Порог per-glob вкручивается по доменам/кабинетам (ratchet), финал — широкие globs.

**Tech Stack:** Vitest 2.1 (`@vitest/coverage-v8`, `all:true`), `react-dom/server` `renderToString`, `@testing-library/react` (jsdom, уже установлен — Track E). Classic-JSX: каждый тест-файл `import React` + `React.createElement`.

**Спек:** [2026-07-04-coverage-phase3-ui-design.md](../specs/2026-07-04-coverage-phase3-ui-design.md). **Карта дыр:** Приложение A (ниже) + `scratchpad/ui-coverage-gaps.json`.

---

## Соглашения (читать перед любым таском)

### C1. Два harness-паттерна

**Паттерн P (presentational) — `renderToString`, environment node.** Для компонентов без интерактива или чьи дыры — в SSR-выводе (ветки пропсов, условный рендер, классы). Эталон — [components.ui-button.test.tsx](../../../src/__tests__/components.ui-button.test.tsx):

```tsx
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
// внешние зависимости — мок ПЕРЕД импортом компонента
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children)
}));
import { Thing } from '@/components/<domain>/thing';

describe('Thing', () => {
  it('<конкретная ветка> → <наблюдаемый вывод>', () => {
    const html = renderToString(React.createElement(Thing, { /* пропсы ветки */ }));
    expect(html).toContain('<маркер этой ветки>');
  });
});
```

**Паттерн I (interactive) — jsdom + `@testing-library/react`.** Для `'use client'` с обработчиками/состоянием/эффектами (onClick, useState, useEffect, императивные ref-эффекты). Первая строка файла — директива окружения:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
import { Thing } from '@/components/<domain>/thing';

describe('Thing (interactive)', () => {
  beforeEach(() => { push.mockClear(); refresh.mockClear(); });
  afterEach(() => { vi.restoreAllMocks(); });
  it('<действие> → <эффект>', async () => {
    render(React.createElement(Thing, { /* props */ }));
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });
});
```

Правило выбора: сначала пытаемся закрыть дыру Паттерном P. Если ветка — обработчик/состояние/эффект и `renderToString` её не исполняет, файл ведём Паттерном I (один jsdom-файл на компонент; при наличии старого renderToString-файла — переносим статические ассерты в него же или оставляем оба, но покрытие считается по обоим). `@testing-library` авто-очищает DOM между тестами (globals включены). Не используем `jest-dom`-матчеры (не настроены) — только `getByRole/`findBy*` (бросают при отсутствии) + `expect(...).toHaveBeenCalled*`.

**Недостижимые строки** (SSR-гарды `typeof document/window` в client-effect'ах и т.п.) — `/* v8 ignore next N -- причина */` c комментарием (правило CLAUDE.md §6). Не писать вакуумных тестов.

### C2. Измерение дыр по домену (быстрый локальный цикл)

Полный `npm run test:coverage` — дорого (~14 мин, живой PG). Для итерации по домену меряем точечно, отключив `all` и сузив include:

```
npx vitest run --mode=unit --coverage --coverage.all=false \
  --coverage.reporter=text --coverage.include='src/components/ui/**' \
  src/__tests__/components.ui-*.test.tsx
```

Колонка «Uncovered Line #s» текст-репортёра указывает конкретные строки/ветки. `--mode=unit` держит окружение быстрым; для файлов с директивой jsdom окружение переключается пофайлово.

### C3. Ratchet-порог (после закрытия домена)

В [vitest.config.ts](../../../vitest.config.ts) в объекте `thresholds` (он активен только в полном режиме, `mode !== 'unit' && mode !== 'integration'`) добавляем per-glob запись домена:

```ts
'src/components/ui/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
```

Подтверждаем полным `npm run test:coverage` (или scoped-прогоном C2 без `--coverage.all=false` по домену). Финал W1 — заменяем накопленные per-domain component-записи одной `'src/components/**'`. Финал W2 — `'src/app/**/*.tsx'`.

### C4. Ритм коммитов

Один коммит = один завершённый файл ИЛИ маленькая группа родственных файлов одного домена + их тесты. Порог-записи C3 — отдельным коммитом в конце домена. Сообщения: `test(cov): <domain>/<file> → 100%` и `test(cov): ratchet threshold src/components/<domain>/**`.

---

## W1 — Компоненты (PR-1)

Порядок доменов (от простого к сложному): **ui → мелкие (dashboard, auth, settings, orders, funnel, tasks, leader, documents, commission, access, pwa-installer, dashboard) → chat → enrollment → import → training → organization → manager → admin → partner.** Точные списки файлов — Приложение A.

### Task 1: `ui/` домен (5 файлов) — обкатка обоих паттернов

**Files:**
- Modify/Create тесты для: `src/components/ui/{select,textarea,paginator}.tsx` (Паттерн P), `src/components/ui/{logout-button,dialog}.tsx` (Паттерн I).
- Test-файлы: `src/__tests__/components.ui-form-controls.test.tsx` (существует — select/textarea), `src/__tests__/components.ui-paginator.test.tsx` (существует), `src/__tests__/components.ui-logout-button.test.tsx` (существует → перевести в jsdom/дополнить), `src/__tests__/components.ui-dialog.test.tsx` (существует).

- [ ] **Step 1 — измерить ui/ дыры.** Run: команда C2 (include `src/components/ui/**`, тесты `components.ui-*`). Expected: `select` b:50, `textarea` b:50, `paginator` b:80, `logout-button` s:63/f:50, `dialog` s:82/f:33.

- [ ] **Step 2 — `Select` недостающая ветка (Паттерн P).** В `components.ui-form-controls.test.tsx` добавить:

```tsx
it('invalid: красная граница + aria-invalid', () => {
  const html = renderToString(React.createElement(Select, { invalid: true }));
  expect(html).toContain('border-red-400');
  expect(html).toContain('aria-invalid="true"');
});
```

(текущие тесты покрывают только `invalid=false` → `border-gray-300`; эта ветка закрывает b:50→100). Аналогично для `Textarea` — добавить тест на её `invalid`-ветку (прочитать `src/components/ui/textarea.tsx`, повторить паттерн с её маркером).

- [ ] **Step 3 — `Paginator` недостающая ветка.** Прочитать `src/components/ui/paginator.tsx`, найти по «Uncovered Line #s» непокрытую ветку (вероятно disabled prev/next на границе). Добавить тест, рендерящий обе границы (первая/последняя страница).

- [ ] **Step 4 — `LogoutButton` интерактив (Паттерн I).** Перевести `components.ui-logout-button.test.tsx` на jsdom и добавить:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
import { LogoutButton } from '@/components/ui/logout-button';

describe('LogoutButton (interactive)', () => {
  beforeEach(() => { push.mockClear(); refresh.mockClear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('успех: POST /api/auth/logout → busy-лейбл → push(/login) + refresh', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
    render(React.createElement(LogoutButton));
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(await screen.findByRole('button', { name: 'Выходим…' })).toBeDefined();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(f).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(refresh).toHaveBeenCalled();
  });

  it('catch: при сетевой ошибке всё равно push(/login)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    render(React.createElement(LogoutButton));
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });

  it('className проп применяется', () => {
    render(React.createElement(LogoutButton, { className: 'text-gray-400' }));
    expect(screen.getByRole('button').className).toContain('text-gray-400');
  });
});
```

Это закрывает `onClick`/busy/fetch-успех+catch/push/refresh (s/b/f → 100).

- [ ] **Step 5 — `Dialog` императивные эффекты (Паттерн I).** Прочитать `src/components/ui/dialog.tsx` + существующий `components.ui-dialog.test.tsx`. Функции 33% → непокрыты `showModal()/close()`-эффекты и обработчики (Escape/backdrop/`onClose`). jsdom не реализует нативный `<dialog>.showModal()` — замокать методы: `HTMLDialogElement.prototype.showModal = vi.fn()` и `.close = vi.fn()` в `beforeEach`. Тесты: `open=true` → `showModal` вызван; `open=false` → `close`; клик по backdrop при `busy=false` → `onClose`; при `busy=true` → НЕ вызван.

- [ ] **Step 6 — проверить домен 100%.** Run: команда C2 по `src/components/ui/**`. Expected: все 4 метрики 100% на всех 13 ui-файлах.

- [ ] **Step 7 — ratchet (C3).** Добавить в `vitest.config.ts` thresholds: `'src/components/ui/**': { lines:100, branches:100, functions:100, statements:100 }`. Run: `npm run test:coverage`. Expected: PASS (порог держится).

- [ ] **Step 8 — commit.**

```
git add src/__tests__/components.ui-*.test.tsx vitest.config.ts
git commit -m "test(cov): components/ui/** → 100% + ratchet threshold"
```

### Task 2..K: остальные домены W1 (по одному таску на домен)

Для КАЖДОГО домена из порядка выше применяем один и тот же цикл (файлы — Приложение A):

- [ ] **Step 1 — измерить** домен (C2, `--coverage.include='src/components/<domain>/**'`, тесты `components.<domain-glob>`).
- [ ] **Step 2 — по каждому файлу-дыре:** прочитать компонент; определить тип (P или I по C1); прочитать существующий тест, если есть; дописать/создать тесты, закрывающие непокрытые строки/ветки из «Uncovered Line #s». Осмысленный `expect` на каждую ветку (§C1). Коммит на файл/группу (C4).
- [ ] **Step 3 — проверить домен 100%** (C2). Дыры, недостижимые рантаймом → `/* v8 ignore … -- причина */`.
- [ ] **Step 4 — ratchet** (C3): добавить `'src/components/<domain>/**'` порог; `npm run test:coverage` PASS.
- [ ] **Step 5 — review** (крупные partner/admin/manager/organization): `superpowers:requesting-code-review` + adversarial-проход на «пустые» тесты.
- [ ] **Step 6 — commit** порога.

Домены и объём дыр: `dashboard` 1, `auth` 2, `settings` 2, `orders` 2, `funnel` 2, `tasks` 3, `leader` 1, `documents` 1, `commission` 1, `access` 1, `pwa-installer` 1, `chat` 4, `enrollment` 4, `import` 3, `training` 5, `organization` 18, `manager` 26, `admin` 29, `partner` 42. (Полные пути — Приложение A.)

### Task K+1: финализация W1

- [ ] **Step 1 — консолидировать порог.** В `vitest.config.ts` заменить все накопленные `'src/components/<domain>/**'`-записи одной `'src/components/**': { lines:100, branches:100, functions:100, statements:100 }`.
- [ ] **Step 2 — full run.** Run: `npm run test:coverage`. Expected: PASS; `src/components/**` = 100%.
- [ ] **Step 3 — commit + PR-1.** `git commit -m "test(cov): consolidate components/** 100% threshold"`; push; `gh pr create` (заголовок «W1: components/** → 100% coverage»).

---

## W2 — Страницы (PR-2)

### Task W2-0: helper `renderServerComponent` + первые 2-3 простые страницы

**Files:**
- Create: `src/__tests__/helpers/renderServerComponent.tsx` (вне coverage: `src/**/__tests__/**` исключён; не `.test.` → не сьют, но импортируем).
- Create: `src/__tests__/helpers/serverComponentMocks.ts` (общие моки next/navigation, next/headers).
- Test: первые страницы — напр. `src/app/forbidden/page.tsx`, `src/app/student/page.tsx`.

- [ ] **Step 1 — helper (полный код).**

```tsx
// src/__tests__/helpers/renderServerComponent.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/** Вызывает async серверный компонент и рендерит его результат в jsdom. */
export async function renderServerComponent(
  node: ReactElement | Promise<ReactElement>
): Promise<ReturnType<typeof render>> {
  const resolved = await node;
  return render(resolved);
}
```

- [ ] **Step 2 — общий мок next/navigation (sentinel redirect/notFound).**

```ts
// src/__tests__/helpers/serverComponentMocks.ts
import { vi } from 'vitest';

export const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  notFound: vi.fn(() => { throw new Error('NOT_FOUND'); })
}));
// в тест-файле: vi.mock('next/navigation', () => ({ redirect: nav.redirect, notFound: nav.notFound }));
```

- [ ] **Step 3 — worked example (реальная страница).** Для `src/app/leader/dashboard/page.tsx` (async; `requireManagerLeader`, `Promise.all([leaderDashboard, recentEvents])`, JSX c KPI):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));
const { leaderDashboard } = vi.hoisted(() => ({ leaderDashboard: vi.fn() }));
vi.mock('@/lib/services/leader/dashboard', () => ({ leaderDashboard }));
const { recentEvents } = vi.hoisted(() => ({ recentEvents: vi.fn() }));
vi.mock('@/lib/services/manager/dashboard', () => ({ recentEvents }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
import LeaderDashboardPage from '@/app/leader/dashboard/page';

describe('LeaderDashboardPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockResolvedValue({ sub: 'u1', companyId: 'c1' });
    leaderDashboard.mockResolvedValue({
      kpis: { managers: 2, activeOrders: 0, debt: 100000, commission: 52500 },
      perManager: []
    });
    recentEvents.mockResolvedValue([]);
  });

  it('рендерит KPI сводки по команде', async () => {
    const { container } = await renderServerComponent(LeaderDashboardPage());
    expect(container.textContent).toContain('Сводка по команде');
    expect(container.textContent).toContain('Менеджеров');
  });

  it('commission=null → «—»', async () => {
    leaderDashboard.mockResolvedValue({ kpis: { managers: 0, activeOrders: 0, debt: 0, commission: null }, perManager: [] });
    const { container } = await renderServerComponent(LeaderDashboardPage());
    expect(container.textContent).toContain('—');
  });
});
```

- [ ] **Step 4 — редирект/notFound-ветки.** Для страницы с гардом: `vi.mock('next/navigation', ...)` из Step 2; `await expect(renderServerComponent(Page())).rejects.toThrow('REDIRECT:/login')` ИЛИ `expect(nav.redirect).toHaveBeenCalled()`.
- [ ] **Step 5 — измерить** `src/app/leader/**` scoped (C2). Обкатать helper на 2-3 страницах, прежде чем масштабировать. **Пересмотреть политику тонких страниц (спек §3):** страница без ветвлений → `/* v8 ignore */` с обоснованием, а не вакуумный тест.
- [ ] **Step 6 — commit** helper + первые страницы.

### Task W2-1..M: страницы по кабинетам

Порядок: `(auth) → student → forbidden/root → leader → organization → partner → manager → admin` (Приложение A). Для каждого кабинета — цикл как в W1 Task 2 (измерить → тесты через helper → 100% → ratchet `'src/app/<cabinet>/**/*.tsx'` → review крупных → commit). Динамические сегменты (`[id]`) — передавать `params`/`searchParams` как Promise (Next 15: `searchParams: Promise<…>`), см. эталон `student/page.tsx`.

### Task M+1: финализация W2

- [ ] Заменить накопленные `'src/app/<cabinet>/**/*.tsx'` одной `'src/app/**/*.tsx'`.
- [ ] `npm run test:coverage` PASS; push; `gh pr create` («W2: app/**/*.tsx pages → 100% coverage»).

---

## Self-review (заполняется автором плана)

- **Покрытие спека:** W1 ↔ §4 W1; W2 ↔ §4 W2; harness'ы ↔ §4; ratchet ↔ §5; тонкие страницы ↔ §3; порядок ↔ §9. ✅
- **Плейсхолдеры:** worked examples (Select/LogoutButton/Dialog/LeaderDashboardPage/helper) — полный код; остальные файлы закрываются единым циклом C1–C4 (по природе задачи тело теста выводится из чтения файла + «Uncovered Line #s», не плейсхолдер). Списки файлов — Приложение A (реальные пути).
- **Согласованность:** имена `renderServerComponent`, паттерны P/I, команды C2/C3 единообразны во всех тасках.

---

## Приложение A — карта дыр (baseline 2026-07-04)

Формат: `путь  s:<statements%> b:<branches%> f:<functions%>`. Файлы с `s:0` — без единого исполняющего теста; `s:100 b:<100` — нужна только недостающая ветка.

### A.1 — components/** (W1)

**(root)** (1)

- `src/components/pwa-installer.tsx`  s:0 b:0 f:0

**access** (1)

- `src/components/access/role-editor.tsx`  s:0 b:0 f:0

**admin** (29)

- `src/components/admin/admin-app-shell.tsx`  s:0 b:0 f:0
- `src/components/admin/admin-rate-override-form.tsx`  s:0 b:0 f:0
- `src/components/admin/admin-sidebar.tsx`  s:100 b:92.3 f:100
- `src/components/admin/assign-or-invite-manager-form.tsx`  s:0 b:0 f:0
- `src/components/admin/assign-order-manager-form.tsx`  s:0 b:0 f:0
- `src/components/admin/audit-detail-button.tsx`  s:0 b:0 f:0
- `src/components/admin/audit-diff-dialog.tsx`  s:97.05 b:81.81 f:100
- `src/components/admin/audit-log-filters.tsx`  s:0 b:0 f:0
- `src/components/admin/audit-log-table.tsx`  s:0 b:0 f:0
- `src/components/admin/custom-fields-admin.tsx`  s:0 b:0 f:0
- `src/components/admin/dlq-table.tsx`  s:0 b:0 f:0
- `src/components/admin/manager-role-control.tsx`  s:0 b:0 f:0
- `src/components/admin/managers-block.tsx`  s:0 b:0 f:0
- `src/components/admin/mark-paid-form.tsx`  s:0 b:0 f:0
- `src/components/admin/organization-edit-form.tsx`  s:0 b:0 f:0
- `src/components/admin/partner-create-form.tsx`  s:0 b:0 f:0
- `src/components/admin/partner-edit-form.tsx`  s:0 b:0 f:0
- `src/components/admin/partners-filters.tsx`  s:0 b:0 f:0
- `src/components/admin/partners-table.tsx`  s:0 b:0 f:0
- `src/components/admin/queue-stats-grid.tsx`  s:0 b:0 f:0
- `src/components/admin/retry-all-button.tsx`  s:0 b:0 f:0
- `src/components/admin/retry-button.tsx`  s:0 b:0 f:0
- `src/components/admin/sync-cursor-dialog.tsx`  s:81 b:28.57 f:22.22
- `src/components/admin/sync-schedule-toggle.tsx`  s:0 b:0 f:0
- `src/components/admin/sync-trigger-button.tsx`  s:0 b:0 f:0
- `src/components/admin/user-edit-form.tsx`  s:0 b:0 f:0
- `src/components/admin/user-invite-form.tsx`  s:0 b:0 f:0
- `src/components/admin/users-filters.tsx`  s:0 b:0 f:0
- `src/components/admin/users-table.tsx`  s:100 b:90 f:100

**auth** (2)

- `src/components/auth/login-form.tsx`  s:0 b:0 f:0
- `src/components/auth/reset-password-form.tsx`  s:0 b:0 f:0

**chat** (4)

- `src/components/chat/chat-composer.tsx`  s:88.46 b:40 f:25
- `src/components/chat/chat-thread-view.tsx`  s:97.7 b:78.94 f:100
- `src/components/chat/order-thread-inbox.tsx`  s:47.45 b:71.42 f:30
- `src/components/chat/unread-badge.tsx`  s:24.13 b:33.33 f:50

**commission** (1)

- `src/components/commission/corrections-queue-table.tsx`  s:0 b:0 f:0

**dashboard** (1)

- `src/components/dashboard/app-shell.tsx`  s:0 b:0 f:0

**documents** (1)

- `src/components/documents/documents-panel.tsx`  s:0 b:0 f:0

**enrollment** (4)

- `src/components/enrollment/enrollment-list.tsx`  s:0 b:0 f:0
- `src/components/enrollment/enrollment-queue.tsx`  s:0 b:0 f:0
- `src/components/enrollment/enrollment-request-form.tsx`  s:0 b:0 f:0
- `src/components/enrollment/enrollment-status-badge.tsx`  s:0 b:0 f:0

**funnel** (2)

- `src/components/funnel/funnel-board.tsx`  s:0 b:0 f:0
- `src/components/funnel/stage-config.tsx`  s:0 b:0 f:0

**import** (3)

- `src/components/import/import-form.tsx`  s:27.81 b:8.33 f:14.28
- `src/components/import/payment-import-form.tsx`  s:45.26 b:8.33 f:16.66
- `src/components/import/payment-queue-table.tsx`  s:35.46 b:45.45 f:10

**leader** (1)

- `src/components/leader/leader-app-shell.tsx`  s:0 b:0 f:0

**manager** (26)

- `src/components/manager/manager-app-shell.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-attention-list.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-doc-upload-form.tsx`  s:73.56 b:50 f:14.28
- `src/components/manager/manager-events-feed.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-finance-payments.tsx`  s:100 b:71.42 f:100
- `src/components/manager/manager-kpi-grid.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-lead-actions.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-leads-filter.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-leads-table.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-messages-inbox.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-order-amounts.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-order-detail-view.tsx`  s:65.93 b:25 f:50
- `src/components/manager/manager-order-header.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-order-less-upload-form.tsx`  s:90.62 b:37.5 f:20
- `src/components/manager/manager-order-timeline.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-orders-card-list.tsx`  s:100 b:80 f:100
- `src/components/manager/manager-orders-filter.tsx`  s:96.2 b:100 f:100
- `src/components/manager/manager-orders-table.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-org-card.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-orgs-list.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-payments-list.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-roster-panel.tsx`  s:0 b:0 f:0
- `src/components/manager/manager-status-change-form.tsx`  s:89.79 b:77.77 f:14.28
- `src/components/manager/manager-students-table.tsx`  s:0 b:0 f:0
- `src/components/manager/org-card-tabs.tsx`  s:0 b:0 f:0
- `src/components/manager/team-visibility-toggle.tsx`  s:0 b:0 f:0

**orders** (2)

- `src/components/orders/order-custom-fields.tsx`  s:87.4 b:77.14 f:44.44
- `src/components/orders/order-stage-stepper.tsx`  s:100 b:93.1 f:100

**organization** (18)

- `src/components/organization/invite-org-user-form.tsx`  s:0 b:0 f:0
- `src/components/organization/org-app-shell.tsx`  s:0 b:0 f:0
- `src/components/organization/org-attention-list.tsx`  s:0 b:0 f:0
- `src/components/organization/org-documents-search.tsx`  s:0 b:0 f:0
- `src/components/organization/org-events-feed.tsx`  s:0 b:0 f:0
- `src/components/organization/org-finance-commission.tsx`  s:48.64 b:50 f:100
- `src/components/organization/org-finance-payments.tsx`  s:100 b:69.23 f:100
- `src/components/organization/org-kpi-grid.tsx`  s:0 b:0 f:0
- `src/components/organization/org-order-amounts.tsx`  s:0 b:0 f:0
- `src/components/organization/org-order-header.tsx`  s:0 b:0 f:0
- `src/components/organization/org-order-timeline.tsx`  s:0 b:0 f:0
- `src/components/organization/org-orders-filter.tsx`  s:0 b:0 f:0
- `src/components/organization/org-orders-table.tsx`  s:0 b:0 f:0
- `src/components/organization/org-payments-list.tsx`  s:0 b:0 f:0
- `src/components/organization/org-sidebar.tsx`  s:91.3 b:85 f:66.66
- `src/components/organization/organization-document-upload-form.tsx`  s:0 b:0 f:0
- `src/components/organization/organization-order-less-upload-form.tsx`  s:87.14 b:50 f:25
- `src/components/organization/team-table.tsx`  s:0 b:0 f:0

**partner** (42)

- `src/components/partner/add-comment-form.tsx`  s:0 b:0 f:0
- `src/components/partner/attention-list.tsx`  s:0 b:0 f:0
- `src/components/partner/bottom-tab-bar.tsx`  s:0 b:0 f:0
- `src/components/partner/commission-statements-list.tsx`  s:65.11 b:40 f:44.44
- `src/components/partner/customer-access-section.tsx`  s:0 b:0 f:0
- `src/components/partner/deal-amounts.tsx`  s:0 b:0 f:0
- `src/components/partner/deal-comments.tsx`  s:0 b:0 f:0
- `src/components/partner/deal-header.tsx`  s:0 b:0 f:0
- `src/components/partner/deal-status-badge.tsx`  s:0 b:0 f:0
- `src/components/partner/deal-timeline.tsx`  s:0 b:0 f:0
- `src/components/partner/deals-card-list.tsx`  s:0 b:0 f:0
- `src/components/partner/deals-filter.tsx`  s:0 b:0 f:0
- `src/components/partner/deals-table.tsx`  s:0 b:0 f:0
- `src/components/partner/documents-list.tsx`  s:61.48 b:26.92 f:66.66
- `src/components/partner/documents-search.tsx`  s:0 b:0 f:0
- `src/components/partner/events-feed.tsx`  s:0 b:0 f:0
- `src/components/partner/invite-customer-admin-form.tsx`  s:0 b:0 f:0
- `src/components/partner/invite-member-form.tsx`  s:0 b:0 f:0
- `src/components/partner/kpi-grid.tsx`  s:0 b:0 f:0
- `src/components/partner/lead-attachment-dropzone.tsx`  s:0 b:0 f:0
- `src/components/partner/lead-attachments-list.tsx`  s:0 b:0 f:0
- `src/components/partner/lead-create-form.tsx`  s:0 b:0 f:0
- `src/components/partner/lead-status-badge.tsx`  s:0 b:0 f:0
- `src/components/partner/lead-status-tabs.tsx`  s:0 b:0 f:0
- `src/components/partner/lead-withdraw-button.tsx`  s:0 b:0 f:0
- `src/components/partner/leads-card-list.tsx`  s:0 b:0 f:0
- `src/components/partner/leads-search.tsx`  s:0 b:0 f:0
- `src/components/partner/leads-table.tsx`  s:0 b:0 f:0
- `src/components/partner/manual-calc-form.tsx`  s:0 b:0 f:0
- `src/components/partner/member-row-actions.tsx`  s:0 b:0 f:0
- `src/components/partner/org-card-header.tsx`  s:0 b:0 f:0
- `src/components/partner/org-comments-tab.tsx`  s:0 b:0 f:0
- `src/components/partner/org-employees-tab.tsx`  s:0 b:0 f:0
- `src/components/partner/org-history-tab.tsx`  s:0 b:0 f:0
- `src/components/partner/org-tabs.tsx`  s:0 b:0 f:0
- `src/components/partner/partner-document-upload-form.tsx`  s:85.48 b:50 f:25
- `src/components/partner/portfolio-card-list.tsx`  s:0 b:0 f:0
- `src/components/partner/portfolio-search.tsx`  s:0 b:0 f:0
- `src/components/partner/portfolio-table.tsx`  s:0 b:0 f:0
- `src/components/partner/rate-override-form.tsx`  s:0 b:0 f:0
- `src/components/partner/team-card-list.tsx`  s:0 b:0 f:0
- `src/components/partner/team-table.tsx`  s:0 b:0 f:0

**settings** (2)

- `src/components/settings/notification-channels-card.tsx`  s:0 b:0 f:0
- `src/components/settings/telegram-link-card.tsx`  s:62.85 b:83.33 f:33.33

**tasks** (3)

- `src/components/tasks/column-config.tsx`  s:0 b:0 f:0
- `src/components/tasks/task-board.tsx`  s:0 b:0 f:0
- `src/components/tasks/task-dialog.tsx`  s:0 b:0 f:0

**training** (5)

- `src/components/training/add-position-dialog.tsx`  s:1.88 b:100 f:0
- `src/components/training/certificate-badge.tsx`  s:90.9 b:66.66 f:100
- `src/components/training/certificate-list.tsx`  s:0 b:0 f:0
- `src/components/training/directions-admin.tsx`  s:0 b:0 f:0
- `src/components/training/order-items-section.tsx`  s:26.51 b:41.66 f:12.5

**ui** (5)

- `src/components/ui/dialog.tsx`  s:82.69 b:100 f:33.33
- `src/components/ui/logout-button.tsx`  s:63.63 b:66.66 f:50
- `src/components/ui/paginator.tsx`  s:100 b:80 f:100
- `src/components/ui/select.tsx`  s:100 b:50 f:100
- `src/components/ui/textarea.tsx`  s:100 b:50 f:100

### A.2 — app/**/*.tsx страницы (W2)

**(auth)** (2)

- `src/app/(auth)/login/page.tsx`  s:0 b:0 f:0
- `src/app/(auth)/reset-password/page.tsx`  s:0 b:0 f:0

**admin** (27)

- `src/app/admin/audit/page.tsx`  s:0 b:0 f:0
- `src/app/admin/commission-corrections/page.tsx`  s:0 b:0 f:0
- `src/app/admin/commission-statements/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/admin/commission-statements/page.tsx`  s:0 b:0 f:0
- `src/app/admin/custom-fields/page.tsx`  s:0 b:0 f:0
- `src/app/admin/dashboard/page.tsx`  s:0 b:0 f:0
- `src/app/admin/documents/page.tsx`  s:0 b:0 f:0
- `src/app/admin/enrollments/page.tsx`  s:0 b:0 f:0
- `src/app/admin/finance/page.tsx`  s:0 b:0 f:0
- `src/app/admin/health/page.tsx`  s:0 b:0 f:0
- `src/app/admin/import/page.tsx`  s:0 b:0 f:0
- `src/app/admin/messages/page.tsx`  s:0 b:0 f:0
- `src/app/admin/orders/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/admin/orders/page.tsx`  s:0 b:0 f:0
- `src/app/admin/organizations/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/admin/organizations/page.tsx`  s:0 b:0 f:0
- `src/app/admin/partners/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/admin/partners/new/page.tsx`  s:0 b:0 f:0
- `src/app/admin/partners/page.tsx`  s:0 b:0 f:0
- `src/app/admin/payments-import/page.tsx`  s:0 b:0 f:0
- `src/app/admin/roles/page.tsx`  s:0 b:0 f:0
- `src/app/admin/settings/page.tsx`  s:0 b:0 f:0
- `src/app/admin/sync/page.tsx`  s:0 b:0 f:0
- `src/app/admin/training-directions/page.tsx`  s:0 b:0 f:0
- `src/app/admin/users/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/admin/users/new/page.tsx`  s:0 b:0 f:0
- `src/app/admin/users/page.tsx`  s:0 b:0 f:0

**forbidden** (1)

- `src/app/forbidden/page.tsx`  s:0 b:0 f:0

**leader** (12)

- `src/app/leader/commission-corrections/page.tsx`  s:0 b:0 f:0
- `src/app/leader/dashboard/page.tsx`  s:0 b:0 f:0
- `src/app/leader/enrollments/page.tsx`  s:0 b:0 f:0
- `src/app/leader/finance/page.tsx`  s:0 b:0 f:0
- `src/app/leader/funnel/page.tsx`  s:0 b:0 f:0
- `src/app/leader/orders/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/leader/orders/page.tsx`  s:0 b:0 f:0
- `src/app/leader/organizations/page.tsx`  s:0 b:0 f:0
- `src/app/leader/roles/page.tsx`  s:0 b:0 f:0
- `src/app/leader/settings/page.tsx`  s:0 b:0 f:0
- `src/app/leader/tasks/page.tsx`  s:0 b:0 f:0
- `src/app/leader/team/page.tsx`  s:0 b:0 f:0

**manager** (19)

- `src/app/manager/dashboard/page.tsx`  s:0 b:0 f:0
- `src/app/manager/documents/page.tsx`  s:0 b:0 f:0
- `src/app/manager/enrollments/page.tsx`  s:0 b:0 f:0
- `src/app/manager/finance/page.tsx`  s:0 b:0 f:0
- `src/app/manager/funnel/page.tsx`  s:0 b:0 f:0
- `src/app/manager/import/page.tsx`  s:0 b:0 f:0
- `src/app/manager/leads/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/manager/leads/page.tsx`  s:0 b:0 f:0
- `src/app/manager/messages/page.tsx`  s:0 b:0 f:0
- `src/app/manager/orders/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/manager/orders/page.tsx`  s:0 b:0 f:0
- `src/app/manager/organizations/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/manager/organizations/page.tsx`  s:0 b:0 f:0
- `src/app/manager/payments-import/page.tsx`  s:0 b:0 f:0
- `src/app/manager/settings/page.tsx`  s:0 b:0 f:0
- `src/app/manager/students/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/manager/students/page.tsx`  s:0 b:0 f:0
- `src/app/manager/tasks/page.tsx`  s:0 b:0 f:0
- `src/app/manager/team/page.tsx`  s:0 b:0 f:0

**organization** (10)

- `src/app/organization/dashboard/page.tsx`  s:0 b:0 f:0
- `src/app/organization/documents/page.tsx`  s:0 b:0 f:0
- `src/app/organization/enrollments/page.tsx`  s:0 b:0 f:0
- `src/app/organization/finance/page.tsx`  s:0 b:0 f:0
- `src/app/organization/messages/page.tsx`  s:0 b:0 f:0
- `src/app/organization/orders/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/organization/orders/page.tsx`  s:0 b:0 f:0
- `src/app/organization/settings/page.tsx`  s:0 b:0 f:0
- `src/app/organization/students/page.tsx`  s:0 b:0 f:0
- `src/app/organization/team/page.tsx`  s:0 b:0 f:0

**page.tsx** (1)

- `src/app/page.tsx`  s:0 b:0 f:0

**partner** (16)

- `src/app/partner/dashboard/page.tsx`  s:0 b:0 f:0
- `src/app/partner/deals/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/partner/deals/page.tsx`  s:0 b:0 f:0
- `src/app/partner/documents/page.tsx`  s:0 b:0 f:0
- `src/app/partner/enrollments/page.tsx`  s:0 b:0 f:0
- `src/app/partner/finance/page.tsx`  s:0 b:0 f:0
- `src/app/partner/leads/[id]/page.tsx`  s:0 b:0 f:0
- `src/app/partner/leads/new/page.tsx`  s:0 b:0 f:0
- `src/app/partner/leads/page.tsx`  s:0 b:0 f:0
- `src/app/partner/messages/page.tsx`  s:0 b:0 f:0
- `src/app/partner/portfolio/[orgId]/documents/page.tsx`  s:0 b:0 f:0
- `src/app/partner/portfolio/[orgId]/page.tsx`  s:0 b:0 f:0
- `src/app/partner/portfolio/[orgId]/settings/page.tsx`  s:0 b:0 f:0
- `src/app/partner/portfolio/page.tsx`  s:0 b:0 f:0
- `src/app/partner/settings/page.tsx`  s:0 b:0 f:0
- `src/app/partner/team/page.tsx`  s:0 b:0 f:0

**student** (2)

- `src/app/student/page.tsx`  s:0 b:0 f:0
- `src/app/student/redirect/page.tsx`  s:0 b:0 f:0
