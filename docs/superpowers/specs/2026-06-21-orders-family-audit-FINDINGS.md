# Findings — семейство «Заказы» (аудит 2026-06-21)

Источник методологии: спека `docs/superpowers/specs/2026-06-21-orders-family-audit-design.md`.
Severity: P1 ломает флоу / P2 заметная несогласованность / P3 косметика / INTENTIONAL намеренное ролевое различие (не баг).

---

## Таблица «ось × роль»

| # | Ось | partner | organization | manager | leader | admin | Severity | Рекомендованный канон |
|---|-----|---------|--------------|---------|--------|-------|----------|----------------------|
| 1 | Навигация (деталь, клик по строке) | Link → `/partner/deals/${id}` (в таблице через `<Link>`, в карточке весь `<Link>`-блок) | Link → `/organization/orders/${id}?org=…` (таблица + карточка) | Link только на название → `/manager/orders/${id}` (вся строка не кликабельна) | Link на название → `/manager/orders/${id}` (cross-cabinet; см. F5) | нет списка → redirect на `/admin/dashboard`; деталь `/admin/orders/${id}` достижима только прямым URL или через другой экран | P2 (leader cross-cabinet) | строки в таблице кликабельны целиком; leader ведёт на `/manager/orders/${id}` — это фактически работает (requireManager проходит), надо зафиксировать как осознанное |
| 2 | Доступность действий | только чтение + upload документа + комментарии | только чтение + upload документа + комментарии | чтение + смена статуса (`ManagerStatusChangeForm`); документы read-only (нет upload); комментарии read-only с плашкой «Возможность отвечать появится в следующем релизе» | идентично manager (shared component); нет upload; комментарии read-only | назначение менеджера (`AssignOrderManagerForm`); остальные данные read-only; нет upload, нет документов-списка, нет платежей | P2 (комментарии у manager/leader читаемые, но не интерактивные) | канон описан в Phase 8.4 roadmap: комментарии станут интерактивными; doc-upload для manager — открытый вопрос |
| 3 | Обратная связь (toast/alert) | форма upload: клиентская обратная связь через стандартный server-action + error-state; комментарии: через `DealComments` server-action | аналогично partner (shared `DealComments`; upload через `OrganizationDocumentUploadForm`) | статус-форма: `ManagerStatusChangeForm` (server-action); toast/alert не виден по коду страницы (внутри компонента) | идентично manager | assign-manager: через `AssignOrderManagerForm`; toast/alert внутри компонента | P3 (единообразие надо проверять внутри shared-компонентов, а не на уровне страниц) | без изменений до Tier-2 формы |
| 4 | Состояния empty/loading/error | empty: `DealsTable` → `<EmptyState icon='📋' message='По выбранным фильтрам заказов нет'/>`, `DealsCardList` → `null` (пропускает рендер); loading: RSC без Suspense (блокирующий fetch); error: Next.js error boundary | empty: `OrgOrdersTable` → `<EmptyState>`, `OrgOrdersCardList` → `null`; loading/error: аналогично partner | empty: `ManagerOrdersTable` → `<EmptyState icon='📋' message='По выбранным фильтрам заказов нет'>`; нет карточного fallback; loading/error: аналогично | идентично manager (shared component) | нет списка (redirect) | P2 (RSC без Suspense одинаково во всех ролях; отсутствие loading-skeleton — косметика, но единообразно) | добавить `loading.tsx` рядом с `page.tsx` для каждого списка — решение владельца |
| 5 | Подтверждения (Dialog) | нет подтверждений на деструктивных действиях (upload — не деструктивная) | нет подтверждений | нет диалога подтверждения при смене статуса через `ManagerStatusChangeForm` (форма отправляется напрямую) | идентично manager | нет подтверждения при назначении менеджера (`AssignOrderManagerForm`) | P2 (смена статуса заказа — необратима при некоторых переходах; нет confirmation Dialog) | добавить `Dialog` с подтверждением для смены статуса у manager/leader; решение владельца |
| 6 | Кросс-ролевая консистентность (нейминг/заголовки/карточки/пагинация) | H1: `«Заказы»` `font-bold`; подзаголовок: `«N заказов»`; карточный список есть (`DealsCardList`); пагинация: offset (Prev/Next, встроен в page.tsx); поиск param: `search` | H1: `«Заказы»` `font-semibold`; подзаголовок: `«N заказов · {orgName}»`; карточный список есть (`OrgOrdersCardList`); пагинация: offset (Prev/Next, встроен в page.tsx); поиск param: `search` | H1: `«Заказы»` `font-semibold` **без** `text-[#111111]`; нет подзаголовка; нет карточного списка; пагинация: cursor (`Дальше →` в table-компоненте); поиск param: `q` | H1: `«Заказы»` `font-semibold text-[#111111]`; подзаголовок: `«Все заказы компании»`; нет карточного списка; пагинация: cursor (shared ManagerOrdersTable); поиск param: `q` | нет списка | P2 (font-bold у partner vs font-semibold у остальных; нет подзаголовка у manager; нет карточек у manager/leader; расхождение param `search` vs `q`) | font-semibold везде; подзаголовок везде; param `search` везде; карточный список — вопрос к владельцу |

