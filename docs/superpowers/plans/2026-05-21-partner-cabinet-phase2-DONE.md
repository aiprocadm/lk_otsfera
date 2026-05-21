# Phase 2 — DONE

**Дата завершения:** 2026-05-21
**Base commit (после Phase 1 merge):** `2497373` (Merge pull request #40)
**Head commit Phase 2:** `1e1367e` (feat(partner): make dashboard attention list and events feed clickable)
**Branch:** `claude/personal-cabinet-phase-2-ADqEE`

## Что готово

### Часть 1 — Service Layer для Leads
- `src/lib/services/partner/leads.ts`:
  - `listLeads({ partnerId, scopeOrgIds?, status?, search?, take, skip })` — список + `countsByStatus` (zero-fill для пустых статусов) + total
  - `getLead({ leadId, partnerId, scopeOrgIds? })` — детальный объект с `createdByUserName`, `organizationName`, `assignedManagerName`
  - `createLead(input)` — статус по умолчанию `new`, валидация `organizationId ∈ partner`, trim/null-coalesce пустых строк
  - `withdrawLead({ leadId, partnerId, scopeOrgIds?, reason })` — переводит `new|in_review → rejected`; кидает `NOT_FOUND` / `ALREADY_REJECTED` / `ALREADY_PROMOTED`

### Часть 2 — API routes для Leads
- `GET /api/partner/leads` — фильтры `status` (валидация enum), `search` (LIKE по name/contact/subject/inn), пагинация (take ≤ 100)
- `POST /api/partner/leads` — Zod-валидация, scope-check `organizationId` против `session.assignedOrgIds`, audit log `lead_created`
- `GET /api/partner/leads/[id]` — 404 при отсутствии или нарушении scope
- `PATCH /api/partner/leads/[id]` — `action: 'withdraw'` единственный, audit log `lead_withdrawn`, маппинг ошибок 404/409

### Часть 3 — UI Leads
- `/partner/leads` (Server Component): status-tabs + search + table/cards + pagination
- `/partner/leads/new` (Server Component с client-form): single-page форма с тремя секциями (Клиент / Контакт / Запрос), предзаполнение названия из выбранной из портфеля организации, чек-боксы `productType`
- `/partner/leads/[id]` (Server Component): шапка со статусом, секция-CTA при promoted (ссылка на `/partner/deals/{id}`), секция rejected reason, три карточки данных + хронология
- Components (7 шт):
  - `lead-status-badge.tsx` — цвет/лейбл per status (+ `leadStatusLabel` helper)
  - `lead-status-tabs.tsx` — чипы-фильтры через URL
  - `leads-table.tsx` (desktop) / `leads-card-list.tsx` (mobile)
  - `leads-search.tsx` — URL-state search
  - `lead-create-form.tsx` — клиент-сайд форма
  - `lead-withdraw-button.tsx` — dialog с подтверждением

### Часть 4 — Интерактивные сделки
- `src/components/partner/add-comment-form.tsx` — client component, POST на `/api/comments` (route уже был), `router.refresh()` после ответа
- `src/components/partner/deal-comments.tsx` — приняла новый prop `orderId`, рисует форму под лентой
- `src/app/partner/deals/[id]/page.tsx` — передаёт `orderId`

### Часть 5 — Навигация
- `src/lib/navigation/cabinet.ts` — снят `disabled: true` с `Заявки`
- `src/components/partner/bottom-tab-bar.tsx` — пересобрана по spec §5.1 (Дашборд / Сделки / Заявки / Документы)
- `src/__tests__/navigation.cabinet.partner.test.ts` — обновлены ожидания (только Финансы остался disabled)

### Часть 6 — Audit log expansion (Phase 1 followup)
- `POST /api/partner/team` → `partner_member_invited`
- `PUT /api/partner/team/[userId]` → `partner_member_scope_changed`
- `DELETE /api/partner/team/[userId]` → `partner_member_deactivated`
- `POST /api/partner/leads` → `lead_created`
- `PATCH /api/partner/leads/[id]` (withdraw) → `lead_withdrawn`
- `src/__tests__/api.partner.team.test.ts` — обновлен мок prisma (auditLog.create)

### Часть 7 — Dashboard polish
- `attention-list.tsx` и `events-feed.tsx` — пункты теперь ссылаются на `/partner/deals/{id}` или `/partner/leads/{id}` (truncate + whitespace-nowrap на дате)

### Часть 8 — Тесты
- `src/__tests__/api.partner.leads.test.ts` — 18 unit-тестов (mocked service): GET с фильтрами, POST с валидацией / scope, GET single, PATCH withdraw + все error-кейсы
- `src/__tests__/services.partner.leads.test.ts` — 13 integration-тестов (skipped без DATABASE_URL, как `services.partner.team.test.ts`): create/list/get/withdraw + scope filtering + search matching

## Проверка состояния

```bash
npm test                # 6 failed (нужен живой Postgres), 160 passed (+18 vs Phase 1), 46 skipped
npm run typecheck       # 0 errors
npm run build           # successful, +3 партнёр-роута (/partner/leads, /partner/leads/new, /partner/leads/[id])
                        # +2 API-роута (/api/partner/leads, /api/partner/leads/[id])
```

## Что НЕ готово (Phase 3+)

- **Lead → Order promotion UI** — partner-side нечего показывать (это action менеджера Промтехносферы)
- **Lead attachments upload** — модель `LeadAttachment` в БД готова с Phase 0, но UI требует Supabase Storage RLS, который выносим в Phase 3
- **Финансы (`/partner/finance`)** — расчёт комиссии + PDF/XLSX, Phase 4
- **Real 1С sync** — Phase 3
- **Push на 1С при promotion** — Phase 3 sync work
- **PWA иконки** — Phase 5 polish
- **Manager-side UI заявок** (внутри `/admin` или `/manager`) — за рамками партнёрского кабинета

## Сознательные упрощения (не баги)

1. **Lead status flow:** партнёр может только `new|in_review → rejected` (withdraw). Переходы `new → in_review → qualified → promoted_to_order` остаются за менеджером (UI которого вне scope).
2. **Lead update fields:** партнёр не может редактировать поля созданной заявки. Если ошибся — отзывает и создаёт новую. Уменьшает конфликт состояний при будущем 1С-sync.
3. **Lead detail без attachments:** показываем notes текстом; upload UI откладывается до Storage RLS.
4. **No lead → order link on dashboard events:** пока что событие "Новый лид" в feed-е ведёт на сам лид, не на промотированный заказ (т.к. promotion ещё не происходит).
5. **partnerOrgScopeFilter не используется для leads:** scope для leads чистый (`organizationId IN scope`) без учёта leads без org. Лиды без organizationId видны всем менеджерам внутри partner — это сознательно, т.к. лид с "новой" компанией создавал кто-то конкретный, но в Phase 2 не вводим extra-видимости.

## Метрики

- **Коммитов в Phase 2:** 9 (от `065f640 docs(phase2)...` до `1e1367e feat(partner)...`)
- **Новых файлов:** 17 (1 service, 2 API routes, 3 pages, 7 components, 2 tests, 1 plan, 1 done)
- **Изменённых файлов:** 8 (nav, bottom-tab-bar, deal-comments, deals/[id] page, team API ×2, team test, attention/events components)
- **Новых тестов:** 18 unit (leads API) + 13 integration (leads service)

## Deviations from плана

1. **Bottom tab bar** изменён сильнее, чем планировалось. План говорил "рассмотреть", фактически переехал в layout Dashboard / Deals / Leads / Documents — это ровно spec §5.1, просто Финансы заменены на Заявки до Phase 4.
2. **Leads attachments UI** — план явно выносил это за scope; в DONE — формально подтверждено.
3. **Bonus:** AttentionList и EventsFeed получили clickable items — не было в плане, но логично следует из появления `/partner/leads/[id]` (был uncovered link target).

## Test plan (выполнено)

- [x] `npm test` — 18 новых unit-тестов проходят, 13 integration skipped (как `team` тесты), общий baseline 6 failed (все нужны DB) сохранён
- [x] `npm run typecheck` — 0 errors
- [x] `npm run build` — successful, 3 новых /partner-роута, 2 API
- [ ] Manual smoke walkthrough на desktop + mobile (DevTools 375px) — выполняется при подъёме окружения
- [ ] Lighthouse mobile ≥85 — мерять при manual smoke
- [ ] Live-DB integration runs (services.partner.leads.test.ts) — запуск с `docker compose up -d db` + `DATABASE_URL`
