# Arch-debt: dashboard services own their return types (§2) — close-out (DONE)

**Дата:** 2026-06-05 · **Ветка:** `claude/arch-debt-dashboard-types-impl` · **Спека:** [arch-debt-dashboard-types-design](../specs/2026-05-31-arch-debt-dashboard-types-design.md) · **План:** [arch-debt-dashboard-types](2026-06-05-arch-debt-dashboard-types.md)

Компаньон к плану (не замена). План — «что собирались», этот файл — «что отгрузили». Трек **C / C3** из [completion-roadmap](../specs/2026-06-02-completion-roadmap.md).

## Статус

**Отгружено в PR #90, 3 коммита:** `b0db250` (рефактор), `dc661d9` (close-out), `5adb6cd` (§2-guardrail — добавлен после opt-in пользователя). Без feature-флага (внутренний рефактор, рантайм не меняется). Реализация — inline (8 точечных правок), ревью — короткоживущий субагент (по уроку finance-хаба: для мелкого механического рефактора inline устойчивее длинного субагент-диспатча, ценность субагента — в независимом ревью).

## Что отгрузили

Развёрнута стрелка зависимостей для 7 dashboard return-типов: владеющий сервис теперь **определяет** тип, презентационный компонент **импортирует его вниз** через `import type`. §2 восстановлен.

| Тип(ы) | Был определён в | Теперь определён в |
|---|---|---|
| `OrgDashboardKpis` | `components/organization/org-kpi-grid.tsx` | `services/organization/dashboard.ts` |
| `OrgAttentionItem`, `OrgAttention` | `components/organization/org-attention-list.tsx` | `services/organization/dashboard.ts` |
| `OrgEvent` | `components/organization/org-events-feed.tsx` | `services/organization/dashboard.ts` |
| `KpiData` | `components/manager/manager-kpi-grid.tsx` | `services/manager/dashboard.ts` |
| `AttentionItem` | `components/manager/manager-attention-list.tsx` | `services/manager/dashboard.ts` |
| `EventItem` | `components/manager/manager-events-feed.tsx` | `services/manager/dashboard.ts` |

Имена сохранены (zero churn у вызывающих). Вложенная зависимость `OrgAttention.items: OrgAttentionItem[]` переехала вместе с обоими типами в один сервис.

## Верификация

- **Остаточные `services → components` импорты:** 0 (`rg "from '@/components" src/lib/services/` пусто) — после переноса это были единственные 6 во всём дереве сервисов.
- **`npm run typecheck`** чисто (главный гейт спеки — `tsc` полностью верифицирует type-only move) · **`npm run lint`** чисто · **dashboard unit: 28** (admin 24 + partner 4) · **dashboard integration: 31** (manager 13 + organization 7 — оба изменённых сервиса — + partner 11, подтвердил отсутствие collateral).
- **Независимое ревью** (субагент): clean, byte-identical поля, корректный порядок вложенного типа, импорты соответствуют использованию, циклов/runtime-утечек нет, admin не тронут.

## In scope, осознанно НЕ сделано

- **`admin/dashboard.ts`** имеет **свои** одноимённые `AttentionItem`/`EventItem` — это **другой модуль**, уже корректно расположенный (сам определяет, сам потребляет). Вне scope спеки, не трогали. Коллизии нет: каждый импортёр указывает явный путь сервиса.
- **#2 (контракт ошибок)** и **#3 (распил раздутых сервисов)** — явные Не-цели спеки (это C4/C5).
- **Переименование типов** — не делали (минимум churn, решение спеки).

## §2-guardrail (опция, пользователь одобрил → отгружено в `5adb6cd`)

- **ESLint `no-restricted-imports`**, scoped на `src/lib/services/**`, запрещает импорт из `@/app`, `@/components`, `@/server-actions` — закрепляет §2 целиком (а не только components), чтобы исправленное в C3 направление зависимостей не вернулось молча. Core-правило ловит и `import type` — ровно ту форму, что нарушал C3.
- Изначально вынесено за scope спеки (её гейт — typecheck+lint) и предложено пользователю отдельным решением, а не внедрено по ходу. Пользователь выбрал «добавить» → расширил до всех трёх направлений §2 (все чисты, 0 нарушений).
- **Проверено, что правило не вхолостую:** probe-импорт из сервиса даёт error с §2-сообщением (components + server-actions пойманы); полный `npm run lint` чист.

## Гочи для будущего

- **`import type` из серверного сервиса в клиентский компонент безопасен** даже без `server-only`-guard: тип стирается при компиляции, рантайм в бандл не попадает. Поэтому отдельный `dashboard-types.ts` не нужен (YAGNI) — тип живёт в файле сервиса, который его производит.
- **Изменённые сервисы покрыты integration-тестами** (`services.{organization,manager}.dashboard.test.ts` содержат `new PrismaClient(`) → L1/L2-гейты их **не гоняют** (unit-режим исключает файлы с `new PrismaClient(`). Для type-only move typecheck достаточен, но прогнал `npm run test:integration -- dashboard` вручную до пуша (повтор урока finance-хаба: integration гонять вручную до пуша).
