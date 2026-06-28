# Orders-Family Audit & Paginator Dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Произвести полный findings-документ по семейству «Заказы» (6 осей × список+деталь × 5 ролей) и отгрузить единственный уже-решённый фикс — извлечение общих `pluralizeRu` и `ui/Paginator` из дублей в partner/org.

**Architecture:** Фаза 1 — статический аудит кода → findings-документ (ратифицируется владельцем, питает отдельный план ремедиации F3/F4/F5/состояний). Фаза 2 — DRY-извлечение двух дублированных юнитов (текстовый плюрализатор → `src/lib/format.ts`; offset-пагинатор → `src/components/ui/paginator.tsx`) с сохранением байт-идентичной разметки, подключение в `organization/orders` и `partner/deals`. Фаза 3 — верификация.

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, TypeScript strict, Vitest (классический JSX-трансформ → `import React` обязателен в тест-файлах компонентов), Tailwind.

**Спека:** [docs/superpowers/specs/2026-06-21-orders-family-audit-design.md](../specs/2026-06-21-orders-family-audit-design.md)

**Ветка:** `claude/orders-family-audit`

---

## Фаза 1 — Аудит → findings-документ

### Task 1: Полный findings-лист семейства «Заказы»

Дискавери-задача: читаем код, заполняем таблицу находок. Кода не меняем. Выход — документ, который владелец ратифицирует перед планом ремедиации.

**Files:**
- Create: `docs/superpowers/specs/2026-06-21-orders-family-audit-FINDINGS.md`

**Читать (источник истины для находок):**
- Списки: `src/app/partner/deals/page.tsx`, `src/app/organization/orders/page.tsx`, `src/app/manager/orders/page.tsx`, `src/app/leader/orders/page.tsx`, `src/app/admin/orders/page.tsx`
- Детали: `src/app/partner/deals/[id]/page.tsx`, `src/app/organization/orders/[id]/page.tsx`, `src/app/manager/orders/[id]/page.tsx`, `src/app/admin/orders/[id]/page.tsx` (у leader страницы детали нет — это часть находки F5)
- Таблицы/фильтры/карточки: `src/components/partner/deals-table.tsx`, `deals-card-list.tsx`, `deals-filter.tsx`; `src/components/organization/org-orders-table.tsx`, `org-orders-filter.tsx`; `src/components/manager/manager-orders-table.tsx`, `manager-orders-filter.tsx`
- Резолверы: `src/lib/services/partner/deals.ts`, `src/lib/services/organization/orders.ts`, `src/lib/services/manager/orders.ts`

- [ ] **Step 1: Прочитать все файлы списка и детали (5 + 4)**

Цель — зафиксировать по каждой роли: заголовок/подзаголовок, наличие карточного списка, модель пагинации, набор действий, состояния empty/loading/error, куда ведёт клик по строке.

- [ ] **Step 2: Трассировать F5 (клик по строке заказа у leader)**

Открыть `src/components/manager/manager-orders-table.tsx` (его использует и leader). Найти, на какой href/Link ведёт строка. Зафиксировать: ведёт ли на `/manager/orders/[id]` (тупик для leader — нет такого роута под `/leader`, либо 404/forbidden), на `/leader/...` (которого нет), или ссылки на деталь нет вовсе. Это определяет severity F5 (P1 если тупик/404; P3 если осознанно list-only).

- [ ] **Step 3: Заполнить findings-документ по шаблону**

Создать `docs/superpowers/specs/2026-06-21-orders-family-audit-FINDINGS.md` со структурой:

```markdown
# Findings — семейство «Заказы» (аудит 2026-06-21)

Источник методологии: [спека](2026-06-21-orders-family-audit-design.md). Severity: P1 ломает флоу / P2 заметная несогласованность / P3 косметика / INTENTIONAL намеренное ролевое различие (не баг).

## Таблица «ось × роль»

| # | Ось | partner | organization | manager | leader | admin | Severity | Рекомендованный канон |
|---|-----|---------|--------------|---------|--------|-------|----------|----------------------|
| 1 | Навигация (деталь, клик по строке) | … | … | … | … | … | … | … |
| 2 | Доступность действий | … | … | … | … | … | … | … |
| 3 | Обратная связь (toast/alert) | … | … | … | … | … | … | … |
| 4 | Состояния empty/loading/error | … | … | … | … | … | … | … |
| 5 | Подтверждения (Dialog) | … | … | … | … | … | … | … |
| 6 | Кросс-ролевая консистентность (нейминг/заголовки/карточки/пагинация) | … | … | … | … | … | … | … |

## Подтверждённые находки

- **F1** … (пагинация ×3) — severity, канон
- **F2** … (дубль Paginator+pluralize) — P2 — извлечь общие юниты (см. план Фаза 2, УЖЕ делается)
- **F3** … (карточный список) — severity, канон
- **F4** … (заголовки/подписи/font-weight) — severity, канон
- **F5** … (деталь у leader) — severity по итогам Step 2, канон
- **F6** admin без списка — INTENTIONAL (Model A), не трогать

## Открытые решения для владельца
- Канон заголовка/подзаголовка списка заказов (текст, font-weight).
- Нужен ли карточный список (`*CardList`) у manager/leader или это осознанно «таблица-only».
- Что делать с деталью заказа у leader (по F5).
- (Пагинация cursor/offset — по спеке §6 НЕ унифицируем в этом проходе.)
```

