# Spec: Позиции заявки (слушатели) + удостоверения + напоминания о сроке

**Дата:** 2026-06-23
**Источник:** ТЗ «Личный кабинет Промтехносфера» v0.4 — §10, §12, §15.4, §15.6, §19, §20.19
**Статус:** design approved (brainstorming), ожидает review перед planning

## 1. Проблема и контекст

ТЗ §15.6 строит модель «одна заявка → несколько обучаемых сотрудников, у каждого своё
направление, свой статус обучения и своё итоговое удостоверение». В текущей схеме
`Order` плоский и **не знает про слушателей**, а `Student` висит на уровне
организации (ростер сотрудников), не связан с заказом. Отсутствует и сущность
«Удостоверение» (§12) со сроком действия и напоминаниями 90/60/30/7.

В коде уже есть три «человекоподобных» сущности, которые **не нужно путать**:

- `Student` — сотрудник организации (ФИО/email/org). = ТЗ §15.4 «Сотрудник организации».
- `EnrollmentRequest` — заявка на обучение (свободный intake, ревью → ручной провижн
  в СДО). **Не связан с заказом**, остаётся отдельным каналом. Не трогаем.
- `Order` — сделка. Сейчас без слушателей.

Этот spec добавляет **отсутствующее звено** `Order ↔ Student` (позиция заявки) и
карточку удостоверения поверх него. Ничего из перечисленного не переписывается.

## 2. Решения brainstorming (зафиксированы)

1. **Обучаемый сотрудник** — переиспользуем `Student` (а не новый `Employee` и не
   снимок). Удостоверения накапливаются по одному человеку между заказами (§12).
2. **Направление обучения** — справочник `TrainingDirection` (а не строка). Закрывает
   §19 «расширяемый список».
3. **Объём итерации** — всё кладом, включая воркер-крон напоминаний 90/60/30/7 (§12,
   критерий §20.19).
4. **Кто заводит слушателей** — manager/admin/leader редактируют; partner/org только
   читают свои заказы (§4 «изменять рабочий статус» — менеджер+).
5. **Где живут удостоверения** — и карточка сотрудника (накопитель истории), и ссылка
   в карточке заказа.

## 3. Модель данных

### 3.1. Новые модели

```prisma
model TrainingDirection {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  name      String
  slug      String?  @unique
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  orderItems   OrderItem[]
  certificates Certificate[]

  @@index([isActive, sortOrder])
}

enum TrainingStatus {
  pending           // ожидает
  in_progress       // обучается
  certificate_issued// удостоверение выдано
  cancelled
}

model OrderItem {
  id             String          @id @default(cuid())
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  orderId        String
  order          Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  studentId      String
  student        Student         @relation(fields: [studentId], references: [id])
  directionId    String
  direction      TrainingDirection @relation(fields: [directionId], references: [id])
  trainingStatus TrainingStatus  @default(pending)
  note           String?
  certificate    Certificate?    // итоговое удостоверение по позиции (1:1, опционально)

  @@unique([orderId, studentId, directionId])
  @@index([orderId])
  @@index([studentId])
}

model Certificate {
  id             String            @id @default(cuid())
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  studentId      String
  student        Student           @relation(fields: [studentId], references: [id])
  organizationId String            // денормализация для scope-выборок и cross-org изоляции
  organization   Organization      @relation(fields: [organizationId], references: [id])
  directionId    String
  direction      TrainingDirection @relation(fields: [directionId], references: [id])
  orderItemId    String?           @unique
  orderItem      OrderItem?        @relation(fields: [orderItemId], references: [id])
  number         String
  issuedAt       DateTime
  validUntil     DateTime?         // вводится вручную (§12); null = бессрочно/неизвестно
  documentId     String?           // ссылка на скан в Document (опционально)
  source         GenerationSource  @default(user)
  comment        String?
  reminders      CertificateReminder[]

  @@index([studentId])
  @@index([organizationId])
  @@index([validUntil])
}

model CertificateReminder {
  id            String      @id @default(cuid())
  createdAt     DateTime    @default(now())
  certificateId String
  certificate   Certificate @relation(fields: [certificateId], references: [id], onDelete: Cascade)
  thresholdDays Int         // 90 | 60 | 30 | 7
  sentAt        DateTime    @default(now())

  @@unique([certificateId, thresholdDays])
}
```

