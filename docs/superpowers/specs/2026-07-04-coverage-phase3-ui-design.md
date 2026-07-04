# Spec — Фаза 3 покрытия: UI-слой (`components/**` + `app/**/*.tsx`) → 100%

**Дата:** 2026-07-04
**Статус:** дизайн на ревью
**Автор-агент:** brainstorming → writing-plans
**Родительский спек:** [2026-06-15-100-percent-test-coverage-design.md](2026-06-15-100-percent-test-coverage-design.md) (программа 100%-покрытия целиком)

## 0. Терминология (важно)

Есть расхождение нумерации фаз между родительским спеком и CLAUDE.md §6:

| Слой | Родительский спек (2026-06-15) | CLAUDE.md §6 |
|---|---|---|
| Логический хвост (`lib`/`server-actions`/`app/api`/`worker`/`middleware`) | Фаза 1 | «фаза 1» |
| Хуки + email `.tsx` | часть Фазы 1/2 | «фаза 2 (Track E)» |
| `components/**` (компоненты) | Фаза 2 | «фаза 3» (UI-слои) |
| `app/**/*.tsx` (страницы) | Фаза 3 | «фаза 3» (UI-слои) |

Этот спек = **CLAUDE.md-«фаза 3»** = родительские **Фаза 2 (компоненты) + Фаза 3 (страницы)**, объединённые в один документ по решению владельца (2026-07-04). Наследует от родителя: границу denominator (§3 родителя), тестовую стратегию/качество (§5), ratchet-механику гейта (§4 Фаза 4).

## 1. Цель

Довести до **100%** по всем четырём v8-метрикам (statements/branches/functions/lines) два слоя, ещё не под порогом:

- `src/components/**/*.tsx` — **167** файлов;
- `src/app/**/*.tsx` — **90** страниц (`page.tsx`).

и закрепить порогом-гейтом (ratchet, per-glob), чтобы не деградировало.

### Non-goals

- Не заменяем Playwright visual/e2e — верстку/пиксели держат снапшоты; coverage-тесты проверяют **поведение и ветки**.
- Не гоняемся за 100% на беслогичных Next-шеллах (`layout/loading/error/not-found/global-error/template` — уже в `coverage.exclude`).
- Не рефакторим рантайм ради тестируемости без отдельного согласования (только точечно, если файл иначе непокрываем).
- Не трогаем `app/api/**` (`.ts`-роуты) — уже под порогом (Фаза 1).

## 2. Текущее состояние (2026-07-04)

- **Компоненты:** 167 `.tsx`; 41 тест-файл `components.*.test.tsx` уже есть. По доменам: partner 42, admin 29, manager 28, organization 19, ui 13, + мелкие (training 5, enrollment/chat 4, tasks/leader/import 3, settings/orders/funnel/dashboard/auth 2, pwa-installer/documents/commission/access 1).
- **Страницы:** 90 `page.tsx`; тестов на серверные компоненты страниц — **0** (все 54 теста, импортирующие `@/app/`, бьют в `app/api/**` роуты).
- **Точная карта дыр** снимается прогоном `npm run test:coverage` (json-summary), результат — вход для плана (какие из 167+90 уже на 100%, где провалы). См. §8.

## 3. Denominator / exclude

Наследуется из родителя §3 без изменений (Next-шеллы, `.d.ts`, барели, type-only модули, `worker/index.ts` уже исключены в `vitest.config.ts`).

**Политика тонких страниц (закрывает открытый вопрос родителя §7):** app-страница без исполняемых ветвлений (чистый `return <Shell><X/></Shell>` без прав/данных/условий) — исключается построчно `/* v8 ignore start … */` c комментарием-обоснованием, а НЕ покрывается вакуумным тестом ради строки. Решение пофайлово при исполнении W2. Любой `/* v8 ignore */` несёт причину-комментарий (правило CLAUDE.md §6).

## 4. Два воркстрима (внутри одного плана; отдельные PR)

Решение владельца: один spec+plan, но **W1 и W2 лендятся отдельными PR** (ревью подъёмное; PR на 250+ файлов недопустим).

### W1 — Компоненты (`components/**`), harness существует

Гибрид (рекомендация родителя §Фаза 2, инфра уже есть):

