# Frontend Tier 2 — слияние дублей (inbox + table-shell) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать два крупнейших фронтовых дубля: три чат-инбокса → один `OrderThreadInbox` (variant-проп), идентичная оболочка таблиц → composable-примитивы `ui/table.tsx` + `EmptyState`, миграция 13+1 таблиц.

**Architecture:** Чистый презентационный дедуп по spec [2026-06-11-frontend-tier2-dedup-design.md](../specs/2026-06-11-frontend-tier2-dedup-design.md). Ноль изменений RBAC/services/API/submit-путей. Инбокс: team-chat-версия становится superset-компонентом с `variant: 'role' | 'team'`. Таблицы: TableShell/THead/Th/Tr/Td/EmptyState в `ui/` (barrel), классы запекаются 1-в-1, отклонения через `cn()`-override.

**Tech Stack:** Next.js 15, React 19, Tailwind, `cn()` (clsx+tailwind-merge, уже есть), vitest unit (classic JSX → **каждый unit-тестируемый компонент обязан `import React`**).

**Верификация на каждом таске:** `npm run typecheck` + целевые unit-тесты; финал — полный гейт (lint, test:unit, build).

**Известные сознательные нормализации** (зафиксировать в close-out):
1. Admin-таблицы (`users`, `partners`, `audit-log`) получают `shadow-sm` (раньше не было) и `last:border-b-0`; их empty-state-текст становится `text-sm` внутри `<p>`. Admin не покрыт visual-снапшотами (Playwright-проекты только partner/org/manager) — риск нулевой.
2. JS-тернарник «последняя строка → `border-b-0`» заменён CSS `last:border-b-0` (визуально эквивалентно; admin-таблицы, где тернарника не было, получают его поведение — см. п.1).
3. `+1 файл сверх утверждённых 13`: `organization/org-finance-payments.tsx` — прямой сиблинг `manager-finance-payments.tsx` (C-a, идентичная оболочка `shadow-sm overflow-x-auto`); мигрировать одного без другого — рассинхрон сиблингов.

---

### Task 1: Примитив `EmptyState`

**Files:**
- Create: `src/components/ui/empty-state.tsx`
- Modify: `src/components/ui/index.ts`
- Test: `src/__tests__/components.ui-empty-state.test.tsx`

- [ ] **Step 1: Написать падающий тест**

```tsx
// src/__tests__/components.ui-empty-state.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';

describe('EmptyState', () => {
  it('renders message inside the standard card', () => {
    const html = renderToString(React.createElement(EmptyState, { message: 'Заявок пока нет' }));
    expect(html).toContain('Заявок пока нет');
    expect(html).toContain('rounded-xl');
    expect(html).toContain('p-12');
    expect(html).toContain('text-center');
  });

  it('renders emoji circle only when icon is provided', () => {
    const withIcon = renderToString(React.createElement(EmptyState, { icon: '✚', message: 'Пусто' }));
    expect(withIcon).toContain('✚');
    expect(withIcon).toContain('rounded-full');
    const withoutIcon = renderToString(React.createElement(EmptyState, { message: 'Пусто' }));
    expect(withoutIcon).not.toContain('rounded-full');
  });

  it('merges caller className over defaults (p-8 beats p-12)', () => {
    const html = renderToString(
      React.createElement(EmptyState, { message: 'Пусто', className: 'p-8' })
    );
    expect(html).toContain('p-8');
    expect(html).not.toContain('p-12');
  });

  it('renders children after the message (CTA slot)', () => {
    const html = renderToString(
      React.createElement(EmptyState, { message: 'Пусто' }, React.createElement('a', { href: '/x' }, 'Создать'))
    );
    expect(html).toContain('Создать');
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run --mode=unit src/__tests__/components.ui-empty-state.test.tsx`
Expected: FAIL — `Cannot find module '@/components/ui/empty-state'`.

- [ ] **Step 3: Реализация**

```tsx
// src/components/ui/empty-state.tsx
import React from 'react';
import { cn } from '@/lib/ui/cn';

/**
 * Пустое состояние списков/таблиц: белая карточка, опциональный эмодзи-круг,
 * серое сообщение, слот под CTA (children). Паддинг по умолчанию p-12;
 * компактные варианты передают className='p-8' (tailwind-merge перекроет).
 */
export function EmptyState({
  icon,
  message,
  className,
  children
}: {
  icon?: string;
  message: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('bg-white border border-gray-200 rounded-xl p-12 text-center', className)}>
      {icon && (
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>{icon}</span>
        </div>
      )}
      <p className='text-gray-500 text-sm'>{message}</p>
      {children}
    </div>
  );
}
```

