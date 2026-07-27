# Этап 10 PR-1 — зачистка клиентских кабинетов + матрица видимости

Дата: 2026-07-27 · Спека: [2026-07-27-stage10-visibility-audit-design.md](../specs/2026-07-27-stage10-visibility-audit-design.md)
(✅ подтверждена 27.07.2026) · ТЗ §3.2 + §7 · Ветка `claude/stage10-visibility-audit`
**от main** (§14 CLAUDE.md).

## Задачи

### 1. Убрать домен лидов из клиентского контура (§6-бис спеки)

Решение заказчика: «партнёр вообще не должен видеть лидов и организация тоже».
Сегодня UI закрыт редиректом (этап 5), **а API открыт** — `GET /api/partner/leads/[id]`
отдаёт `assignedManagerName`.

- [ ] Удалить страницы `app/partner/leads/{page,[id]/page,new/page}.tsx`.
- [ ] Удалить роуты `app/api/partner/leads/**` (5 файлов, включая вложения).
- [ ] Удалить сервисы `services/partner/{leads,leadAttachments}.ts`.
- [ ] Удалить компоненты: `leads-table`, `leads-card-list`, `lead-create-form`,
      `leads-search`, `lead-status-tabs`, `lead-withdraw-button`.
      **НЕ трогать** `lead-status-badge` (staff-экраны, карточка организации),
      `lead-attachments-list`/`lead-attachment-dropzone` (используют обращения).
- [ ] Убрать nav-пункт `/partner/leads` из `navigation/cabinet.ts`.
- [ ] Убрать флаг `partner_leads` из `featureFlags.ts` и его префикс из
      `middleware.ts` (по образцу удаления `one_c_sync`/`document_scan`).
- [ ] Данные (`Lead`, `LeadAttachment`) НЕ трогаем — с ними работают сотрудники.
- [ ] Проверить, что `/partner/leads` и `/api/partner/leads/*` дают 404 для партнёра.

### 2. Матрица видимости (артефакт приёмки)

- [ ] `docs/audit/2026-07-27-client-visibility-matrix.md`: строка на каждую
      клиентскую поверхность — эндпоинт · роль · поля наружу · вердикт
      (`ok` / `over-fetch` / `leak`).
- [ ] Периметр (решение заказчика — включая общие роуты): API партнёра,
      API организации, общие (`client-requests`, `comments`, `dashboard`,
      `documents`, `enrollments`, `messages`, `notifications`, `support/question`),
      клиентские server-actions, страницы кабинетов с прямым `prisma.*`.
- [ ] Каждый `leak` — чинится в этом же PR; каждый `over-fetch` — переводится
      на явный `select`.

### 3. Явные `select` вместо пост-фильтрации (§7 ТЗ)

- [ ] Клиентские сервисы (`services/partner/**`, `services/organization/**`)
      выбирают ровно поля своего DTO; `include` без вложенного `select` не
      остаётся.
- [ ] Перенести/переименовать чувствительную
      `getOrgIntermediaryCommissionForOrgs` так, чтобы она не жила в клиентском
      неймспейсе (или явно задокументировать гейт в имени файла).

### 4. Guardrail от регресса

- [ ] Тест `security.client-services-select.guardrail.test.ts`: в
      `services/{partner,organization}/**` нет `include:` без вложенного
      `select`, и клиентские DTO не содержат запрещённых §7 полей
      (`assignedManager*`, `funnelStage*`, `dealId`, `promotedDealId`,
      внутренние заметки).

### 5. Тесты

- [ ] Удалить тесты удалённого кода (партнёрские лиды: страницы, API, сервисы,
      компоненты — ~14 файлов).
- [ ] Актуализировать затронутые (`api.featureFlags.gating`, `notifications.href`,
      `components.bottom-tab-bar`, `kpi-grid`, `attention-list`, `events-feed`,
      `security.idor-lead` — оставить staff-часть).
- [ ] Новый негативный тест: партнёр дёргает `/api/partner/leads*` → 404.

### 6. Отгрузка

- [ ] `npm run typecheck` + `npm run lint` + `npm run test:unit` зелёные;
      integration по затронутым местам на живом Postgres.
- [ ] CHANGELOG.md, STATUS.md, PR с `base: main`.
