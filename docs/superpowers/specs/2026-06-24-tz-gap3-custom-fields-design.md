# Spec: Настраиваемые поля (gap #3)

**Дата:** 2026-06-24
**Источник:** ТЗ «Личный кабинет Промтехносфера» v0.4 — §11
**Статус:** design (autonomous goal-run); решения зафиксированы, ассумпции помечены, ждут review.
**Память:** [[project-tz-v04-gap-program-2026-06-23]] gap #3.

## 1. Проблема и контекст

§11 ТЗ: администратор может заводить **настраиваемые (дополнительные) поля**. Модели `CustomField`
в схеме нет — расширить заказ/сущность произвольным полем сейчас нельзя.

**ASSUMPTION (целевая сущность):** ТЗ-документа нет в репо; из памяти gap-программы §11 =
«настраиваемые поля» без указания носителя. Для v1 целевая сущность — **`Order`** (ядро
операционного учёта; именно там бизнесу нужны доп-атрибуты заявки). Модель полиморфна
(`entityType`) — добавление другой сущности позже = расширение enum + одна точка рендера.
Подтвердить целевые сущности на review.

Паттерн-референс: справочник `TrainingDirection` (admin CRUD reference list, sub-project #1) —
[directions-admin.tsx](src/components/training/directions-admin.tsx) + [api/admin/training-directions](src/app/api/admin/training-directions) +
[admin/training-directions/page.tsx](src/app/admin/training-directions/page.tsx). Gap #3 зеркалит этот паттерн для
определений полей.

## 2. Решения (зафиксированы)

1. **Две модели**: `CustomFieldDefinition` (что за поле — конфигурит admin) + `CustomFieldValue`
   (значение поля у конкретной записи). Значения в отдельной таблице (не JSON на `Order`) —
   чисто, расширяемо, не мешает узким селектам заказа.
2. **Полиморфизм** через `entityType` (String, v1 = `'order'`) + `entityId`. Без FK на носитель
   (цена расширяемости; целостность value↔entity держим на уровне сервиса).
3. **Типы поля** (enum): `text | number | date | select | boolean`. Значение хранится строкой
   (`value String?`), сериализация/парс по `fieldType` в сервисе/UI.
4. **Конфиг — admin-only** (как `TrainingDirection`). Использованное поле **деактивируется**, не
   удаляется (сохранность значений).
5. **Значения** — редактирует тот, кто редактирует заказ (manager/admin/leader); видит тот, кто
   видит заказ (scoped, реюз order-резолвера). org/partner — read-only.
6. **Graceful**: нет активных определений → секция «Дополнительные поля» не рендерится. Не
   feature-flag (как и `TrainingDirection`).

## 3. Модель данных

```prisma
enum CustomFieldType {
  text
  number
  date
  select
  boolean
}

model CustomFieldDefinition {
  id         String          @id @default(cuid())
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
  entityType String          // v1: 'order'
  key        String          // машинный ключ (a-z0-9_), стабилен
  label      String          // отображаемое имя (RU)
  fieldType  CustomFieldType
  options    String[]        // для select; иначе пусто
  required   Boolean         @default(false)
  sortOrder  Int             @default(0)
  isActive   Boolean         @default(true)
  values     CustomFieldValue[]

  @@unique([entityType, key])
  @@index([entityType, isActive, sortOrder])
}

model CustomFieldValue {
  id           String                @id @default(cuid())
  createdAt    DateTime              @default(now())
  updatedAt    DateTime              @updatedAt
  definitionId String
  definition   CustomFieldDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)
  entityType   String
  entityId     String
  value        String?               // сериализованное значение по fieldType

  @@unique([definitionId, entityId])
  @@index([entityType, entityId])
}
```
Миграция аддитивна (две новые таблицы + enum). DB-state gotcha (ветка от main): пересоздать
dev-БД перед `migrate deploy` (как в gap #2).

## 4. Сервисы (`src/lib/services/customFields/**`, Result §3)

- **`definitions.ts`** (admin): `listDefinitions(entityType?)`, `createDefinition`,
  `updateDefinition`, `deactivateDefinition`. Право мутаций — admin (page+route+service-чек роли).
  Валидации: `key` уникален per `entityType` (`duplicate_key`), `key`-формат, `select` требует
  непустые `options` (`options_required`), `not_found`, `forbidden`.
- **`values.ts`**: `getValuesForEntity(prisma, session, entityType, entityId)` — отдаёт активные
  определения + текущие значения (scoped: вызывается из уже-авторизованного order-контекста);
  `setValues(prisma, session, entityType, entityId, Record<defId,value>)` — апсертит значения
  (`@@unique([definitionId, entityId])`), проверяет право редактирования заказа (реюз
  `canSeeOrder`/manager-scope + роль manager/admin/leader), валидирует значение по `fieldType`
  (число/дата/опция из `options`/boolean) → `invalid_value`. org/partner → `forbidden` на запись.
Барель `customFields/index.ts`.

## 5. UI

- **Admin-справочник** `/admin/custom-fields` — зеркало `DirectionsAdmin`: таблица определений
  (label · key · тип · обязательное · активно), Dialog add/edit (label/key/тип/опции для select/
  required/sortOrder), деактивация. Routes `/api/admin/custom-fields[/[id]]` (тонкие). Пункт в
  admin-nav.
- **Карточка заказа** (manager/admin/leader edit; org/partner read-only): секция «Дополнительные
  поля» — рендер по `fieldType` (text→Input, number→Input[number], date→date, select→Select,
  boolean→checkbox). Подмешивается в `loadManagerOrderDetail` (+ org/partner order-detail read
  paths — отдельные секции read-only). Сохранение — server-action `setValues`.
- Только `ui/`-примитивы, `errorMessageRu`, без инлайн-hex.

## 6. RBAC / безопасность

- Определения — admin-only (defense-in-depth: `/admin` middleware + page-гард + сервис-чек роли).
- Значения — видимость и запись наследуют scope заказа (manager `managedOrgIds`+`teamMode`,
  org/partner свои; org/partner запись запрещена). Cross-company/cross-partner изоляция через
  тот же order-резолвер. Запись значения требует доступа к конкретному `entityId` (нельзя писать
  значения чужому заказу).
- Значения валидируются по `fieldType` (нет инъекции произвольных типов).

## 7. Тесты (§6)

- **Unit**: валидаторы значений по типу (число/дата/select-опция/boolean → `invalid_value`);
  `duplicate_key`/`options_required`; deny не-admin на определения; deny org/partner на запись
  значений.
- **Integration** (живой PG): CRUD определений; апсерт значений (idempotent по
  `@@unique([definitionId,entityId])`); scope — чужой заказ не отдаёт/не пишет значения.
- **Coverage**: новые logic-файлы под порог 100% (§6 фаза 1) — `customFields/**`, routes.

## 8. Вне объёма (явно)

- Носители кроме `Order` (v1 = order; расширение = enum + точка рендера).
- Условная видимость полей, формулы, межполевые зависимости.
- Историзация значений (только текущее значение).
- Экспорт доп-полей в 1С/комиссии.

## 9. Критерии приёмки

1. Admin создаёт доп-поле (text/number/date/select/boolean) для заказа; `select` требует опции;
   дубль `key` отклоняется; использованное поле деактивируется, не удаляется.
2. В карточке заказа manager видит и редактирует доп-поля; org/partner видят read-only; значение
   валидируется по типу.
3. Менеджер не может писать/читать значения чужого (вне scope) заказа.
4. Нет активных определений → секция не рендерится; фича без feature-flag.
5. Все гейты зелёные (typecheck/lint/unit/integration).
