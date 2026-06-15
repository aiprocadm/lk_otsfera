# T5 — Заявки на обучение: дизайн

**Дата:** 2026-06-14
**Трек:** T5 из [launch-readiness-roadmap](2026-06-13-launch-readiness-roadmap.md) (🔴 launch, первая волна). Независим.
**Метод:** 2 параллельных Explore (file:line). Подтверждено в коде.

## Цель
Подача заявки на обучение слушателя (партнёр/организация/менеджер/руководитель/админ) → утверждение на нашей стороне → провижн слушателя в текущую LMS (`otsfera.cdoprof.com`).

## Текущее состояние (разведка)
- `Student` — read-only roster (email/name/organizationId/externalStudentId), кабинет его НЕ создаёт и в LMS НЕ провижнит; только бриджит student-role Users в LMS (`/student/redirect` + one-time code + bridge-JWT, allowlist `otsfera.cdoprof.com`).
- Концепции курсов/обучения/enrollment НЕТ. «Заявка» сейчас = партнёрский лид (другой домен).
- Провижн слушателя в LMS — НЕ автоматизирован, API-контракта провижна нет.

## Решения владельца (2026-06-14)
1. **Провижн = ручной в LMS + отметка.** Утверждение → статус `approved`. Оператор создаёт слушателя в LMS вручную, затем в кабинете ставит `provisioned` + вписывает `externalStudentId`. Кабинет LMS не зовёт, `Student`/`User` не создаёт.
2. **Утверждение = общая очередь команды.** Все менеджеры + руководитель + админ видят все заявки и утверждают/отклоняют/провижнят (как лиды T3).
3. (агент) Курс = **свободный текст** (каталога курсов нет). Орг — опциональна (новый клиент допустим), плюс свободные `studentName/studentEmail`.

## Модель данных (миграция)
```prisma
enum EnrollmentStatus { pending approved rejected provisioned }

model EnrollmentRequest {
  id                String           @id @default(cuid())
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  submittedByUserId String
  submittedByUser   User             @relation("EnrollmentSubmitter", fields: [submittedByUserId], references: [id])
  submitterRole     String           // partner|organization|manager|leader|admin (snapshot)
  partnerId         String?          // set when submitted by a partner → partner visibility
  partner           Partner?         @relation(fields: [partnerId], references: [id])
  organizationId    String?          // client org if known
  organization      Organization?    @relation(fields: [organizationId], references: [id])
  studentName       String
  studentEmail      String
  courseTitle       String           // free-text
  note              String?
  status            EnrollmentStatus @default(pending)
  reviewedByUserId  String?
  reviewedByUser    User?            @relation("EnrollmentReviewer", fields: [reviewedByUserId], references: [id])
  reviewedAt        DateTime?
  rejectedReason    String?
  externalStudentId String?          // filled when marked provisioned
  provisionedAt     DateTime?

  @@index([status])
  @@index([partnerId])
  @@index([submittedByUserId])
}
```
Back-relations на `User` (2: submitter/reviewer), `Partner`, `Organization`. Аддитивная миграция, ничего существующего не ломает.

## Дизайн
### Сервис `lib/services/enrollments/`
- `submit.ts` — `submitEnrollmentRequest(prisma, session, args)`: создаёт заявку, snapshot `submitterRole`, `partnerId` если роль partner, валидация (email, name, course непустые). Партнёр/орг: organizationId ограничен их scope (партнёр — свои орг; орг — своя). Менеджер/админ — любая/none.
- `list.ts` — `listEnrollmentRequests`: для **reviewer** (manager/leader/admin) — общая очередь (все, фильтр статуса/поиска); для **submitter** (partner/org) — только свои (`partnerId` / `submittedByUserId`/org). Один сервис, ветка по роли.
- `lifecycle.ts` — throw-based (как T3): `approveEnrollment`, `rejectEnrollment(reason)`, `markProvisioned(externalStudentId)`. Переходы: pending→approved→provisioned; pending→rejected. audit + notify submitter (S5-стиль, in-app).
- `policy.ts` — `canReviewEnrollments(session)` = role∈{manager,admin} (+ leader = manager+managerRole). `canSubmitEnrollments(session)` = все 5 ролей.

### RBAC / гейтинг
- Флаг `enrollment_requests` (opt-in), 3 точки: middleware-префиксы (`/partner/enrollments`,`/organization/enrollments`,`/manager/enrollments`; leader под `leader_cabinet`; admin безусловно), nav-флаг, route `notFoundIfDisabled`.
- API под `/api/enrollments` (вне cabinet-префиксов → middleware /api не трогает): `POST` (submit, любой из 5 ролей, requireSession + canSubmit), `GET` (list, role-scoped), `/api/enrollments/[id]` `PATCH` (approve|reject|markProvisioned — canReview). Throw→HTTP.
- Подача доступна всем 5 ролям → единый POST с проверкой роли внутри (не per-cabinet-роут). Утверждение — только reviewer.

### UI (§4: ОДНА презентационная форма, не 5 сиблингов)
- `components/enrollment/enrollment-request-form.tsx` — презентационный, domain-agnostic (name/email/course/org/note), принимает `onSubmit`-action. Переиспользуется всеми ролями.
- `components/enrollment/enrollment-queue.tsx` — очередь reviewer'а + клиентские действия (approve/reject/provision).
- `components/enrollment/enrollment-status-badge.tsx` — презентационный бейдж.
- Страницы (тонкие): `/partner/enrollments`, `/organization/enrollments` (форма + свои заявки); `/manager/enrollments`, `/leader/enrollments`, `/admin/enrollments` (очередь + можно подать). nav «Заявки на обучение» в 5 ролях.

## Тестовая стратегия
| Часть | Слой | Тест |
|---|---|---|
| submit | unit | создаёт заявку со snapshot роли/partnerId; партнёр вне scope орг → reject |
| list | unit | reviewer видит все; partner — только свои (partnerId); org — свои |
| lifecycle | unit | approve/reject/markProvisioned переходы (валид/невалид), audit+notify; provision пишет externalStudentId |
| policy | unit | canReview только manager/admin; canSubmit все 5 |
| API | unit | POST submit (роль-гейт), PATCH approve/reject/provision (reviewer-гейт), notFoundIfDisabled |
| nav | unit | пункт в 5 ролях под флагом |

Гейты: typecheck/lint/`test:unit`/build; integration (scope/lifecycle на живой PG) — WSL.

## Порядок реализации
1. Флаг + middleware + nav (5 ролей) + миграция/схема.
2. policy + submit + list + lifecycle (+ unit TDD).
3. API (`/api/enrollments[/[id]]`) + unit.
4. UI (форма/очередь/бейдж + 5 страниц).

## Вне scope
- Авто-провижн через LMS API (контракта нет) — future.
- Каталог курсов (сейчас free-text) — future.
- Создание `Student`/student-`User` из заявки — не делаем (ручной провижн); при необходимости — отдельный трек.
