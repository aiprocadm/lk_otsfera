# Спека — Ремедиация семейства «Заказы» (SP1 часть 2)

**Дата:** 2026-06-21
**Статус:** дизайн утверждён владельцем (ратификация findings), ждёт вычитки спеки → план
**Тип:** UX/flow ремедиация по ратифицированным находкам аудита

## 1. Контекст

Продолжение [аудита семейства «Заказы»](2026-06-21-orders-family-audit-design.md). Findings — [2026-06-21-orders-family-audit-FINDINGS.md](2026-06-21-orders-family-audit-FINDINGS.md). Часть 1 (дедуп `pluralizeRu`/`Paginator`, F2) отгружена в [PR #138](https://github.com/aiprocadm/lk_otsfera/pull/138). Эта спека закрывает **ратифицированные владельцем** находки F3/F4/F5 + ось 5.

**Граница (из аудита, держим жёстко):** не трогаем намеренные ролевые различия — admin без списка (Model A), partner lead-only (F2), manager/leader scope (C8). Пагинацию cursor/offset НЕ унифицируем (spec аудита §6).

## 2. Ратифицированные решения (что делаем)

| # | Находка | Решение владельца | Объём |
|---|---------|-------------------|-------|
| R1 | **F4** заголовки/подписи/param поиска | **Полное выравнивание** | H1 = `font-semibold text-[#111111]` во всех ролях; подзаголовок везде; param поиска `q`→`search` у manager/leader (filter + сервис) |
| R2 | **F3** карточный список manager/leader | **Добавить** `ManagerOrdersCardList` | sibling карточного списка (зеркало `OrgOrdersCardList`), рендер в manager + leader списках |
| R3 | **F5** деталь заказа у leader | **Завести** `/leader/orders/[id]` | новая страница детали под leader + `ManagerOrdersTable` принимает `basePath` (дефолт `/manager`), leader-список передаёт `/leader`; BackLink ведёт в свой кабинет |
| R4 | **ось 5** подтверждение смены статуса | **Добавить** `Dialog`-подтверждение | confirmation-модалка перед сменой статуса у manager/leader (CLAUDE.md §9) |

## 3. Канон (детали реализации)

### R1 — выравнивание заголовков/подписей/param
- **H1:** во всех 4 ролях-списках (partner/org/manager/leader) — `text-2xl font-semibold text-[#111111]`. Сейчас partner = `font-bold`, manager = без `text-[#111111]`.
- **Подзаголовок:** единый паттерн «`{N} заказов`» (через `pluralizeRu`, уже общий) + опциональный scope-суффикс: org → `· {orgName}`, leader/team-mode → `· вся компания`, scoped manager → без суффикса. Manager сейчас без подзаголовка — добавить count.
- **Param поиска:** унифицировать в `search` (как у partner/org). Затрагивает: `ManagerOrdersFilter` (имя поля/URL-param), `manager/orders/page.tsx` + `leader/orders/page.tsx` (чтение `sp`), сервис `listOrders` (аргумент `q`→`search`). **C8-инвариант изоляции не меняется** — переименование чисто параметра, не scope-логики.

### R2 — ManagerOrdersCardList
- Зеркалит `OrgOrdersCardList` (адаптивный карточный fallback, виден на мобиле, таблица `hidden md:block`). Sibling по §4 (manager-специфичный, не общий компонент).
- Рендерится в `manager/orders/page.tsx` и `leader/orders/page.tsx` рядом с таблицей. Карточка ведёт на `{basePath}/orders/${id}` (см. R3 про basePath).

### R3 — /leader/orders/[id] + basePath
- `ManagerOrdersTable` (и новый `ManagerOrdersCardList`) принимают проп **`basePath: '/manager' | '/leader'`** (дефолт `/manager`). Строки/карточки ведут на `${basePath}/orders/${id}`. manager-список не меняет поведения (дефолт), leader-список передаёт `/leader`.
- Новая страница `src/app/leader/orders/[id]/page.tsx` — деталь заказа под leader: `requireManagerLeader()`, тот же `getOrder()` (уже поддерживает leader через `isLeaderSameCompany`), BackLink → `/leader/orders`. Переиспользует презентационные компоненты детали из manager-детали; не дублирует бизнес-логику.
- **Открытый под-вопрос реализации (решить в плане при чтении кода):** доступен ли leader-у на детали тот же набор действий (смена статуса/назначение менеджера), что и manager-у, или leader read-only? Дефолт: тот же набор (leader = расширенный manager). Зафиксировать по фактическому поведению manager-детали.

### R4 — Confirmation Dialog смены статуса
- Обернуть submit `ManagerStatusChangeForm` в `Dialog`-подтверждение (примитив `src/components/ui/dialog.tsx`, CLAUDE.md §9 — нативный `<dialog>`, focus-trap/Escape бесплатно).
- Текст: «Сменить статус заказа на „{новый статус}“?» + кнопки «Подтвердить»/«Отмена». `busy`-состояние во время submit. Применяется и к manager, и к leader (shared form).

## 4. Файловая карта (предварительно, уточняется в плане)

- `src/components/manager/manager-orders-table.tsx` — +`basePath` проп, ссылки через него.
- `src/components/manager/manager-orders-card-list.tsx` — **новый** (зеркало OrgOrdersCardList) + `basePath`.
- `src/components/manager/manager-orders-filter.tsx` — param `q`→`search`.
- `src/lib/services/manager/orders.ts` — аргумент `q`→`search` (+ типы).
- `src/app/manager/orders/page.tsx` — H1/подзаголовок канон, рендер CardList, чтение `search`.
- `src/app/leader/orders/page.tsx` — то же + `basePath='/leader'`.
- `src/app/leader/orders/[id]/page.tsx` — **новый** (деталь под leader).
- Компонент(ы) смены статуса (`ManagerStatusChangeForm` — точный путь в плане) — обёртка в `Dialog`.

## 5. Тест-стратегия (CLAUDE.md §6)

- `typecheck` + `lint` + `test:unit` — обязательны.
- **R1 param:** unit на сервис `listOrders` (читает `search`); обновить тесты, где мокался `q`. Изоляция C8 — существующий integration-инвариант не должен сломаться (переименование параметра, не scope).
- **R2 CardList:** unit-рендер `ManagerOrdersCardList` (есть строки / пусто) по образцу существующих component-тестов (`import React` + `renderToString`).
- **R3 leader detail:** unit/guard-тест, что `/leader/orders/[id]` требует manager/leader и ведёт BackLink на `/leader/orders`; `basePath` проп таблицы покрыть unit (ссылка `/leader/...` vs `/manager/...`).
- **R4 Dialog:** component-тест, что submit идёт через подтверждение (по образцу `components.ui-dialog.test.tsx` и существующих form-тестов со статусом).
- Если меняется раскладка списков/детали — `e2e:visual` + обновление baseline (operator-deferred, как в части 1).
- Полный `build`.

## 6. Вне scope

- Другие семейства (Финансы/Документы/Сообщения/Команда/Заявки) — отдельные сабпроекты трека D.
- Унификация модели пагинации (cursor/offset).
- Изменение RBAC/C8/F2/Model A инвариантов.
- F7/F8 (P3 информативные находки) — не трогаем.
