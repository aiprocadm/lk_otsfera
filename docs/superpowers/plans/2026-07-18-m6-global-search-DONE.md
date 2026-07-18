# DONE: M6 — Глобальный поиск (staff)

**Дата:** 2026-07-18
**Spec:** [2026-07-18-m6-global-search-design.md](../specs/2026-07-18-m6-global-search-design.md)
**Plan:** [2026-07-18-m6-global-search.md](2026-07-18-m6-global-search.md)
**Ветка:** `claude/m6-global-search` (от `main`@`6282435`)

## Что отгружено

- **Флаг `global_search`** — opt-in, три точки чтения: nav (пункты «Поиск» 🔎 у manager и leader), page-гейты обеих страниц (`notFound()` до auth), сервис-гейт в `globalSearch` (`forbidden`). Middleware-точки нет — прецедент `internal_tasks`/`staff_calendar`.
- **Сервис `src/lib/services/search/`** — без новых таблиц и миграций:
  - `scopes.ts` — where-построители 8 категорий (заказы, организации, заявки, задачи, события календаря, документы, слушатели, сообщения staff-чата). Manager-ветки переиспользуют существующие швы (`managerOrderScope` / `managerOrgScope` / `managerDocumentScope` / `taskWhereForLevel` / `leadWhereForLevel` / `eventScopeWhere` / `conversationScopeWhere`), admin — company-floor (Model A). Единственный модуль поиска, различающий роли.
  - `globalSearch.ts` — гейты → валидация `q` (< 2 → `too_short`, > 100 → срез) → `teamMode` → параллельный `Promise.all` по включённым категориям (`take: 8`, узкие селекты) → `recordPiiAccess` → `SearchGroup[]`. Категории задач/календаря/чата участвуют только при включённых `internal_tasks` / `staff_calendar` / `staff_chat` — поиск не раскрывает выключенный модуль.
- **ПДн (§25.7)** — новый контекст `global_search_students`; журналируются id найденных слушателей, `meta` только счётчики (`{take, hasQuery}`), сырая строка запроса не пишется никуда (ни журнал, ни audit, ни логи).
- **Экспорт швов** — `eventScopeWhere` (M5) и `conversationScopeWhere` (M4) из приватных стали экспортируемыми; поведение не менялось.
- **UI** — страницы `/manager/search` (`requireManager`) и `/leader/search` (`requireManagerLeader`), обе `force-dynamic`, `searchParams` как Promise (Next 15), короткий `q` коротится до сервиса. Компоненты `search-form.tsx` (GET-форма без клиентского JS) и `search-results.tsx` (группы, счётчики, «показаны первые N», пустая выдача) — презентационные, на примитивах `ui/`.

## Отклонение от плана

`teamModeOverride` у страницы лидера — не был в спеке, найден живым smoke-тестом: `/leader/orders` показывает всю компанию через `listOrders(..., teamModeOverride: true)`, а поиск читал общий тумблер `managerTeamVisibility` (у демо-компании выключен) и отдавал лидеру пустую выдачу. Добавлен опциональный `teamModeOverride` в `globalSearch`; передаёт только страница лидера, гейт — `requireManagerLeader`. Инвариант «поиск видит ровно то, что домашний список раздела» восстановлен.

## Отложено (фаза 2, §6 спеки)

Полнотекст/триграммы (pg_trgm, tsvector) и ранжирование с подсветкой; контакты M2 (ждут PR-B `/manager/contacts` и решения о ПДн-контексте контактов); омниканальные источники (`InboundMessage`, `Call`, `Comment`/`Message`/`DealNote`); `/admin/search` (сервис admin-ready — нужна только страница + nav) и «⌘K»-палитра с автокомплитом; пагинация «показать ещё» внутри категории.

## Тесты

Новые: `services.search.scopes` (12), `services.search.global-search` (15), `components.search` (6), `pages.manager-search` (6), `pages.leader-search` (5). Обновлены под новый флаг и пункты меню: `featureFlags`, `featureFlags.manager`, `navigation.cabinet.leader`, `components.manager-sidebar`, `components.leader-sidebar`, `pii.contexts`.

## Статус гейтов

`typecheck` ✅ · `lint` ✅ (0 warnings) · полный `test:unit` ✅ · живой smoke на :3000 с `FEATURE_GLOBAL_SEARCH=1` (менеджер и лидер, запрос «демо» → группа «Заказы» со ссылкой на карточку) ✅. Полный `test:coverage` + `build` + `gate` — на контроллере (прецедент M4/M5). Миграций нет.
