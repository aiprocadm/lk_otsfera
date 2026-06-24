# Настраиваемые поля (gap #3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** §11 ТЗ — admin заводит настраиваемые поля (text/number/date/select/boolean) для заказа; значения редактируются в карточке заказа (manager/admin/leader), read-only для org/partner.

**Architecture:** Две модели `CustomFieldDefinition` (конфиг admin) + `CustomFieldValue` (значение, полиморфно по entityType/entityId, v1='order'). Admin-CRUD зеркалит `TrainingDirection`; значения встраиваются в order-detail. Без feature-flag (graceful).

**Tech Stack:** Next.js 15 / Prisma 5 / Vitest. Spec: [2026-06-24-tz-gap3-custom-fields-design.md](../specs/2026-06-24-tz-gap3-custom-fields-design.md). Branch `claude/tz-gap3-custom-fields` (от main).

---

### Task 1: Schema + миграция
**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_custom_fields/migration.sql`
- [ ] Добавить enum `CustomFieldType` + модели `CustomFieldDefinition`/`CustomFieldValue` (см. spec §3).
- [ ] Пересоздать dev-БД (ветка от main) → `migrate diff`→deploy→`prisma generate`. `npm run typecheck`.
- [ ] Commit `feat(schema): custom field definition + value models (§11)`.

### Task 2: Сервис определений (admin CRUD)
**Files:** `src/lib/services/customFields/definitions.ts`, `index.ts`, test (integration)
- [ ] TDD `listDefinitions`/`createDefinition`/`updateDefinition`/`deactivateDefinition` (Result §3): admin-only (`forbidden`); `duplicate_key` (нарушение `@@unique([entityType,key])`); `options_required` для `select` без опций; key-формат; деактивация вместо удаления.
- [ ] Commit `feat(custom-fields): definitions service (admin CRUD) (§11)`.

### Task 3: Сервис значений
**Files:** `src/lib/services/customFields/values.ts`, test (integration)
- [ ] TDD `getValuesForEntity(prisma, session, entityType, entityId)` → активные определения + значения (scoped через order-резолвер); `setValues(...)` — апсерт по `@@unique([definitionId,entityId])`, право редактирования заказа (manager/admin/leader + scope), валидация по `fieldType` (`invalid_value`), org/partner запись → `forbidden`.
- [ ] Реюз order-scope: импортировать `canSeeOrder`/manager-scope из `services/manager/orders` (или соответствующий резолвер). Cross-company изоляция.
- [ ] Commit `feat(custom-fields): values service (scoped get/set + type validation) (§11)`.

### Task 4: Admin API + UI (справочник)
**Files:** `src/app/api/admin/custom-fields/route.ts` + `[id]/route.ts` (тонкие), `src/components/admin/custom-fields-admin.tsx`, `src/app/admin/custom-fields/page.tsx`, nav (cabinet.ts admin)
- [ ] Зеркало `training-directions`: GET/POST + PATCH; компонент Dialog add/edit (label/key/тип/опции/required/sortOrder) + деактивация; страница admin-gated; пункт «Доп-поля» в admin-nav.
- [ ] Обновить admin-sidebar/nav count-тесты (как в gap #2). `npm run test:unit -- custom-fields admin-sidebar navigation`.
- [ ] Commit `feat(admin): custom fields reference page (§11)`.

### Task 5: Встраивание в карточку заказа
**Files:** `src/lib/services/manager/orderDetail.ts` (+ org/partner order-detail read paths), order-detail компоненты, server-action `src/server-actions/customFields.ts`
- [ ] Подмешать `getValuesForEntity('order', orderId)` в `loadManagerOrderDetail` + org/partner аналоги (read-only).
- [ ] Секция «Дополнительные поля»: рендер по типу; manager/admin/leader редактируют (server-action `setValues`), org/partner read-only. Только `ui/`-примитивы.
- [ ] TDD: order-detail отдаёт значения scoped; запись валидируется/scoped. Commit `feat(orders): custom fields section in order detail (§11)`.

### Task 6: Docs
- [ ] CHANGELOG `[Unreleased]`; (env не нужен — фича без конфигурации). Commit `docs: custom fields (§11)`.

### Финал
- [ ] Гейты typecheck/lint/unit + integration. Holistic review. Close-out `-DONE.md`. PR.

## Self-review (покрытие spec)
§11 определения → Task 1,2,4 ✓; значения+валидация → Task 3,5 ✓; admin-only конфиг → Task 2,4; scoped значения → Task 3,5; graceful (нет полей→нет секции) → Task 5; без flag → Task 4.
