# Track G1 (P2) — Конструктор ролей (AccessProfile) — design

**Дата:** 2026-07-02
**Источник требований:** внешний промпт `ClaudeCode_prompt_трек_G1_конструктор_ролей.md` + `ТЗ_Разработчик_lk_otsfera_v0.5` §3.2–3.3 + бизнес-ТЗ v0.6 §6.3/§21.
**Предпосылка:** треки A+C, B, F, D закрыты и в `main`.
**Scope:** только **G1** (фундамент — права как данные). G2 (воронка/канбан), G3 (задачи/канбан), G4 (CRM-карточка) — отдельно.

---

## 1. Проблема и цель

Сейчас видимость менеджера захардкожена: `Company.managerTeamVisibility` (булев `teamMode`) переключает менеджера между **three-way scoped** (свои заказы `managerId==sub` ∪ закреплённые орги `managedOrgIds` ∪ исторические комментарии) и **company-wide** (все заказы компании). Ставок «нарезать» роль по типам объектов нет.

Цель G1: дать администратору/руководителю **создавать роли-профили с настраиваемым набором прав как данные** (без правки кода), поверх системного `enum Role`. Системные роли остаются якорями доступа к префиксам маршрутов; кастомные профили настраивают охват **внутри** менеджерского контура.

Не-цель G1: отделы/подчинение (позже); полная воронка leads (G2); UI-редактор статусов/KPI (другие треки).

---

## 2. Ключевое архитектурное решение — **наслоение, а не замена**

Промпт требует одновременно: (a) «охват берётся из профиля» и (b) «регресс-тесты C IDOR / F list-cross-tenant зелёные **без изменений**, поведение по умолчанию идентично». Единственная согласованная трактовка:

> **Профиль — это override, читаемый из сессии. При отсутствии профиля (`accessProfileId=null`) резолвер падает в существующую `teamMode`-логику ровно как сегодня.**

Следствия:
- Существующие тесты строят manager-сессии **без** `accessProfile` → попадают в legacy-ветку → байт-в-байт то же поведение → зелёные без правок.
- Сигнатуры публичных резолверов **не меняются** (`managerOrderScope(session, teamMode)` и т.п.) — функция внутри сперва смотрит `session.accessProfile`, а `teamMode` остаётся fallback'ом. Нулевой churn на ~15 call-site'ах.
- «Дефолтный профиль `all`» из промпта = когда руководитель ЯВНО создаёт профиль уровня `all`, он эквивалентен company-wide (`teamMode=on`). Но существующие менеджеры остаются на `null` и сохраняют сегодняшнее поведение точь-в-точь.

**Company-scope (C8) — жёсткий пол поверх любого профиля.** Профиль не может расширить видимость за пределы своей компании; во всех profile-ветках AND-ится `companyId` (или `NO_COMPANY_SENTINEL` при `companyId=null` → fail-safe deny company-wide).

---

## 3. Модель данных (G1.1)

### 3.1. Prisma

```prisma
enum ScopeLevel {
  own
  assigned
  all
}

model AccessProfile {
  id                 String     @id @default(cuid())
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
  companyId          String
  company            Company    @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name               String
  ordersScope        ScopeLevel @default(all)
  organizationsScope ScopeLevel @default(all)
  threadsScope       ScopeLevel @default(all)
  documentsScope     ScopeLevel @default(all)
  financeScope       ScopeLevel @default(all)
  leadsScope         ScopeLevel @default(all)
  capabilities       String[]   // default-deny: пустой = никаких флагов
  users              User[]

  @@unique([companyId, name])
  @@index([companyId])
}
```

На `User`: `accessProfileId String?` + relation `accessProfile AccessProfile?`. На `Company`: `accessProfiles AccessProfile[]`.

**Почему enum-колонки для охватов, а не Json:** типобезопасность + queryable + дефолт `all` = обратная совместимость на уровне БД. **Почему `String[]` для capabilities:** open-ended (§25.2 «настройка вместо кода»), новый флаг не требует миграции; типобезопасность обеспечивается union `Capability` + Zod-энумом в коде; идиоматично проекту (`productMix String[]`, `notificationChannels Json?`).

