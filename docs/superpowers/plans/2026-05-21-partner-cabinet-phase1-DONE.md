# Phase 1 — DONE

**Дата завершения:** 2026-05-21
**Base commit (после Phase 0):** `ea9671a` (chore(gitignore): exclude local assistant/session state)
**Head commit Phase 1:** `f53679e` (feat(pwa): web app manifest and meta tags for install-on-home-screen)
**Branch:** `claude/personal-account-dashboard-ztxqC`

## Что готово

### Часть 1 — Фундамент (Tasks 1-3)
- `src/lib/orders/humanStage.ts` — чистая функция `(executionStatus, financialStatus) → { label, tone }` для двухмерного отображения статуса сделки (12 кейсов + fallback)
- `SessionPayload` расширен полями `partnerRole: 'admin' | 'manager'` и `assignedOrgIds: string[]`
- `POST /api/auth/login` обогащает JWT данными `PartnerUser` (sub-role + scope orgIds); deactivated PartnerUser → 403; legacy partner без PartnerUser → нет sub-role полей

### Часть 2 — RBAC (Tasks 4-6)
- `src/middleware.ts` блокирует не-admin'ов на `/partner/team/**` и `/partner/portfolio/[id]/settings/**` → redirect `/forbidden`
- `src/lib/auth/policy.ts`:
  - `isPartnerAdmin(session)` — синхронный predicate
  - `canPartnerAccessOrg(session, orgId)` — async, проверяет partnerId match + scope (если scope пуст = весь partner)
  - `partnerOrgScopeFilter(session)` — Prisma `where` для list-запросов
- `src/lib/auth/guard.ts`: `requirePartner()` + `requirePartnerAdmin()` — единый формат `GuardResult` для API роутов

### Часть 3 — Service Layer (Tasks 7-12)
- `src/lib/services/partner/portfolio.ts` — `listPortfolio(prisma, { partnerId, scopeOrgIds, search, take, skip })`, возвращает `{ items: { id, name, inn, assignedManagerUserId, ordersCount, debt }, total }`
- `src/lib/services/partner/dashboard.ts`:
  - `kpis()` — 4 числа: открытые сделки, outstanding (totalAmount − paidAmount), активные leads, commission за текущий месяц (paid×partner.commissionRate)
  - `attention()` — застрявшие сделки, overdue invoices, stale leads
  - `recentEvents()` — слитая по времени лента orders/leads/payments (top N)
- `src/lib/services/partner/team.ts` — `listTeam`, `inviteMember`, `assignOrgs`, `deactivate`
- `src/lib/services/partner/rateOverride.ts` — per-org commission rate с audit log записью

### Часть 4 — API routes (Tasks 13-17)
- `GET /api/partner/dashboard` → kpis + attention + events
- `GET /api/partner/portfolio` → list с фильтрами/пагинацией
- `GET /api/partner/portfolio/[orgId]` → карточка организации (с scope check)
- `PUT /api/partner/portfolio/[orgId]/rate` → override ставки (admin only)
- `GET/POST /api/partner/team` + `PUT/DELETE /api/partner/team/[userId]` — invite / assignOrgs / deactivate

### Часть 5 — Навигация (Tasks 18-19)
- `src/lib/navigation/cabinet.ts` `navByRole.partner` — реальные разделы (Дашборд, Портфель, Команда) активны; Сделки/Заявки/Документы/Финансы помечены `disabled` (Phase 2)
- `src/components/partner/bottom-tab-bar.tsx` — мобильный bottom tab bar (4 кнопки, hidden on `md:`)
- `src/app/partner/layout.tsx` — оборачивает `AppShell` + BottomTabBar, `pb-16 md:pb-0` для контента

### Часть 6 — UI страницы (Tasks 20-25)
- `/partner/dashboard` — Server Component с реальными KPI, attention list, events feed
- `/partner/portfolio` — список + поиск + пагинация
- `/partner/portfolio/[orgId]` — header + табы (Сотрудники / Комментарии / История)
- `/partner/portfolio/[orgId]/settings` — форма override ставки (admin only, защищена middleware)
- `/partner/team` — список членов + форма инвайта + редактирование scope (admin only)
- Бонус (Phase 2 spillover, но уже реализовано в той же сессии): `/partner/deals`, `/partner/deals/[id]`, `/partner/portfolio/[orgId]/documents`, `/partner/documents`

### Часть 7 — PWA (Task 26)
- `public/manifest.webmanifest` — brand colors, ru lang, standalone display, start_url `/partner/dashboard`
- `src/app/layout.tsx` — Next.js 15 `metadata` + `viewport` exports с manifest link, themeColor, appleWebApp