Заполнить все ячейки `…` фактами из Step 1–2. Никаких «TBD» — где факт не установлен, дочитать файл.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-orders-family-audit-FINDINGS.md
git commit -m "docs(audit): orders-family findings (6 axes x 5 roles)"
```

- [ ] **Step 5: Гейт ратификации**

Остановиться. Показать findings владельцу: какие P1/P2/P3 фиксим, как звучит канон по F3/F4/F5. Эти решения → **отдельный план ремедиации** (вне этого плана; см. «После плана»). Фаза 2 ниже от ратификации НЕ зависит (F2 решён в спеке §5/§6) и идёт независимо.

---

## Фаза 2 — DRY-извлечение `pluralizeRu` и `ui/Paginator` (F2)

### Task 2: Извлечь `pluralizeRu` в `src/lib/format.ts`

Обе страницы (`partner/deals`, `organization/orders`) содержат дословную копию функции русского плюрализатора в подзаголовке. Выносим в общий форматтер.

**Files:**
- Modify: `src/lib/format.ts` (добавить функцию)
- Test: `src/__tests__/lib.format.test.ts` (добавить describe-блок)
- Modify: `src/app/organization/orders/page.tsx` (удалить локальную `pluralize`, импортировать `pluralizeRu`)
- Modify: `src/app/partner/deals/page.tsx` (то же)

- [ ] **Step 1: Написать падающий тест**

В `src/__tests__/lib.format.test.ts` добавить в конец файла:

```ts
import { pluralizeRu } from '@/lib/format';

describe('pluralizeRu', () => {
  it('1, 21 -> one (но не 11)', () => {
    expect(pluralizeRu(1, 'заказ', 'заказа', 'заказов')).toBe('заказ');
    expect(pluralizeRu(21, 'заказ', 'заказа', 'заказов')).toBe('заказ');
  });
  it('2-4, 22-24 -> few (но не 12-14)', () => {
    expect(pluralizeRu(2, 'заказ', 'заказа', 'заказов')).toBe('заказа');
    expect(pluralizeRu(24, 'заказ', 'заказа', 'заказов')).toBe('заказа');
  });
  it('0, 5, 11, 12, 14 -> many', () => {
    expect(pluralizeRu(0, 'заказ', 'заказа', 'заказов')).toBe('заказов');
    expect(pluralizeRu(5, 'заказ', 'заказа', 'заказов')).toBe('заказов');
    expect(pluralizeRu(11, 'заказ', 'заказа', 'заказов')).toBe('заказов');
    expect(pluralizeRu(12, 'заказ', 'заказа', 'заказов')).toBe('заказов');
    expect(pluralizeRu(14, 'заказ', 'заказа', 'заказов')).toBe('заказов');
  });
});
```

> Примечание: `import { fmtMoney, ... }` уже есть в начале файла; добавь `pluralizeRu` в существующий импорт ИЛИ отдельной строкой — оба варианта проходят.

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/__tests__/lib.format.test.ts -t pluralizeRu`
Expected: FAIL — `pluralizeRu` не экспортируется из `@/lib/format`.

- [ ] **Step 3: Реализовать функцию**

В `src/lib/format.ts` добавить в конец файла:

```ts
/**
 * Русский плюрализатор: pluralizeRu(2, 'заказ','заказа','заказов') -> 'заказа'.
 * Заменяет дословно скопированную локальную `pluralize` в partner/deals и organization/orders.
 */
export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run src/__tests__/lib.format.test.ts -t pluralizeRu`
Expected: PASS (3 теста).

- [ ] **Step 5: Подключить в `organization/orders/page.tsx`**

В `src/app/organization/orders/page.tsx`:
1. Добавить к импортам: `import { pluralizeRu } from '@/lib/format';`
2. В подзаголовке заменить `pluralize(total, 'заказ', 'заказа', 'заказов')` → `pluralizeRu(total, 'заказ', 'заказа', 'заказов')`.
3. Удалить локальную функцию `function pluralize(...) { ... }` (целиком).