---

## Подтверждённые находки

### F1 — Три разные модели пагинации

- **partner** (`src/app/partner/deals/page.tsx`): offset (`skip`/`take`), Prev/Next кнопки, дублированный `Paginator` + `pluralize` встроен прямо в page.tsx.
- **organization** (`src/app/organization/orders/page.tsx`): offset (`skip`/`take`), Prev/Next кнопки, дублированный `Paginator` + `pluralize` встроен прямо в page.tsx.
- **manager/leader** (`src/components/manager/manager-orders-table.tsx`): cursor-based, кнопка «Дальше →» рендерится внутри table-компонента, нет кнопки «Назад».
- **admin**: нет списка, только деталь (INTENTIONAL).

Severity: **P2** — cursor-vs-offset принципиально разные UX-паттерны; решение по унификации принято спекой §6 (не унифицируем в этом проходе). Внутри offset-роллей — дублированный код `Paginator` + `pluralize` идентичен в partner и org (см. F2).

Канон: согласно спеке §6 — оставить cursor у manager/leader, offset у partner/org. Дублирование Paginator/pluralize — кандидат на общий util (см. F2).

---

### F2 — Дублирование Paginator + pluralize в partner и org

`src/app/partner/deals/page.tsx` строки 101–149 и `src/app/organization/orders/page.tsx` строки 108–170 содержат побайтово идентичные функции `pluralize` и `Paginator` (разница только в href-префиксе и сохранении `org`-параметра у org).

Severity: **P2** — нарушает DRY, риск дивергенции при правке одного без другого.

Канон: извлечь `pluralizeRu(n, one, few, many)` в `src/lib/utils/pluralize.ts` и `PaginatorBar` в `src/components/ui/paginator.tsx` (принимает `href`-билдер или базовый path + searchParams). Это уже запланировано как «общие юниты» в Phase 2 плана.

---

### F3 — Карточный список есть у partner/org, нет у manager/leader

- `src/components/partner/deals-card-list.tsx` — `DealsCardList` рендерится параллельно с `DealsTable`, показывается на мобильных (`md:hidden`). Ведёт на `/partner/deals/${id}`.
- `src/components/organization/org-orders-table.tsx` — `OrgOrdersCardList` экспортируется из того же файла, рендерится параллельно с таблицей на мобильных. Ведёт на `/organization/orders/${id}`.
- `src/components/manager/manager-orders-table.tsx` — нет мобильного fallback; на мобильных таблица скрыта (`hidden md:block`), но карточного альтернатива нет. На мобиле manager/leader видят пустое место вместо списка.

Severity: **P2** — у manager/leader на мобиле список недостижим (таблица скрыта, карточек нет).

Канон: добавить `ManagerOrdersCardList` (sibling-pattern) либо принять осознанное «manager/leader — desktop-only» (решение владельца).

---

### F4 — Расходятся заголовки, подзаголовки и font-weight

| Роль | H1 текст | font | Подзаголовок |
|------|----------|------|--------------|
| partner | «Заказы» | `font-bold` | «N заказ(а/ов)» |
| organization | «Заказы» | `font-semibold` | «N заказ(а/ов) · {orgName}» |
| manager | «Заказы» | `font-semibold` (**без** `text-[#111111]`) | — (нет) |
| leader | «Заказы» | `font-semibold text-[#111111]` | «Все заказы компании» |

Дополнительно: поиск у partner/org — query param `search`; у manager/leader — `q`. Filter-placeholder у partner: «Поиск по названию или номеру…»; у org/manager: «Поиск по названию или номеру заказа…» (более длинный).

Severity: **P2** — `font-bold` у partner vs `font-semibold` у остальных; отсутствие `text-[#111111]` у manager; отсутствие подзаголовка у manager; разный param поиска.

Канон: `font-semibold text-[#111111]` везде (как у leader); подзаголовок у manager — например «Мои заказы» (scoped mode) или «Заказы компании» (team mode); param поиска унифицировать в `search` (потребует изменения фильтра manager/leader и сервиса). Точный текст — решение владельца.

---

### F5 — Деталь заказа у leader: cross-cabinet ссылка, технически работает

**Трассировка (Step 2):**

Leader-список (`src/app/leader/orders/page.tsx`) использует тот же `ManagerOrdersTable`, что и manager. В компоненте (`src/components/manager/manager-orders-table.tsx`, строка 59):

```tsx
href={`/manager/orders/${o.id}`}
```

Роут `/leader/orders/[id]` **не существует** (подтверждено: `glob src/app/leader/orders/**` возвращает только `page.tsx`).

**Что происходит при клике:**

1. Middleware (`src/middleware.ts`): `/manager` разрешён для `role=manager` — leader является manager по JWT, проходит.
2. Feature-gate: `/manager` префикс проверяет флаг `manager_cabinet` — должен быть включён (иначе leader-кабинет тоже недоступен).
3. Страница `src/app/manager/orders/[id]/page.tsx`: `requireManager()` (`src/lib/auth/requireRole.ts` строка 89) — проверяет `session.role !== 'manager'`, leader проходит.
4. Данные: `getOrder()` (`src/lib/services/manager/orders.ts`) вызывает `isLeaderSameCompany()` — специально расширяет видимость leader на всю компанию. Leader **видит деталь заказа** своей компании.

