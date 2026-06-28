# T5 — Заявки на обучение: close-out (DONE, код)

**Дата:** 2026-06-14
**Ветка:** `claude/t1-f6-leader-axes`
**Спека:** [../specs/2026-06-14-t5-enrollment-requests-design.md](../specs/2026-06-14-t5-enrollment-requests-design.md)

Подача заявки на обучение (5 ролей) → утверждение на нашей стороне (общая очередь) → ручной провижн в LMS + отметка. Всё по TDD; решения процесса — владельца.

## Решения владельца (2026-06-14)
1. **Провижн = ручной в LMS + отметка** (статус `provisioned` + `externalStudentId`; кабинет LMS не зовёт, `Student`/`User` не создаёт → `EnrollmentRequest` самодостаточна).
2. **Утверждение = общая очередь** (менеджеры + руководитель + админ видят/утверждают все).
3. (агент) Курс = свободный текст; орг опциональна.

## Отгружено
- **Модель + миграция** `20260615030202_enrollment_requests`: `EnrollmentRequest` + enum `EnrollmentStatus` (pending/approved/rejected/provisioned), back-relations на User(2)/Partner/Organization. Аддитивно. Применена локально + `prisma generate` (после снятия зомби-процессов `prisma/seed.ts`, державших query_engine DLL).
- **Флаг** `enrollment_requests` (opt-in) + 3 точки: middleware (5 префиксов dark-launch), nav (5 ролей), page `isFeatureEnabled→notFound` / API `notFoundIfDisabled`.
- **Сервис** `lib/services/enrollments/`: `policy` (canReview=manager/admin, canSubmit=5 ролей, submitterRole snapshot), `submit` (scope орг для partner/org), `list` (reviewer=вся очередь, submitter=свои), `lifecycle` (approve/reject/markProvisioned, throw+audit).
- **API** `/api/enrollments` (POST submit любой submitter, GET role-scoped), `/api/enrollments/[id]` (PATCH approve|reject|markProvisioned, reviewer-only). Throw→HTTP.
- **UI** (§4: ОДНА презентационная форма + одна очередь + read-only список, не 5 сиблингов): `enrollment-request-form`, `enrollment-queue`, `enrollment-list`, `enrollment-status-badge`; 5 страниц (`partner/organization/manager/leader/admin/enrollments`); nav «Заявки на обучение» в 5 ролях.

## Верификация
- **Unit:** service 13, API 9 — зелёные. typecheck/lint чисто. Nav-каноны обновлены (+1 пункт в 5 ролях): featureFlags.manager, components.{manager,admin,org,leader}-sidebar, navigation.cabinet.{partner,leader} — 88 зелёных.
- **build:** см. ниже (ловит страницы/слаги).
- **Integration (WSL live-PG):** scope/lifecycle на живой БД — за оператором (тесты по образцу T3).

## Вне scope (future)
- Авто-провижн через LMS API (контракта нет).
- Каталог курсов (сейчас free-text).
- Создание `Student`/student-`User` из заявки (ручной провижн).
- Уведомление submitter о смене статуса (сейчас только audit + свой список; enum `NotificationType` не расширялся, чтобы не плодить миграцию) — future, как S5 для лидов.

## Операционка перед запуском
- Включить `FEATURE_ENROLLMENT_REQUESTS=1` (dark-launch off по умолчанию).
- WSL integration-прогон.
