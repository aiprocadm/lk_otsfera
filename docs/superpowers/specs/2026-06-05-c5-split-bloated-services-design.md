# Arch-debt C5: распил раздутых сервисов — design

**Дата:** 2026-06-05 · **Статус:** согласовано (объём = все три файла, выбор пользователя) · **Трек:** C / **C5** из [completion-roadmap](2026-06-02-completion-roadmap.md) · **Тип:** прямой рефактор, **поведение неизменно**.

Предшественники на фундаменте: [C3 dashboard-types](2026-05-31-arch-debt-dashboard-types-design.md) (PR #90), [C4 Result-contract](2026-06-05-arch-debt-result-contract-design.md) (PR #91). C5 — третья «быстрая внутренняя победа», чистит фундамент перед чатом.

---

## 1. Цель и не-цели

**Цель.** Разбить три раздутых модуля на сфокусированные под-модули, сохранив **байт-в-байт** публичную поверхность (каждый внешний импорт продолжает работать без изменений) и поведение (те же тесты остаются зелёными — они и есть контракт).

| Файл | Строк (сейчас) | Шов декомпозиции |
|---|---|---|
| `src/lib/notifications.ts` | 693 | по аудитории: `core` / `org` / `manager` (+ `shared`) |
| `src/lib/services/admin/users.ts` | 442 | чтение vs запись: `queries` / `mutations` (+ `errors`) |
| `src/lib/services/manager/dashboard.ts` | 376 | по виджету: `kpis` / `attention` / `events` (+ `constants`) |

**Не-цели (явно вне объёма):**
- Никаких изменений сигнатур, кодов ошибок, статусов, текстов, control-flow. Это **move-only** рефактор.
- Не трогаем ~20 вызывающих (workers, routes, server-actions, компоненты, `chat/messages.ts` и т.д.) — их спасает barrel.
- Не переписываем тесты (они импортят barrel-путь, остаются как есть). Правка теста = сигнал, что поверхность поехала → стоп.
- Не оптимизируем запросы, не «заодно чиним» — строго перенос.

---

## 2. Ключевые решения

1. **Barrel = `<name>/index.ts`** (не «файл рядом с папкой того же имени»). Обосновано конвенцией репозитория: `src/lib/services/oneCSync/` — директория сфокусированных модулей за `index.ts`-barrel; `src/lib/email/templates/index.ts` — второй пример. Совпадений `foo.ts` + `foo/` в репо **нет**. CLAUDE.md §13 — «пиши как окружающий код».
   - `src/lib/notifications.ts` → `src/lib/notifications/index.ts` + соседи.
   - `src/lib/services/admin/users.ts` → `src/lib/services/admin/users/index.ts` + соседи.
   - `src/lib/services/manager/dashboard.ts` → `src/lib/services/manager/dashboard/index.ts` + соседи.
   - Импорт-спецификаторы `@/lib/notifications`, `@/lib/services/admin/users`, `@/lib/services/manager/dashboard` **не меняются** (директория резолвится в `index.ts`).

2. **`notifications` — по аудитории, НЕ по каналу.** Roadmap предполагал «in-app/email/dispatch», но фактический код **переплетает** in-app `notification.create` + email-dispatch в одном цикле (строки 340–371, 661–690). Разрез по каналу разорвал бы control-flow и нёс риск изменения поведения. Собственные разделители файла (`// ----- Organization-side fan-out`, `// ----- Manager-side fan-out`) указывают истинный шов — по аудитории. Это чистый перенос.

3. **Внутренние хелперы остаются приватными в под-модулях.** `getAppBaseUrl`/`orderLabel` (общие для org+manager) → `shared.ts` (экспортированы для соседей, **не** ре-экспортируются barrel'ом). `buildOrgNotification`/`dispatchOrgEmail`/`MANAGER_TEMPLATES`/`computeAttachmentLabel`/`assertNotLastActiveAdmin`/`isAllowedRoleTransition`/константы дашборда — приватны в своих под-модулях. Публичная поверхность barrel'а = ровно сегодняшние `export`-символы (подтверждено grep'ом: снаружи ссылаются только уже-экспортированные `resolveManagerRecipients` и доменные типы).

4. **Atomicity по файлу = один коммит.** Удаление исходного файла без существующего barrel'а ломает `tsc` → pre-commit хук блокирует. Поэтому каждый из трёх распилов — один коммит, содержащий: новые под-модули + `index.ts` + удаление старого файла. Тесты не трогаются.

---

## 3. Декомпозиция по файлам

### 3.1 `notifications/` (по аудитории)

| Под-модуль | Содержимое (перенос) | Экспортирует наружу (через barrel) |
|---|---|---|
| `shared.ts` | `getAppBaseUrl`, `orderLabel` | — (внутренний, импортится `org`+`manager`) |
| `core.ts` | `NotificationInput`(приватн.), `createNotification`, `notifyDocumentCreated`, `notifyStatusChanged`, `notifyMessageCreated`, `triggerNotificationEmail` | 5 функций |
| `org.ts` | `OrgNotifyInput`(приватн.), `buildOrgNotification`(приватн.), `dispatchOrgEmail`(приватн.), `notifyOrgUsers`, `NotifyOrgUsersSummary` | `notifyOrgUsers`, `NotifyOrgUsersSummary` |
| `manager.ts` | `resolveManagerRecipients`, `OrderContext`/`ManagerNotificationOutput`(приватн.), `MANAGER_TEMPLATES`(приватн.), `getManagerOrderUrl`/`metaFromInput`(приватн.), `notifyManagers` + типы `NotifyManagersType/Input/Options/Summary`, `ManagerRecipient` | `notifyManagers`, `resolveManagerRecipients`, 5 типов |
| `index.ts` | `export * from './core'; export * from './org'; export * from './manager';` | barrel |

Граф импортов ацикличен: `core` и `org` и `manager` могут зависеть от `shared`; между собой не зависят (`org`/`manager` создают строки через `db.notification.create`, не через `core.createNotification`).

### 3.2 `services/admin/users/` (чтение vs запись)

| Под-модуль | Содержимое | Экспортирует |
|---|---|---|
| `errors.ts` | `AdminUserErrorCode`, `AdminUserError`(класс), `AdminUserFailure` | все три (внутр. throw-механизм C4, но остаются экспортированы) |
| `queries.ts` | `getUser`, `listUsers`, `computeAttachmentLabel`(приватн.), типы `UserDetail`, `UserRow`, `UserFilters` | `getUser`, `listUsers`, 3 типа |
| `mutations.ts` | `createUser`, `updateUser`, `deactivateUser`, `reactivateUser`, `assertNotLastActiveAdmin`/`isAllowedRoleTransition`/`ALLOWED_TRANSITIONS`(приватн.), типы `CreateUserArgs`, `CreateUserResult`, `UpdateUserArgs` | 4 функции, 3 типа |
| `index.ts` | `export * from './errors'; export * from './queries'; export * from './mutations';` | barrel |

Граф: `mutations` → `queries` (`getUser` в `updateUser` строка 256; тип `UserDetail`) и `mutations` → `errors`. Однонаправленно, без цикла. `queries` не бросает `AdminUserError` → не зависит от `errors`.

### 3.3 `services/manager/dashboard/` (по виджету)

| Под-модуль | Содержимое | Экспортирует |
|---|---|---|
| `constants.ts` | `DAY_MS`/`THIRTY_DAYS_MS`/`FOURTEEN_DAYS_MS`/`THREE_DAYS_MS`/`ONE_DAY_MS`, `ATTENTION_CAP_PER_SOURCE`, `DEFAULT_EVENTS`, `ACTIVE_EXEC`, `TERMINAL_EXEC` | — (внутр., импортятся виджетами) |
| `kpis.ts` | `KpiData`, `kpis` | `KpiData`, `kpis` |
| `attention.ts` | `AttentionItem`, `attention` | `AttentionItem`, `attention` |
| `events.ts` | `EventItem`, `recentEvents` | `EventItem`, `recentEvents` |
| `index.ts` | `export * from './kpis'; export * from './attention'; export * from './events';` | barrel |

Типы `KpiData/AttentionItem/EventItem` импортятся компонентами (после C3) из barrel-пути → `export *` сохраняет. Константы приватны (сегодня не экспортированы — никто снаружи не импортит).

---

## 4. Стратегия верификации (контракт «поведение неизменно»)

База: ветка отрезана от свежего green `main` (3392625, включает C3+C4). Значит до правок всё зелёное по построению.

**Гейт (после каждого файла + финально):**
- `npm run typecheck` — главный страж: barrel должен ре-экспортировать ровно публичную поверхность, иначе ~20 вызывающих не сойдутся по типам.
- `npm run lint` — в т.ч. eslint `no-restricted-imports` guardrail из C3 (services не импортят app/components/server-actions — наш перенос его не нарушает).
- Целевые тесты по затронутому модулю (см. ниже), unit и/или integration.

**Тесты-контракт по модулю (импортят barrel-путь — не трогаются):**

| Модуль | Unit | Integration (`new PrismaClient(`) |
|---|---|---|
| `notifications` | — | `notifications.notifyManagers`, `notifications.notifyOrgUsers`, `notifications.invariant`, `worker.notification-hooks`, `worker.sync-payments.notifies-managers`; + `api.notifications.manager-refactor`, `api.comments.*` |
| `admin/users` | `services.admin.users`, `server-actions.admin.users`, `components.admin-users-table` | — (нет integration; C4 close-out §47) |
| `manager/dashboard` | компонентные (`manager-kpi-grid/events-feed/attention-list`) | `services.manager.dashboard` |

**Финальный гейт (Task 4):** `typecheck` + `lint` + полный `test:unit` (1082) + `test:integration` затронутых (`notif|admin.users|manager.dashboard|comments`) + `next build` + независимое ревью субагентом (перенос полон, поверхность идентична, хелперы не утекли, циклов нет).

**Anti-regression проверки:**
- `rg "from '@/lib/notifications/(core|org|manager|shared)'"` вне самих под-модулей → 0 (никто не лезет мимо barrel).
- `git show --stat` каждого коммита: только добавленные под-модули + barrel + удалённый исходник; **ни одного** изменённого вызывающего/теста (кроме, возможно, doc-правки CLAUDE.md §2).
- Диффом убедиться, что перенесённые тела функций идентичны (нет «заодно» правок).

---

## 5. Риски и крайние случаи

- **`export *` утечка приватных хелперов.** Снято: общие хелперы (`shared.ts`, `constants.ts`) barrel'ом **не** ре-экспортируются; внутри под-модулей хелперы остаются без `export`. `export *` тащит только публичные символы.
- **Тип-в-сигнатуре без экспорта** (`OrgNotifyInput` в `notifyOrgUsers`) — уже так сегодня (тип приватный, функция публичная), TS это допускает; поведение не меняется.
- **Файл+директория того же имени** — исключено выбором `index.ts`-barrel (решение №1).
- **CLAUDE.md §2** ссылается на `src/lib/notifications.ts` как модуль — после распила это директория. Обновить строку §2 (импорт-спецификатор тот же, меняется только заметка о расположении). Низкий приоритет, но честнее.
- **Циклы импортов** — проверены вручную (см. §3): все графы однонаправленны.

---

## 6. Открытые вопросы

Нет. Объём (все три файла) подтверждён пользователем; шов, barrel-стиль и тест-контракт детерминированы кодом и конвенцией репо.
