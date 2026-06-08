# Согласованность ролей (admin / руководитель / manager / partner / organization / student) — аудит-карта (design)

**Дата:** 2026-06-07
**Статус:** approved (brainstorming + вычитка 2026-06-07; ось 4 = Model A). Готов под writing-plans.
**Автор:** brainstorming-сессия «всё логично реализовано в разных ролях?»
**Связанные:** CLAUDE.md §2/§4/§5/§13, [C1 org finance + leader](../plans/2026-06-04-organization-finance-hub.md), [C8 manager company-wide + leader](../plans/2026-06-05-c8-manager-company-wide.md), [admin sync control center](2026-06-07-admin-sync-control-center-design.md)

---

## 0. Журнал решений (из brainstorming)

Вопрос сессии: согласованы ли пять ролевых кабинетов между собой — нет ли «нелогичных» расхождений. Зафиксированные развилки:

1. **Выход** → *карта-аудит как spec* (не сразу унификация, не просто устный вердикт). Каждое расхождение классифицируется и получает вердикт; результат — этот документ.
2. **Глубина** → *вердикт + рекомендация + порядок*. По каждому «дрейфу»: рекомендация как чинить, оценка размера (S/M/L), риск, приоритет → готовый бэклог под writing-plans.
3. **Охват** → *Гибрид (2 слоя)*. Слой 1 — матрица присутствия (полнота). Слой 2 — глубокий вердикт по 6 структурным осям (согласованность). Решение об охвате принято агентом.
4. **Admin** → *принцип: «admin управляет всем»* (решение пользователя). Реализация — **Model A (Зеркало)**, подтверждено на вычитке 2026-06-07. Model B (Impersonation) отклонён как избыточный (см. ось 4).
5. **Недостающий кабинет** → по просьбе пользователя добавлен **`student`** (в исходном списке его не было; «руководитель» из списка — под-роль, не кабинет, так что базовых кабинетов всё равно пять).

### Метод классификации

| Метка | Значение |
|---|---|
| `осознанно (§4)` | Расхождение узаконено CLAUDE.md §4 sibling-паттерном: «компонент для partner и org не делай общим — домены расходятся». Касается **расхождения реализаций**. |
| `дрейф` | Случайное расхождение **контракта/UX/идиомы**, которое §4 не оправдывает. Кандидат на унификацию. |
| Вердикт | 🟢 ок · 🟡 частичный дрейф · 🔴 дрейф · ⚪ нужно решение |
| Размер | S (точечно) · M (несколько файлов/логика) · L (затрагивает RBAC/схему) |

**Ключевой принцип границы (§4):** sibling-паттерн узаконивает **расхождение реализаций** (три team-страницы, три гарда — by design), но **не расхождение контрактов** (имена под-ролей, redirect-поведение, видимость меню, источник навигации). Аудит ищет именно второе.

---

## 1. Канон ролей (как есть в коде)

**5 базовых кабинетов** — `Role = 'admin' | 'manager' | 'partner' | 'organization' | 'student'` (`src/lib/auth/jwt.ts:15`).

**«Руководитель» — не кабинет, а под-роль** в трёх кабинетах, реализованная тремя способами:

| Кабинет | Поле сессии | Значение «старшего» | Гард | Enforcement |
|---|---|---|---|---|
| partner | `partnerRole` | `'manager'` | `requirePartnerAdmin` / `isPartnerAdmin` | middleware + page |
| organization | `roleInOrg` | `'leader'` (+`admin`) | `requireOrganizationAdminOrLeader` | page (+ nav) |
| manager | `managerRole` | `'leader'` | `requireManagerLeader` | page (+ nav) |

`student` — тонкий bridge-shell к внешнему LMS (`/student` → `/student/redirect` чеканит одноразовый код + JWT и редиректит наружу, `src/app/student/redirect/page.tsx`). Реального in-app кабинета нет — это by design (MVP).

---

## 2. Слой 1 — матрица присутствия (полнота)

Колонки — 5 кабинетов. ✓ = есть · ✗ = нет · — = нет by-design · ~ = частично/через другой путь.

