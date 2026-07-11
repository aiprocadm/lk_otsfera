# Журнал доступа к ПДн (ТЗ §25.7) — design

**Дата:** 2026-07-11
**Автор:** Claude (session-driven; дизайн-панель 3 линзы × 3 судьи, синтез по must-graft)
**Статус:** Approved for implementation (autonomous); решения, требующие внимания владельца, — в §«Открытые решения»
**Related:** Серия укрепления (ТЗ v0.5 §16/§25.7), последний пункт. Предыдущий: [staff-2fa](2026-07-11-staff-2fa-design.md) (PR #195). База — ветка `claude/pii-access-journal` от tip `claude/release-hardening-r0` (e82ba45); PR целить в main, НЕ мержить раньше PR #196.

## Проблема

Сотрудники (admin / manager / leader) видят ПДн физлиц клиентского контура:
слушателей (`Student`), контактов лидов (`Lead.clientContact*`), заявок на
обучение (`EnrollmentRequest`), звонящих (`Call.callerNumber`), отправителей
входящих (`InboundMessage`), пользователей клиентских организаций (`User`).
Существующий `AuditLog` фиксирует только **мутации**; единственное read-событие —
`document_download_signed_url`. На вопрос §25.7 «кто, когда и чьи ПДн смотрел»
оператор сегодня ответить не может.

## Цель

Append-only журнал **чтений** ПДн сотрудниками: каждое событие фиксирует
актора (снапшот роли и companyId), контекст (какой экран/сервис), действие
(list/view) и **поимённый состав выдачи** (`subjectIds`). Просмотр — отдельная
admin-страница с индексируемым обратным поиском «кто смотрел субъекта X».

## Не-цели / Out of scope (явно, это решения, а не пробелы)

- **Файлы-документы** — скачивания уже журналируются в `AuditLog`
  (`document_download_signed_url` во всех трёх download-роутах: generic,
  organization, manager). Двойную запись в оба журнала не делаем; ответ
  регулятору по файлам собирается из `AuditLog`. Пересмотр возможен в v1.1.
- **Чат и комментарии** (`/messages`, авторы комментариев в order detail) —
  деловая переписка сторон договора; журналирование каждого рендера треда
  раздуло бы журнал без комплаенс-ценности. Домен chat к тому же за opt-in
  флагом. Known limitation.
- **Справочник собственных сотрудников** — инлайн-чтение кандидатов-менеджеров
  в `admin/orders/[id]/page.tsx` (`role: 'manager'`) — ПДн сотрудников
  оператора обрабатываются в рамках трудовых отношений, это не клиентские
  субъекты §25.7. (Списки `admin/users` при этом журналируются: там есть
  пользователи клиентского контура — partner/organization.)
- **Акторы partner/organization** — журнал v1 охватывает только staff-роли.
  Хелпер сам отсекает не-staff сессии, поэтому общие сервисы
  (`enrollments/list`, `certificates`, `orderItems`) инструментируются без
  ветвления по ролям; расширение на клиентские роли = снятие одного guard'а.
- **`listManagerLeads`** (список лидов) — в списке только юрлицо
  (`clientCompanyName`, `clientInn`), ПДн физлица нет → не журналируется.
  Контактные ПДн отдаёт только `getManagerLead` (карточка) — она журналируется.
- **requestId-колонка** — сквозной request-id в проекте ещё не существует
  (бэклог PR #194 «корреляция requestId/jobId»); колонку добавим вместе с той
  инфраструктурой, не раньше.

## Дизайн

### Модель данных (prisma) — отдельная таблица, не AuditLog

Переиспользование `AuditLog` отвергнуто панелью: ключевой запрос «кто смотрел
субъекта X» упирался бы в подтверждённую перф-ловушку raw `meta::text ILIKE`
без индекса ([auditLog.ts:53](../../../src/lib/services/admin/auditLog.ts)),
read-события задоминировали бы мутационный трейл и его distinct-фильтры, а
`entityId='list'` убивал бы селективность `[entity, entityId]`. Отдельная
таблица даёт независимые индексы, ретеншн и страницу предъявления.

```prisma
/// §25.7: журнал доступа сотрудников к ПДн физлиц клиентского контура.
/// Append-only: приложение никогда не обновляет и не удаляет строки.
model PiiAccessEvent {
  id           String   @id @default(cuid())
  createdAt    DateTime @default(now())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  userRole     String   // снапшот: admin | manager | leader
  companyId    String?  // снапшот C8-скоупа сессии
  context      String   // ключ PII_CONTEXTS (см. реестр)
  action       String   // list | view
  subjectType  String   // student | lead | enrollment_request | user | caller | inbound_sender
  subjectIds   String[] // точный поимённый состав выдачи (естественный cap: take<=100)
  subjectCount Int      // = subjectIds.length (денорм для быстрых сводок)
  meta         Json?    // take, hasQuery, cursor:boolean — БЕЗ сырых поисковых строк

  @@index([subjectIds], type: Gin) // обратный поиск «кто смотрел субъекта X»
  @@index([userId, createdAt])     // трейл по сотруднику
  @@index([subjectType, createdAt])
  @@index([createdAt])
}
```

- Модель `User` получает обратную связь `piiAccessEvents PiiAccessEvent[]`
  (Prisma требует обе стороны relation) — по образцу `auditLogs`.
- `subjectIds` хранит **id строк** (`Student.id`, `Call.id`,
  `InboundMessage.id`, …), не сами ПДн — журнал не становится вторым
  хранилищем ПДн и безопасен для бэкапов. Резолв id → отображаемое имя
  делается в момент просмотра журнала.
- В `meta` **запрещено** класть сырую поисковую строку `q` (может содержать
  ФИО/email) — только факт `hasQuery: true`. Это правило закрепляется тестом.
- `scrub()` защищает pino-логи, не таблицы; поэтому второе правило: содержимое
  `PiiAccessEvent.meta` никогда не выводится в pino (`log.*`) — только счётчики.
- Пустая выдача (`subjectIds.length === 0`) не журналируется — не-доступ
  не событие.
- Снапшоты `userRole`/`companyId` пишутся на момент доступа: смена роли или
  компании сотрудника задним числом не искажает журнал.
- `updatedAt` намеренно отсутствует (append-only, экономия записи).

### Реестр контекстов — единая точка правды

`src/lib/pii/contexts.ts`:

```ts
export const PII_CONTEXTS = {
  manager_students_list:  { subjectType: 'student',            action: 'list', labelRu: 'Список слушателей',        callSite: 'src/lib/services/manager/students.ts' },
  manager_student_view:   { subjectType: 'student',            action: 'view', labelRu: 'Карточка слушателя',       callSite: 'src/lib/services/manager/students.ts' },
  manager_lead_view:      { subjectType: 'lead',               action: 'view', labelRu: 'Карточка лида (контакты)', callSite: 'src/lib/services/manager/leads.ts' },
  enrollments_list:       { subjectType: 'enrollment_request', action: 'list', labelRu: 'Заявки на обучение',       callSite: 'src/lib/services/enrollments/list.ts' },
  org_card_inbound:       { subjectType: 'inbound_sender',     action: 'list', labelRu: 'Карточка организации: входящие', callSite: 'src/lib/services/manager/organizationCard.ts' },
  org_card_calls:         { subjectType: 'caller',             action: 'list', labelRu: 'Карточка организации: звонки',   callSite: 'src/lib/services/manager/organizationCard.ts' },
  inbox_list:             { subjectType: 'inbound_sender',     action: 'list', labelRu: 'Инбокс: входящие',         callSite: 'src/lib/services/inbound/listInbox.ts' },
  calls_list:             { subjectType: 'caller',             action: 'list', labelRu: 'Журнал звонков',           callSite: 'src/lib/services/telephony/listCalls.ts' },
  certificates_list:      { subjectType: 'student',            action: 'list', labelRu: 'Удостоверения',            callSite: 'src/lib/services/training/certificates.ts' },
  order_items_list:       { subjectType: 'student',            action: 'list', labelRu: 'Слушатели заказа',         callSite: 'src/lib/services/training/orderItems.ts' },
  admin_users_list:       { subjectType: 'user',               action: 'list', labelRu: 'Пользователи (список)',    callSite: 'src/lib/services/admin/users/queries.ts' },
  admin_user_view:        { subjectType: 'user',               action: 'view', labelRu: 'Карточка пользователя',    callSite: 'src/lib/services/admin/users/queries.ts' },
} as const;
export type PiiContextKey = keyof typeof PII_CONTEXTS;
```

Реестр кормит: (1) guardrail-тест полноты, (2) RU-лейблы фильтров admin UI,
(3) валидацию `subjectType`/`action` в хелпере (context — единственный
источник, рассинхрон невозможен).

Композиция сервисов: `loadManagerOrderDetail` вызывает `listOrderItems`
внутри — журналирует **внутренний** сервис, поэтому и API-роут
`api/manager/orders/[id]/items`, и страница детали заказа дают ровно одно
событие `order_items_list` на выдачу. Двойной записи нет.

### Хелпер записи — awaited, never-throws (fail-open)

`src/lib/pii/record.ts`:

```ts
export type PiiAccessArgs = {
  session: SessionPayload;
  context: PiiContextKey;
  subjectIds: string[];
  meta?: { take?: number; hasQuery?: boolean; cursor?: boolean };
};

export async function recordPiiAccess(prisma: PrismaLike, args: PiiAccessArgs): Promise<void>;
export async function recordPiiAccessMany(prisma: PrismaLike, argsList: PiiAccessArgs[]): Promise<void>; // createMany, 1 round-trip
```

Поведение (по порядку):
1. `isFeatureEnabled('pii_access_log')` ложен → return (kill-switch).
2. Сессия не staff (`role !== 'admin' && role !== 'manager'`) → return —
   централизованный guard, общие сервисы не ветвятся по ролям.
3. `subjectIds.length === 0` → return.
4. `create`/`createMany` **с await**, обёрнутый try/catch: сбой →
   `log.error('pii_access_log_write_failed', { context, count })` и **данные
   отдаются** (fail-open). `log.error`, не `warn` — это алертный сигнал.

Fail-open — буквальное соблюдение §3 graceful degradation. Fail-closed
(сбой журнала блокирует выдачу) двое из трёх судей признали нарушением
преамбулы CLAUDE.md без санкции владельца и новым режимом отказа с blast-radius
«все staff-страницы» — см. §«Открытые решения». Точка изменения одна (хелпер),
апгрейд до fail-closed при решении владельца — локальная правка.

`userRole` вычисляется в хелпере: `session.role === 'manager' &&
session.managerRole === 'leader' ? 'leader' : session.role`.

Вызов — **awaited** (не floating promise: завершение ответа Next может
оборвать необслуженный промис), сразу после prisma-выборки, до `return`.

### Точки вызова (12 контекстов, см. реестр)

Два сопутствующих приведения к канону §2/§3 (единственные рефакторинги PR):

1. **`getManagerLead(prisma, leadId)` → `(prisma, session, leadId)`** — без
   session вызов хелпера внутри сервиса невозможен. Затронуты 2 продовых
   call-site (`manager/leads/[id]/page.tsx`, `api/manager/leads/[id]/route.ts`)
   и ~5 тест-файлов. Заодно сервис получает возможность в будущем сузить
   выборку по scope (сейчас scope-чек живёт на странице).
2. **Инлайн `prisma.student.findUnique` в `manager/students/[id]/page.tsx`
   выносится в `getStudent`** (`services/manager/students.ts`) с тем же
   C8 teamMode-скоупом, что у `listStudents` — существующее отступление
   RSC-инлайна приводится к слоям §2, и карточка слушателя журналируется
   сервисом, а не страницей.

`getOrganizationCard` пишет **два** события (`org_card_inbound`,
`org_card_calls`) одним `createMany`.

### Guardrail полноты (по образцу worker.processor-coverage)

`src/__tests__/pii.capture-coverage.guardrail.test.ts`:
- для каждого контекста из `PII_CONTEXTS` читает файл `callSite` и падает,
  если в нём нет вызова `recordPiiAccess` с этим контекстом;
- падает, если контекст объявлен, но не используется, или используется
  контекст вне реестра.

Плюс строка в CLAUDE.md §12: «новое staff-чтение ПДн физлиц клиентского
контура обязано регистрировать контекст в `src/lib/pii/contexts.ts` и вызывать
`recordPiiAccess`». Ограничение guardrail'а честно фиксируем: он проверяет
известные реестру файлы; новый сервис мимо реестра ловится только ревью.

### Флаг `pii_access_log` — opt-out (включён по умолчанию)

Комплаенс-механизм не может быть opt-in: забытый env на новом окружении =
журнал молча не ведётся. Это ровно сценарий doc-комментария
`featureFlags.ts` («default-true matters for safety»). Прецедент семантики
не `staff_2fa` (он opt-in), а базовое семейство opt-out.

Поведенческий флаг (задокументированное исключение из трёхточечного правила
§5). Точки чтения:
1. `recordPiiAccess` — при off no-op (пауза ведения);
2. страница `/admin/pii-access` — **не гейтится**: просмотр накопленной
   истории работает даже при выключенной записи, вместо этого баннер
   «Запись журнала приостановлена» (kill-switch виден, а не тих).

`docs/feature-flags-matrix.md`: «`FEATURE_PII_ACCESS_LOG=0` — аварийный
kill-switch; выключение = пауза журнала = комплаенс-дыра, допускается только
на время инцидента».

### Admin UI — `/admin/pii-access` (Model A)

- Сервис `src/lib/services/admin/piiAccess.ts` → `listPiiAccess(prisma,
  session, filters)`: период from/to, сотрудник (actorUserId), userRole,
  context (RU-лейблы из реестра), subjectType, **точный subjectId** (GIN
  `subjectIds: { has }`), cursor-пагинация `take ≤ 100` — по образцу
  `listAudit`. **Никакого текстового ILIKE-поиска по meta** — только точные
  индексируемые фильтры (урок перф-ловушки listAudit закреплён панелью).
- Резолв отображения: акторы — join `user`; субъекты — батч-резолв по типам
  (`student`/`user`/`lead`/… → максимум 4-6 `findMany` на страницу, без N+1);
  удалённый субъект показывается как id с пометкой.
- RBAC три уровня §4: `/admin` в `protectedPrefixes` (уже есть) +
  `requireAdmin()` на странице + проверка `session.role === 'admin'` в сервисе.
- Страница самого журнала **не журналируется** (рекурсию v1 не заводим;
  зафиксировано как known limitation — subjectIds там и так не ПДн, а id).
- Nav-пункт «Доступ к ПДн» в admin-навигации, флагом не скрывается
  (graceful-паттерн admin-chat).

### Объём, ретеншн, эксплуатация

- Оценка: ~20 staff × ~200 ПДн-выдач/день ≈ **~1 млн строк/год**, с GIN —
  порядка 1-1.5 ГБ/год. Хранение бессрочное (§16), таблица попадает в
  стандартные бэкапы ([runbook-backups](../../runbook-backups.md)).
- **Явный триггер эскалации: > 10 млн строк** → месячное партиционирование
  по `createdAt` (отдельная миграция, вне v1).
- Шумовые источники, известные заранее:
  - авто-рефреш/поллинг `/manager/inbox` и `/manager/calls` — каждая
    перезагрузка = строка; рычаг v1.1 — дедуп в окне (например, не писать
    повторное событие того же (userId, context, hash(subjectIds)) в течение
    N минут). В v1 не реализуем — сначала смотрим реальный объём;
  - **dev double-render RSC** — в dev-режиме страницы рендерятся дважды,
    локально возможны дублирующиеся строки. Это не баг, в prod не воспроизводится.

## Открытые решения (для владельца; выбраны безопасные дефолты)

1. **Fail-open vs fail-closed.** Реализован fail-open (§3 graceful
   degradation). Комплаенс-линза панели аргументировала fail-closed («доступ
   без следа хуже отказа страницы»), но это изменение правила CLAUDE.md,
   требующее вашей санкции, и новый режим отказа. Апгрейд — локальная правка
   хелпера + новый error-код `pii_log_failed` в ~12 сервисах.
2. **Скачивания файлов вне журнала ПДн** (остаются в AuditLog) — см. Не-цели.
3. **Чат/комментарии вне журнала** — см. Не-цели.

## Тестовая стратегия (гейт 100%)

- **Unit `lib/pii`**: хелпер — флаг off → no-op; не-staff → no-op; пустые
  subjectIds → no-op; успешная запись (мок prisma); сбой insert → проглочен +
  `log.error` (console-spy паттерн); leader-снапшот роли; `recordPiiAccessMany`
  → один createMany; запрет сырого q в meta (типовой уровень + тест хелпера).
- **Guardrail**: `pii.capture-coverage.guardrail.test.ts` (см. выше).
- **Unit сервисов**: каждый из 12 контекстов — существующий тест-файл сервиса
  дополняется assert'ом «вызван recordPiiAccess с правильным context и
  subjectIds» (мок `@/lib/pii/record` через `vi.hoisted`-паттерн §6).
- **Unit admin-сервиса**: `listPiiAccess` — фильтры, cursor, take-кэп,
  role-guard, батч-резолв без N+1.
- **Route/page**: `/admin/pii-access` через `renderServerComponent` (баннер
  при off, таблица, фильтры); правка тестов `manager/leads/[id]` и
  `students/[id]` под новые сигнатуры сервисов.
- **Integration (живой PG)**: GIN-поиск `subjectIds has X` возвращает события;
  createMany двух событий organizationCard; снапшот userRole='leader';
  сервисы с реальной выборкой пишут точный состав ids.
- **Blast-radius шаг**: первый полный integration-прогон выявит существующие
  тесты, чувствительные к новым строкам (row-count/console-spy) — в плане
  заложен отдельный шаг на их правку (опыт панели: объём неизвестен заранее).

## Оценка

~14-16 TDD-коммитов: миграция+модель → реестр+хелпер → guardrail →
12 call-sites (группами) → рефакторинги сигнатур → admin-сервис → страница →
флаг+матрица → доки+CLAUDE.md §12 → close-out.
