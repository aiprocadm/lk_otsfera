# Track G2 (P2) — Воронка продаж / канбан — design

**Дата:** 2026-07-03
**Источник:** внешний промпт трека G (G2) + `ТЗ_Разработчик_lk_otsfera_v0.5` §24 (+ §12 настраиваемые статусы, §21 канбан) + бизнес-ТЗ v0.6.
**Предпосылка:** G1 (конструктор ролей) закрыт на ветке; DB мигрирована.

## 1. Проблема и цель

ТЗ §24.3: продажникам нужен **простой воронкоориентированный режим** (в духе AmoCRM), отдельный от тяжёлого операционного кабинета. Фундамент уже есть — модель `Lead` + `LeadStatus` (`new → in_review → qualified → promoted_to_order → rejected`): «это и есть воронка продаж». Дельта: **канбан-воронка** (drag-drop карточек по стадиям, быстрое добавление, минимум полей) + **настраиваемые стадии** (руководитель) + промоут `promoted_to_order` → `Order` (механизм есть).

Роль «менеджер по продажам» **уже нарезается конструктором G1** (`leads`-охват). G2 — первый потребитель этого охвата.

## 2. Ключевые находки (карта кода)

- `listManagerLeads` (`manager/leads.ts`) — **team-wide, БЕЗ scope-фильтра** («все менеджеры видят все лиды by design»). Это ровно тот gap, который закрывает G1 `leads`-охват (в G1 он только хранился — enforcement обещан в G2).
- Lifecycle (`manager/leadLifecycle.ts`): `ALLOWED_STATUS` (new→in_review, in_review→{new,qualified}, qualified→in_review); `assignLead`/`setLeadStatus`/`promoteLead`(нужен `organizationId`)/`rejectLead`(нужен reason). Терминальные (`promoted_to_order`/`rejected`) — отдельные действия.
- **Словаря стадий НЕТ**: order-stages (`humanStage.ts`) — производные от enum-якорей, не конфигурируемые из UI. Настраиваемые стадии — greenfield.
- Канбана/drag-drop нет. `SavedView` модель есть, не используется.
- Флаги: `partner_leads` (opt-out), `manager_cabinet` (opt-in). Для G2 — новый `sales_funnel` (opt-in).

## 3. Фазировка

Воронка = лид-lifecycle. Канбан визуализирует его. Настраиваемые стадии — надстройка над якорями. Отсюда:

- **PR-1 (бэкенд, полностью TDD-able сейчас):**
  1. Флаг `sales_funnel` (opt-in, 3 точки).
  2. **Enforcement `leads`-охвата G1** в `listManagerLeads` (own/assigned/all, company-floor) — закрывает gap «менеджер видит все лиды».
  3. **Сервис доски** `getFunnelBoard(prisma, session)` — лиды, сгруппированные по колонкам-стадиям (поверх `LeadStatus`), в рамках leads-scope + company.
  4. **Move-действие** `moveFunnelLead(prisma, session, {leadId, toStage, reason?, ...})` — диспетчер поверх lifecycle (`setLeadStatus`/`promoteLead`/`rejectLead`).
- **PR-2 (UI + конфиг):**
  5. Канбан-доска (нативный HTML5 drag-drop, §13 без новых либ), быстрое добавление лида, страницы `/leader/funnel` (+ `/manager/funnel`?), nav.
  6. **Настраиваемые стадии** — словарь `FunnelStage` (company-scoped) поверх якорей + UI руководителя (по образцу конструктора ролей G1).

Причина фазировки: карта показала, что канбан можно построить **над существующими якорями `LeadStatus`** без нового словаря — это ⅘ ценности (AmoCRM-доска) сразу; словарь стадий (доп. промежуточные стадии типа «Оплата» под якорем `qualified`) — надстройка PR-2.

## 4. Модель колонок (PR-1) — якоря `LeadStatus`

Колонки доски (стадии) = enum-якоря с ТЗ-лейблами:

