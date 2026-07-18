# Plan: M6 — Глобальный поиск (staff)

**Spec:** [2026-07-18-m6-global-search-design.md](../specs/2026-07-18-m6-global-search-design.md)
**Ветка:** `claude/m6-global-search` (от `main`@`6282435`)
**Формат:** одна сессия, задачи последовательные; тесты пишутся рядом с кодом каждой задачи.

## Задачи

- [x] **T1. Флаг + экспорт швов.**
  - `global_search` в `FEATURE_FLAGS` (комментарий с точками чтения) + `OPT_IN_FLAGS`.
  - Экспортировать `eventScopeWhere` из `src/lib/services/calendar/items.ts` и `conversationScopeWhere` из `src/lib/services/staffChat/conversations.ts` (docstring: переиспользуется поиском M6; поведение не меняется).
  - Обновить тесты, перечисляющие флаги (если есть snapshot-список).

- [x] **T2. ПДн-контекст.** `global_search_students` в `src/lib/pii/contexts.ts` (subjectType `student`, action `list`, labelRu «Глобальный поиск: слушатели», callSite `src/lib/services/search/globalSearch.ts`). Guardrail `pii.capture-coverage` станет зелёным после T3.

- [x] **T3. Сервис.** `src/lib/services/search/scopes.ts` (admin/manager where-построители 8 категорий, чистые функции) + `src/lib/services/search/globalSearch.ts` (гейты → валидация q → teamMode → Promise.all с take 8 → recordPiiAccess слушателей → маппинг SearchGroup[]). Категории task/event/message — за флагами своих модулей.
  - Тесты: `services.search.scopes.test.ts`, `services.search.global-search.test.ts` (полное покрытие ветвей — денominator 100%).

- [x] **T4. Компоненты.** `src/components/search/search-form.tsx` (GET-форма, примитивы ui/) + `src/components/search/search-results.tsx` (группы, счётчики, «показаны первые 8», пустая выдача). Тесты компонентов.

- [x] **T5. Страницы + nav.** `src/app/manager/search/page.tsx` (+ leader sibling): флаг-гейт `notFound()`, require-гвард, `searchParams` Promise, `force-dynamic`; короткий q — без похода в сервис. Пункты «Поиск» 🔎 в `navByRole.manager` и `navByRole.leader`. Тесты страниц (`renderServerComponent`) + правка nav-тестов.

- [x] **T6. Гейты + close-out.** `npm run typecheck`, `npm run lint`, полный `npm run test:unit`; живой smoke (dev на :3000, `FEATURE_GLOBAL_SEARCH=1`): логин менеджером → `/manager/search?q=` по знакомым сидовым данным. Коммит + push. `2026-07-18-m6-global-search-DONE.md` (формат M5-DONE): отгружено/отложено/статус гейтов/коммиты.
