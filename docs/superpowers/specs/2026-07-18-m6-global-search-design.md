# Spec: M6 — Глобальный поиск (staff)

**Дата:** 2026-07-18
**Источник:** программа CRM-паритет (M1 ✅ #201 → M2 ✅ #202 → M3 ✅ #205 → M4 ✅ #207 → M5 ✅ #208 → **M6**); позиция в roadmap брейнсторма — «M6 (глобальный поиск)». Отдельного брейнсторма по M6 не было — скоуп v1 предложен агентом по образцу M5 (минимально-рисковый). Из M4 сюда явно отложен «поиск по переписке» (close-out M4 §4).
**Статус:** design — предложение агента, реализация в той же сессии. Открытые вопросы §6 — кандидаты на фазу 2 после реакции владельца.
**Ветка:** `claude/m6-global-search` (от `main`@`6282435`, включает M1–M5 + контракт-аудит).

> **Домен staff-only.** Поиск — рабочий инструмент сотрудников (manager / leader; admin — через сервис, страница — фаза 2 §6.4). Клиентские роли (partner/organization/student) его не видят никогда. Сквозной инвариант: **поиск показывает ровно то, что видит домашний список раздела** — никакого расширения видимости, все существующие scope-швы переиспользуются, не дублируются.

---

## 0. Решения (зафиксированы в этой спеке)

1. **Без новых таблиц и миграций.** v1 — параллельная read-агрегация: по каждой категории `contains` + `mode:'insensitive'` (идиома всех существующих списков, см. §1) с per-category `take` и существующим scope-where. pg_trgm / tsvector / ранжирование — фаза 2 (§6.1): текущие объёмы данных индексов не требуют, а дверь открыта — меняется реализация сервиса, не экран.
2. **8 категорий v1:** сделки (Order), организации (Organization), заявки-лиды (Lead), задачи (Task), события календаря (CalendarEvent), документы (Document), слушатели (Student), сообщения staff-чата (StaffMessage — отложенный из M4 «поиск по переписке»). **Контакты (M2) — вне v1**: PR-B справочника (`/manager/contacts`) не отгружен, результату некуда вести (§6.2).
3. **Scope = scope домашнего списка** (уточнено при smoke-тесте: страница лидера передаёт `teamModeOverride: true` — зеркало `listOrders(..., teamModeOverride: true)` на `/leader/orders`; без этого поиск лидера был бы уже его домашних списков). Orders → `managerOrderScope(session, teamMode)`; organizations → `managerOrgScope`; documents → `managerDocumentScope` (включая `scanStatus ≠ infected`); tasks → `taskWhereForLevel(session, profile?.tasks ?? 'all')`; leads → `leadWhereForLevel(session, profile?.leads ?? 'all')`; students → зеркало `listStudents` (teamMode ? org.companyId : `managedOrgIds`); события → `eventScopeWhere` (M5), сообщения → `conversationScopeWhere` (M4) — оба **экспортируются** из своих модулей (сегодня приватные), не копируются. Admin — Model A внутри company-floor, как в M5 items (для лидов — вся командная очередь, у Lead нет companyId).
4. **Страницы:** `/manager/search` + `/leader/search` (sibling-паттерн G3/M5). Поиск server-side: GET-форма `?q=` на самой странице, без API-роута и клиентского JS (идиома фильтров списков). Общий презентационный компонент выдачи — допустим по sibling-правилу (§4 CLAUDE.md): строго презентационный, domain-agnostic тип `SearchHit`; ссылки ведут в `/manager/*` (лидер — тоже manager, requireManager пускает).
5. **Флаг `global_search`** — opt-in; точки чтения: nav (`flag:` на обоих пунктах), page-гейт `notFound()` обеих страниц, сервис-гейт `isFeatureEnabled` в `globalSearch` (defense-in-depth). Middleware-точки нет — прецедент `internal_tasks`/`staff_calendar`.
6. **Категории уважают флаги своих разделов:** сообщения — только при `staff_chat`, задачи — при `internal_tasks`, календарь — при `staff_calendar` (иначе поиск раскрывал бы данные выключенного модуля; прецедент — staff-слагаемое бейджа = 0 при `staff_chat=off`).
7. **ПДн (§25.7).** Слушатели в выдаче (name+email) → новый контекст `global_search_students` (subjectType `student`, action `list`, callSite `src/lib/services/search/globalSearch.ts`) + `recordPiiAccess` с id найденных строк; `meta` — только `{take, hasQuery:true}`, **сырая строка запроса в журнал не пишется** (запрет record.ts:9). Лиды в выдаче показывают только `clientCompanyName`+`subject` (без контактных ПДн) → не журналируются — зеркалит решение домашнего списка (`manager_lead_view` журналирует карточку, не список).

## 1. Контекст (сверено по коду)

- Готового поиска нет: ни `api/*search*`, ни компонента; фильтры списков — серверные GET-формы через URL searchParams (`manager-orders-filter.tsx`).
- Идиома поиска в сервисах: `where.OR = [{ field: { contains: q, mode: 'insensitive' } }, …]`, цифровые поля (ИНН, номера) — без `mode` ([admin/organizations.ts:44](../../../src/lib/services/admin/organizations.ts), [manager/leads.ts:61](../../../src/lib/services/manager/leads.ts), [manager/students.ts:59](../../../src/lib/services/manager/students.ts)).
- Scope-швы: `managerOrderScope`/`managerOrgScope`/`managerDocumentScope` + `getCompanyTeamVisibility` ([managerPolicy.ts](../../../src/lib/auth/managerPolicy.ts)); `taskWhereForLevel`/`leadWhereForLevel` ([accessProfile.ts](../../../src/lib/auth/accessProfile.ts)); `eventScopeWhere` ([calendar/items.ts:42](../../../src/lib/services/calendar/items.ts), приватный → экспортировать); `conversationScopeWhere` ([staffChat/conversations.ts:16](../../../src/lib/services/staffChat/conversations.ts), приватный → экспортировать).
- Гейт staff — идиома `staffGate` ([tasks/tasks.ts:40](../../../src/lib/services/tasks/tasks.ts)): `admin|manager` + `companyId`, иначе `forbidden`.
- Страницы-цели ссылок существуют: `/manager/orders/[id]`, `/manager/organizations/[id]`, `/manager/leads/[id]`, `/manager/students/[id]`; задачи/календарь/документы/сообщения — списки без детальных страниц → ссылка на раздел.
- Next 15: `searchParams` — Promise (идиома [manager/orders/page.tsx:18](../../../src/app/manager/orders/page.tsx)).

**Безопасность.** Строка запроса — данные, не команды; в Prisma `contains` инъекция невозможна. Cross-company изоляция (C8) держится существующими scope-where каждой категории; deny не расширяется и не сужается относительно домашних списков. Строка запроса не пишется ни в журнал ПДн, ни в audit (поиск — read-only, audit не пишем), ни в структурные логи.

## 2. Модель данных

Нет изменений. Миграций нет.

## 3. Сервисный слой — `src/lib/services/search/`

- **`scopes.ts`** — чистые построители where по категориям: `searchScopes(session, teamMode)` возвращает набор `Prisma.*WhereInput`; admin-ветки — company-floor (`NO_COMPANY_SENTINEL`-идиома), manager-ветки — переиспользование швов §0.3. Единственный модуль, знающий про роли; сам поиск ролей не различает.
- **`globalSearch.ts`** — `globalSearch(prisma, session, { q })`:
  1. гейт: `isFeatureEnabled('global_search')` → `forbidden`; `staffGate` (admin|manager + companyId) → `forbidden`;
  2. валидация: `q.trim()`, длина < 2 → `{ ok:false, error:'too_short' }`; > 100 → срез до 100;
  3. `teamMode = getCompanyTeamVisibility(prisma, session.companyId)` — один раз на запрос;
  4. параллельный `Promise.all` по включённым категориям (§0.6), `take: 8`, узкие селекты, `orderBy` — свежие сверху (`createdAt desc`, у задач/событий — по своему датному полю);
  5. `recordPiiAccess('global_search_students')` по найденным слушателям (никогда не бросает — record.ts never-throws);
  6. маппинг в `SearchGroup[]`.

```ts
export type SearchHit = {
  id: string;
  /** Первая строка результата (название/номер/сниппет). */
  title: string;
  /** Вторая строка (орг/статус/автор) — опциональна. */
  subtitle: string | null;
  /** Куда ведёт клик; null — некликабельный хит (не встречается в v1). */
  href: string | null;
  date: Date | null;
};
export type SearchGroup = { key: SearchCategory; labelRu: string; hits: SearchHit[]; limited: boolean };
export type GlobalSearchResult =
  | { ok: true; query: string; groups: SearchGroup[] }
  | { ok: false; error: 'forbidden' | 'too_short' };
```

Поля поиска по категориям (OR): Order — `title`, `orderNumber`, `externalId`(без mode); Organization — `name`, `inn`(без mode), `externalId`(без mode); Lead — `clientCompanyName`, `subject`, `clientInn`(без mode); Task — `title`, `description`; CalendarEvent — `title`, `description`, `location`; Document — `name`; Student — `name`, `email`; StaffMessage — `body`, `attachmentName`. Сниппет сообщения — тело, срезанное до 120 символов. `limited = hits.length === take` (подпись «показаны первые 8»).

## 4. Поверхность

- **Страницы:** `src/app/manager/search/page.tsx` (`isFeatureEnabled('global_search') || notFound()` → `requireManager()` → `q = (await searchParams).q` → `globalSearch` → рендер, `force-dynamic`) и `src/app/leader/search/page.tsx` (то же с `requireManagerLeader()`). Пустой/короткий `q` → страница с формой и подсказкой, без запросов в БД (сервис не зовём при `q.trim().length < 2` — страница сама коротит; `too_short` сервиса остаётся defense-in-depth).
- **Компоненты `src/components/search/`:** `search-form.tsx` (GET-форма: `Input name='q'` + `Button`, action передаётся пропом — переиспользуется обеими страницами) и `search-results.tsx` (группы с RU-заголовком, счётчиком и списком хитов; пустая выдача — «Ничего не найдено»). Оба презентационные, палитра — примитивы `ui/`.
- **Навигация:** manager — `{ href: '/manager/search', label: 'Поиск', icon: '🔎', flag: 'global_search' }` после «Главная»; leader — `{ href: '/leader/search', label: 'Поиск', icon: '🔎', flag: 'global_search' }` после «Сводка» (leader-пункт несёт flag, как `/leader/tasks` — прецедент G3).
- **Флаг:** `global_search` в `FEATURE_FLAGS` + `OPT_IN_FLAGS`; комментарий с точками чтения (nav ×2, page-гейты ×2, сервис-гейт). Middleware-префикс не добавляется (прецедент G3/M5).

## 5. Worker

Не затрагивается: очередей, процессоров и расписаний нет.

## 6. Открытые вопросы → фаза 2

1. Полнотекст/триграммы (pg_trgm, tsvector + GIN), ранжирование, подсветка совпадений `<mark>`.
2. Контакты (M2) — после отгрузки PR-B `/manager/contacts` (+ решение о журналировании ПДн контактов и новом `PiiSubjectType 'contact'`).
3. Омниканальные источники: `InboundMessage`, `Call`, `Comment`/`Message`/`DealNote` (лента M1) — с обязательным ПДн-контекстом для inbound_sender/caller.
4. `/admin/search` (сервис admin-ready — Model A в scopes.ts; нужна только страница+nav) и «⌘K»-палитра с клиентским автокомплитом.
5. Пагинация «показать ещё» внутри категории; переброс `?q=` в фильтры домашних списков.

## 7. Тестовая стратегия

Unit (мок-prisma по образцу calendar/staff-chat): `scopes` — admin/manager ветки всех категорий, C8-floor, teamMode-прокидка, уровни профиля; `globalSearch` — гейты (клиентские роли/без компании/флаг off → forbidden), `too_short`, срез длинного q, выключенные модульные флаги режут категории, маппинг хитов и `limited`, ПДн-вызов (id слушателей, meta без сырой строки; пустая выдача — no-op record.ts). Страницы: `renderServerComponent` ×2 (флаг off → notFound, форма без q, группы с q). Компоненты: `search-form`/`search-results` (пустая выдача, группы, ссылки). Обновить снапшот-списки flags/nav-тестов, затронутые новым флагом/пунктами. Гейты перед коммитом: `typecheck`, `lint`, полный `test:unit`; полный `test:coverage` + `build` — на контроллере (прецедент M4/M5).