| Домен | admin | manager | partner | organization | student |
|---|:-:|:-:|:-:|:-:|:-:|
| Dashboard | ✓ | ✓ | ✓ | ✓ | — bridge |
| Заказы / Сделки | ✓ | ✓ | ✓ deals | ✓ | — |
| Документы | ✓ | ✓ *(API upload)* | ✓ | ✓ *(server-action upload)* | — |
| Сообщения | ✓ *(без флага)* | ✓ *(manager_cabinet)* | ✓ *(chat)* | ✓ *(chat)* | — |
| Финансы / Комиссии | ✓ statements | ✗ **нет** | ✓ finance | ✓ finance | — |
| Команда (под-роли) | ✓ users | ✓ /team | ✓ /team | ✓ /team | — |
| Сотрудники / Слушатели | ✓ users | ✓ students | ~ portfolio | ✓ students | self |
| Заявки (leads) | — | — | ✓ *(flag)* | — | — |
| Портфель | — | — | ✓ | — | — |
| Орг/Партнёр-управление | ✓ | ✓ orgs | — | — | — |
| Ops: sync / health / audit | ✓ | — | — | — | — |

### Completeness-флаги

- **(C-a) У manager нет финанс/комиссия-вью** — при том что воркер генерит комиссии (`docs.calculateMonthlyCommissions`, `generateCommissionPdf/Xlsx`). Открытый продуктовый вопрос (см. §5). Лин агента: вероятно by-design на MVP (manager не видит деньги; финансы — у org-owner/leader и partner-admin).
- **(C-b) «Сообщения» гейтятся тремя разными флагами** — см. ось 5.
- **(C-c) `/student` в меню только у organization** (пункт «Кабинет слушателя»), хотя middleware пускает в `/student` ещё manager и admin — но без пункта меню (`src/lib/navigation/cabinet.ts`, `src/lib/auth/access.ts:16`). Мелкий дрейф; фиксится заодно с осью 4/2.
- partner «Сотрудники» — через `org-employees-tab` портфеля, не отдельной страницей. By design (partner работает через организации портфеля). 🟢.

---

## 3. Слой 2 — структурные оси (согласованность)

### Ось 1 — модель «руководителя» (под-роли / elevation)

**Факт:** три под-роли (см. §1). `partnerRole='manager'`, `roleInOrg='leader'`, `managerRole='leader'` — два имени для одной идеи «старший в группе». Три гарда. Разное поведение при отказе: partner → `/forbidden` (middleware+page), org → `/forbidden` (page), manager-leader → `/manager/dashboard` (мягко, `src/lib/auth/requireRole.ts:78`). Разный уровень enforcement: у partner elevation захардкожена в middleware (`src/middleware.ts:58-67`), у org/manager — нет.

**Классификация:** расхождение **реализаций** (3 гарда/3 страницы) — `осознанно (§4)`. Расхождение **контракта** — `дрейф`: (a) имя `manager` для partner-старшего конфликтует с top-level ролью `manager`; (b) redirect-контракт неоднороден (forbidden vs dashboard); (c) уровень enforcement неоднороден.

**Вердикт:** 🟡 частичный дрейф.
**Рекомендация:**
1. Единый redirect-контракт при нехватке прав внутри кабинета. Рекомендую `/forbidden` везде (явный сигнал «нет прав»), либо явно задокументировать, почему manager-leader мягкий. **S · low.**
2. Зафиксировать **словарь под-ролей** в `jwt.ts` (комментарий/тип-алиас): `partnerRole='manager'` = «партнёрский администратор». Значение не мигрировать (дорого), но снять двусмысленность в типах и доке. **S · low.**
3. НЕ добавлять middleware-enforcement для org/manager elevation (page+nav достаточно) — описать как осознанный выбор, выровняв формулировку с partner. **S · low.**

### Ось 2 — навигация

