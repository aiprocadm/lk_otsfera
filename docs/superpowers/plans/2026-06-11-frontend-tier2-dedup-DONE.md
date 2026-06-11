# Frontend Tier 2 — слияние дублей (inbox + table-shell) — DONE

> Companion close-out to [2026-06-11-frontend-tier2-dedup.md](2026-06-11-frontend-tier2-dedup.md) (план = «что планировали», этот файл = «что отгрузили»). Spec: [../specs/2026-06-11-frontend-tier2-dedup-design.md](../specs/2026-06-11-frontend-tier2-dedup-design.md).

**Дата:** 2026-06-11 · **Ветка:** `claude/frontend-tier2-dedup` · **Метод:** subagent-driven development (implementer + spec-review + quality-review на каждый таск).

## Что отгружено

| Слой | Файлы | Коммиты |
|---|---|---|
| Примитив `EmptyState` | `src/components/ui/empty-state.tsx` (+barrel, +4 unit) | `e9b3de4` |
| Table-примитивы | `src/components/ui/table.tsx`: `TableShell`/`THead`/`Th`/`Tr`/`Td` (+barrel, +7 unit) | `8c3f025` |
| Единый инбокс | `src/components/chat/order-thread-inbox.tsx` (`variant: 'role' \| 'team'`) + слитый тест (9 unit) | `508c24c` |
| Слияние 3→1 | 4 страницы `*/messages` → `OrderThreadInbox`; удалены `partner-messages-inbox`, `organization-messages-inbox`, `team-chat-inbox` + 3 теста (−1356 строк) | `aa5552f` |
| Миграция partner | `leads/deals/portfolio/team-table.tsx` (4) | `a913503` |
| Миграция org | `org-orders-table`, `team-table`, `org-finance-payments` (3) | `5e8ae27` + `872aab0` |
| Миграция manager | `manager-orders-table`, `manager-orgs-list`, `manager-students-table`, `manager-finance-payments` (4) | `7266b1b` |
| Миграция admin | `users-table`, `partners-table`, `audit-log-table` (3) | `a2fab69` |

Итого мигрировано **14 таблиц** (13 утверждённых + 1 сиблинг, см. ниже); инбокс-дубль ~1100 строк схлопнут в один компонент.

## Верификация (финальный гейт, прогнан целиком)

- `npm run typecheck` — clean.
- `npm run lint` — **0 warnings / 0 errors**.
- `npm run test:unit` — **181 файл / 1362 теста** зелёные (было 1359; −17 старых инбокс-тестов, +9 order-thread-inbox, +4 empty-state, +7 table — точно по прогнозу плана).
- `npm run build` — успех, полная таблица маршрутов.

Ревью: каждый таск — spec-compliance (hunk-by-hunk, включая opus-ревью верности OrderThreadInbox трём оригиналам) + quality (все APPROVED). Финальное холистическое ревью ветки — отдельным заходом после этого коммита.

## Сознательные нормализации / отклонения

1. **Admin-таблицы** (нет visual-снапшотов): +`shadow-sm` на wrapper, +`last:border-b-0` на строках, empty-state-текст теперь `text-sm` внутри `<p>`.
2. **JS-тернарник «последняя строка»** во всех таблицах заменён CSS `last:border-b-0` (запечён в `Tr`) — индекс из map-колбэков удалён.
3. **+1 файл сверх утверждённых 13:** `org-finance-payments.tsx` — прямой сиблинг `manager-finance-payments.tsx` (та же оболочка `shadow-sm overflow-x-auto`); мигрирован для симметрии сиблингов.
4. **`org-finance-payments` empty-state:** голый крупный эмодзи `💸` (`text-4xl mb-3`) нормализован в стандартный круг `EmptyState icon='💸'` (фикс-коммит `872aab0` — первый проход эмодзи терял).
5. **`TableShell.children` опционален** (classic-JSX `React.createElement`-тесты; тот же прецедент, что `Badge`/`Field` в Tier 1).

## Зафиксированный минорный долг (из ревью, не блокеры)

- `Th`: `{...rest}` спредится после `scope='col'` → теоретически перекрываем; для column-headers неактуально, фикс — переставить spread при следующем касании.
- `THead.className` применяется к внутреннему `<tr>`, не `<thead>` — задокументировать в JSDoc при следующем касании; теста на `THead.className` нет.
- Инлайн-hex (`text-[#F97316]`, `text-[#111111]`) в ячейках мигрированных таблиц и inline-стили `order-thread-inbox` — существующий долг §13 (guardrail отложен до около-нулевого счётчика).
- Кнопки в `partner/team-table` и `organization/team-table` — кандидаты на `Button`-примитив при инкрементальной миграции.

## Отложено (follow-up)

1. **`useActionState`/submit-хук** — отдельный spec (поведенческий рефакторинг 25 форм; в проекте 0 использований useActionState).
2. **Группа-2 таблиц** (раскрывашки `<details>`: `commission-statements-list`, `org-finance-commission`; `dlq-table`; inline-таблица `admin/commission-statements/page.tsx`) и card-list/`<ul>`-компоненты.
3. **Tier 3:** data-fetching (SWR/React-Query), оптимистичные апдейты, кэш поллинга.
4. **eslint-guardrail на инлайн-hex** — после миграции остатка (Tier 2 уменьшил счётчик: hover-hex и shell-классы ушли в примитивы).
