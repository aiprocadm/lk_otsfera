# План — Этап 5 / PR-1: заявки клиентов — модель, подача, триаж, запрет партнёрских лидов

Спека: [2026-07-24-stage5-client-requests-design.md](../specs/2026-07-24-stage5-client-requests-design.md) §2–5, §9 (PR-1) — ✅ подтверждена.
Цель PR-1: критерий этапа — «партнёр не может создать Lead ни через UI, ни через
API; заявка проходит путь подача → триаж → лид». DaData-автокомплит и
антидубли-плашки — PR-2.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (по желанию).

## A. Модель и миграция

- [ ] A1. `schema.prisma`: enum `ClientRequestSource` (partner_cabinet |
  organization_cabinet | website), enum `ClientRequestStatus` (submitted |
  in_triage | converted | rejected); модели `ClientRequest` +
  `ClientRequestAttachment` (§2 спеки, по образцу Lead/LeadAttachment);
  `Lead`: `partnerId` → nullable, `+source LeadSource
  @default(partner_legacy)` (partner_legacy | client_request | manual |
  website), `+sourceRequestId String? @unique` (+ relation на ClientRequest).
- [ ] A2. Миграция additive (без потери данных): существующие лиды получают
  `partner_legacy`; `prisma generate`; integration-тест миграции.

## B. Флаг и подача (ФТ-1.2, 1.3)

- [ ] B1. Флаг `client_requests` (opt-in): middleware-префиксы
  `/partner/requests`, `/organization/requests`, `/manager/requests`
  (+leader/admin), nav-пункты, route/page-гейты — все три точки.
- [ ] B2. Сервис `clientRequests/submit.ts`: скоупы по роли (partner —
  partnerId; organization — членство), валидация (компания*, контакт*,
  телефон/email хотя бы одно, тема*), транзакция заявка+вложения, аудит,
  уведомление менеджерам `client_request_submitted` best-effort.
- [ ] B3. Вложения: сервис по образцу leadAttachments (MIME/size, скан-очередь,
  presigned download, infected → 410), роуты подателя и staff.
- [ ] B4. `POST /api/client-requests` (+ GET список своих) — тонкие роуты;
  формы `/partner/requests` и `/organization/requests` (sibling): подача +
  список со статус-бейджами «подана → в работе → принята/отклонена» + деталка.

## C. Триаж (ФТ-1.4)

- [ ] C1. Сервис `clientRequests/triage.ts`: `takeInTriage` (submitted →
  in_triage, triagedBy), `convertToLead` (транзакция: Lead из полей заявки,
  source=client_request, sourceRequestId, partnerId наследуется; заявка →
  converted, convertedLeadId), `rejectRequest` (причина); lifecycle_violation
  по конвейеру; статусные уведомления подателю
  `client_request_status_changed` best-effort.
- [ ] C2. Очередь `/manager/requests` (+ зеркала leader/admin): company-scope
  (C8-паттерн inbox), список + деталка с действиями C1.
- [ ] C3. Новый сервис создания лида сотрудником (`manual`): только
  manager/leader/admin; форма в разделе лидов менеджера.

## D. Запрет партнёрских лидов (ФТ-1.5–1.7)

- [ ] D1. `createLead` (partner) и `POST /api/partner/leads` → `forbidden`;
  guard-тест критерия приёмки (UI и API).
- [ ] D2. `/partner/leads*` → redirect на `/partner/requests`; nav партнёра:
  «Заявки» → `/partner/requests`; nav менеджера: «Заявки» → «Лиды», новый
  пункт «Обращения клиентов» → `/manager/requests`.
- [ ] D3. Флаг `partner_leads`: вывести из точек чтения партнёрского создания
  (разделы менеджера не трогаем); redirect живёт под `client_requests`.

## E. Тесты (порог 100%) и ворота

- [ ] E1. submit: скоупы, валидация, транзакционность, вложения (unit +
  integration).
- [ ] E2. triage: конвейер, convertToLead (source/sourceRequestId/converted),
  reject, C8-скоуп, уведомления.
- [ ] E3. Запрет: партнёр UI/API → forbidden (guard), redirect, nav.
- [ ] E4. Миграция Lead (partner_legacy, nullable partnerId) — integration.
- [ ] E5. Страницы/формы/бейджи; обновить существующие lead-тесты.
- [ ] E6. `typecheck`/`lint`/`test:unit` зелёные; integration по затронутым
  местам; CHANGELOG; STATUS; PR.
