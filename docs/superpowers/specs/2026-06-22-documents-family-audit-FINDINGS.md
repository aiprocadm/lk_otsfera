# Findings — семейство «Документы» (аудит 2026-06-22)

Методология: `docs/superpowers/specs/2026-06-21-orders-family-audit-design.md` (наследуется).
Префикс находок — `DD` (Track **D** / **D**ocuments). Severity P1/P2/P3/INTENTIONAL.

Роли с экраном «Документы»: partner, organization, manager, admin (4). У leader отдельного экрана
документов нет (видит через manager-кабинет / leader hub). `DocumentsList` (`components/partner/
documents-list.tsx`) — **уже общий** презентационный компонент для всех 4 ролей (хорошо); дублируется
только page-chrome (заголовок/табы/тип-фильтр/пагинатор/pluralize).

---

## Таблица «ось × роль»

| # | Ось | partner | organization | manager | admin | Severity | Канон |
|---|-----|---------|--------------|---------|-------|----------|-------|
| 1 | Заголовок | «Документы» `text-2xl font-**bold** text-[#111111]` + подзаг (count+pluralize) | «Документы» `text-2xl font-**bold**` + подзаг | «Документы» `text-2xl font-semibold` — **без подзаг** | **«Admin · Documents» `text-xl font-semibold`** (англ., меньше, без `text-[#111111]`) | **P2** | `text-2xl font-semibold text-[#111111]` + рус.«Документы» везде (R1 + §13) |
| 2 | Param поиска | `search` | `search` | **`q`** | n/a (нет поиска) | P2 | `search` везде (R1-канон) |
| 3 | Пагинация | offset, локальный `Paginator` (дубль) | offset, локальный `Paginator` (дубль) | cursor «Дальше →» | нет (take 200 хардкод) | P2 | offset/cursor НЕ унифицируем (spec §6); но **локальные `Paginator` заменить на общий `ui/Paginator`** (F2) |
| 4 | Табы (По заказам / Общие) | инлайн `<Link>`, border-стиль (`bg-white border`) | инлайн, border-стиль | `TabChips` компонент, **gray-стиль** (`bg-gray-100`, без border) | `TabChips` компонент (своя копия!), gray-стиль | P2 | дедуп `TabChips` (manager+admin копии) + единый стиль — judgment владельца |
| 5 | Тип-фильтр (чипы по типам) | локальные `TypeFilter`+`Chip` | локальные `TypeFilter`+`Chip` (дубль, +`org`) | `<select>` в форме (другой паттерн) | нет | P3 | partner/org `TypeFilter`/`Chip` дублируются → кандидат на общий; manager `<select>` намеренно иной |
| 6 | pluralize подзаголовка | локальный `pluralize` (дубль) | локальный `pluralize` (дубль) | n/a | n/a | P3 | `pluralizeRu` из `lib/format` (F2) |
| 7 | Доступность действий (upload) | нет upload на странице (partner outgoing-only через деталь заказа) | upload order-less на вкладке «Общие» | upload order-less на «Общие» | нет upload | INTENTIONAL | по document-exchange design (partner outgoing-only) |

---

## Подтверждённые находки (чиним в этом проходе — продолжение канона R1/F2 + §13)

### DD1 — Заголовки расходятся; admin на английском — P2
partner/org `font-bold`; manager `font-semibold`; **admin = `text-xl font-semibold` + «Admin · Documents»**
(англ., другой размер, без `text-[#111111]`). Канон: `text-2xl font-semibold text-[#111111]` + рус.
«Документы» во всех 4 (R1 + CLAUDE.md §13 локализация). → чиним.

### DD2 — Param поиска `q` (manager) vs `search` (partner/org) — P2
manager-документы используют `q` (URL + форма + сервис Zod-схема `listDocuments`). Канон R1 = `search`.
→ переименовать сервис-опцию + фильтр + URL-param + форму + 1 unit-тест (`services.manager.documents.unit.test.ts:112`). → чиним.

### DD3 — Локальный `Paginator` дублируется в partner/org вместо общего `ui/Paginator` — P2
`ui/Paginator` (извлечён в F2 Заказов) domain-agnostic, offset, `basePath`+`searchParams`, те же «Назад»/
«Вперёд», сам считает страницы и возвращает null при ≤1. partner/org документы держат свои побайтовые
копии. → заменить на общий `ui/Paginator` в обеих страницах. → чиним.

### DD4 — Локальный `pluralize` дублируется вместо `pluralizeRu` — P3
partner/org документы держат локальный `pluralize` (идентичен `pluralizeRu` из `lib/format`).
→ заменить на `pluralizeRu`. → чиним.

---

## Открытые решения для владельца (НЕ реализуем без ратификации)

1. **DD-tabs (ось 4):** дедуп `TabChips` (manager+admin держат отдельные копии) и единый визуальный стиль
   табов — partner/org рисуют border-чипы инлайн, manager/admin — `bg-gray-100` через компонент. Свести к
   одному стилю + общему компоненту? Какой стиль канон?
2. **DD-typefilter (ось 5):** partner/org `TypeFilter`+`Chip` дублируются (отличие — `org`-param). Извлечь
   общий компонент? manager использует `<select>` (намеренно иной — оставить?).
3. **manager-подзаголовок (ось 1):** добавить подзаголовок-count менеджеру (как partner/org)? cursor-список
   manager не имеет `total` — отсюда у Заказов был scope-label canon. Для документов — текст?
4. **admin-пагинация (ось 3):** admin general-вкладка грузит `take:200` без пагинатора — добавить пагинацию
   или оставить (admin = Model A, internal)?

---

## Файлы аудита
Страницы: `src/app/{partner,organization,manager,admin}/documents/page.tsx`.
Компоненты: `partner/documents-list.tsx` (общий), `documents/documents-panel.tsx` (admin orders),
upload-формы по ролям. Сервисы: `manager/documents.ts`, `organization/documents.ts`,
`partner/{documentsList,orgDocuments}.ts`. Общий примитив: `ui/paginator.tsx`, `lib/format.ts`.