- [ ] **Step 6: Подключить в `partner/deals/page.tsx`**

В `src/app/partner/deals/page.tsx` — те же три шага (импорт, замена вызова, удаление локальной `pluralize`).

- [ ] **Step 7: typecheck + затронутые тесты**

Run: `npm run typecheck && npx vitest run src/__tests__/lib.format.test.ts`
Expected: typecheck без ошибок (нет «unused `pluralize`»), тесты PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/format.ts src/__tests__/lib.format.test.ts src/app/organization/orders/page.tsx src/app/partner/deals/page.tsx
git commit -m "refactor(orders): extract pluralizeRu to lib/format, dedupe partner+org"
```

### Task 3: Извлечь `Paginator` в `src/components/ui/paginator.tsx`

Обе страницы содержат дословную копию offset-пагинатора. Выносим в domain-agnostic ui-примитив (CLAUDE.md §4 — строго презентационный). Компонент сам считает страницы и сам сохраняет текущие query-параметры, поэтому из страниц уходит ручной расчёт `page/pages` и guard `pages > 1`.

**Files:**
- Create: `src/components/ui/paginator.tsx`
- Modify: `src/components/ui/index.ts` (добавить экспорт)
- Test: `src/__tests__/components.ui-paginator.test.tsx`
- Modify: `src/app/organization/orders/page.tsx` (удалить локальный `Paginator` + расчёт `page/pages`, использовать общий)
- Modify: `src/app/partner/deals/page.tsx` (то же)

- [ ] **Step 1: Написать падающий тест**

Create `src/__tests__/components.ui-paginator.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Paginator } from '@/components/ui/paginator';