В `src/components/ui/index.ts` добавить строку (после `Field`):

```ts
export { EmptyState } from './empty-state';
```

- [ ] **Step 4: Прогнать тест — зелёный**

Run: `npx vitest run --mode=unit src/__tests__/components.ui-empty-state.test.tsx`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/empty-state.tsx src/components/ui/index.ts src/__tests__/components.ui-empty-state.test.tsx
git commit -m "feat(ui): EmptyState primitive"
```

---

### Task 2: Примитивы таблицы (`TableShell`/`THead`/`Th`/`Tr`/`Td`)

**Files:**
- Create: `src/components/ui/table.tsx`
- Modify: `src/components/ui/index.ts`
- Test: `src/__tests__/components.ui-table.test.tsx`

- [ ] **Step 1: Написать падающий тест**

```tsx
// src/__tests__/components.ui-table.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { TableShell, THead, Th, Tr, Td } from '@/components/ui/table';

function renderFullTable(extra?: { shellClassName?: string; overflow?: 'hidden' | 'x-auto'; hover?: boolean }) {
  return renderToString(
    React.createElement(
      TableShell,
      { className: extra?.shellClassName, overflow: extra?.overflow },
      React.createElement(THead, null, React.createElement(Th, null, 'Колонка')),
      React.createElement(
        'tbody',
        null,
        React.createElement(
          Tr,
          { hover: extra?.hover },
          React.createElement(Td, null, 'Ячейка')
        )
      )
    )
  );
}

