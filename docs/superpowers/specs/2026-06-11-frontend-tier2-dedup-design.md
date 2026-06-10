# Frontend Tier 2 — слияние дублей (inbox + table-shell) — Design / Spec

> **Контекст.** Tier 1 ([2026-06-10-frontend-foundation-design.md](2026-06-10-frontend-foundation-design.md), PR #110) завёл `ui/`-примитивы, `errorMessageRu`, toast. Tier 2 — следующий слой того же трека: **дедупликация** проверенно-идентичного кода. Третий пункт исходного Tier-2-списка (`useActionState`-унификация сабмита) — **сознательно вынесен** в отдельный будущий spec: это поведенческий рефакторинг 25 форм, а не дедуп.

**Цель.** Убрать два крупнейших фронтовых дубля: (1) три чат-инбокса → один `OrderThreadInbox`; (2) идентичная оболочка 13 таблиц → композиционные table-примитивы в `ui/` + миграция всех 13.

**Принципиально.** Чистый дедуп без изменения поведения: ноль изменений в RBAC, services, API-контрактах, submit-путях, разметке/стилях (за вычетом одного CSS-эквивалентного упрощения, см. ниже). Visual-снапшоты Playwright и `data-unread`-маркеры e2e не должны измениться.

---

## Решения (из брейнсторма 2026-06-11)

| Вопрос | Решение |
|---|---|
| Объём захода | **Инбоксы + table-shell.** `useActionState` — отдельный spec позже. |
| Глубина слияния инбоксов | **Все три → один** (`partner`, `organization`, `team-chat`). Team-chat отличается ровно 2 конфиг-битами (side-бейдж + явная передача `side`), не доменной логикой. |
| Форма table-абстракции | **Композиционные примитивы** (TableShell/THead/Th/Tr/Td/EmptyState), не конфиг-DataTable. Каждая таблица держит свои колонки/ячейки в JSX — гибко для ссылок/бейджей; в духе рукописных примитивов Tier 1. |
| Объём миграции таблиц | **Все 13 near-identical** + их empty-states. Группа-2 (раскрывашки `<details>`, DLQ) и card-list'ы — не трогаем. |

---

## Блок 1 — `OrderThreadInbox` (3 → 1)

### Текущее состояние

- [partner-messages-inbox.tsx](../../../src/components/partner/partner-messages-inbox.tsx) и [organization-messages-inbox.tsx](../../../src/components/organization/organization-messages-inbox.tsx) — **побайтовый дубль** (~355 строк каждый): различия только в имени компонента, префиксах `console.warn` и форматировании.
- [team-chat-inbox.tsx](../../../src/components/chat/team-chat-inbox.tsx) — тот же скелет (state, polling, selectThread, attach, send, разметка) + 2 отличия: side-бейдж «Заказчик/Партнёр» (список + шапка треда, левая панель 300px вместо 280px) и **явная передача `side`** в `uploadAttachment` и POST `/api/messages` (для manager/admin серверный `deriveSide` возвращает null).

### Новый компонент

`src/components/chat/order-thread-inbox.tsx` (client) — team-chat-версия как superset:

```ts
type Props = {
  threads: Thread[];        // Thread-тип как сейчас (id, orderId, side, orderNumber, orderTitle, lastMessageAt, unread)
  currentUserId: string;
  variant: 'role' | 'team';
};
```

- **`variant='role'`** (partner/org-страницы): `side` НЕ передаётся ни в `uploadAttachment`, ни в POST — сервер выводит сторону из сессии. Side-бейдж не рендерится. Левая панель 280px.
- **`variant='team'`** (manager/admin-страницы): `side: selected.side` в обоих вызовах + бейдж в списке и шапке. Левая панель 300px.
- Разметка/inline-стили переносятся **байт-в-байт** из соответствующих веток (дедуп, не рестайлинг). Префикс логов — единый `[order-thread-inbox]`.
- `variant` — обязательный проп (без дефолта): забыть его невозможно (typecheck), а молчаливый дефолт скрыл бы выбор стороны.

### Удаляется / меняется

- Удалить: `partner-messages-inbox.tsx`, `organization-messages-inbox.tsx`, `team-chat-inbox.tsx` (−~1100 строк, +~430).
- 4 страницы импортируют общий компонент напрямую (без re-export-обёрток): [partner/messages/page.tsx](../../../src/app/partner/messages/page.tsx), [organization/messages/page.tsx](../../../src/app/organization/messages/page.tsx) → `variant='role'`; [manager/messages/page.tsx](../../../src/app/manager/messages/page.tsx), [admin/messages/page.tsx](../../../src/app/admin/messages/page.tsx) → `variant='team'`.
- `manager-messages-inbox.tsx` (дайджест order-comments, серверный) — **не участвует**: другой компонент, не дубль.

### Почему это не нарушает §4 sibling-rule

§4 запрещает общий компонент «на всякий случай» — здесь обратная ситуация: **post-hoc слияние доказанно идентичного кода**. Компонент role-blind по конструкции: доменная граница (кто какие треды видит, какая сторона пишет) живёт на сервере в `/api/messages` (`deriveSide`, scope-фильтрация тредов на страницах). `Thread`-тип domain-agnostic. Дом — `components/chat/`, уже роль-нейтральный (`chat-thread-view`, `chat-composer`). Если домены когда-нибудь разойдутся по-настоящему (не конфиг-битом) — форкнуть обратно дешевле, чем годами синхронизировать три копии.

### Тесты

Три файла (`components.partner-messages-inbox.test.tsx`, `components.organization-messages-inbox.test.tsx`, `components.team-chat-inbox.test.tsx`) → один `components.order-thread-inbox.test.tsx`, покрывающий **оба варианта**; все текущие assertions сохраняются (empty-state, unread-маркеры, выбор треда, team-специфичные side-бейджи). Classic-JSX: явный `import React`.

---

## Блок 2 — table-примитивы + миграция 13 таблиц

### Текущее состояние

13 из 27 таблиц повторяют идентичную оболочку: wrapper `bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm`, `table.w-full.text-sm`, thead-строка `border-b border-gray-100 bg-gray-50 text-left`, `th.px-4.py-2.5.font-medium.text-gray-600`, body-строки `border-b border-gray-50 hover:bg-[#FFF7ED]` с JS-тернарником «последняя строка → `border-b-0`», и empty-state-карточка (15+ повторов: `p-12 text-center` + эмодзи-круг + серый текст).

### Новые примитивы — `src/components/ui/table.tsx` (+ `empty-state.tsx`)

| Примитив | Рендерит | Пропы |
|---|---|---|
| `TableShell` | `div`-wrapper + `<table class="w-full text-sm">` | `children`, `className?` (на wrapper) |
| `THead` | `<thead><tr class="border-b border-gray-100 bg-gray-50 text-left">` | `children` (= `Th`), `className?` |
| `Th` | `<th scope="col" class="px-4 py-2.5 font-medium text-gray-600">` | нативные + `className?` |
| `Tr` | `<tr class="border-b border-gray-50 hover:bg-[#FFF7ED] last:border-b-0">` | нативные + `className?` |
| `Td` | `<td class="px-4 py-2.5">` | нативные + `className?` |
| `EmptyState` | карточка `bg-white border rounded-xl p-12 text-center` + эмодзи-круг + `p.text-gray-500.text-sm` | `icon?: string` (эмодзи), `message: string`, `className?` |

- Все классы мержатся через `cn()` (Tier 1) — локальные отклонения (`text-right`, ширины) остаются на месте вызова.
- `scope="col"` запекается в `Th` (a11y-свип Tier 1 сохраняется автоматически).
- **Единственное намеренное упрощение:** JS-проверка последней строки заменяется CSS-вариантом `last:border-b-0` — визуально эквивалентно, убирает индекс-зависимый тернарник из 13 map-колбэков.
- `EmptyState` — отдельный файл (используется и вне таблиц, напр. `manager-messages-inbox`); оба добавляются в barrel `ui/index.ts`.

### Миграция — все 13 + их empty-states

| Домен | Файлы |
|---|---|
| partner | `leads-table.tsx`, `deals-table.tsx`, `portfolio-table.tsx`, `team-table.tsx` |
| organization | `org-orders-table.tsx`, `team-table.tsx` |
| manager | `manager-orders-table.tsx`, `manager-orgs-list.tsx`, `manager-students-table.tsx`, `manager-finance-payments.tsx` |
| admin | `partners-table.tsx`, `users-table.tsx`, `audit-log-table.tsx` |

Empty-state мигрируется в этих же файлах (тексты/эмодзи сохраняются как есть). **Не мигрируются:** группа-2 (`commission-statements-list`, `org-finance-commission`, `dlq-table`, inline-таблица в `admin/commission-statements/page.tsx` — другой паддинг/`<details>`-структура) и card-list/`<ul>`-компоненты.

---

## Data flow / Error handling

Без изменений. Оба блока — чистая презентация: fetch-пути инбокса, API-контракты, RBAC-фильтрация тредов/строк остаются как есть.

---

## Тест-стратегия (§6)

| Что | Как |
|---|---|
| `OrderThreadInbox` | Слитый unit-файл: оба варианта; assertions из всех 3 старых файлов сохранены. |
| Table-примитивы | Unit: `TableShell` рендерит wrapper-классы; `Th` имеет `scope="col"`; `Tr` имеет hover/last-классы; `EmptyState` рендерит message + icon. `import React` явно. |
| Регресс-гард миграции | Существующие unit-тесты таблиц (если есть) и страниц остаются зелёными **без правок**. `npm run test:unit` целиком. |
| Визуальный регресс | Классы переносятся 1-в-1 → существующие Playwright-снапшоты должны совпасть (прогон `e2e:visual` — опционально, локально). |

Слои: L1 + L2 (unit). Integration/L2.5 не затрагиваются (нет правок prisma/worker/services).

## Верификация

`npm run typecheck` · `npm run lint` · `npm run test:unit` · `npm run build`. Метод реализации — subagent-driven development (как Tier 1).

---

## Не входит (follow-up)

- **`useActionState`/submit-хук** — отдельный spec (поведенческий рефакторинг 25 форм).
- **Группа-2 таблиц** (раскрывашки, DLQ) и card-list'ы.
- **Tier 3:** data-fetching (SWR/React-Query), оптимистичные апдейты, кэш поллинга.
- **eslint-guardrail на инлайн-hex** — по-прежнему отложен до около-нулевого счётчика (Tier 1 §6); этот заход уменьшает счётчик (hover-hex уходит в `Tr`).