## Проверка состояния

```bash
# Tests
npm test                               # 142 unit-теста PASS; 6 integration-тестов требуют живого DATABASE_URL (services.partner.*, schema.integration, worker.sync-orders.smoke) + 33 skipped
npm run typecheck                      # 0 errors
npm run build                          # successful (~14 partner routes собраны)

# Integration smoke (требует docker compose up -d db redis + DATABASE_URL)
docker compose up -d db redis
npm run prisma:migrate:deploy
npm test                               # все 181 теста должны проходить с живой БД
```

## Что НЕ готово (Phase 2+)

- **Phase 2 (Deals + Documents UI):** Хотя deals/documents страницы уже собраны как bonus (см. commits `6bf9f7c`, `3acc140`, `73e226f`, `7f6f3f5`), они работают на демо-данных. Полная воронка сделок на дашборде (§5.2 desktop-only), leads UI, deals-документы upload — остаются на Phase 2.
- **Phase 3 (Real 1С sync):** scheduler-ы, REST adapter, конфликт-резолв, mapping из реального 1С remain TODO.
- **Phase 4 (Commission calc):** расчёт + PDF/XLSX генерация комиссии за период.
- **Storage RLS (§7.4):** появится с document upload UI.
- **Playwright e2e:** Phase 1 верифицируется manual smoke + unit/integration тестами.

## Сознательные упрощения (не баги)

1. **Фильтры портфеля:** реализованы только `name search` и `pagination`. `hasDebt / hasActiveDeals / productMix / assignedManagerId` отложены на Phase 2 (где их можно унифицировать с deals-фильтрами).
2. **SavedView UI:** модель в БД есть (Phase 0), но «сохранить фильтр / поделиться» UI не реализован — URL-state даёт 80% ценности.
3. **Bulk actions:** не реализованы — в Phase 1 нет mutation-операций над списками.
4. **Audit log scope:** пишется только для rate override; invite/deactivate PartnerUser audit — Phase 2.
5. **PWA иконки:** `manifest.webmanifest` ссылается на `/icon-192.png` и `/icon-512.png`, которые в репо отсутствуют. Manifest валиден, но браузер не покажет install prompt без реальных PNG. Финальные брендовые ассеты — Phase 5 polish.

## Test plan (выполнено)

- [x] `npm test` — 142 unit-тестов PASS, 33 skipped, 6 integration-тестов требуют живого Postgres (не доступен в текущей sandbox-среде)
- [x] `npm run typecheck` — 0 errors
- [x] `npm run build` — successful, 14 partner-роутов собраны
- [ ] Manual smoke walkthrough на desktop + mobile (DevTools 375px) — выполняется при подъёме окружения (`docker compose up` + `npm run dev`)
- [ ] Login как admin / manager — sub-role guards проверены unit-тестами (`auth.middleware.partner-subrole.test.ts`, `auth.guard.partner.test.ts`)
- [ ] Lighthouse mobile ≥85 — мерять при manual smoke

## Метрики

- **Коммитов в Phase 1:** 27 (от `214622f feat(orders): humanStage...` до `f53679e feat(pwa)...`)
- **Новых файлов:** ~50 (services, API routes, UI pages, components, tests)
- **Новых тестов:** ~25 (auth.jwt.partner-payload, api.auth.login.partner-enrichment, auth.middleware.partner-subrole, auth.policy.partner-scope, auth.guard.partner, services.partner.{portfolio,dashboard.kpis,dashboard.attention,dashboard.events,team,rateOverride,orgCard}, api.partner.{dashboard,portfolio,portfolio.org,portfolio.rate,team}, navigation.cabinet.partner, orders.humanStage)

## Deviations from плана

1. **Ветка переименована.** Plan ссылался на `claude/partner-cabinet-phase0` (продолжение Phase 0 ветки). Текущая работа продолжалась в отдельных feature-ветках (`claude/partner-cabinet-phase0` → merged PRs #38, #39), а финальный polish (Task 26 PWA + этот DONE) собран в `claude/personal-account-dashboard-ztxqC` поверх merged main.
2. **Часть Phase 2 UI задач уже собрана.** В рамках Phase 1 PR (#38, #39) уже залиты страницы deals list, deal detail, org documents tab, partner global documents — это spillover, не баг. Phase 2 теперь сводится к улучшению UX этих экранов + leads + finance + uploads.
3. **PWA иконки не положены.** План явно допускает placeholder; в этом DONE отмечено как known limitation для Phase 5.
4. **Manual smoke не выполнен.** Sandbox-окружение без UI-доступа; smoke-тест переведён в ответственность developer-а при поднятии локального docker compose.