describe('table primitives', () => {
  it('TableShell renders wrapper + table with baked classes', () => {
    const html = renderFullTable();
    expect(html).toContain('rounded-xl');
    expect(html).toContain('shadow-sm');
    expect(html).toContain('overflow-hidden');
    expect(html).toContain('w-full text-sm');
  });

  it('TableShell overflow="x-auto" swaps overflow class', () => {
    const html = renderFullTable({ overflow: 'x-auto' });
    expect(html).toContain('overflow-x-auto');
    expect(html).not.toContain('overflow-hidden');
  });

  it('TableShell merges caller className (hidden md:block for responsive tables)', () => {
    const html = renderFullTable({ shellClassName: 'hidden md:block' });
    expect(html).toContain('hidden');
    expect(html).toContain('md:block');
  });

  it('Th bakes scope=col and header classes', () => {
    const html = renderFullTable();
    expect(html).toContain('scope="col"');
    expect(html).toContain('font-medium text-gray-600');
    expect(html).toContain('bg-gray-50');
  });

  it('Tr bakes hover + last:border-b-0 by default', () => {
    const html = renderFullTable();
    expect(html).toContain('hover:bg-[#FFF7ED]');
    expect(html).toContain('last:border-b-0');
  });

  it('Tr hover=false omits hover class', () => {
    const html = renderFullTable({ hover: false });
    expect(html).not.toContain('hover:bg-[#FFF7ED]');
  });

  it('Td bakes cell padding', () => {
    const html = renderFullTable();
    expect(html).toContain('px-4 py-2.5');
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npx vitest run --mode=unit src/__tests__/components.ui-table.test.tsx`
Expected: FAIL — `Cannot find module '@/components/ui/table'`.

- [ ] **Step 3: Реализация**

```tsx
// src/components/ui/table.tsx
import React from 'react';
import { cn } from '@/lib/ui/cn';

/**
 * Композиционные примитивы таблиц (§13: палитра запекается в ui/).
 * Каждая таблица держит свои колонки/ячейки в JSX; примитивы дают только
 * повторяющуюся оболочку. Отклонения — через className (tailwind-merge:
 * caller-классы перекрывают дефолты той же группы).
 */

type TableShellProps = {
  /** 'hidden' (дефолт) — обычные таблицы; 'x-auto' — широкие финансовые. */
  overflow?: 'hidden' | 'x-auto';
  className?: string;
  children: React.ReactNode;
};

export function TableShell({ overflow = 'hidden', className, children }: TableShellProps) {
  return (
    <div
      className={cn(
        'bg-white border border-gray-200 rounded-xl shadow-sm',
        overflow === 'hidden' ? 'overflow-hidden' : 'overflow-x-auto',
        className
      )}
    >
      <table className='w-full text-sm'>{children}</table>
    </div>
  );
}

export function THead({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <thead>
      <tr className={cn('border-b border-gray-100 bg-gray-50 text-left', className)}>{children}</tr>
    </thead>
  );
}

export function Th({ className, children, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope='col' className={cn('px-4 py-2.5 font-medium text-gray-600', className)} {...rest}>
      {children}
    </th>
  );
}

type TrProps = React.HTMLAttributes<HTMLTableRowElement> & {
  /** false — для «неактивных» строк (team-tables), у которых нет hover-подсветки. */
  hover?: boolean;
};

export function Tr({ hover = true, className, children, ...rest }: TrProps) {
  return (
    <tr
      className={cn(
        'border-b border-gray-50 last:border-b-0',
        hover && 'hover:bg-[#FFF7ED]',
        className
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Td({ className, children, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-2.5', className)} {...rest}>
      {children}
    </td>
  );
}
```

В `src/components/ui/index.ts` добавить:

```ts
export { TableShell, THead, Th, Tr, Td } from './table';
```

- [ ] **Step 4: Прогнать тест — зелёный**

Run: `npx vitest run --mode=unit src/__tests__/components.ui-table.test.tsx`
Expected: PASS (7 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/table.tsx src/components/ui/index.ts src/__tests__/components.ui-table.test.tsx
git commit -m "feat(ui): table primitives (TableShell/THead/Th/Tr/Td)"
```

---

### Task 3: `OrderThreadInbox` — компонент + слитый тест

**Files:**
- Create: `src/components/chat/order-thread-inbox.tsx` (копия `team-chat-inbox.tsx` + правки ниже)
- Create: `src/__tests__/components.order-thread-inbox.test.tsx`
- (Старые компоненты/тесты удаляются в Task 4 — здесь НЕ трогать.)

- [ ] **Step 1: Скопировать базу**

```bash
cp src/components/chat/team-chat-inbox.tsx src/components/chat/order-thread-inbox.tsx
```

- [ ] **Step 2: Применить правки к `order-thread-inbox.tsx`**

Правка 2a — Props и сигнатура. Старый код:

```ts
type Props = {
  threads: Thread[];
  currentUserId: string;
};
```

Новый:

```ts
type Props = {
  threads: Thread[];
  currentUserId: string;
  /**
   * 'role' — partner/org-кабинеты: side НЕ передаётся (сервер выводит из сессии),
   *          side-бейджи не рендерятся, левая панель 280px.
   * 'team' — manager/admin: side передаётся явно (deriveSide для них возвращает null),
   *          бейджи «Заказчик/Партнёр» в списке и шапке, левая панель 300px.
   */
  variant: 'role' | 'team';
};
```

Сигнатура: `export function TeamChatInbox({ threads, currentUserId }: Props) {` → `export function OrderThreadInbox({ threads, currentUserId, variant }: Props) {`

Правка 2b — `handleAttach`. Старый код:

```ts
    // Team inbox passes side explicitly — deriveSide returns null for managers/admins
    const path = await uploadAttachment(file, selected.orderId, selected.side);
```

Новый:

```ts
    // variant='team' passes side explicitly — deriveSide returns null for managers/admins;
    // variant='role' omits side — server derives it from the session role
    const path = await uploadAttachment(
      file,
      selected.orderId,
      variant === 'team' ? selected.side : undefined
    );
```

Правка 2c — `handleSend` POST body. Старый код:

```ts
      // Team MUST pass side explicitly — deriveSide returns null for managers/admins
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selected.orderId,
          side: selected.side,
          body: text,
          ...(pendingAttachment ? { attachmentPath: pendingAttachment.path } : {})
        })
      });
```

Новый:

```ts
      // variant='team' MUST pass side explicitly — deriveSide returns null for managers/admins
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selected.orderId,
          ...(variant === 'team' ? { side: selected.side } : {}),
          body: text,
          ...(pendingAttachment ? { attachmentPath: pendingAttachment.path } : {})
        })
      });
```

Правка 2d — ширина левой панели. Старый: `width: '300px',` → новый: `width: variant === 'team' ? '300px' : '280px',`

Правка 2e — title-span в списке тредов (в role-варианте без flex-растяжения, байт-в-байт как в partner/org-оригиналах). Старый код:

```tsx
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: isUnread ? 600 : 400,
                          color: '#111111',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                          minWidth: 0
                        }}
                      >
                        {thread.orderTitle}
                      </span>
                      <span style={sideBadgeStyle(thread.side)}>
                        {sideBadgeLabel(thread.side)}
                      </span>
```

Новый:

```tsx
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: isUnread ? 600 : 400,
                          color: '#111111',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          ...(variant === 'team' ? { flex: 1, minWidth: 0 } : {})
                        }}
                      >
                        {thread.orderTitle}
                      </span>
                      {variant === 'team' && (
                        <span style={sideBadgeStyle(thread.side)}>
                          {sideBadgeLabel(thread.side)}
                        </span>
                      )}
```

Правка 2f — шапка выбранного треда. Старый код:

```tsx
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid #E5E7EB',
                backgroundColor: '#F9FAFB',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
```

Новый:

```tsx
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid #E5E7EB',
                backgroundColor: '#F9FAFB',
                ...(variant === 'team'
                  ? { display: 'flex', alignItems: 'center', gap: '8px' }
                  : {})
              }}
            >
```

И ниже в той же шапке. Старый код:

```tsx
              <span style={sideBadgeStyle(selected.side)}>
                {sideBadgeLabel(selected.side)}
              </span>
```

Новый:

```tsx
              {variant === 'team' && (
                <span style={sideBadgeStyle(selected.side)}>
                  {sideBadgeLabel(selected.side)}
                </span>
              )}
```

Правка 2g — все 6 префиксов логов `[team-chat-inbox]` → `[order-thread-inbox]` (fetch messages failed / fetch messages error / markRead error / attachment upload failed / send message failed / handleSend error).

Правка 2h — JSDoc над компонентом (добавить перед `export function OrderThreadInbox`):

```tsx
/**
 * Единый order-thread инбокс для всех кабинетов (Tier 2: слияние
 * partner-/organization-messages-inbox и team-chat-inbox).
 * Доменная граница живёт на сервере (/api/messages, deriveSide);
 * различия ролей сводятся к variant-пропу — см. Props.
 */
```

- [ ] **Step 3: Написать слитый тест**

```tsx
// src/__tests__/components.order-thread-inbox.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';

const CURRENT_USER = 'user-1';

const THREAD_A = {
  id: 'thread-a',
  orderId: 'order-a',
  side: 'partner' as const,
  orderNumber: 'ПЗ-0001',
  orderTitle: 'Поставка оборудования',
  lastMessageAt: new Date('2024-03-01T10:00:00Z'),
  unread: false
};

const THREAD_B = {
  id: 'thread-b',
  orderId: 'order-b',
  side: 'partner' as const,
  orderNumber: 'ПЗ-0002',
  orderTitle: 'Монтажные работы',
  lastMessageAt: new Date('2024-03-02T12:00:00Z'),
  unread: true
};

const THREAD_ORG = {
  id: 'thread-org-1',
  orderId: 'order-1',
  side: 'org' as const,
  orderNumber: 'ПЗ-0010',
  orderTitle: 'Поставка компрессоров',
  lastMessageAt: new Date('2024-04-01T10:00:00Z'),
  unread: false
};

const THREAD_ORG_UNREAD = {
  id: 'thread-org-2',
  orderId: 'order-2',
  side: 'org' as const,
  orderNumber: 'ПЗ-0011',
  orderTitle: 'Монтаж оборудования',
  lastMessageAt: new Date('2024-04-03T08:00:00Z'),
  unread: true
};

describe('OrderThreadInbox variant=role (partner/org)', () => {
  it('shows "Нет переписок" when threads array is empty', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    expect(html).toContain('Нет переписок');
  });

  it('renders both thread order labels', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    expect(html).toContain('Поставка оборудования');
    expect(html).toContain('Монтажные работы');
  });

  it('renders order numbers for each thread', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    expect(html).toContain('ПЗ-0001');
    expect(html).toContain('ПЗ-0002');
  });

  it('renders unread indicator only for unread threads', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    const occurrences = html.split('data-unread="true"').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does NOT render side badges in role variant', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_ORG, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    expect(html).not.toContain('Заказчик');
    expect(html).not.toContain('Партнёр');
  });
});

describe('OrderThreadInbox variant=team (manager/admin)', () => {
  it('shows "Нет переписок" when threads array is empty', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [],
        currentUserId: CURRENT_USER,
        variant: 'team'
      })
    );
    expect(html).toContain('Нет переписок');
  });

  it('renders side badge "Заказчик" for org thread and "Партнёр" for partner thread', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_ORG, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'team'
      })
    );
    expect(html).toContain('Заказчик');
    expect(html).toContain('Партнёр');
  });

  it('renders order labels and numbers', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_ORG, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'team'
      })
    );
    expect(html).toContain('Поставка компрессоров');
    expect(html).toContain('ПЗ-0010');
  });

  it('renders as many unread dots as there are unread threads', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_ORG, THREAD_B, THREAD_ORG_UNREAD],
        currentUserId: CURRENT_USER,
        variant: 'team'
      })
    );
    const count = html.split('data-unread="true"').length - 1;
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 4: Прогнать тест — зелёный**

Run: `npx vitest run --mode=unit src/__tests__/components.order-thread-inbox.test.tsx`
Expected: PASS (9 тестов). Также `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/order-thread-inbox.tsx src/__tests__/components.order-thread-inbox.test.tsx
git commit -m "feat(chat): OrderThreadInbox — unified inbox with variant prop"
```

---

### Task 4: Переключить 4 страницы, удалить 3 старых инбокса + их тесты

**Files:**
- Modify: `src/app/partner/messages/page.tsx`, `src/app/organization/messages/page.tsx`, `src/app/manager/messages/page.tsx`, `src/app/admin/messages/page.tsx`
- Delete: `src/components/partner/partner-messages-inbox.tsx`, `src/components/organization/organization-messages-inbox.tsx`, `src/components/chat/team-chat-inbox.tsx`
- Delete: `src/__tests__/components.partner-messages-inbox.test.tsx`, `src/__tests__/components.organization-messages-inbox.test.tsx`, `src/__tests__/components.team-chat-inbox.test.tsx`

- [ ] **Step 1: partner-страница**

В `src/app/partner/messages/page.tsx`:
- `import { PartnerMessagesInbox } from '@/components/partner/partner-messages-inbox';` → `import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';`
- `<PartnerMessagesInbox threads={threads} currentUserId={session.sub} />` → `<OrderThreadInbox threads={threads} currentUserId={session.sub} variant='role' />`

- [ ] **Step 2: organization-страница**

В `src/app/organization/messages/page.tsx` — аналогично:
- `import { OrganizationMessagesInbox } from '@/components/organization/organization-messages-inbox';` → `import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';`
- `<OrganizationMessagesInbox threads={threads} currentUserId={session.sub} />` → `<OrderThreadInbox threads={threads} currentUserId={session.sub} variant='role' />`

- [ ] **Step 3: manager- и admin-страницы**

В `src/app/manager/messages/page.tsx` и `src/app/admin/messages/page.tsx`:
- `import { TeamChatInbox } from '@/components/chat/team-chat-inbox';` → `import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';`
- Вызов (в обоих файлах):

```tsx
          <OrderThreadInbox
            threads={chat.ok ? chat.rows : []}
            currentUserId={session.sub}
            variant='team'
          />
```

- [ ] **Step 4: Удалить старые файлы (git rm ДО typecheck — иначе stale-резолюция)**

```bash
git rm src/components/partner/partner-messages-inbox.tsx src/components/organization/organization-messages-inbox.tsx src/components/chat/team-chat-inbox.tsx
git rm src/__tests__/components.partner-messages-inbox.test.tsx src/__tests__/components.organization-messages-inbox.test.tsx src/__tests__/components.team-chat-inbox.test.tsx
```

- [ ] **Step 5: Верификация**

Run: `npm run typecheck` — clean (ни одного импорта удалённых модулей).
Run: `npx vitest run --mode=unit src/__tests__/components.order-thread-inbox.test.tsx` — PASS.
Run: `npx rg -l "team-chat-inbox|partner-messages-inbox|organization-messages-inbox" src/` — пусто (доки не считаются).

- [ ] **Step 6: Commit**

```bash
git add -A src/app/partner/messages src/app/organization/messages src/app/manager/messages src/app/admin/messages
git commit -m "refactor(chat): switch 4 pages to OrderThreadInbox, drop 3 duplicate inboxes"
```

---

## Миграция таблиц — общие правила (Tasks 5–8)

Каждый файл: добавить `import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';` и применить маппинг. **Содержимое ячеек, ссылки, бейджи, форматтеры — НЕ трогать.**

| Старый паттерн | Новый |
|---|---|
| `<div className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'><table className='w-full text-sm'>` … `</table></div>` | `<TableShell>` … `</TableShell>` |
| то же с префиксом `hidden md:block` (responsive, есть card-list-сиблинг) | `<TableShell className='hidden md:block'>` |
| `…rounded-xl shadow-sm overflow-x-auto'>` (финансовые) | `<TableShell overflow='x-auto'>` |
| admin: `…rounded-xl overflow-hidden'>` (без shadow) | `<TableShell>` (нормализация +shadow-sm — см. шапку плана) |
| `<thead><tr className='border-b border-gray-100 bg-gray-50 text-left'>` … `</tr></thead>` | `<THead>` … `</THead>` |
| `<th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>X</th>` | `<Th>X</Th>` |
| то же + `text-right` | `<Th className='text-right'>X</Th>` |
| `<tr key={…} className={`border-b border-gray-50 hover:bg-[#FFF7ED] ${i === rows.length - 1 ? 'border-b-0' : ''}`}>` | `<Tr key={…}>` (убрать `, i` из map-аргументов, если больше не используется — иначе lint) |
| `<tr key={…} className='border-b border-gray-50 hover:bg-[#FFF7ED]'>` (admin, без тернарника) | `<Tr key={…}>` |
| `<tr key={…} className='border-b border-gray-50 last:border-b-0 hover:bg-[#FFF7ED]'>` | `<Tr key={…}>` |
| team-tables: `` `border-b border-gray-50 ${last…} ${m.isActive ? 'hover:bg-[#FFF7ED]' : 'bg-gray-50/50 text-gray-400'}` `` | `<Tr key={…} hover={m.isActive} className={m.isActive ? undefined : 'bg-gray-50/50 text-gray-400'}>` |
| `<td className='px-4 py-2.5'>` | `<Td>` |
| `<td className='px-4 py-2.5 EXTRA'>` | `<Td className='EXTRA'>` |
| empty-state `p-12` + эмодзи-круг + `<p className='text-gray-500 text-sm'>MSG</p>` [+ CTA] | `<EmptyState icon='ЭМОДЗИ' message='MSG'>[CTA]</EmptyState>` |
| empty-state `p-8 text-center` + `<p className='text-gray-500 text-sm'>MSG</p>` | `<EmptyState message='MSG' className='p-8' />` |
| admin empty-state `p-8 text-center text-gray-500` с голым текстом | `<EmptyState message='MSG' className='p-8' />` (текст нормализуется в `<p class='text-gray-500 text-sm'>`) |

Эмодзи/тексты empty-state брать из текущего файла как есть. После каждого таска: `npm run typecheck` + перечисленные тесты + commit.

**Полностью worked example — `partner/leads-table.tsx`, начало файла после миграции** (остальные колонки/ячейки преобразуются по тем же правилам):

```tsx
import Link from 'next/link';
import type { LeadRow } from '@/lib/services/partner/leads';
import { LeadStatusBadge } from './lead-status-badge';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

// …fmtMoney/fmtDate без изменений…

export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState icon='✚' message='Заявок пока нет'>
        <Link
          href='/partner/leads/new'
          className='inline-block mt-3 px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
        >
          Создать первую заявку
        </Link>
      </EmptyState>
    );
  }

  return (
    <TableShell className='hidden md:block'>
      <THead>
        <Th>Клиент</Th>
        <Th>Тема</Th>
        <Th>Контакт</Th>
        <Th>Статус</Th>
        {/* …остальные Th по маппингу… */}
      </THead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.id}>
            {/* td → Td по маппингу, содержимое не трогать */}
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
```

**Полностью worked example — `admin/users-table.tsx` после миграции** (admin-нормализация):

```tsx
import React from 'react';
import Link from 'next/link';
import {
  deactivateUserFormAction,
  reactivateUserFormAction
} from '@/server-actions/admin/users';
import type { UserRow } from '@/lib/services/admin/users';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ',
  manager: 'Менеджер',
  partner: 'Партнёр',
  organization: 'Организация',
  student: 'Студент'
};

export function UsersTable({ rows, currentUserId }: { rows: UserRow[]; currentUserId: string }) {
  if (rows.length === 0) {
    return <EmptyState message='Пользователей не найдено' className='p-8' />;
  }
  return (
    <TableShell>
      <THead>
        <Th>Email</Th>
        <Th>Имя</Th>
        <Th>Роль</Th>
        <Th>Привязка</Th>
        <Th>Активен</Th>
        <Th>Создан</Th>
        <Th className='text-right'>Действия</Th>
      </THead>
      <tbody>
        {rows.map((u) => {
          const isSelf = u.id === currentUserId;
          return (
            <Tr key={u.id}>
              <Td className='font-mono text-xs text-[#111111]'>{u.email}</Td>
              <Td>{u.name}</Td>
              <Td className='text-gray-600'>{ROLE_LABELS[u.role] ?? u.role}</Td>
              <Td className='text-gray-600'>{u.attachmentLabel}</Td>
              <Td>
                {u.isActive ? (
                  <span className='text-green-600 text-xs'>●</span>
                ) : (
                  <span className='text-gray-300 text-xs'>●</span>
                )}
              </Td>
              <Td className='text-gray-500 text-xs'>
                {new Intl.DateTimeFormat('ru-RU').format(u.createdAt)}
              </Td>
              <Td className='text-right'>
                <div className='flex items-center justify-end gap-2'>
                  <Link href={`/admin/users/${u.id}`} className='text-[#F97316] text-xs hover:underline'>
                    Редактировать
                  </Link>
                  {!isSelf && (
                    u.isActive ? (
                      <form action={deactivateUserFormAction}>
                        <input type='hidden' name='id' value={u.id} />
                        <button type='submit' className='text-gray-500 text-xs hover:text-red-600'>
                          Деактивировать
                        </button>
                      </form>
                    ) : (
                      <form action={reactivateUserFormAction}>
                        <input type='hidden' name='id' value={u.id} />
                        <button type='submit' className='text-gray-500 text-xs hover:text-green-600'>
                          Восстановить
                        </button>
                      </form>
                    )
                  )}
                </div>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}
```

---

### Task 5: Миграция partner-таблиц (4 файла)

**Files (Modify):**
- `src/components/partner/leads-table.tsx` — wrapper `hidden md:block`; empty: `icon='✚'`, CTA-Link как children (worked example выше)
- `src/components/partner/deals-table.tsx` — wrapper `hidden md:block`; строки с тернарником
- `src/components/partner/portfolio-table.tsx` — wrapper `hidden md:block`; строки с тернарником
- `src/components/partner/team-table.tsx` — wrapper `hidden md:block`; **условный hover**: `<Tr hover={row.isActive} className={row.isActive ? undefined : 'bg-gray-50/50 text-gray-400'}>`

- [ ] **Step 1:** Мигрировать все 4 файла по маппингу (читать файл целиком перед правкой; содержимое ячеек не трогать; эмодзи/тексты empty-state сохранить из файла).
- [ ] **Step 2:** Run: `npm run typecheck` — clean; `npm run lint` — 0 warnings (следить за неиспользуемым `i` в map).
- [ ] **Step 3:** Run: `npx vitest run --mode=unit src/__tests__/` (полный unit при сомнении — но как минимум `components.*`-тесты) — зелёные.
- [ ] **Step 4: Commit**

```bash
git add src/components/partner/leads-table.tsx src/components/partner/deals-table.tsx src/components/partner/portfolio-table.tsx src/components/partner/team-table.tsx
git commit -m "refactor(partner): migrate 4 tables to ui table primitives"
```

---

### Task 6: Миграция organization-таблиц (2 + сиблинг финансов)

**Files (Modify):**
- `src/components/organization/org-orders-table.tsx` — wrapper `hidden md:block` (десктоп-таблица; mobile card-list ниже в том же файле НЕ трогать)
- `src/components/organization/team-table.tsx` — **условный hover** (`!m.isActive ? 'bg-gray-50/50 text-gray-400'` → `<Tr hover={m.isActive} className={m.isActive ? undefined : 'bg-gray-50/50 text-gray-400'}>`)
- `src/components/organization/org-finance-payments.tsx` — `<TableShell overflow='x-auto'>`; empty `p-12` стандартный (+1 к утверждённым 13: сиблинг manager-finance-payments, см. шапку плана)

- [ ] **Step 1:** Мигрировать 3 файла по маппингу.
- [ ] **Step 2:** Run: `npm run typecheck` + `npm run lint` — clean.
- [ ] **Step 3:** Run: `npx vitest run --mode=unit src/__tests__/components.manager-finance.test.tsx` (покрывает финансовые компоненты) и полный `npm run test:unit` при расхождениях.
- [ ] **Step 4: Commit**

```bash
git add src/components/organization/org-orders-table.tsx src/components/organization/team-table.tsx src/components/organization/org-finance-payments.tsx
git commit -m "refactor(org): migrate 3 tables to ui table primitives"
```

---

### Task 7: Миграция manager-таблиц (4 файла)

**Files (Modify):**
- `src/components/manager/manager-orders-table.tsx` — wrapper `hidden md:block`; пагинация/фильтры вне таблицы НЕ трогать
- `src/components/manager/manager-orgs-list.tsx` — стандартный wrapper; `<Th className='text-right'>` x3 (включая пустой `<Th className='text-right'></Th>` — оставить пустым)
- `src/components/manager/manager-students-table.tsx` — стандартный wrapper
- `src/components/manager/manager-finance-payments.tsx` — `<TableShell overflow='x-auto'>`; empty `p-8`: `<EmptyState message='Платежей пока нет.' className='p-8' />`; строки уже с `last:border-b-0` — просто `<Tr key={p.id}>`

- [ ] **Step 1:** Мигрировать 4 файла по маппингу.
- [ ] **Step 2:** Run: `npm run typecheck` + `npm run lint` — clean.
- [ ] **Step 3:** Run: `npx vitest run --mode=unit src/__tests__/components.manager-finance.test.tsx` — PASS (assertions «Платежей пока нет.» и колонки должны остаться зелёными).
- [ ] **Step 4: Commit**

```bash
git add src/components/manager/manager-orders-table.tsx src/components/manager/manager-orgs-list.tsx src/components/manager/manager-students-table.tsx src/components/manager/manager-finance-payments.tsx
git commit -m "refactor(manager): migrate 4 tables to ui table primitives"
```

---

### Task 8: Миграция admin-таблиц (3 файла, с нормализацией)

**Files (Modify):**
- `src/components/admin/users-table.tsx` — worked example выше (полный код)
- `src/components/admin/partners-table.tsx` — тот же паттерн (empty `p-8` голый текст → `<EmptyState message='…' className='p-8' />`)
- `src/components/admin/audit-log-table.tsx` — тот же паттерн

Нормализации (сознательные, admin без visual-снапшотов): +`shadow-sm`, +`last:border-b-0`, empty-текст в `<p class='text-gray-500 text-sm'>`.

- [ ] **Step 1:** Мигрировать 3 файла.
- [ ] **Step 2:** Run: `npm run typecheck` + `npm run lint` — clean.
- [ ] **Step 3:** Run: `npx vitest run --mode=unit src/__tests__/components.admin-users-table.test.tsx` — PASS без правок теста.
- [ ] **Step 4: Commit**

```bash
git add src/components/admin/users-table.tsx src/components/admin/partners-table.tsx src/components/admin/audit-log-table.tsx
git commit -m "refactor(admin): migrate 3 tables to ui table primitives (normalize shadow/last-row)"
```

---

### Task 9: Финальные гейты + close-out

- [ ] **Step 1:** Run: `npm run typecheck` — clean.
- [ ] **Step 2:** Run: `npm run lint` — 0 warnings / 0 errors.
- [ ] **Step 3:** Run: `npm run test:unit` — все зелёные (база Tier 1: 1359; дельта: −17 старых инбокс-тестов (partner 5 + org 5 + team 7), +9 order-thread-inbox, +4 empty-state, +7 table = ориентир ~1362; точное число зафиксировать).
- [ ] **Step 4:** Run: `npm run build` — успех, полная таблица маршрутов.
- [ ] **Step 5:** Написать close-out `docs/superpowers/plans/2026-06-11-frontend-tier2-dedup-DONE.md` (companion, НЕ rename плана): что отгружено по слоям + коммиты, верификация с числами, сознательные нормализации (admin shadow/last-row/empty-текст, +1 файл org-finance-payments), отложенное (`useActionState` — отдельный spec; группа-2 таблиц; Tier 3).
- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-06-11-frontend-tier2-dedup-DONE.md
git commit -m "docs(plan): frontend Tier 2 dedup close-out"
```