**Факт:** admin / manager / partner / student рендерятся через `AppShell` → `navItemsFor(navByRole)` (`src/components/dashboard/app-shell.tsx:47`). organization — через отдельный клиентский `OrgSidebar` с хардкод-списком `ITEMS` (`src/components/organization/org-sidebar.tsx:9-16`). При этом `navByRole.organization` — **заглушка** (только dashboard, `/student`, messages); реальные пункты org (Финансы, Команда, Документы, Заказы, Сотрудники) живут лишь в `OrgSidebar`. Два источника правды; меню org нельзя получить из `navByRole`.

**Классификация:** `дрейф`. (Причина дрейфа объяснимая — org-switcher и per-org контекст требуют клиентского компонента, — но это не узаконивает мёртвую заглушку `navByRole.organization` и второй источник правды.)

**Вердикт:** 🔴 дрейф.
**Рекомендация:** привести org к единому источнику. Вариант-минимум: синхронизировать `navByRole.organization` с реальными пунктами и рендерить через `navItemsFor`, добавив org-switcher как слот/проп шелла. Если per-org client-context принципиально требует отдельного компонента — оставить `OrgSidebar`, но **пункты брать из `navByRole.organization`** (один источник), а не из хардкода. **M · medium** (org-switcher + query-param/cookie логика, e2e org-проект).

### Ось 3 — идиома гарда (defense-in-depth §4)

**Факт:** три идиомы. partner-страницы местами — ручной `getSession()` + `redirect('/login')` + `isPartnerAdmin` (`src/app/partner/team/page.tsx:11-13`). organization — `requireOrganization()` в layout + per-page контекст (`src/app/organization/layout.tsx:10`). manager/admin — семейство `require*` (`requireManager`, `requireManagerLeader`, `requireAdmin`, …). Defense-in-depth (middleware+page+service) есть везде — но идиома страницы неоднородна.

**Классификация:** `дрейф (мягкий)`. Функционально корректно; риск — при копипасте легко пропустить слой, плюс когнитивная нагрузка.

**Вердикт:** 🟡 мягкий дрейф.
**Рекомендация:** каноничный `require*`-хелпер на каждый кабинет в `src/lib/auth/requireRole.ts`; заменить ручной `getSession()+redirect` в partner-страницах на уже существующий `requirePartnerAdmin()`. **S–M · low.**

### Ось 4 — admin-reach (принцип «admin управляет всем»)

**Факт — трёхслойная несогласованность:**
- **Сервис/policy:** `if (session.role === 'admin') return true` во всех чек-функциях (`src/lib/auth/policy.ts:15,44`) → admin **уже** всемогущ по данным.
- **Middleware:** нет admin-байпаса; `protectedPrefixes` пускает admin в `/partner`, `/organization`, `/student`, но **блокирует `/manager`** (`src/lib/auth/access.ts:11-17`, `src/middleware.ts:52-56`).
- **Page-гард:** `requireOrganization` / `requirePartnerAdmin` / `requireManager` **бьют admin** (`role !== '…'`). → admin не может работать внутри чужого кабинета; реальная власть — через `/admin/*` зеркало.

Итог: записи admin в `protectedPrefixes` для `/partner` и `/organization` — **мёртвые двери** (middleware пускает, page-гард всё равно бьёт). `/manager` не пускает даже middleware. Принцип «admin управляет всем» истинен на уровне данных, ложен на уровне кабинетов, и непоследователен между кабинетами.

**Классификация:** 🔴 `дрейф` (3-слойная несогласованность). **Принцип-решение пользователя: admin управляет всем.**

**Рекомендация — Model A (Зеркало), рекомендуемая:**
1. Узаконить: admin-omnipotence = `/admin/*` зеркало + policy `return true`. (Власть admin **не уменьшается** — она тут и живёт.)
2. Убрать admin из `protectedPrefixes['/partner']` и `['/organization']` — мёртвые двери. **Предусловие** (тест-стратегия §6): grep, нет ли под этими префиксами shared-роутов без ролевого гарда, которые admin реально использует.
3. Узаконить `/manager` без admin как **единое правило**: «кабинет = его роль; admin — через `/admin/*` + policy». Задокументировать в CLAUDE.md §4.
**S · low.**