**Миграция** — аддитивная, обратимая: новый enum + новая таблица + nullable-колонка `User.accessProfileId` (существующие строки = `null` = legacy). Дефолт колонок охвата `all` — «безопасный дефолт» (промпт), но применяется только к ЯВНО созданным профилям.

### 3.2. Типы в коде (`src/lib/auth/accessProfile.ts` — новый барьерный модуль)

```ts
export type ScopeLevel = 'own' | 'assigned' | 'all';
export type AccessObjectType = 'orders' | 'organizations' | 'threads' | 'documents' | 'finance' | 'leads';
export type Capability =
  | 'see_commission' | 'import_1c' | 'export'
  | 'manage_catalog' | 'manage_users' | 'assign_orders';

export const CAPABILITIES: readonly Capability[] = [...];
export const capabilitySchema = z.enum([...]);      // валидация на входе/выходе
export const scopeLevelSchema = z.enum(['own','assigned','all']);

export type SessionAccessProfile = {
  id: string;
  name: string;
  orders: ScopeLevel; organizations: ScopeLevel; threads: ScopeLevel;
  documents: ScopeLevel; finance: ScopeLevel; leads: ScopeLevel;
  capabilities: Capability[];
};
```

---

## 4. Права в сессии (G1.2)

`SessionPayload` (`src/lib/auth/jwt.ts`) получает `accessProfile?: SessionAccessProfile | null`, плюс соответствующая ветка в `sessionPayloadSchema` (Zod валидирует на trust-boundary — как остальные claims). Размер токена: 6 коротких enum-строк + маленький массив флагов — пренебрежимо.

**Точка загрузки:** `src/app/api/auth/login/route.ts` (после блока `user.role === 'manager'`, ~стр. 134). При логине менеджера, если `user.accessProfileId` задан — читаем профиль (индексный single-row lookup, как `managedOrgIds`) и денормализуем в токен. Профили — только для `role==='manager'` (кооперативный контур); admin/partner/organization токены профиль не несут.

**Свежесть:** денормализация в JWT (TTL 7д) — как `managedOrgIds`/`managerRole` сегодня; правка профиля применяется на следующем логине. Приемлемо и консистентно (промпт допускает «грузить по profileId с кэшем», если раздувает токен — здесь не раздувает).

---

## 5. Резолвинг охватов (G1.2)

Новый чистый helper в `managerPolicy.ts` (или `accessProfile.ts`):

```ts
const COMPANY = (s) => ({ companyId: s.companyId ?? NO_COMPANY_SENTINEL });   // C8 floor

function orderWhereForLevel(s, level: ScopeLevel): Prisma.OrderWhereInput {
  if (level === 'all')      return COMPANY(s);
  if (level === 'own')      return { AND: [COMPANY(s), { managerId: s.sub }] };
  /* assigned */            return { AND: [COMPANY(s), { organizationId: { in: managedOrgIds(s) } }] };
}
```

Публичные резолверы читают профиль-первым, teamMode-fallback (сигнатуры не меняются):

```ts
export function managerOrderScope(s, teamMode): Prisma.OrderWhereInput {
  const lvl = s.accessProfile?.orders;
  return lvl ? orderWhereForLevel(s, lvl)
             : (teamMode ? companyWideOrderFilter(s) : managerOrderScopeFilter(s));   // legacy
}
export function managerDocumentScope(s, teamMode): Prisma.DocumentWhereInput {
  const lvl = s.accessProfile?.documents;
  const orderWhere = lvl ? orderWhereForLevel(s, lvl) : managerOrderScope(s, teamMode);
  return { order: orderWhere, scanStatus: { not: 'infected' } };
}
export function managerOrgScope(s, teamMode): Prisma.OrganizationWhereInput {
  const lvl = s.accessProfile?.organizations;
  if (!lvl) return teamMode ? { companyId: s.companyId ?? NO_COMPANY_SENTINEL } : managerOrgScopeFilter(s);
  if (lvl === 'all') return { companyId: s.companyId ?? NO_COMPANY_SENTINEL };
  return { AND: [{ companyId: s.companyId ?? NO_COMPANY_SENTINEL }, managerOrgScopeFilter(s)] };  // assigned/own
}
```

