# План — Этап 6 / PR-1: сделки — модель, стадии, канбаны

Спека: [2026-07-25-stage6-deals-kanban-design.md](../specs/2026-07-25-stage6-deals-kanban-design.md) §3–4, §9 (PR-1) — ✅ подтверждена («всё да»).
Цель PR-1: работающие канбаны сделок менеджера и руководителя с настройкой
стадий; move включая won/lost как смену статуса (won ставит `wonAt`, lost —
диалог причины). Создание заказа при выигрыше, конверсия лид→сделка и лента —
PR-2; аналитика — PR-3.

Упрощение PR-1 (зафиксировано): скоуп менеджера — `managerId == sub` (own),
лидера — company-floor; уровни `accessProfile.deals` не добавляем (расширение
JWT-профиля — при реальной необходимости отдельно).

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (по желанию).

## A. Модель и миграция

- [x] A1. `schema.prisma`: enum `DealStatus` (open|won|lost); `DealStage`
  (зеркало FunnelStage: companyId, name, position, statusAnchor DealStatus,
  color, isTerminal, @@unique([companyId, position])); `Deal` (§3 спеки:
  companyId NOT NULL, leadId? @unique, organizationId?, contactId?, title,
  amount?, managerId?, status @default(open), stageId? SetNull,
  expectedCloseAt?, wonAt?, lostAt?, lostReason?, orderId? @unique); поля
  впрок для PR-2: `Lead.promotedDealId? @unique`, `LeadStatus.promoted_to_deal`
  (additive), `DealNote.dealId?` (SetNull). Обратные relations.
- [x] A2. Аддитивная миграция (diff-метод) + generate; integration-тест.

## B. Сервисы

- [x] B1. `src/lib/services/deals/stages.ts`: `DEFAULT_DEAL_STAGES` («Новая →
  Переговоры → Предложение → Выиграна(терм., won) → Проиграна(терм., lost)»),
  резолвер `stageForDeal` (клон funnel/stages).
- [x] B2. `src/lib/services/deals/board.ts`: `listDealBoard(prisma, session,
  { managerId? })` — staff-only; менеджер own, лидер/админ company (+фильтр
  по менеджеру); `moveDeal(prisma, session, { dealId, stageId, lostReason? })`
  — скоуп + компания стадии; смена стадии; в терминальную: won → status=won +
  wonAt, lost → обязательная причина (validation) + lostAt; из терминальной →
  lifecycle_violation; аудит `deal_stage_changed`.
- [x] B3. `src/lib/services/deals/crud.ts`: `createDeal` (title*, amount?,
  organizationId? — из компании сессии, managerId — по умолчанию sub),
  `updateDeal` (те же поля + expectedCloseAt), скоупы как board; аудит.
- [x] B4. `src/lib/services/access/dealStages.ts`: CRUD стадий (клон
  funnelStages: admin|manager-leader, position_taken, аудит; удаление стадии
  → SetNull сделкам).

## C. UI и страницы

- [x] C1. `src/components/deals/deal-board.tsx` — клон funnel-board (native
  dnd; won-стадия — подтверждающий диалог «Отметить выигранной?» (заказ —
  в PR-2, в диалоге сказать «создание заказа появится следующим
  обновлением»), lost — диалог причины).
- [x] C2. `src/components/deals/deal-dialog.tsx` — создание/редактирование
  сделки (по task-dialog); кнопка «+ Сделка» на доске.
- [x] C3. `src/components/deals/deal-stage-config.tsx` — клон
  funnel/stage-config.
- [x] C4. Страницы `/manager/deals` (доска своих) и `/leader/deals` (доска
  команды + фильтр менеджера + StageConfig); server-actions
  `src/server-actions/deals/index.ts` (move/create/update/stages CRUD).
- [x] C5. Флаг `deals_pipeline` (opt-in): middleware `/manager/deals` +
  `/leader/deals`, nav-пункты «Сделки» (manager, leader), page-гейты.
  ВНИМАНИЕ: `/partner/deals` (портфолио заказов) не трогаем.

## D. Тесты (порог 100%) и ворота

- [x] D1. stages: дефолты/резолвер; dealStages CRUD (роль-гейт, position_taken).
- [x] D2. board: скоупы (менеджер own / лидер company / чужая компания / клиент
  forbidden), move (обычная, won, lost без причины → validation, из
  терминальной → violation), фильтр по менеджеру.
- [x] D3. crud: создание/редактирование, скоупы.
- [x] D4. UI: доска (dnd, диалоги), deal-dialog, stage-config; страницы;
  nav; guard «клиентские роли → 404».
- [x] D5. Integration: миграция, полный board-цикл на живом Postgres.
- [x] D6. `typecheck`/`lint`/`test:unit` зелёные; integration; CHANGELOG;
  STATUS; PR.