### 3.2. Изменения существующих моделей

- **`Student`**:
  - `email`: снять глобальный `@unique`, заменить на `@@unique([organizationId, email])`
    (сотрудник принадлежит одной организации; глобальная уникальность ошибочна).
  - добавить `status String @default("active")` (§15.4 «статус карточки»).
  - relation: `orderItems OrderItem[]`, `certificates Certificate[]`.
- **`Order`**: relation `items OrderItem[]`.
- **`Organization`**: relation `certificates Certificate[]`.

### 3.3. Миграция

Одна миграция: новые таблицы/enum + alter `Student`. Перед применением — pre-check на
дубли `(organizationId, email)` в существующих данных (в demo/seed дублей нет;
прод-проверка — пункт runbook). Старый глобальный unique-индекс на `Student.email`
дропается, новый составной создаётся.

## 4. Сервисы (`src/lib/services/training/**`)

Все функции — контракт §3: `(prisma, session, args) => Promise<{ ok:true, … } | { ok:false, error }>`.

- **`directions.ts`** — `listDirections`, `createDirection`, `updateDirection`,
  `deactivateDirection`. Право мутаций: admin/leader (§10/§11). Деактивация вместо
  удаления использованного направления.
- **`orderItems.ts`** — `listOrderItems(orderId)`, `addOrderItem`, `updateItemStatus`,
  `removeOrderItem`. Мутации: manager/admin/leader; чтение scoped как заказ. Валидации:
  `direction_inactive`, `duplicate_position` (нарушение `@@unique`), `not_found`,
  `forbidden`. Реюз существующего scope-резолвера заказа (`canSeeOrder`/`getOrder`).
- **`certificates.ts`** — `listCertificates` (по сотруднику / истекающие),
  `createCertificate`, `updateCertificate`, `issueFromOrderItem` (создаёт удостоверение
  по позиции и переводит `trainingStatus → certificate_issued` в одной транзакции).
  Видимость scoped: manager по `managedOrgIds`+`teamMode`, partner по своим орг., org по
  своим. Cross-org/cross-partner изоляция.
- **`expiry.ts`** — `selectDueReminders(certs, today)` — **чистая** функция: на вход
  список удостоверений с `validUntil` + уже отправленные пороги, на выход — пары
  `(certificateId, thresholdDays)`, которые надо отправить сегодня. Тестируется в
  изоляции (по паттерну commission-calc). Пороги: `[90, 60, 30, 7]`.

Барель `src/lib/services/training/index.ts` экспортирует публичные функции.

## 5. Воркер: напоминания о сроке удостоверения

- **Очередь**: добавить `notifications.certificateExpiry` в `QUEUE_NAMES`
  ([queues.ts](src/lib/jobs/queues.ts)).
- **Расписание**: `CERT_EXPIRY_SCHEDULES` в [scheduling.ts](src/lib/jobs/scheduling.ts),
  паттерн `0 7 * * *`, tz `Europe/Moscow`. Регистрируется в bootstrap воркера рядом с
  `registerAlertSchedules`/`registerCommissionSchedules`.
- **Процессор** (`src/worker/processors/certificateExpiry.ts`):
  1. Выбрать удостоверения с `validUntil != null`, попадающие в окна порогов.
  2. Через `selectDueReminders` отфильтровать уже отправленные (join `CertificateReminder`).
  3. Для каждой пары — fan-out получателям (§12): пользователи организации → партнёр
     (если организация через него) → ответственный менеджер заказа → руководитель.
     Канал: `createNotification` (ЛК) + `triggerNotificationEmail` (e-mail) из
     [notifications/core.ts](src/lib/notifications/core.ts).
  4. Записать `CertificateReminder` (idempotent через `@@unique`) — повторный прогон не
     дублирует.
