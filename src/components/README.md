# src/components — презентационный слой

Клиентские/презентационные компоненты, разложены по доменам (`orders/`, `documents/`,
`partner/`, `organization/`, `manager/`, `admin/` …). `'use client'` — только когда реально
нужно (форма, состояние, эффекты); серверные компоненты по умолчанию.

## UI-кит ([ui/](ui/), barrel [ui/index.ts](ui/index.ts))

`Button`, `Input`, `Select`, `Textarea`, `Badge`, `Field`, `Dialog`, `Spinner`, `EmptyState`,
`TableShell`/`Th`/`Tr`/`Td`, `Paginator`, `Breadcrumbs` и др. Прямой импорт из подмодуля
(`@/components/ui/spinner`) — норма.

- **Модалки — только через [`Dialog`](ui/dialog.tsx)** (нативный `<dialog>`, initial-focus,
  aria-live регионы). Сырой `<dialog>`/`role="dialog"` ловит eslint-guardrail
  `NO_HANDROLLED_MODAL` (CLAUDE.md §9).
- **Палитра запекается в примитивы**: оранжевая гамма проекта (`#F97316`/`#EA580C`/…) живёт
  внутри `ui/` — не инлайнить brand-hex в новых компонентах, переиспользовать примитив.
- Ошибки — `errorMessageRu` ([src/lib/errors/messages.ts](../lib/errors/messages.ts));
  транзиентный фидбек — `toast` ([src/lib/ui/toast.ts](../lib/ui/toast.ts)).

## Инварианты

- **Никакой prisma/базы из компонентов** — правило `components-no-db` в
  [.dependency-cruiser.cjs](../../.dependency-cruiser.cjs), проверка `npm run boundaries`.
  Данные приходят пропсами из server components / server-actions.
- **Sibling-паттерн по ролям (CLAUDE.md §4)**: компонент, нужный partner-у и organization-у,
  не делать общим «на всякий случай» — две версии `partner-*`/`organization-*`. Исключение —
  строго презентационный компонент с domain-agnostic типом (тип живёт в `lib`, компонент
  реэкспортирует).
- Нейминг файлов — `kebab-case.tsx`; тесты — `src/__tests__/components.*.test.tsx`.
