# Track G3 + G4 (P2) — внутренние задачи/канбан + CRM-карточка организации — design

**Дата:** 2026-07-03
**Источник:** внешний промт `ClaudeCode_prompt_трек_G3_G4.md` + ТЗ Разработчик v0.5 (§13.3, §15, §21) + ТЗ ЛК Промтехносфера v0.6 (§9, §15, §17).
**Предпосылка:** строится поверх G1 (`AccessProfile` — конструктор ролей) и G2 (`FunnelStage` — воронка/канбан лидов, PR #178). G2-паттерны переиспользуются буквально.
**Scope:** G3 — внутренние задачи как данные + канбан с настраиваемыми колонками (только сотрудники: admin/leader/manager). G4 — карточка организации-накопитель (заявки/документы/оплаты/переписка), видимая только внутри компании.

---

## 1. Проблема и цель

- **G3.** Постановка задач сейчас живёт в Битриксе. Нужен внутренний канбан задач с настраиваемыми колонками, привязкой к заявке/организации, исполнителями и сроком. Клиентский контур (partner/organization/student) не нагружаем — задачи строго внутренние (как order-`Comment`).
- **G4.** История по организации размазана по разным экранам. Нужна единая карточка-накопитель: заявки, документы, оплаты, переписка, реквизиты — в одном месте, видно только внутри компании (admin/leader/manager по scope). Клиент видит только своё (как сейчас).

**Инвариант (регресс-контракт, повторяется в plan и close-out):** флаг `internal_tasks` выключен → ни одного нового пути (middleware 404, nav скрыт, роутов нет); существующие тесты зелёные без изменений (кроме inventory-тестов nav/sidebar/featureFlags). G4 — только чтение поверх существующих scope-фильтров; новых enforcement-послаблений нет; company-floor (C8) держится в обоих teamMode.

---

## 2. Ключевые находки (карта кода — что переиспользуем)

| Потребность G3/G4 | Эталон G1/G2 | Как переиспользуем |
|---|---|---|
| Словарь настраиваемых колонок | `model FunnelStage` (`@@unique([companyId,position])`, `statusAnchor`) | `TaskColumn` зеркалит 1:1, якорь — новый enum `TaskStatus` |
| Defaults-как-константа + резолвер | `src/lib/funnel/stages.ts` (`DEFAULT_FUNNEL_STAGES`, `resolveFunnelStages`, `stageForLead`) | `src/lib/tasks/columns.ts` (`DEFAULT_TASK_COLUMNS`, `resolveTaskColumns`, `columnForTask`) |
| Доска (группировка по колонкам) | `getFunnelBoard` | `listTaskBoard` — та же группировка, БЕЗ lifecycle-диспетчера |
| Move карточки | `moveFunnelLead` (dispatcher-over-lifecycle) | `moveTask` — **проще**: смена колонки = смена `status`+`columnId`; done-колонка → `completedAt` |
| CRUD словаря (роль-гейт, audit, position_taken) | `src/lib/services/access/funnelStages.ts` | `src/lib/services/tasks/columns.ts` — клонируется целиком |
| Per-manager охват | `leadWhereForLevel`/`canSeeLead` + `AccessProfile.leadsScope` | `taskWhereForLevel`/`canSeeTask` + `AccessProfile.tasksScope` (task **есть** companyId → company-floor как у orders) |
| Канбан-UI (HTML5 DnD) | `src/components/funnel/funnel-board.tsx` | `src/components/tasks/task-board.tsx` |
| Конфиг-панель словаря | `src/components/funnel/stage-config.tsx` | `src/components/tasks/column-config.tsx` |
| Флаг в 3 точках | `sales_funnel` (opt-in) | `internal_tasks` (opt-in), префиксы `/manager/tasks` + `/leader/tasks` |
| Тонкий server-action | `src/server-actions/funnel/index.ts` | `src/server-actions/tasks/index.ts` |
| Org-деталь → CRM-карточка | `getOrganization` (manager) + `/manager/organizations/[id]/page.tsx` | расширяем в табы; аггрегат-сервис `getOrganizationCard` |
| Audit-сущность | `AuditEntity` union | добавить `'task'`, `'task_column'` |

---

## 3. Модель данных (G3)

Новый enum-якорь + словарь колонок + задача + join-таблица исполнителей. Всё аддитивно/обратимо, company-scoped (граница изоляции C8).

```prisma
enum TaskStatus {
  todo
  in_progress
  review
  done
}

enum TaskPriority {
  low
  medium
  high
}

/// Трек G3 (§21): настраиваемые колонки канбана задач — словарь поверх enum-якорей
/// TaskStatus. Company-scoped (руководитель конфигурирует). Пустой набор → DEFAULT_TASK_COLUMNS.
model TaskColumn {
  id           String     @id @default(cuid())
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  companyId    String
  company      Company    @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name         String
  position     Int
  statusAnchor TaskStatus
  color        String?
  isDoneColumn Boolean    @default(false)
  tasks        Task[]     @relation("TaskColumnTasks")

  @@unique([companyId, position])
  @@index([companyId])
}

/// Трек G3 (§21, §13.3): внутренняя задача. Company-scoped (hard FK). Колонка — soft-link
/// (SetNull: удаление колонки не удаляет задачу; статус re-derive из status-якоря). Привязки
/// к заявке/организации — nullable SetNull.
model Task {
  id                   String         @id @default(cuid())
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt
  companyId            String
  company              Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  title                String
  description          String?
  status               TaskStatus     @default(todo)
  priority             TaskPriority?
  columnId             String?
  column               TaskColumn?    @relation("TaskColumnTasks", fields: [columnId], references: [id], onDelete: SetNull)
  dueDate              DateTime?
  completedAt          DateTime?
  createdById          String
  createdBy            User           @relation("TaskCreatedBy", fields: [createdById], references: [id])
  linkedOrderId        String?
  linkedOrder          Order?         @relation("TaskLinkedOrder", fields: [linkedOrderId], references: [id], onDelete: SetNull)
  linkedOrganizationId String?
  linkedOrganization   Organization?  @relation("TaskLinkedOrganization", fields: [linkedOrganizationId], references: [id], onDelete: SetNull)
  assignees            TaskAssignee[]

  @@index([companyId, status])
  @@index([companyId, createdAt])
  @@index([linkedOrderId])
  @@index([linkedOrganizationId])
}

/// M:N исполнители задачи (идиома репозитория — OrganizationUser/PartnerUser).
model TaskAssignee {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  taskId     String
  task       Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  userId     String
  user       User     @relation("TaskAssignee", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([taskId, userId])
  @@index([userId])
}
```

Back-relations: `Company.tasks Task[]` + `Company.taskColumns TaskColumn[]`; `User.tasksCreated Task[] @relation("TaskCreatedBy")` + `User.taskAssignments TaskAssignee[] @relation("TaskAssignee")`; `Order.tasks Task[] @relation("TaskLinkedOrder")`; `Organization.tasks Task[] @relation("TaskLinkedOrganization")`.

**Почему `status` enum + `columnId?`, а не только `columnId`:** дефолтные колонки — код-константа (нет строк). Задача в дефолтной колонке хранит `columnId=null`, а её колонка re-derive из `status` (как `Lead.status`→стадия). Кастомная колонка → `columnId=<cuid>`. Без enum-якоря нельзя различить 4 дефолтные колонки при `columnId=null`.

**AccessProfile.tasksScope** (per-manager охват задач, рецепт «как добавляли leads», 9 точек): `tasksScope ScopeLevel @default(all)` на `AccessProfile`.

---

## 4. Библиотека колонок + резолвинг (G3)

`src/lib/tasks/columns.ts` — зеркало `funnel/stages.ts`:

```ts
export type TaskColumnView = { id: string; name: string; position: number; statusAnchor: TaskStatus; isDoneColumn: boolean; color: string | null };
export const DEFAULT_TASK_COLUMNS: readonly TaskColumnView[] = [
  { id: 'default:todo',        name: 'К выполнению', position: 0, statusAnchor: 'todo',        isDoneColumn: false, color: null },
  { id: 'default:in_progress', name: 'В работе',     position: 1, statusAnchor: 'in_progress', isDoneColumn: false, color: null },
  { id: 'default:review',      name: 'На проверке',  position: 2, statusAnchor: 'review',      isDoneColumn: false, color: null },
  { id: 'default:done',        name: 'Готово',       position: 3, statusAnchor: 'done',        isDoneColumn: true,  color: null }
];
resolveTaskColumns(prisma, companyId): Promise<TaskColumnView[]>  // custom-or-defaults, all-or-nothing
columnForTask(columns, task: { status; columnId }): TaskColumnView | undefined  // explicit columnId, иначе первая с statusAnchor===status
```

---

## 5. Сервисы (G3, Result-контракт §3)

`src/lib/services/tasks/board.ts`:
- `listTaskBoard(prisma, session): Promise<TaskBoard>` — читает `resolveTaskColumns` + `task.findMany({ where: taskWhereForLevel(session, profile.tasks) ?? companyFloor, include: assignees+links, take: 500 })`, группирует в колонки через `columnForTask`. Read без Result-обёртки (как `getFunnelBoard`).
- `moveTask(prisma, session, { taskId, toColumnId }): Promise<{ ok } | { ok:false; error }>` — `error: 'not_found'|'forbidden'|'invalid_column'`. Гейт companyId→forbidden; target по `resolveTaskColumns`; load task + `canSeeTask` (scope-miss → `not_found`, не leak-аем); persist `columnId = startsWith('default:')?null:toColumnId`, `status = target.statusAnchor`, `completedAt = target.isDoneColumn ? now : null`; audit `task_moved`.

`src/lib/services/tasks/tasks.ts` (CRUD задач):
- `createTask` / `updateTask` / `deleteTask` / `assignTask` — Result-контракт, company-scoped (createdById=session.sub, companyId=gate), IDOR-чек по companyId (→not_found), Zod-валидация (→validation), audit в $transaction. `assignTask` синхронизирует `TaskAssignee` (set-разница). Привязки `linkedOrderId`/`linkedOrganizationId` валидируются на принадлежность компании (иначе validation).
- Роль-гейт создания/редактирования: любой сотрудник (admin|manager) в своей компании; удаление колонок — только admin|leader.

`src/lib/services/tasks/columns.ts` (CRUD колонок) — клон `access/funnelStages.ts`: `listTaskColumns/createTaskColumn/updateTaskColumn/deleteTaskColumn`, роль-гейт admin|leader, `position_taken` на unique, audit `task_column_*`.

`src/lib/auth/accessProfile.ts`: `taskWhereForLevel(session, level)` (company-floor как `orderWhereForLevel`): all→`{companyId}`; own→`AND[floor, OR[createdById=sub, assignees.some.userId=sub]]`; assigned→`AND[floor, OR[createdById=sub, assignees.some.userId=sub, linkedOrganizationId in managedOrgIds]]`. `canSeeTask(session, task)` — in-memory зеркало.

---

## 6. Флаг + gate (G3)

`internal_tasks` — **opt-in** (default disabled), env `FEATURE_INTERNAL_TASKS`. 3 точки (+4-я для API если появится):
1. `featureFlags.ts`: в `FEATURE_FLAGS` + в `OPT_IN_FLAGS`.
2. `middleware.ts` `FEATURE_PREFIXES`: `{prefix:'/manager/tasks',flag:'internal_tasks'}`, `{prefix:'/leader/tasks',flag:'internal_tasks'}`.
3. `navigation/cabinet.ts`: nav-item `{href:'/manager/tasks', label:'Задачи', icon:'✅', flag:'internal_tasks'}` в `navByRole.manager` и `.leader`.

Роль-гейт страниц: middleware `protectedPrefixes` (`/manager`→manager, `/leader`→leader-eligible) уже покрывает; page-guard `requireManager()`/`requireManagerLeader()` + service-scope.

---

## 7. UI (G3)

- `src/components/tasks/task-board.tsx` — клиентский канбан (HTML5 DnD), клон `funnel-board.tsx`, но БЕЗ reason-диалога (move не требует причины). На drop → `moveTaskAction`.
- `src/components/tasks/task-dialog.tsx` — create/edit задачи (title, description, priority, dueDate, исполнители — multi-select, привязка order/organization). Dialog-примитив.
- `src/components/tasks/column-config.tsx` — клон `stage-config.tsx` (CRUD колонок, leader).
- Страницы: `/manager/tasks/page.tsx` (доска), `/leader/tasks/page.tsx` (доска + конфиг колонок). Loading/empty/error на секциях.
- Server-action: `src/server-actions/tasks/index.ts` — `moveTaskAction`, `createTaskAction`, `updateTaskAction`, `deleteTaskAction`, `assignTaskAction`, `create/update/deleteTaskColumnAction`; `revalidatePath('/manager/tasks','/leader/tasks')`.

---

## 8. G4 — CRM-карточка организации

**Новых моделей нет** — только чтение/агрегация. Возможны индексы (уже есть `[companyId,*]` на Order).

- `src/lib/services/manager/organizationCard.ts`: `getOrganizationCard(prisma, session, orgId): Promise<OrganizationCard | null>`. Внутри:
  1. `requireManagerForOrg`-эквивалент scope-чек in-process (teamMode-aware) → foreign org → `null` (не leak).
  2. `Promise.all`: header (`getOrganization`), заявки (`listOrders({organizationId})`), документы (org-filter), оплаты+KPI (`getManagerFinanceOverview` секция orgId, комиссия по `can(see_commission)`), переписка (треды/комментарии org-filter), реквизиты (узкий DTO — БЕЗ комиссии/себестоимости для менеджера).
  3. Возврат **узкого DTO** (не raw Prisma-объект — иначе finance-скаляры утекут в RSC-payload).
- Org-filter добавляем в `listDocuments`/`listIncomingComments` (Zod `organizationId?` + where `order.organizationId`).
- Страница `/manager/organizations/[id]/page.tsx` → табы (История · Заявки · Документы · Оплаты · Переписка · Реквизиты). Табы через query-param (`?tab=`), НЕ второй динамический сегмент рядом с `[id]` (Next.js упадёт — §11).
- Комиссия скрыта в менеджерском контуре service-layer field-gating (`commission: null` без `see_commission`).

---

## 9. Тестовая стратегия

**Unit (без Postgres):**
- `tasks.columns.unit.test.ts` — `DEFAULT_TASK_COLUMNS`, `columnForTask` (explicit/anchor/undefined).
- `accessProfile.tasks.unit.test.ts` — `taskWhereForLevel`/`canSeeTask` (own/assigned/all + company-floor + NO_COMPANY_SENTINEL).
- `server-actions.tasks.test.ts` — vi.hoisted+vi.mock, тонкий адаптер (передаёт `{}, SESSION, args` + revalidatePath).
- `featureFlags` — generic (флаг сам подхватывается); inventory-тесты nav/sidebar адаптируем.

**Integration (live Postgres):**
- `services.tasks.board.integration.test.ts` — группировка, move (в т.ч. done→completedAt), scope-изоляция, error-коды.
- `services.tasks.columns.integration.test.ts` — CRUD, position_taken, IDOR→not_found.
- `services.tasks.isolation.test.ts` — **контракт §4:** задачи не доступны клиентским ролям (нет service-пути; canSeeTask deny для partner/organization/student) + cross-company companyA/companyB → not_found.
- `services.organizationCard.integration.test.ts` (G4) — агрегация; IDOR (чужая орг→null); комиссия=null в менеджерском контуре; C8 оба режима.

**Coverage:** `src/lib/**`(не `.tsx`)/`server-actions/**`/`app/api/**` под 100%-порогом (фаза 1) — TDD, не понижаем.

---

## 10. PR-split

- **PR-1 (backend, TDD-able сейчас):** G3 схема+миграция, `tasks/columns.ts`, task-сервисы (board/CRUD/move/assign/columns), `AccessProfile.tasksScope` (9 точек), audit-сущности, флаг `internal_tasks` (3 точки), unit+integration тесты, isolation-контракт. Регресс зелёный.
- **PR-2 (G3 UI):** task-board/task-dialog/column-config, страницы manager/leader, nav, inventory-тесты.
- **PR-3 (G4):** `getOrganizationCard` + org-filters, табовая страница, тесты (IDOR/commission/C8).

Реализация — в одной ветке, коммиты по под-задачам (как G2), теги `[G3.x]`/`[G4.x]`.

---

## 11. Открытые вопросы / вне scope

- **Admin-страница `/admin/tasks`** — вне scope этой итерации (Model A зеркало можно добавить позже; сервисный `canManage` уже пускает admin). Отмечается в close-out.
- **G3.5 уведомления** (назначение/срок) — фаза 2 (опц. по промту). Сервисы оставляют точку расширения; фан-аут не блокирует основной путь.
- **Пагинация доски** — `take:500` cap как у funnel; per-column paging вне scope.
- **Приоритет как enum vs строка** — выбран enum `TaskPriority` (nullable), аддитивно.
- Каждый открытый вопрос фиксирует резолюцию в close-out.