**Вывод:** навигация технически функционирует. Это не P1 (тупика нет). Однако это неявный cross-cabinet переход: leader оказывается на странице `/manager/orders/[id]` (URL содержит `/manager/`), а не на `/leader/orders/[id]`. BackLink на этой странице ведёт обратно на `/manager/orders`, а не на `/leader/orders` — leader вышел из своего кабинета.

Severity: **P2** — UX-тупик в навигации назад: после клика на заказ из `/leader/orders` пользователь оказывается на `/manager/orders/{id}` с BackLink «Все заказы» → `/manager/orders`, а не `/leader/orders`. Чтобы вернуться в leader-кабинет, нужно использовать sidebar/nav.

Канон (два варианта, решение владельца):
- **Вариант A**: создать `/leader/orders/[id]` (собственная деталь или thin wrapper с правильным BackLink).
- **Вариант B**: в `ManagerOrdersTable` принимать `basePath` prop (по умолчанию `/manager`), leader-страница передаёт `/leader`. Но `/leader/orders/[id]` всё равно нужен.

---

### F6 — Admin не имеет списка заказов

`src/app/admin/orders/page.tsx` содержит только `redirect('/admin/dashboard')`. Деталь `/admin/orders/[id]` существует и доступна прямым URL (или через ссылку из dashboard).

Severity: **INTENTIONAL** — Model A: admin управляет через `/admin/*` зеркало + dashboard, не через список-кабинет. Не трогать.

---

## Дополнительные находки (за пределами F1–F6)

### F7 — filter: ManagerOrdersFilter — сервер-компонент, DealsFilter/OrgOrdersFilter — клиент

- `src/components/manager/manager-orders-filter.tsx`: `<form method='get'>` — серверный компонент, submit через нативную форму.
- `src/components/partner/deals-filter.tsx` и `src/components/organization/org-orders-filter.tsx`: `'use client'`, `useRouter`/`useSearchParams`/`useTransition`.

Это разные паттерны с разным UX: клиентские фильтры применяют select немедленно без submit-кнопки (except поиск требует Enter или кнопку); серверный фильтр manager требует нажатия «Найти».

Severity: **P3** — разный UX паттерн. Можно считать намеренной разницей (manager filter intentionally server-rendered). Фиксируем для информации.

### F8 — Таблица manager не скрывает колонку «Менеджер» от самого менеджера

В `ManagerOrdersTable` колонка «Менеджер» всегда отображается. Для manager в scoped-mode это отображает его собственное имя в каждой строке. Для leader — показывает разных менеджеров (полезно). Для manager в team-mode — тоже полезно.

Severity: **P3** — минимальная косметика; не баг.

---

## Открытые решения для владельца

1. **Канон заголовка/подзаголовка списка заказов**: зафиксировать `font-semibold text-[#111111]` везде? Какой текст подзаголовка у manager (scoped mode vs team mode)?
2. **Карточный список у manager/leader**: нужен `ManagerOrdersCardList` для мобильных (F3), или manager/leader — desktop-only кабинет?
3. **Деталь заказа у leader (F5)**: создать `/leader/orders/[id]` с правильным BackLink? или принять cross-cabinet переход как намеренный?
4. **Param поиска `q` vs `search`**: унифицировать в `search` (затрагивает manager-filter + сервис) или оставить как есть?
5. **Confirmation Dialog при смене статуса** у manager/leader (F5/ось 5): добавить или считать текущее поведение приемлемым?
6. **Пагинация cursor/offset** — по спеке §6 НЕ унифицируем в этом проходе. Подтверждаем решение.

---

## Файлы, прочитанные при аудите

**Страницы-списки:**
- `src/app/partner/deals/page.tsx`
- `src/app/organization/orders/page.tsx`
- `src/app/manager/orders/page.tsx`
- `src/app/leader/orders/page.tsx`
- `src/app/admin/orders/page.tsx`

**Страницы-детали:**
- `src/app/partner/deals/[id]/page.tsx`
- `src/app/organization/orders/[id]/page.tsx`
- `src/app/manager/orders/[id]/page.tsx`
- `src/app/admin/orders/[id]/page.tsx`
- (leader/orders/[id] — не существует, подтверждено glob)

**Компоненты:**
- `src/components/partner/deals-table.tsx`
- `src/components/partner/deals-card-list.tsx`
- `src/components/partner/deals-filter.tsx`
- `src/components/organization/org-orders-table.tsx` (содержит и OrgOrdersCardList)
- `src/components/organization/org-orders-filter.tsx`
- `src/components/manager/manager-orders-table.tsx`
- `src/components/manager/manager-orders-filter.tsx`

**Сервисы:**
- `src/lib/services/partner/deals.ts`
- `src/lib/services/organization/orders.ts`
- `src/lib/services/manager/orders.ts`

**Auth:**
- `src/lib/auth/requireRole.ts`
- `src/lib/auth/access.ts`
- `src/middleware.ts`
