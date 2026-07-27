# Этап 9 PR-3 — Экспорты (остаток ФТ-12.2), завершает этап 9

Дата: 2026-07-27 · Спека: [2026-07-26-stage9-support-sessions-exports-design.md](../specs/2026-07-26-stage9-support-sessions-exports-design.md)
(✅ подтверждена 26.07.2026) · ТЗ §Модуль 12 (ФТ-12.1–12.2) · Ветка
`claude/stage9-pr3-exports` **от main** (§14 CLAUDE.md — стек на ветку не используем).

## Что делаем

4 выгрузки из §6 спеки + `PiiAction 'export'` + вкладка «Удостоверения» карточки
организации + должность слушателя (решение заказчика по вопросу §9-1).

Правила Модуля 12 (ФТ-12.1) — общие для всех четырёх, эталон
[`certificates/xlsx.ts`](../../../src/lib/services/certificates/xlsx.ts):
та же сервис-выборка, что у экрана (RBAC не обходится), активные фильтры
уважаются, лимит 10 000 строк + хвост «показаны первые N из M», защита от
формула-инъекций, брендовая шапка.

## Задачи

### 1. Должность слушателя (`Student.position`)

- [x] `prisma/schema.prisma`: `position String?` в `Student` (аддитивно).
- [x] Миграция через `prisma migrate diff` (неинтерактивная сессия) + `migrate deploy` + `generate`.
- [x] Автозаполнение из заявки на обучение: в `enrollments/submit.ts` после
      создания заявки проставить `Student.position` для позиций с `studentId` и
      непустой должностью — **только если у слушателя пусто** (не затираем
      актуальное значение старой заявкой).
- [x] Карточка сотрудника `/organization/students/[id]`: показ должности +
      форма правки (server-action `updateOrgStudentPosition`, скоуп — активная
      организация кабинета; чужой студент → `forbidden`).

### 2. `PiiAction` += `export` (ФТ-12.1)

- [x] `src/lib/pii/contexts.ts`: `PiiAction = 'list' | 'view' | 'export'`.
- [x] Контекст `org_card_certificates_export` (student/export, callSite — роут
      выгрузки удостоверений из карточки) — единственная staff-выгрузка с ПДн.
- [x] ~~RU-лейбл действия «Выгрузка»~~ — не потребовался: UI `/admin/pii-access`
      рендерит `labelRu` контекста, а не действие.
- [x] Клиентские выгрузки своих данных не журналируются — обеспечивает
      `isStaff`-фильтр внутри `recordPiiAccess`, отдельных веток не пишем.
- [x] **Отклонение от §6 спеки:** контекст `org_students_export` НЕ заводился —
      staff-экрана выгрузки сотрудников организации нет (выгрузка живёт только
      в клиентском кабинете), а клиентская по ФТ-12.1 не журналируется. Заводить
      всегда-пустой контекст = мусор в фильтрах `/admin/pii-access`.

### 3. Выгрузка заказов (staff) — `/manager/orders`, `/leader/orders`

- [x] `src/lib/services/manager/orders.ts`: вынести построение `where` в общий
      `buildOrdersWhere` (используют `listOrders` и экспорт) + `listOrdersForExport`
      (без cursor, лимит + `total`) — фильтры и скоуп те же, `teamModeOverride`
      лидера сохраняется.
- [x] Рендерер `src/lib/services/orders/xlsx.ts` (`renderOrdersXlsx`): №, номер
      заказа, название, организация, менеджер, статус исполнения, финстатус,
      сумма, оплачено, долг, создан.
- [x] Роут `src/app/api/manager/orders/export/route.ts` (роль `manager`; лидер
      проходит как manager с `teamModeOverride`, как на экране `/leader/orders`).
- [x] Кнопки «Выгрузить в Excel» на обеих страницах (уважают активные фильтры).

### 4. Удостоверения из карточки организации (staff)

- [x] Новая вкладка `certificates` в `ORG_CARD_TABS` + данные в
      `getOrganizationCard` (через `listCertificates` — скоуп сессии не обходится).
- [x] Роут `src/app/api/manager/organizations/[id]/certificates/export/route.ts`
      → существующий `renderCertificatesXlsx` + `recordPiiAccess('org_card_certificates_export')`.
- [x] Кнопка на вкладке.

### 5. Платежи/задолженность

- [x] Рендерер `src/lib/services/finance/xlsx.ts` (`renderPaymentsXlsx`): дата,
      номер заказа, сумма, НДС, назначение, № платёжки, способ, возврат,
      комментарий; строка KPI (начислено/оплачено/долг) в шапке листа.
- [x] Роут клиента `src/app/api/organization/finance/export/route.ts` (своя
      активная организация; не-staff → журнал не пишется).
- [x] Роут staff `src/app/api/manager/organizations/[id]/payments/export/route.ts`
      (скоуп `requireManagerForOrg`-эквивалент на уровне сервиса).
- [x] Кнопки: `/organization/finance` и вкладка «Оплаты» карточки организации.

### 6. Сотрудники организации — `/organization/students`

- [x] `listOrgStudentsForExport` (тот же `where`, что у экрана + должность +
      счётчик **действующих** удостоверений на дату выгрузки).
- [x] Рендерер `src/lib/services/organization/students-xlsx.ts`: №, ФИО, email,
      должность (пусто → «—», решение заказчика), действующих удостоверений,
      внешний id, добавлен.
- [x] Роут `src/app/api/organization/students/export/route.ts` + кнопка на экране.

### 7. Общий `exportHref`

- [x] `src/lib/ui/exportHref.ts` + замена двух копий (`partner/certificates`,
      `organization/certificates`) и использование во всех новых кнопках.

### 8. Тесты (порог покрытия 100% — §6 CLAUDE.md)

- [x] Рендереры: колонки, лимит + хвост, формула-инъекции, пустая выдача.
- [x] Роуты: 401/403-негативы, content-type/content-disposition, проброс фильтров.
- [x] Сервисы: `listOrdersForExport` (скоуп/фильтры/лимит), `listOrgStudentsForExport`
      (счётчик удостоверений), `updateOrgStudentPosition` (чужой студент → forbidden).
- [x] UI: кнопки на 4 экранах + вкладка «Удостоверения», карточка сотрудника с должностью.
- [x] Integration: staff-выгрузка пишет `PiiAccessEvent` с `action='export'`,
      клиентская — не пишет; автозаполнение должности из заявки.

### 9. Отгрузка

- [x] `npm run typecheck` + `npm run lint` + `npm run test:unit` зелёные;
      integration по затронутым местам на живом Postgres.
- [x] CHANGELOG.md, STATUS.md (этап 9 → ✅ после мержа), PR с `base: main`.
