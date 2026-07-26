# Этап 7 PR-2 — Intake «Входящие в работу» (ФТ-8.1–8.4, ФТ-1.6, ФТ-7.5, ФТ-3.1)

Спека: [2026-07-26-stage7-intake-tasks-sla-design.md](../specs/2026-07-26-stage7-intake-tasks-sla-design.md) §4–5 (подтверждена 26.07.2026).
Ветка `claude/stage7-pr2-intake`. SLA-джоб/пороги компании — PR-3 (здесь подсветка по дефолт-константам 4/24 ч).

## A. Модель (аддитивная миграция)

- [x] enum `LeadSource` + `call`, `inbound_message`; `Lead.sourceCallId? @unique`
      + `Lead.sourceInboundId? @unique` (relations `LeadFromCall`/`LeadFromInbound`).
- [x] `EnrollmentRequest` + `claimedByUserId?` (relation) / `claimedAt?`;
      `InboundMessage` + `claimedByUserId?` (relation) / `claimedAt?`;
      `Call` + `claimedByUserId?` (relation) / `claimedAt?` /
      `intakeClosedAt?` / `intakeClosedById?`.

## B. Сервисы

- [x] `services/intake/claim.ts` — `claimEnrollment/claimInbound/claimCall` по
      образцу `claimOrder` (staff-гейт + scope до мутации, `already_assigned`,
      идемпотентность, аудит). ClientRequest — существующий `takeInTriage`.
- [x] `services/intake/convert.ts` — `createLeadFromInbound` (транзакция: Lead
      `source='inbound_message'`+`sourceInboundId`, поля из формы с префиллом;
      обращение → `bound`+`boundBy`+`companyId`) и `createLeadFromCall`
      (`source='call'`+`sourceCallId`; звонок → claim). Повторная конверсия →
      `already_converted` (@unique).
- [x] `services/intake/list.ts` — union-ридер: критерии «в Intake»
      (request `submitted|in_triage`, enrollment `pending`, inbound
      `unresolved`, call входящий без привязки/лида/закрытия), нормализация в
      `IntakeItem`, сортировка «дольше ждёт — выше», slaLevel по константам
      4/24 ч, фильтры лидера (менеджер / «без ответственного»), пагинация
      после merge. Клиентские роли → forbidden.
- [x] `services/intake/badges.ts` + роут `GET /api/staff/badges` —
      `{intake, tasksOverdue}` по тем же скоупам; клиентам 403.
- [x] `getManagerLead` + source-поля (тип, id источника, тема) — ФТ-3.1.

## C. UI

- [x] Флаг `intake_inbox` (opt-in): featureFlags + middleware-префиксы
      (`/manager/intake`, `/leader/intake`, `/admin/intake`) + nav + page-гейты.
- [x] Страницы `manager|leader|admin/intake`: таблица (тип, от кого, суть,
      ожидание с подсветкой, ответственный, действия); лидер/админ — фильтр по
      менеджеру + «Без ответственного».
- [x] Действия строки: «Взять в работу» (×4), «Создать лид» (request →
      `convertToLead`; inbound/call → диалог с префиллом), «Задача»
      (quick-диалог с префиллом, «на себя»), «Закрыть» (call), «Открыть →»
      (карточка источника; привязка и отклонение — там, 1 клик — фиксируем
      как отклонение-через-источник).
- [x] «Создать лид» и «Задача» также на экранах Обращений и Звонков (ФТ-1.6,
      ФТ-7.5).
- [x] Карточка лида: строка «Источник» со ссылкой (заявка/обращение/звонок).
- [x] Бейджи: `NavItem.badgeKey?: 'intake'|'tasks_overdue'`, клиентский
      `NavBadge` (поллинг 30 с по образцу NotificationBell) в
      manager/leader-сайдбарах.

## D. Тесты (порог 100%)

- [x] Unit: claim×3 (успех/идемпотент/чужой/`already_assigned`), конверсии
      (префилл, пометка источника, повтор → ошибка), union-ридер (критерии,
      сортировка, slaLevel, фильтры, forbidden), badges (скоупы, 403),
      роут, nav/сайдбары с бейджем, компоненты (таблица, диалоги), страницы ×3.
- [x] Integration (живой Postgres): путь «обращение → взять в работу →
      создать лид (bound) → задача»; звонок → лид/закрытие; счётчики бейджей.
- [x] Актуализация затронутых тестов (middleware/nav/featureFlags-матрица,
      inbox/calls компоненты).

## E. Финал

- [x] typecheck / lint / unit / integration зелёные; CHANGELOG; STATUS.md; PR.
