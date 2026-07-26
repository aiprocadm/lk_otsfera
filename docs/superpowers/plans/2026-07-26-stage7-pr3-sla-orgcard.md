# Этап 7 PR-3 — SLA-эскалация + вкладки карточки организации (§4.4, ФТ-8.5, §9 этапа 7)

Спека: [2026-07-26-stage7-intake-tasks-sla-design.md](../specs/2026-07-26-stage7-intake-tasks-sla-design.md) §7–8 (подтверждена 26.07.2026).
Ветка `claude/stage7-pr3-sla-orgcard`. Завершает этап 7.

## A. Модель (аддитивная миграция)

- [x] `Company` + `slaResponseHours Int @default(24)` + `slaWarningHours Int
      @default(4)` (§4.4: порог эскалации / подсветки).
- [x] `SlaEscalation` — журнал дедупа: `sourceType`, `sourceId`, `companyId?`,
      `@@unique([sourceType, sourceId])` (образец CertificateReminder + P2002-skip).

## B. Настройка порогов (решение §10-3: карточка на «Команде» руководителя)

- [x] `services/manager/slaSettings.ts`: `getSlaSettings` / `setSlaSettings`
      (валидация 1–168 ч, warning < response, идемпотентность, аудит
      `sla_settings_changed`) — образец teamVisibility.
- [x] Server-action (гейт как у setTeamVisibilityAction) + клиентская
      карточка «SLA входящих» на `/leader/team` (два поля часов + сохранить).

## C. Подсветка Intake по порогам компании

- [x] `listIntake`/`slaLevelFor`: пороги из `Company` сессии (один select,
      фолбэк на константы 4/24 при отсутствии компании).

## D. Джоб эскалации (ФТ-8.5, решение §10-2: одно уведомление, без повторов)

- [x] `queues.ts` + `monitoring.slaEscalation`; `scheduling.ts` —
      `SLA_ESCALATION_SCHEDULES` (`*/30 * * * *`, Europe/Moscow) + register.
- [x] Процессор `src/worker/processors/sla-escalation.ts`: единицы Intake БЕЗ
      ответственного старше `slaResponseHours` их компании (единицы общей
      очереди — дефолт-порог, эскалация руководителям всех компаний) →
      журнал `SlaEscalation` (P2002-skip) → `sla_escalation` руководителям
      (`createNotification` + каналы, `meta.url` на /leader/intake);
      идемпотентно, degrade gracefully. Регистрация в worker/index.ts
      (+guardrail-тест).

## E. Карточка организации (§9 этапа 7)

- [x] `getOrganizationCard` + 3 выборки по 20: заявки клиентов (subject,
      статус, причина), лиды (subject, статус), сделки (title, статус,
      сумма); `OrganizationCard` расширяется.
- [x] `org-card-tabs.tsx` + вкладки «Заявки клиентов» (флаг client_requests),
      «Лиды» (без флага — лиды под manager_cabinet), «Сделки»
      (deals_pipeline); страница `[id]` фильтрует по флагам как для
      inbound/calls.

## F. Тесты (порог 100%)

- [x] Unit: slaSettings (валидация/идемпотент/аудит), action, карточка-компонент,
      listIntake с порогами компании, процессор (порог, дедуп-журнал,
      получатели по компании/общая очередь, graceful), scheduling, org-card
      сервис/табы/страница.
- [x] Integration (живой Postgres): просроченное обращение → джоб →
      уведомление руководителю + журнал; второй прогон пуст; смена порога;
      вкладки карточки с данными.
- [x] Актуализация затронутых (leader/team страница, org-card тесты).

## G. Финал

- [x] typecheck / lint / unit / integration зелёные; CHANGELOG; STATUS.md
      (**этап 7 = ✅ после мержа**); PR.