| Колонка (стадия) | Якорь `LeadStatus` | Терминальная |
|---|---|---|
| Новый лид | `new` | нет |
| В работе / Контакт установлен | `in_review` | нет |
| Квалифицирован / Предложение | `qualified` | нет |
| Передано в работу | `promoted_to_order` | да (промоут → Order) |
| Отказ | `rejected` | да (нужен reason) |

Промежуточные пользовательские стадии («Оплата» под `qualified`) — PR-2 (словарь + `Lead.funnelStageId`). В PR-1 доска строится над якорями напрямую (без нового столбца).

**Move-семантика** (`moveFunnelLead` → target-якорь):
- `promoted_to_order` → `promoteLead` (требует `lead.organizationId`; иначе `error: 'org_required'`).
- `rejected` → `rejectLead` (требует `reason`; иначе `reason_required`).
- `new`/`in_review`/`qualified` → `setLeadStatus` (уважает `ALLOWED_STATUS`; иначе `lifecycle_violation`).
Возврат из терминальных — запрещён (как сегодня).

## 5. Leads-scope (G1) — резолвинг

Новый scope-хелпер (по образцу `orderWhereForLevel`): `leadWhereForLevel(session, level) → Prisma.LeadWhereInput` с company-floor:
- `all` → все лиды компании (через `partner.companyId`? — Lead не имеет прямого `companyId`; scope через `assignedManagerId`/`partner`). См. §5.1.
- `assigned` → `assignedManagerId == session.sub` **или** закреплённые (managedOrgIds → lead.organizationId).
- `own` → `assignedManagerId == session.sub` (или `createdByUserId`).
- нет профиля → **legacy (team-wide, без фильтра)** — сохраняет сегодняшнее поведение (регресс зелёный).

### 5.1. Company-floor для Lead
`Lead` не несёт `companyId` напрямую — компания выводится через `partner` (партнёр принадлежит компании?) или `organization.companyId`. **Открытый вопрос (уточнить в реализации):** как Lead привязан к компании. Если `Partner` не company-scoped, company-floor для лидов идёт через `organization.companyId` (для org-bound лидов) — org-less лиды видит только `own`/`assigned` по `assignedManagerId`. Резолвер строится после проверки схемы `Partner`/`Organization.companyId`.

**Инвариант наслоения (как G1):** нет профиля → legacy (team-wide). Профиль → scope. Регресс `manager/leads` тестов зелёный (сессии без профиля).

## 6. Тестовая стратегия
- **Unit:** `leadWhereForLevel` под каждый уровень + company-floor + no-profile→legacy; `moveFunnelLead` диспетчеризация (мок lifecycle).
- **Integration (Postgres up):** `listManagerLeads` со scope (own/assigned/all vs no-profile); `getFunnelBoard` группировка + scope; `moveFunnelLead` end-to-end (setStatus/promote/reject) + ошибки (`org_required`/`reason_required`/`lifecycle_violation`).
- **Регресс:** существующие `manager.leads*`/`leadLifecycle*` тесты зелёные без правок логики (no-profile сессии).

## 7. Открытые вопросы / вне scope
1. **Company-привязка Lead** (§5.1) — проверить `Partner.companyId`/`Organization.companyId` при реализации резолвера.
2. **Быстрое добавление лида менеджером** — Lead требует `partnerId`; manager-quick-add (direct lead без партнёра) — отдельное решение (PR-2 или позже).
3. **Настраиваемые стадии** (словарь `FunnelStage` + `Lead.funnelStageId` + config UI) — PR-2.
4. **Канбан drag-drop UI** — PR-2.
5. **`SavedView`** (сохранённые фильтры доски) — позже.

## 8. PR-split — согласовать
- PR-1: флаг + leads-scope enforcement + board-service + move-service (бэкенд, TDD, регресс зелёный).
- PR-2: канбан UI + настраиваемые стадии + quick-add.
