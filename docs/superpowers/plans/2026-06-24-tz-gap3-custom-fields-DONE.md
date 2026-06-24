# Настраиваемые поля (gap #3) — Close-out

**Дата:** 2026-06-24
**Ветка:** `claude/tz-gap3-custom-fields` (от main)
**Spec:** [2026-06-24-tz-gap3-custom-fields-design.md](../specs/2026-06-24-tz-gap3-custom-fields-design.md) · **Plan:** [2026-06-24-tz-gap3-custom-fields.md](2026-06-24-tz-gap3-custom-fields.md)
**Память:** [[project-tz-v04-gap-program-2026-06-23]] gap #3.

## Что отгружено (§11 ТЗ)

Настраиваемые (доп.) поля заказа: admin их конфигурит, значения заполняются в карточке заказа.

### Модель
- `CustomFieldDefinition` (entityType/key/label/fieldType enum text|number|date|select|boolean/options/required/sortOrder/isActive) + `CustomFieldValue` (полиморфно entityType/entityId, v1='order', `@@unique([definitionId,entityId])`). Миграция аддитивна (2 таблицы + enum + FK ON DELETE CASCADE).
- **ASSUMPTION**: носитель v1 = `Order` (полиморфизм готов к расширению; подтвердить §11 на review).

### Сервисы (`services/customFields/**`, Result §3)
- `definitions.ts` — admin-only CRUD (`invalid_key`/`options_required`/`duplicate_key`/`not_found`); деактивация вместо удаления; `getActiveDefinitions` (no-session read для рендера).
- `values.ts` — `getValuesForEntity` (no role-check, вызывается из авторизованного контекста) + `setValues` (write-scope **реюзит реальный order-resolver** `canSeeOrder`+`getCompanyTeamVisibility`+leader-invariant → C8 cross-company изоляция; org/partner → `forbidden`; валидация по типу, all-or-nothing → `invalid_value`; idempotent upsert).

### UI
- Admin-справочник `/admin/custom-fields` (зеркало TrainingDirection): таблица + Dialog add/edit (key immutable на edit, options только для select) + деактивация; API `/api/admin/custom-fields[/[id]]` тонкие; пункт «Доп-поля» в admin-nav.
- Секция «Дополнительные поля» в карточке заказа во **всех 5 поверхностях**: manager/admin/**leader** edit, organization/partner read-only. Server-action `saveOrderCustomFieldsAction`. Рендер по типу; пусто при отсутствии активных определений (graceful).

### Гейты
- typecheck ✓ · lint ✓ (0 warnings)
- **unit: 290 файлов passed / 1 skipped / 0 failed** (вкл. обновлённые nav-count тесты)
- integration (живой PG): `services.customFields.{definitions,values}` 33/33 ✓ (admin-only, scope-deny, type-validation, idempotent upsert)
- Миграция `20260624020000_custom_fields` применена (dev-БД пересоздана под ветку).
- **Holistic review (opus): SHIP WITH MINOR FIXES** — все 7 инвариантов PASS. Исправлено: **leader-кабинет не был подключён** (5-я поверхность; leader — редактор по §11) + добавлены RU-сообщения `invalid_key`/`options_required`/`duplicate_key`. Косметика (partner fetch до redirect — не утечка; whitespace-число) не блокирует.

## Остаток / follow-up
- Подтвердить носитель §11 (v1=Order); расширение на др. сущности = enum entityType + точка рендера.
- Прод pre-check: новые таблицы пустые, backfill не нужен.

## Коммиты (10)
schema+spec/plan → definitions service → values service → admin API → admin page+nav → server-action → section component → order-detail врезка (4) → CHANGELOG → review-fixes (leader wiring + RU msgs).
