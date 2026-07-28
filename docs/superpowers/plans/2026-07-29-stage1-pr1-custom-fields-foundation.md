# Этап 1 PR-1 — фундамент настраиваемых полей (§11: 12 типов, роли, 5 сущностей)

Дата: 2026-07-29 · Спека: [2026-07-29-stage1-custom-fields-design.md](../specs/2026-07-29-stage1-custom-fields-design.md)
(✅ подтверждена 29.07.2026, решения Q1–Q5) · Ветка от `main` (§14 CLAUDE.md).

**Границы PR-1:** только схема + сервисный слой + правила доступа. Экрана
настройки (PR-2), секций на карточках (PR-3) и карточки документа (PR-4) здесь
нет. Наружное поведение до/после PR-1 обязано совпасть — заказ с уже
настроенными полями работает как работал.

## Задачи

### 1. Схема (аддитивная миграция)

- [x] `enum CustomFieldType` += `textarea`, `money`, `datetime`, `multiselect`,
      `phone`, `email`, `url`. Существующие пять значений не трогать
      (переименование = потеря данных).
- [x] `CustomFieldDefinition` += `helpText String?`, `visibleToRoles String[]`,
      `editableByRoles String[]`, `isSystem Boolean @default(false)`.
- [x] **Data-шаг в той же миграции** (ловушка §3.2 спеки): всем существующим
      строкам `UPDATE ... SET "editableByRoles" = ARRAY['admin','leader','manager']`
      — иначе менеджеры молча теряют право правки полей заказа на бою.
- [x] `npm run prisma:generate`; `prisma migrate status` чистый.

### 2. Типы и приведение значений — `lib/services/customFields/coerce.ts`

- [x] `validateFieldValue(fieldType, options, value)` расширяется на 12 типов по
      таблице §3.1 спеки. `money` — регэксп `^-?\d+(\.\d{1,2})?$` (строкой, не
      float: float теряет копейки). `url` — только `http`/`https`
      (`javascript:` обязан отвергаться). `multiselect` — JSON-массив, все
      элементы ∈ `options`, дубли запрещены.
- [x] `serializeMultiselect` / `parseMultiselect` — единственное место, где
      множественный выбор превращается в строку и обратно (отдельный тип-обёртка
      `CustomFieldValueView` не понадобился: наружу и так уходит типизированный
      `FieldWithValue`). Плюс `normalizeValue` — нормализация телефона.
- [x] Старое поведение пяти существующих типов не меняется ни на символ
      (регрессы `values.*` должны пройти без правок).

### 3. Реестр системных полей — `lib/services/customFields/systemFields.ts`

- [x] Список по сущностям из §11 ТЗ: организация — название, тип, связанный
      партнёр, ответственный менеджер, статус; сотрудник — ФИО, организация,
      статус карточки. Русские подписи рядом (их покажет PR-2).
- [x] `isReservedKey(entityType, key)` — используется при создании определения.

### 4. Сущности и правила доступа

- [x] `CUSTOM_FIELD_ENTITIES = ['order','organization','partner','student','document']`;
      создание определения с чужим `entityType` → новый код `invalid_entity_type`.
- [x] Создание с зарезервированным ключом → новый код `reserved_key`.
- [x] Гейт настройки: `requireAdmin` → **admin ∨ leader** (`isManagerLeader`).
      Менеджер — `forbidden`.
- [x] `resolveEntityAccess(prisma, session, entityType, entityId)` вместо
      `resolveWritableOrder`: возвращает `{ canRead, canWrite }` поверх
      **существующих** политик (`canSeeOrder`+`teamMode`, `canManagerAccessOrg`,
      `canSeeDocument`, скоуп организации у сотрудника, `partnerId` у партнёра).
- [x] Итоговое право записи = **скоуп карточки ∧ роль ∈ `editableByRoles`**
      (пустой массив ⇒ admin+leader, решение Q1). Ни одно не ослабляет другое.
- [x] `getValuesForEntity` получает **обязательный** `session` и фильтрует по
      `visibleToRoles` на сервере (скрытое поле не должно доезжать до HTML).
      Обязательность аргумента — защита от «молча забыл», как с `teamMode` (§4 CLAUDE.md).
- [x] Новые коды ошибок добавить в `errorMessageRu`.

### 5. Тесты

- [x] Unit: таблица «тип × значение → валидно/нет» на все 12 типов, включая
      границы (`money` с тремя знаками, `multiselect` с дублем, `url` с
      `javascript:`, пустая строка = очистка).
- [x] Unit: `isReservedKey`; фильтрация по `visibleToRoles` для пяти ролей.
- [x] Integration (живой Postgres): матрица 5 сущностей × 5 ролей на чтение и
      запись; ключевой регресс — **партнёр компании A не пишет в карточку
      организации компании B**.
- [x] Integration: миграционный регресс — «старое» определение заказа правится
      менеджером, «новое» (созданное после) — нет.
- [x] 100 % покрытие новых файлов (§6 CLAUDE.md) — проверено адресным прогоном
      с `--coverage`: `services/customFields/**` = 100 % строк, веток и функций
      (`access.ts`, `coerce.ts`, `definitions.ts`, `entities.ts`, `roles.ts`,
      `systemFields.ts`, `values.ts`).

## Отгрузка

- [x] `npm run typecheck` · `npm run lint` · `npm run test:unit` — зелёные.
- [x] `npm run test:integration` (живой Postgres на :5432) по затронутым файлам.
- [x] CHANGELOG.md.
- [ ] PR с `base: main`; после мержа — проверить, что код реально в `main`
      (`git cat-file -e origin/main:src/lib/services/customFields/coerce.ts`).
- [ ] Обновить STATUS.md (этап 1 → `🔍 PR`, ссылка на PR, запись в журнал).

## Найдено по ходу (факты для следующих PR, не решения)

- **Руководитель без закреплённых организаций не открывает карточку
  организации.** `canManagerAccessOrg` (тот же предикат, что у гарда карточки)
  лидер-инвариант C8 не применяет: при `managerTeamVisibility=OFF` доступ даёт
  только закрепление. Значит, настраиваемые поля организации руководитель по
  факту не отредактирует, хотя §4 ТЗ даёт ему настройку полей. Поведение
  платформы этапом НЕ менялось (это было бы изменение политики доступа сверх
  §11) — зафиксировано регрессом в `services.customFields.access.integration`.
  Решение — вопрос заказчику перед PR-3.
- **Секция полей на карточке заказа пока получает общий флаг `editable`**, а не
  флаг каждого поля: per-field `definition.editable` уже приходит с сервера, но
  UI переключится на него в PR-3 вместе с остальными карточками. На боевых
  данных расхождения нет — у существующих полей заказа роли проставлены
  миграцией.
