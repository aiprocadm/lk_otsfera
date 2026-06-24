# Close-out: позиции заявки (слушатели) + удостоверения + напоминания о сроке

**Дата:** 2026-06-24
**План:** [2026-06-23-order-positions-certificates.md](2026-06-23-order-positions-certificates.md)
**Spec:** [2026-06-23-order-positions-certificates-design.md](../specs/2026-06-23-order-positions-certificates-design.md)
**Ветка:** `claude/order-positions-certificates` (от `main`)
**Метод:** subagent-driven-development (свежий субагент на задачу + контроллерская верификация).

## Что отгружено

Первый sub-project gap-программы ТЗ v0.4 — закрывает пробелы §15.6 / §12 / §10 (per-student) / §19.

| Слой | Отгружено | Коммиты |
|---|---|---|
| **Данные** | `TrainingDirection`, `OrderItem` (позиция), `Certificate`, `CertificateReminder` + enum `TrainingStatus`; `Student.email` → `@@unique([organizationId,email])` + `status`; relation `Order.items`/`Organization.certificates`. Миграции `20260623000000` + `20260623010000` (индексы по `directionId`). Seed 4 направлений. | `247aff1`, `6803feb`, `263d90a` |
| **Логика** | Чистая `selectDueReminders` (активная полоса 90/60/30/7, идемпотентна). | `5d0ebd3` |
| **Сервисы** (Result §3) | `directions` (admin/leader), `orderItems` (scoped via `getOrder`, RBAC, dup-guard), `certificates` (`scopeOrgIds` по ролям, `issueFromOrderItem` в транзакции). Barrel + cross-org isolation integration-инвариант. | `eda1b0e`, `7783a84`, `46b0912`, `d6ccf44` |
| **Воркер** | Очередь `notifications.certificateExpiry` + ежедневное расписание `0 7 * * *`; процессор `certificate-expiry` (fan-out §12: орг→партнёр→менеджер→руководитель, ЛК+email; dedup через `@@unique`+P2002). | `152de09`, `8aaba0a` |
| **UI** | Тонкие API-роуты менеджера; секция «Слушатели» в карточке заказа (manager+leader, add/смена статуса/выдать удостоверение); read-only позиции в org/partner; карточки удостоверений + бейдж срока на странице сотрудника `/manager/students/[id]`; admin-страница справочника направлений + nav. | `5bba307`, `f092aba`, `3a6d870`, `752a30c`, `e2d8112` |

## Гейты (контроллерская верификация)

- `typecheck` — чисто ✅
- `lint` — 0 warnings/errors ✅
- `test:unit` — 3111 passed / 3 skipped (288 файлов) ✅
- `test:integration` (training): `schema.training` 2 + `services.training.isolation` 1 + `worker.certificate-expiry` 1 = **4/4** ✅ (живой PG)
- `build` — exit 0 ✅
- processor-coverage guardrail ✅ (новый процессор покрыт integration-тестом)
- **Holistic security review** (отдельный субагент, весь diff `3574007..HEAD`): **Ship** — 0 Critical / 0 Important; IDOR и cross-tenant изоляция корректны во всех новых роутах/сервисах. 2 Minor (contract-нит) исправлены коммитом `037baa3`: роут `certificates` → 400 (вместо 403) при отсутствии `studentId/directionId`; `createCertificate` маппит Prisma P2003 → `not_found` вместо throw.

## Решения, принятые по ходу (отклонения от плана — обоснованные)

1. **Миграции через `migrate diff` + `migrate deploy`** — `migrate dev` не работает не-интерактивно в этом окружении. Эквивалентный forward-only результат, drift нет.
2. **Индексы `@@index([directionId])`** на `Certificate`/`OrderItem` добавлены по code-review (I3) до ухода в прод.
3. **`NotificationType` enum НЕ трогали** — колонка `Notification.type` это `String`, enum ни к чему не привязан; процессор пишет строковый литерал `'certificate_expiring'`. Добавление значения = 0 пользы + риск drift (YAGNI).
4. **`AuditEntity`** расширен значениями `'order_item'`, `'certificate'` (типизированный union).
5. **Leader-страница заказа** (`/leader/orders/[id]`) переиспользует `ManagerOrderDetailView` — секцию слушателей подключили и там.
6. **org/partner read-path** грузит позиции внутри уже авторизованного запроса (НЕ через manager-scoped `listOrderItems`) — иначе scope-mismatch скрыл бы данные.

## Остаток (вынесено в отдельные пробелы gap-программы)

- **Telegram-канал** напоминаний (ТЗ §18) — отдельный sub-project; подключится к тому же fan-out-хуку.
- **Настраиваемый справочник статусов обучения** (`trainingStatus` тут фикс-enum; §10) — отдельный пробел.
- **6-стадийный рабочий статус заказа** (§10) — расхождение с текущими enum, отдельное решение.
- **Прод pre-check**: перед деплоем на непустую БД выполнить `SELECT "organizationId", email, COUNT(*) FROM "Student" GROUP BY 1,2 HAVING COUNT(*)>1;` (миграция `Student_organizationId_email_key` упадёт при дублях) — пункт runbook.
- **Smoke вручную** (оператор): добавить слушателя → сменить статус → выдать удостоверение со сроком → бейдж; cert с `validUntil`=+7дн → прогон воркера → уведомление в ЛК.

## Критерии приёмки spec §10 — статус

1. Несколько слушателей в заказе, дубль отклоняется — ✅ (`orderItems` + `@@unique`, тест).
2. Удостоверение с ручной `validUntil`; «выдать» → статус `certificate_issued` — ✅ (`issueFromOrderItem`, тест).
3. Напоминания 90/60/30/7, без дублей — ✅ (процессор + dedup integration-тест).
4. Менеджер видит своё, не видит чужое — ✅ (cross-org isolation integration-инвариант).
5. Справочник направлений только admin/leader, деактивация не удаление — ✅ (`directions` сервис + admin-страница).