- **Guardrail** (§6): добавить процессор в
  [worker.processor-coverage.guardrail.test.ts](src/__tests__/worker.processor-coverage.guardrail.test.ts)
  с соответствующим интеграционным тестом.
- Новый `NotificationType`: `certificate_expiring` (добавить в enum / тип строки).

**Канал Telegram** — вне объёма (отдельный пробел ТЗ §18). Когда он будет сделан, он
подключится автоматически, т.к. использует тот же fan-out-хук.

## 6. UI (русский, sibling-паттерн §4)

- **Карточка заказа** (manager / organization / partner): секция «Слушатели» — таблица
  (ФИО · направление · статус обучения · удостоверение). Подмешивается в
  `loadManagerOrderDetail` и org/partner-аналоги (отдельные read-пути).
  - manager: кнопка «Добавить слушателя» → `Dialog`-модалка (выбор `Student` из ростера
    орг. + `TrainingDirection`); смена статуса; «Выдать удостоверение».
  - partner/org: read-only.
- **Удостоверения сотрудника**: список карточек на странице сотрудника + бейдж срока
  (`ui/Badge`: «истекает через N дн.» / «просрочено»). Создание/правка — manager/admin.
- **Справочник направлений**: страница в `/admin` (admin/leader) — список, создание,
  деактивация, порядок.
- Только примитивы `ui/`, строки ошибок через `errorMessageRu`, без инлайн-hex (§13).

## 7. RBAC / безопасность (§4, §16)

Defense-in-depth в трёх местах, scoped идентично orders/students:

1. **Middleware** — префиксы `/manager` `/partner` `/organization` `/admin` уже есть.
2. **Page/route** — `requireRole`/`requireManager`/`requirePartner`/`requireOrganization`
   + `canSee*`-чек на странице.
3. **Service** — scope-фильтр: manager → `managedOrgIds`+`teamMode`, partner → свои орг.,
   org → свои; `Certificate.organizationId` обеспечивает прямую фильтрацию. Cross-company
   (C8) и cross-partner изоляция сохраняются.

Комиссия **не затрагивается**: обучение — операционные данные, менеджер их видит (§5.1).

## 8. Тесты (§6)

- **Unit**: `expiry.selectDueReminders` (пороги, идемпотентность, граничные даты);
  scope/deny-all для `orderItems`/`certificates`; `duplicate_position`/`direction_inactive`.
- **Integration** (живой PG): cross-org isolation invariant для позиций и удостоверений
  (чужой заказ/сотрудник не виден); reminder dedup (двойной прогон процессора →
  один `CertificateReminder`); processor-coverage guardrail.
- **Coverage**: новые logic-файлы под порогом 100% (§6, фаза 1) — `services/training/**`,
  `worker/processors/certificateExpiry.ts`, `expiry.ts`.

## 9. Вне объёма (явно)

- Telegram-канал для напоминаний (отдельный пробел §18; пока ЛК + e-mail).
- Настраиваемый справочник статусов обучения (`trainingStatus` тут — фикс-enum; §10 —
  отдельный пробел).
- Авто-получение сроков из внешней СДО (§12 — не v1).
- 6-стадийный «рабочий статус» заказа (§10) — отдельное расхождение, не в этом spec.

## 10. Критерии приёмки (этого spec)

1. В заказе можно добавить нескольких слушателей (ФИО + направление), у каждого свой
   статус обучения; дубль (заказ+сотрудник+направление) отклоняется.
2. Удостоверение создаётся с ручной `validUntil`; «Выдать удостоверение» из позиции
   переводит статус слушателя в «удостоверение выдано».
3. Воркер-крон формирует напоминания за 90/60/30/7 дней получателям §12; повторный
   прогон не дублирует (критерий ТЗ §20.19).
4. Менеджер видит слушателей и удостоверения своих организаций, но не видит чужие
   (cross-org/cross-partner изоляция, серверная проверка).
5. Справочник направлений редактируют только admin/leader; использованное направление
   деактивируется, не удаляется.