describe('Paginator', () => {
  it('возвращает пусто при ≤1 странице', () => {
    const html = renderToString(
      React.createElement(Paginator, { basePath: '/x', searchParams: {}, take: 25, skip: 0, total: 10 })
    );
    expect(html).toBe('');
  });

  it('первая страница (60/25): «Вперёд» есть, «Назад» нет, «Страница 1 из 3»', () => {
    const html = renderToString(
      React.createElement(Paginator, {
        basePath: '/organization/orders', searchParams: { search: 'abc' }, take: 25, skip: 0, total: 60
      })
    );
    expect(html).toContain('Вперёд');
    expect(html).not.toContain('Назад');
    expect(html).toContain('Страница 1 из 3');
  });

  it('средняя страница: обе кнопки; текущие query-параметры сохранены', () => {
    const html = renderToString(
      React.createElement(Paginator, {
        basePath: '/organization/orders', searchParams: { search: 'abc', org: 'o1' }, take: 25, skip: 25, total: 60
      })
    );
    expect(html).toContain('Назад');
    expect(html).toContain('Вперёд');
    expect(html).toContain('search=abc');
    expect(html).toContain('org=o1');
    expect(html).toContain('/organization/orders?');
  });

  it('последняя страница: «Назад» есть, «Вперёд» нет', () => {
    const html = renderToString(
      React.createElement(Paginator, {
        basePath: '/partner/deals', searchParams: {}, take: 25, skip: 50, total: 60
      })
    );
    expect(html).toContain('Назад');
    expect(html).not.toContain('Вперёд');
    expect(html).toContain('Страница 3 из 3');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/__tests__/components.ui-paginator.test.tsx`
Expected: FAIL — модуль `@/components/ui/paginator` не существует.

- [ ] **Step 3: Реализовать компонент**

Create `src/components/ui/paginator.tsx`:

```tsx
import React from 'react';

/**
 * Offset-пагинация (take/skip) для серверных списков. Domain-agnostic:
 * сохраняет все текущие query-параметры, кроме take/skip, и подставляет целевой skip.
 * Сам считает число страниц и возвращает null при ≤1 странице (вызывающему guard не нужен).
 * Извлечён из дублей в organization/orders и partner/deals (CLAUDE.md §4 — презентационный примитив).
 */
export function Paginator({
  basePath,
  searchParams,
  take,
  skip,
  total
}: {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  take: number;
  skip: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / take));
  if (pages <= 1) return null;

  const page = Math.floor(skip / take) + 1;

  function link(targetSkip: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === 'take' || k === 'skip') continue;
      if (typeof v === 'string' && v.length > 0) params.set(k, v);
    }
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);

  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>
        Страница {page} из {pages} · {total} всего
      </span>
      <div className='flex gap-2'>
        {skip > 0 && (
          <a
            href={link(prev)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Назад
          </a>
        )}
        {skip + take < total && (
          <a
            href={link(next)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Добавить экспорт в баррель**

В `src/components/ui/index.ts` добавить строку:

```ts
export { Paginator } from './paginator';
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `npx vitest run src/__tests__/components.ui-paginator.test.tsx`
Expected: PASS (4 теста).

- [ ] **Step 6: Подключить в `organization/orders/page.tsx`**

В `src/app/organization/orders/page.tsx`:
1. К импортам добавить: `import { Paginator } from '@/components/ui';`
2. Удалить расчёт `const page = ...` и `const pages = ...` (строки расчёта пагинации в теле компонента страницы).
3. Заменить блок
   ```tsx
   {pages > 1 && (
     <Paginator take={take} skip={skip} page={page} pages={pages} total={total} searchParams={sp} />
   )}
   ```
   на
   ```tsx
   <Paginator basePath='/organization/orders' searchParams={sp} take={take} skip={skip} total={total} />
   ```
4. Удалить локальную `function Paginator(...) { ... }` (целиком).

- [ ] **Step 7: Подключить в `partner/deals/page.tsx`**

В `src/app/partner/deals/page.tsx` — то же, но `basePath='/partner/deals'`. Удалить локальный `Paginator` и расчёт `page/pages`.

- [ ] **Step 8: typecheck + затронутые тесты**

Run: `npm run typecheck && npx vitest run src/__tests__/components.ui-paginator.test.tsx`
Expected: typecheck чисто (нет неиспользуемых `page`/`pages`/локального `Paginator`), тесты PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/paginator.tsx src/components/ui/index.ts src/__tests__/components.ui-paginator.test.tsx src/app/organization/orders/page.tsx src/app/partner/deals/page.tsx
git commit -m "refactor(orders): extract ui/Paginator, dedupe partner+org offset pagination"
```

---

## Фаза 3 — Верификация

### Task 4: Полная проверка фиксов Фазы 2

**Files:** нет (только команды).

- [ ] **Step 1: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: оба без ошибок/варнингов (lint-staged гоняет с `--max-warnings=0`).

- [ ] **Step 2: Unit-слой**

Run: `npm run test:unit`
Expected: PASS, включая новые `pluralizeRu` (3) и `Paginator` (4); число файлов выросло на 1 (`components.ui-paginator.test.tsx`).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: успешная сборка (страницы `organization/orders` и `partner/deals` компилируются с общими юнитами).

- [ ] **Step 4: Визуальная регрессия (условно, локально/оператором)**

Извлечение сохраняет байт-идентичную разметку (те же классы/тексты), поэтому baseline меняться НЕ должны. Если есть доступ к локальному e2e-харнессу (dev :3000 + seed):
Run: `npm run e2e:visual`
Expected: проекты `organization-*` и partner-снапшоты для списков заказов — без диффа. Если внезапно дифф (разметка сместилась) — проверить, что причина легитимна, и `npm run e2e:visual:update`. Если e2e-харнесс недоступен (см. память `project-running-locally`) — пропустить, отметить как operator-deferred.

- [ ] **Step 5: Финальный commit (если визуал обновлялся)**

```bash
git add src/e2e/snapshots
git commit -m "test(orders): refresh visual baselines after Paginator extraction"
```

Если baseline не менялись — шаг пропустить.

---

## Самопроверка плана (выполнена при написании)

- **Покрытие спеки:** §4 находки → Task 1 (findings) + Task 2/3 (F2 фикс); §5 канон-правило «дубли → общий примитив» → Task 2/3; §6 «пагинацию не унифицируем» → соблюдено (общий Paginator не меняет offset-модель, manager/leader cursor не трогаем); §8 тест-стратегия → Task 2/3 unit + Task 4 (typecheck/lint/build/e2e). F3/F4/F5/состояния — НЕ в этом плане (зависят от ратификации Task 1), вынесены в follow-up (см. ниже).
- **Плейсхолдеры:** реальный код во всех code-шагах; единственные `…` — в шаблоне findings-таблицы (заполняются в Task 1 Step 3, это её назначение), не код.
- **Консистентность типов:** `pluralizeRu(n, one, few, many)` и `Paginator({ basePath, searchParams, take, skip, total })` — одни и те же сигнатуры в реализации, тестах и местах подключения.

## После плана (follow-up, вне этого документа)

После ратификации findings (Task 1 Step 5) — **отдельный план ремедиации** для F3 (карточный список manager/leader), F4 (заголовки/подписи/font-weight), F5 (деталь заказа leader) и осей состояний/подтверждений. Их конкретный «канон» зависит от решений владельца по findings, поэтому код для них здесь намеренно не писался (иначе — плейсхолдеры/выдуманный канон).