**Альтернатива — Model B (Impersonation):** admin реально входит в каждый кабинет → admin во все `protectedPrefixes` + все `require*` пускают admin + обработка scope (у admin нет `companyId`/`managedOrgIds` → manager-сервисы сломаются; нужен company-wide-unscoped admin-режим или явный admin-view). **M–L · medium** (трогает RBAC §4, mode-aware scope C8).

> **Решено (вычитка 2026-06-07): Model A.** Литеральный вход admin в кабинеты (B) не требуется — принцип «admin управляет всем» выполнен через `/admin/*` + policy `return true`.

### Ось 5 — флаг-гейтинг (§5)

**Факт:** «Сообщения» гейтятся тремя способами: admin/messages — **без флага**; manager/messages — `manager_cabinet`; partner/messages и organization/messages — `chat` (`src/lib/navigation/cabinet.ts`, `src/middleware.ts:10-11`). Флаг `chat` используется в middleware и nav, но **не перечислен в CLAUDE.md §5** (там 8 флагов, `chat` отсутствует).

**Классификация:** `дрейф`. Один и тот же домен (messages) — три разных гейта; недокументированный флаг нарушает 3-точечное правило §5.

**Вердикт:** 🟡 дрейф.
**Рекомендация:**
1. Выровнять «Сообщения» под единый флаг (вероятно `chat`) для manager/partner/org; admin-messages без флага — оставить как явное internal-исключение, **задокументировав** матрицу. **S · low.**
2. Проверить `chat` по §5 (3 точки: middleware ✓, nav ✓, route-handler `requireFeature`/`notFoundIfDisabled` — проверить в `api/comments`/messages-роутах). Добавить `chat` в список CLAUDE.md §5. **S · low.**

### Ось 6 — синхрон меню↔гард

**Факт:** `navByRole.partner` пункт `/team` — **без** `leaderOnly`/`adminOnly` (`src/lib/navigation/cabinet.ts:32`) → «Команда» видна **всем** partner-пользователям. Но доступ закрыт двумя слоями: middleware (`src/middleware.ts:58-67`, `/partner/team` admin-only) + page (`isPartnerAdmin`). → не-admin партнёр **видит пункт, кликает, получает `/forbidden`**. Сравнить: manager `/team` — `leaderOnly` (скрыт), org `/team` — `adminOnly`+leader (скрыт от member). Контроль доступа у partner корректен и многослоен — рассинхронизирована только **видимость меню**.

**Классификация:** 🔴 `дрейф (UX-баг)`. Самый явный «нелогичный» пункт для конечного пользователя.

**Вердикт:** 🔴 дрейф.
**Рекомендация:** добавить в `navByRole.partner` пункту `/team` флаг `adminOnly` (аналог `leaderOnly`) и расширить `navItemsFor` фильтром по `session.partnerRole === 'admin'`. `navItemsFor` уже умеет фильтровать `leaderOnly` — это тот же механизм. **S · low.**

> **Эталон-паттерн** для «доступ шире/уже меню»: student-bridge (`src/app/student/redirect/page.tsx:49-55`) — жёсткий серверный гейт на чувствительное действие + комментарий «почему». Применять как референс при правках осей 4/6.

---

## 4. Сводка вердиктов

| Ось | Вердикт | Класс | Размер · Риск |
|---|---|---|---|
| 1 Модель «руководителя» | 🟡 частичный дрейф | контракт-дрейф | S · low |
| 2 Навигация (org) | 🔴 дрейф | дрейф | M · medium |
| 3 Идиома гарда | 🟡 мягкий дрейф | дрейф | S–M · low |
| 4 Admin-reach | 🔴 дрейф (3-слой) | дрейф | S (A) / M–L (B) · low/med |
| 5 Флаг-гейтинг messages | 🟡 дрейф | дрейф | S · low |
| 6 Меню↔гард (partner/team) | 🔴 дрейф (UX) | дрейф | S · low |

Осознанные расхождения (НЕ чинить, by-design §4): три team-страницы/гарда как реализации; partner-сотрудники через портфель; student как bridge-shell; отсутствие ops-доменов у не-admin.

---

## 5. Открытые вопросы

