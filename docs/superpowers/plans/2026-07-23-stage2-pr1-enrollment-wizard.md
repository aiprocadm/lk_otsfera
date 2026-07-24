# План — Этап 2 / PR-1: модель шапка+позиции и мастер подачи заявки на обучение

Спека: [2026-07-23-stage2-enrollment-wizard-design.md](../specs/2026-07-23-stage2-enrollment-wizard-design.md) §2–4, §7, §9 (PR-1) — ✅ подтверждена.
Цель PR-1: заявка на N слушателей одной подачей (чекбоксы сотрудников + добавление
строками с полями вопроса 5), направление — только из справочника. Excel-импорт,
статусная лента, дашборды, уведомления подателю — PR-2.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (по желанию).

## A. Модель и миграция (ФТ-2.2)

- [x] A1. `schema.prisma`: enum `EnrollmentStatus` + `in_training`, `certificates_ready`
  (additive). Новая модель `EnrollmentRequestItem` (§2 спеки: requestId FK Cascade,
  studentId?, fullName, email, position?, snils?, birthDate?, extra?, status,
  externalStudentId?; @@index([requestId])). `EnrollmentRequest`: + `directionId?`
  FK → TrainingDirection (+ обратная relation), `courseTitle` → `legacyCourseTitle?`;
  `studentName`/`studentEmail`/`externalStudentId` уходят с шапки (в позиции);
  `provisionedAt` остаётся. `Student.enrollmentItems` relation.
- [x] A2. Миграция **правится руками** (данные не теряем): RENAME COLUMN
  courseTitle→legacyCourseTitle (не drop+add); CREATE TABLE items; INSERT-бэкфилл —
  по одной позиции на существующую заявку (id = gen_random_uuid(), fullName/email/
  status/externalStudentId с шапки); затем DROP старых колонок шапки.
- [x] A3. `prisma generate`; integration-тест миграции: legacy-заявка получила
  позицию, legacyCourseTitle сохранён.

## B. Сервисы

- [x] B1. `enrollments/validate.ts` (чистые функции): `validateSnils` (пусто или
  11 цифр после снятия маски), `validateEmail`, `parseBirthDate`,
  `validateEnrollmentItems` (≥1, email обязателен, дубликаты email → warning-склейка)
  — русские сообщения ошибок (переиспользуются Excel-импортом в PR-2).
- [x] B2. `submit.ts` rewrite: вход `{ directionId, organizationId?, note?, items[] }`;
  directionId обязателен и активен; скоупы org/partner как сейчас; каждый
  `studentId` принадлежит выбранной организации (иначе forbidden); транзакция
  шапка+позиции; аудит (кол-во позиций, без ПДн).
- [x] B3. `list.ts`: EnrollmentRow → + `directionName` (direction.name ??
  legacyCourseTitle ?? '—'), `studentCount`, `firstStudentName`; поиск — по
  ФИО/email позиций и имени направления; выборка include items (узкий select).
- [x] B4. `lifecycle.ts`: approve/reject — как было + зеркалирование статуса в
  позиции; `markProvisioned` — шапка+все позиции → provisioned,
  `externalStudentId` (опц.) пишется в позицию, если она одна. Переходы
  in_training/certificates_ready — PR-2.

## C. API

- [x] C1. `POST /api/enrollments`: новый контракт тела (directionId + items[]);
  коды ошибок validation/forbidden как сейчас.
- [x] C2. `GET /api/enrollments`: строки с directionName/studentCount (совместимо
  с очередью); STATUSES + новые значения enum.
- [x] C3. Новый `GET /api/enrollments/students?organizationId=` — сотрудники
  организации для шага 2 (session-скоуп: organization — свои членства, partner —
  свои организации, manager/admin — любая; `listOrgStudents` внутри; recordPiiAccess).
- [x] C4. Страницы передают справочник направлений (active TrainingDirection)
  в мастер серверным пропсом.

## D. Мастер подачи (ФТ-2.1 без Excel) + адаптация UI

- [x] D1. `components/enrollment/enrollment-wizard.tsx` (client, shared
  presentational): 3 шага — направление (+выбор организации для partner/manager),
  слушатели (чекбоксы из API C3 с поиском + «Добавить слушателя» строкой:
  ФИО*, email*, должность, СНИЛС (маска 11 цифр), дата рождения, «Дополнительно»;
  редактирование/удаление позиций), проверка (итог, примечание, отправка).
  Инлайн-подсказки и пустые состояния (ФТ-2.6 в объёме мастера). Плейсхолдер
  кнопки «Импорт из Excel — скоро» НЕ ставим (появится в PR-2).
- [x] D2. Страницы organization/partner/manager/admin enrollments: форма →
  мастер (пропсы: directions, organizations, для organization — activeOrgId).
- [x] D3. `enrollment-list.tsx` (податель): направление + «N слушателей» + статус.
- [x] D4. `enrollment-queue.tsx` (ревьюер): строка заявки — направление, податель,
  позиции (ФИО/email/должность/СНИЛС/дата рождения/дополнительно) раскрытием;
  approve/reject/provision как сейчас (по шапке).
- [x] D5. Старый `enrollment-request-form.tsx` удаляется вместе с тестами
  (заменён мастером).

## E. Тесты (порог 100%)

- [x] E1. validate.ts — все ветки, русские сообщения.
- [x] E2. submit: скоупы, чужой studentId → forbidden, direction неактивен →
  validation, транзакционность, дубликаты email (unit + integration на живой БД).
- [x] E3. lifecycle: зеркалирование позиций, externalStudentId в одиночную позицию.
- [x] E4. list: directionName/count/поиск по позициям; API роуты (C1–C3, скоупы C3).
- [x] E5. Мастер: шаги, добавление/удаление/редактирование позиций, валидация,
  сабмит; списки/очередь; страницы (renderServerComponent).
- [x] E6. Integration миграции (A3) + существующие enrollment-тесты обновлены.

## F. Ворота и поставка

- [x] F1. `.env.example`/доки — не требуется (новых env нет). CHANGELOG.md — запись.
- [ ] F2. `typecheck` / `lint` / `test:unit` зелёные; integration по затронутым
  местам (живой Postgres; `prisma migrate deploy` на тестовой БД).
- [ ] F3. PR открыт, STATUS.md обновлён. PR-2 (Excel, лента, дашборды,
  уведомления, переходы in_training/certificates_ready) — следующим.