`canSeeOrder(session, order, teamMode)` — та же наслоённая логика для точечных гейтов (9 call-site'ов), профиль-первым с company-floor `order.companyId === session.companyId`, иначе legacy three-way.

**Маппинг охватов на объекты в G1:**
| Object type | Enforcement в G1 |
|---|---|
| `orders` | `managerOrderScope` + `canSeeOrder` (активно; регресс C/F) |
| `documents` | `managerDocumentScope` (активно) |
| `organizations` | `managerOrgScope` + `canSeeOrganization` call-site'ы (активно) |
| `threads` | `listManagerMessages` строит order-where из `threads`-уровня (активно) |
| `finance` | список орг финвитрины реюзит org-scope; плюс gate `see_commission` (§6) |
| `leads` | **хранится и валидируется**, полное enforcement — **G2** (воронка). Явно не молчим. |

`own`/`assigned` для организаций совпадают (нет per-manager «владения» оргой отдельно от закрепления) → оба → `managedOrgIds`.

---

## 6. Флаги возможностей — gate `see_commission` (G1.3)

`can(session, capability)` в `accessProfile.ts`:
```ts
export function can(session, cap: Capability): boolean {
  if (session.role === 'admin') return true;                       // admin всегда (Model A)
  if (session.accessProfile) return session.accessProfile.capabilities.includes(cap);  // profiled: default-deny
  // no profile → backward-compat legacy для внутренних ролей:
  if (cap === 'see_commission') return isManagerLeader(session);   // сегодня комиссию видит только leader (+admin выше)
  return false;                                                    // прочие флаги без профиля — deny (никто на них не завязан)
}
```

**Реальный gate:** `getManagerFinanceOverview` (`manager/finance.ts:38-39`) — заменить
`const canSeeCommission = unscoped || isManagerLeader(session);`
на `const canSeeCommission = can(session, 'see_commission');`.

Тождество для no-profile: `can(admin)=true`, `can(no-profile leader)=true`, `can(no-profile plain manager)=false` — **идентично** текущему `unscoped || isManagerLeader`. Existing `services.manager.finance.test.ts` (сессии без профиля) → зелёный. Профилированная роль без флага → комиссия скрыта (даже если построена на leader'е); профилированная роль С флагом → видит (даже рядовой «старший оператор») — flag и грантит, и рестриктит. `getOrgIntermediaryCommission` не вызывается при `false` (field-level, как сегодня).

`can()` заложен как общий механизм и для прочих флагов (`import_1c`/`export`/`manage_catalog`/`manage_users`/`assign_orders`) — применяется точечно по мере надобности (в G1 живой gate — `see_commission`).

---

## 7. UI конструктора ролей (G1.4)

Экран под `admin` и `manager+leader`. Т.к. `/admin/*` и `/manager/*` разделены (Model A), делаем **две тонкие страницы** поверх общего презентационного компонента + общих сервисов (sibling-pattern §4 CLAUDE.md — компонент строго презентационный, принимает domain-agnostic тип):
- `/leader/roles` (гард `requireManagerLeader`) и `/admin/roles` (гард `requireAdmin`, company-scope по `session.companyId`).
- Список профилей компании; создать/редактировать (имя + 6 селектов охвата + чекбоксы флагов); назначить профиль пользователю (менеджеру своей компании).

Сервис `src/lib/services/access/profiles.ts` (Result-контракт §3): `listAccessProfiles`, `createAccessProfile`, `updateAccessProfile`, `deleteAccessProfile`, `assignUserProfile`. Все company-scoped (профиль и целевой user должны быть в `session.companyId`; иначе `forbidden`/`not_found`). Аудит на каждую мутацию (`access_profile_created/updated/deleted`, `user_access_profile_assigned`). Server-actions в `src/server-actions/access/`.

UI-кит `src/components/ui` (Button/Select/Input/Dialog/Badge/Field/Table). Nav-пункт добавляется в `src/lib/navigation/cabinet.ts`. Опциональный feature-flag `role_constructor` (opt-in) — staged rollout по §5 CLAUDE.md (middleware/nav/route — 3 точки).

---

## 8. Примерные роли (G1.5)

Тест/сид собирает через конструктор и проверяет резолвинг:
- **«Оператор заявок»** — `orders/threads/documents = assigned`, `finance = own`, `leads = own`, `capabilities = []` (без `see_commission`, без продаж).
- **«Специалист по ОТ (аутсорсинг)»** — `organizations/documents/threads = assigned`, `capabilities` без `see_commission` → комиссия и внутренняя кухня скрыты; видит только закреплённые орги.
- **«Менеджер по продажам»** — `leads = all` (или `assigned`), прочее операционное сужено; заготовка под G2.

Проверяется: (a) через сервис создаётся профиль с нужной матрицей; (b) сессия с этим профилем даёт ожидаемый scope-filter (unit на резолвер) и/или реальную выборку (integration); (c) `see_commission` gate реально скрывает комиссию для «специалиста»/«оператора».

---

## 9. Тестовая стратегия

- **Unit (mode=unit):** `accessProfile.ts` (`can`, `orderWhereForLevel`, scope-резолверы под каждый `ScopeLevel` + company-floor + no-profile→legacy эквивалентность); Zod-схемы; пример-роли матрица.
- **Integration (mode=integration, живой Postgres):** сервисы CRUD профилей (company-scope, аудит, IDOR cross-company); `assignUserProfile`; end-to-end scope через `listManagerOrders`/`listManagerOrganizations`/`listManagerDocuments` с профилированной сессией; `see_commission` gate через `getManagerFinanceOverview`.
- **Регресс (обязателен зелёным без правок логики):** `c1/c2/c3`, `f.list-cross-tenant`, `auth.requireRole.teammode`, `services.manager.finance`. Допускается только **добавление** новых кейсов, не изменение существующих.
- Coverage: новые `src/lib/**` (не `.tsx`), `src/server-actions/**`, `src/app/api/**` под 100%-порогом (фаза 1). UI `.tsx` — фаза 2 (не под порогом).

---

## 10. PR-split (промпт §3 — «Согласуй в плане»)

- **PR-1 (бэкенд):** G1.1 модель+миграция, G1.2 сессия+резолверы, G1.3 `see_commission` gate, `can()`, G1.5 пример-роли (unit+integration). Регресс зелёный. Полностью тестируемо без UI.
- **PR-2 (UI):** G1.4 конструктор (сервисы CRUD + server-actions + страницы `/leader/roles`,`/admin/roles` + nav + флаг). UI-тесты — фаза 2.

Порядок реализации внутри PR-1: G1.1 → G1.2 → G1.3 → G1.5. Каждый шаг — TDD, `vitest run` зелёный перед коммитом.

---

## 11. Открытые вопросы / сознательно вне scope

1. **Отделы/подчинение** (`Department`, охват подчинённых) — отдельный этап (промпт/ТЗ §3.3 п.5).
2. **Полное enforcement `leads`-охвата** — G2 (воронка). В G1 только хранится/валидируется/проверяется в пример-роли.
3. **`finance`-scope как отдельный фильтр** — в G1 финвитрина реюзит org-scope + `see_commission`; выделенный финансовый охват — при необходимости позже.
4. **Смена профиля не инвалидирует активные JWT** (7д) — как `managedOrgIds` сегодня; force-logout/refresh — вне G1.
5. **Прочие capability-gate'ы** (`import_1c`/`export`/…) — механизм `can()` готов, точки применения — по мере фич.