1. ~~**Admin-модель (ось 4):**~~ **РЕШЕНО (2026-06-07): Model A** (Зеркало). Model B отклонён.
2. **Manager finance-вью (C-a):** нужен ли manager read-only финанс/комиссия-вью? Лин агента — нет на MVP. Это **продуктовое** решение, не код.

---

## 6. Приоритизированный бэклог (готов под writing-plans)

| # | Приоритет | Ось | Задача | Размер · Риск |
|---|---|---|---|---|
| 1 | **P1 ✅** | 6 | `adminOnly` на `navByRole.partner` `/team` + фильтр в `navItemsFor` | S · low |
| 2 | **P1 ✅** | 1 | Единый redirect-контракт под-ролей + словарь под-ролей (док/типы) | S · low |
| 3 | **P1 ✅** | 4 | Model A: убрать мёртвые двери admin, узаконить правило (после подтверждения §5.1) | S · low |
| 4 | **P2** | 5 | Выровнять флаг messages + внести `chat` в CLAUDE.md §5 (проверить 3 точки) | S · low |
| 5 | **P2** | 3 | Канонизация `require*`-идиомы; partner `getSession`→`requirePartnerAdmin` | S–M · low |
| 6 | **P3** | 2 | Унификация навигации org → единый источник `navByRole` | M · medium |
| — | Open | C-a | Продуктовое решение по manager finance-вью (не код) | — |

**Порядок:** P1 (3 точечных низкориска, дают видимый эффект и убирают UX-баг) → P2 (выравнивание идиом/флагов) → P3 (навигация org — самое крупное, отдельным планом).

**Статус:** P1 (строки 1–3) ✅ отгружен 2026-06-07 — Task 1 `5e67bb2`, Task 2 `db6f2ed`, Task 3 `c07996a` (план [role-consistency-p1](../plans/2026-06-07-role-consistency-p1.md), close-out [-DONE](../plans/2026-06-07-role-consistency-p1-DONE.md)). P2 (строки 4–5) — план [role-consistency-p2](../plans/2026-06-08-role-consistency-p2.md).

> **Поправка к оси 5 (2026-06-08):** при подготовке P2-плана выяснилось, что рекомендация «выровнять manager/partner/org messages под единый флаг `chat`» опирается на неполную модель. `/messages` несёт ДВА домена: order-comments (ungated, есть у manager/admin) и team-chat (флаг `chat`). У partner/org `/messages` — чат-only (корректно hard-gated по `chat` во всех 3 точках §5). Менеджерский нельзя гейтить через `chat` (скроет комментарии). Поэтому ось 5 в P2 сведена к **документации** (внести `chat` в CLAUDE.md §5 + матрица), без правок флагов. Админский graceful-режим — узаконенное internal-исключение.

---

## 7. Тест-стратегия

Принцип: любая унификация **обязана сохранить defense-in-depth §4** (middleware + page + service). Слои не сокращать.

- **Ось 6:** unit на `navItemsFor` — partner-не-admin не видит `/team`, partner-admin видит. Регрессия: middleware/page-гард `/partner/team` по-прежнему бьёт не-admin.
- **Ось 4 (Model A):** (1) grep всех роутов под `/partner`,`/organization` без ролевого гарда — подтвердить безопасность удаления admin из `protectedPrefixes`; (2) тест, что admin остаётся omnipotent через `policy.ts` (`canReadOrder`/`canAccessOrganization` → `true`); (3) cross-role: admin НЕ получает доступ к кабинетным мутациям, требующим `partnerId`/`organizationId`.
- **Ось 1:** тест redirect-контракта — denied elevation для каждой под-роли ведёт на ожидаемый таргет (после унификации — единый).
- **Ось 5:** тест `chat` по 3 точкам §5 (middleware/nav/route-handler).
- **Ось 2:** e2e org-проект (storageState `organization`) + snapshot — после миграции org-меню рендерит те же пункты; org-switcher работает.
- **Регрессия C8:** cross-company инвариант (manager company-wide) не должен пострадать от admin-правок (ось 4).

Слой запуска тестов — по CLAUDE.md §6 (L1 при коммите, L2 unit при push, L3 integration перед PR).
