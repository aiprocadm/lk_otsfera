# Phase 2 — Plan: Заявки (Leads) + интерактивные сделки

**Дата начала:** 2026-05-21
**Base commit (после Phase 1 + main merge):** `2497373` (Merge pull request #40)
**Branch:** `claude/personal-cabinet-phase-2-ADqEE`
**Spec reference:** `docs/superpowers/specs/2026-05-21-partner-cabinet-design.md` §§ 5.6, 5.5, 7.5

## Цель фазы

После Phase 1 партнёр уже видит свой портфель и сделки в read-only. Phase 2 закрывает **главный gap воронки**: партнёр должен иметь возможность **подавать заявки** (Leads), которые менеджер Промтехносферы потом конвертирует в Order. Параллельно делаем сделки **интерактивными** — добавляем возможность писать комментарии.

## Что входит в Phase 2

### Часть 1 — Service Layer для Leads
- `src/lib/services/partner/leads.ts`:
  - `listLeads({ partnerId, scopeOrgIds?, status?, search?, take, skip })` — список с фильтрами и пагинацией
  - `getLead({ leadId, partnerId })` — детальный объект для карточки
  - `createLead(input)` — создание заявки партнёром, status=`new`
  - `updateLeadStatus({ leadId, partnerId, status, rejectedReason? })` — partner может только rejected (сам отказался), admin Промтехносферы — другие переходы (Phase 3)
  - В рамках Phase 2: партнёр может **отозвать** свою заявку (`new → rejected` со своим reason)

### Часть 2 — API routes для Leads
- `GET /api/partner/leads` — list с фильтрами `status`, `search`, `take`, `skip`
- `POST /api/partner/leads` — создание (любой partner-user)
- `GET /api/partner/leads/[id]` — детали
- `PATCH /api/partner/leads/[id]` — обновление status/notes (с ограничениями по роли)

### Часть 3 — UI Leads
- `/partner/leads` — список с status-tabs (Все / Новые / На рассмотрении / Квалифицированы / Конвертированы / Отклонены) + поиск + пагинация
- `/partner/leads/new` — форма создания (без wizard, одна страница — wizard как progressive enhancement в Phase 3)
- `/partner/leads/[id]` — карточка заявки (status, поля, контакты клиента, history)
- Components:
  - `LeadStatusBadge` — цветовое отображение `LeadStatus`
  - `LeadsTable` (desktop) + `LeadsCardList` (mobile)
  - `LeadStatusTabs` — фильтр по статусу через URL params
  - `LeadCreateForm` — клиент-сайд форма
  - `LeadWithdrawButton` — для new заявок (partner cancels own lead)

### Часть 4 — Интерактивные сделки
- `AddCommentForm` (client component) на `/partner/deals/[id]` — POST на `/api/comments` (route уже есть)
- Минимальная mutation для UX: партнёр может комментировать свои сделки

### Часть 5 — Навигация
- `navByRole.partner` — снять `disabled: true` с `/partner/leads`
- BottomTabBar — рассмотреть добавление Leads (либо вместо Team для не-admin)

### Часть 6 — Audit log expansion
- Дописать audit-log entries для `inviteMember`, `deactivateMember`, `createLead`, `updateLeadStatus` (заметка `Phase 2 cleanup`).

### Часть 7 — Тесты
- `services.partner.leads.test.ts` — integration с живой БД (как `team.test.ts`)
- `api.partner.leads.test.ts` — unit без БД (mocks)
- `navigation.cabinet.partner.test.ts` — обновить ожидания (leads теперь enabled)
- `api.partner.comments.test.ts` — partner может POST comment на свой order

## Что НЕ делаем в Phase 2

- **Lead → Order promotion UI** — оставляем для Phase 3 (требует менеджерский UI Промтехносферы, который вне scope партнёрского кабинета)
- **Lead attachments upload** — UI откладываем; модель `LeadAttachment` уже есть в БД, но full flow связан с Supabase Storage RLS, который выносим в Phase 3
- **Финансы (/partner/finance)** — выносим в Phase 4 вместе с расчётом комиссии
- **Push 1С** при promotion — Phase 3 sync work
- **Storage RLS** — Phase 3
- **PWA polish (иконки)** — Phase 5

## Метрики приёмки

- `npm test` — все Phase 1 тесты + новые проходят (integration-тесты живой БД skipped в sandbox)
- `npm run typecheck` — 0 errors
- `npm run build` — successful, +3 route (`/partner/leads`, `/partner/leads/new`, `/partner/leads/[id]`)
- Lead create через UI → виден в списке → можно отозвать → виден как rejected
- Партнёр может оставить комментарий к сделке → видно в `/partner/deals/[id]`
- Manager (с scope) видит только свои leads/comments — RBAC соблюдается

## Зависимости

- Prisma schema (Lead, LeadStatus) — **уже есть** из Phase 0
- Migration — не требуется (модель Lead готова)
- API guards (`requirePartner`) — **уже есть**
- `canPartnerAccessOrg` — **уже есть** (используется при promote-проверках)