- **Презентационные / SSR-ветки** → `renderToString` (`react-dom/server`), environment `node`. Эталон — существующие [components.ui-button.test.tsx](../../../src/__tests__/components.ui-button.test.tsx), [components.manager-orders-filter.test.tsx](../../../src/__tests__/components.manager-orders-filter.test.tsx). Classic-JSX: каждый тест-файл обязан `import React` + `React.createElement` (gotcha `project-vitest-classic-jsx`). Внешние зависимости мокаются (`vi.mock('next/link')` и т.п.).
- **Интерактивные client-компоненты** (обработчики событий, `useState`/`useEffect`, async-состояние) → **jsdom + `@testing-library/react`** (per-file `// @vitest-environment jsdom`; `@testing-library/react` уже установлен — Track E использует `renderHook`). Только там, где `renderToString` физически не достаёт ветку.
- Строки, недостижимые ни одним рантаймом (SSR-гарды `typeof document/window` внутри client-effect'ов) → `/* v8 ignore */` c обоснованием (как в Track E).

**Порядок W1** (от простого к сложному — отладить паттерн на примитивах): `ui/` (13) → мелкие домены (`dashboard/auth/settings/orders/funnel/tasks/leader/chat/enrollment/import/training/documents/commission/access/pwa-installer`) → `organization` (19) → `manager` (28) → `admin` (29) → `partner` (42). Каждый домен — отдельный коммит; крупные (partner/admin/manager/org) — ревью `superpowers:requesting-code-review`.

### W2 — Страницы (`app/**/*.tsx`), harness НОВЫЙ

Серверные компоненты = async-функции. Нужен маленький общий helper (проектируется и покрывается первым в W2):

```
renderServerComponent(PageFn, { params, searchParams })
```

- Мокает `next/headers` (cookies), `@/lib/db/prisma`, `@/lib/auth/*` (`getSession`/`requireRole*`/`require*`), `next/navigation` (`redirect`/`notFound` — как throw-сентинелы, чтобы ассертить факт вызова).
- Вызывает async-страницу, рендерит возвращённый JSX через `@testing-library/react` (jsdom) и ассертит: дерево/ключевые узлы, а также `redirect(...)`/`notFound()` на ветках прав/отсутствия данных.

**Порядок W2** (по кабинетам): `auth` → `student` → `leader` → `organization` → `manager` → `admin` → `partner`. Отдельный PR от W1.

## 5. Ratchet-порог (гейт)

Per-glob thresholds в `vitest.config.ts` (в блоке, активном только в полном режиме — не `--mode=unit/integration`; механизм доказан Track E, открытый вопрос родителя §7 снят). Добавляем **инкрементально** по мере закрытия домена/кабинета, чтобы гейт зеленел по ходу, а не краснел до конца:

- W1: `src/components/ui/**` → … → `src/components/partner/**`; финал — широкий `src/components/**`.
- W2: `src/app/<кабинет>/**/*.tsx` покабинетно; финал — `src/app/**/*.tsx`.

Порог — те же `{ lines:100, branches:100, functions:100, statements:100 }`.

## 6. Тестовая стратегия / качество

Наследует родителя §5. «100%» меряет исполнение, не качество:

- Каждый тест — осмысленный `expect` на ветку/побочный эффект (условный рендер, значение пропса, `redirect`/`notFound`, вызов колбэка), **не** «отрендерилось без ошибок».
- Для форм/интерактива — проверяем оба исхода (валид/ошибка, disabled/loading, ветки состояния).
- Ревью каждой крупной пачки — `requesting-code-review`; для самых больших (partner/admin) — adversarial-проход на «пустые» тесты.

## 7. Риски

1. **W2 harness — главный неизвестный.** Серверные компоненты со сложным `Promise.all` из сервисов, `next/headers`, редиректами. Митигируем: helper проектируется и обкатывается на 2-3 простых страницах первым шагом W2, до масштабирования.
2. **Интерактивные ветки компонентов** недостижимы `renderToString` → часть файлов уедет в jsdom+`@testing-library` (дороже) или в обоснованный `/* v8 ignore */`.
3. **Тонкие страницы** — риск вакуумных тестов ради строки; митигируем политикой §3 (exclude с обоснованием).
4. **Стоимость прогона** — полный coverage ~23 мин + живой Postgres; гейт остаётся **L3/ручной** (pre-push/manual), не per-commit.
5. **Хрупкость гейта 100%** — новая строка без теста валит push; культура «тест в том же PR».

## 8. Открытые вопросы

- **Объём W2** — после снятия baseline и обкатки helper'а пересмотреть, не уходит ли часть тонких страниц в exclude (§3). Решаем по факту.
- **Точная карта дыр** — baseline-прогон `test:coverage` (в процессе на момент написания) даёт пофайловый список; он — вход для плана (батчи по доменам с реальными числами, а не оценками).

## 9. Порядок исполнения

Baseline (`test:coverage`) → план (writing-plans) → **W1** (компоненты, порядок §4, ratchet §5, отдельный PR) → **W2** (страницы: helper → кабинеты §4, ratchet §5, отдельный PR). Каждый крупный домен/кабинет — ревью. Ratchet вкручивается по ходу.
