# Backend-Frontend Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть разрыв «бэкенд впереди фронта» по спеке [2026-07-15-backend-frontend-parity-design.md](../specs/2026-07-15-backend-frontend-parity-design.md): 8 треков (A–H), один PR на ветке `claude/backend-frontend-parity-c44a4e`.

**Architecture:** Каждая задача — вертикальный срез: (тонкий бэкенд-кусок при необходимости: сервис Result-контракта → route/action-маппинг) → клиентский/серверный UI по существующим паттернам → тесты до 100% покрытия затронутых файлов. Миграций Prisma нет.

**Tech Stack:** Next.js 15 App Router, React 19, TS strict, Prisma 5, Vitest (unit+integration, mode-partitioning), jsdom + @testing-library для компонентов, `renderServerComponent` для страниц.

---

## Глобальные правила для исполнителя (каждая задача)

1. **Порядок в задаче:** прочитать указанные файлы → тест (падает) → минимальная реализация → тест зелёный → `npm run typecheck` → коммит.
2. **Коммит после каждой задачи**, pathspec'ом (`git add <файлы> && git commit -- <файлы>`), Conventional Commits (`feat(parity): …` / `fix(parity): …` / `test(parity): …` / `docs(parity): …`), футер `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Если pre-commit hook падает по таймауту среды (не по коду) — разобраться; `--no-verify` только если хук падает из-за отсутствия инфраструктуры, а `typecheck`+целевые тесты прогнаны вручную.
3. **Не спавнить суб-агентов. Не запускать долгие фоновые процессы.** `npm test` целиком не гонять — только целевые файлы: `npx vitest run --mode=unit src/__tests__/<файл>` (integration-тесты пишем, но НЕ запускаем без живого Postgres — они прогонятся на финальном gate).
4. **План — намерение; код — истина.** При расхождении строк/сигнатур с реальным кодом следовать реальному коду и паттернам репо, сохранив контракт задачи. Все правила CLAUDE.md действуют (Result-контракт §3, RBAC §4, `errorMessageRu`, примитивы `ui/`, не инлайнить brand-hex, `'use client'` только по необходимости, узкие селекты Prisma).
5. **Тесты:** unit-роуты по эталону `src/__tests__/api.manager.documents.upload.test.ts` (vi.hoisted-моки); компоненты по паттернам фазы 3 (`renderToString`/node для презентационных; jsdom + `@testing-library` + per-file `// @vitest-environment jsdom` для интерактивных; диалоги — mock `HTMLDialogElement.prototype.showModal/close`); страницы — `src/__tests__/helpers/renderServerComponent.tsx`; сервисы с Prisma — integration (файл содержит `new PrismaClient(`). Каждому новому файлу — тест-файл, покрывающий все ветки (coverage-гейт 100%).

---

### Task H1: Актуализировать комментарии флагов

**Files:**
- Modify: `src/lib/featureFlags.ts:39-42`

- [ ] **Step 1:** Заменить комментарии:
```ts
  // PR-A: омниканальный инбокс. Гейтит /manager/inbox (экран построен: src/app/manager/inbox).
  'inbound_messaging',
  // PR-B: телефония Mango. Гейтит /manager/calls (экран построен: src/app/manager/calls).
  'telephony_mango',
```
- [ ] **Step 2:** `npm run typecheck` → чисто.
- [ ] **Step 3:** Commit `docs(parity): H1 — актуализировать комментарии флагов inbound_messaging/telephony_mango`.

---

### Task B1: assignLead — валидация assignToUserId (`invalid_manager`)

**Files:**
- Modify: `src/lib/services/manager/leadLifecycle.ts` (функция `assignLead`, ~:59-79; тип `LeadResult` ~:56)
- Modify: `src/app/api/manager/leads/[id]/route.ts` (маппинг ошибок ~:11-12)
- Test: `src/__tests__/manager.leadLifecycle.assign-validation.integration.test.ts` (новый)
- Test: обновить unit-тест роута, если есть маппинг-таблица (`grep -l "leads/\[id\]" src/__tests__`)

Контракт: при `assignToUserId && assignToUserId !== managerId` кандидат обязан существовать, `role === 'manager'`, `isActive === true` → иначе `{ ok:false, error:'invalid_manager' }`. Роут мапит `invalid_manager` → 400. Лиды остаются shared-queue — company-проверки НЕ добавлять.

- [ ] **Step 1:** Написать integration-тест (по паттернам соседних `*.integration.test.ts` — сид company/user/lead через helpers, что уже используют тесты лидов; найти через `grep -l "assignLead" src/__tests__`):
  - назначение на несуществующий id → `invalid_manager`;
  - на пользователя `role:'partner'` → `invalid_manager`;
  - на неактивного менеджера → `invalid_manager`;
  - на активного менеджера другой компании → **ok** (shared queue);
  - self-assign без `assignToUserId` — без изменений поведения.
- [ ] **Step 2:** Реализация в `assignLead` перед `prisma.lead.update`:
```ts
const assignee = args.assignToUserId ?? args.managerId;
if (assignee !== args.managerId) {
  const candidate = await prisma.user.findUnique({
    where: { id: assignee },
    select: { role: true, isActive: true },
  });
  if (!candidate || candidate.role !== 'manager' || !candidate.isActive) {
    return { ok: false, error: 'invalid_manager' };
  }
}
```
  Расширить union ошибок `LeadResult` кодом `'invalid_manager'`.
- [ ] **Step 3:** В роуте добавить маппинг `invalid_manager` → 400.
- [ ] **Step 4:** `npm run typecheck`; unit-тесты роута (если менялись) прогнать.
- [ ] **Step 5:** Commit `fix(parity): B1 — валидация assignToUserId в assignLead (invalid_manager)`.

---

### Task B2: Карточка лида — «Передать менеджеру» + «Вернуть в новые»

**Files:**
- Modify: `src/components/manager/manager-lead-actions.tsx`
- Modify: `src/app/manager/leads/[id]/page.tsx` (кандидаты в props)
- Test: `src/__tests__/components.manager-lead-actions.test.tsx` (существует — найти точное имя `grep -l "manager-lead-actions" src/__tests__` и расширить)
- Test: тест страницы `src/__tests__/app.manager.leads.id.page.test.tsx` (аналогично найти и обновить моки)

Контракт: страница грузит `listCompanyManagers(prisma, session.companyId)` (`src/lib/services/manager/team.ts`), фильтрует `isActive && id !== session.sub`, передаёт `candidates: {id, name, email}[]` в `ManagerLeadActions`. В компоненте: `Select` кандидатов + кнопка «Передать» → существующий `run({ action:'assign', assignToUserId })`; кнопка «Вернуть в новые» при `status==='in_review'` → `run({ action:'setStatus', status:'new' })`. Ошибка `invalid_manager` → тост «Выбранный менеджер недоступен».

- [ ] **Step 1:** Расширить component-тест: рендер селекта при непустых candidates; сабмит шлёт PATCH c `assignToUserId` (mock fetch); кнопка «Вернуть в новые» видна только при `in_review` и шлёт setStatus; при пустых candidates селект не рендерится.
- [ ] **Step 2:** Реализация в `manager-lead-actions.tsx`: новый props `candidates`, локальный `useState` выбранного id, `Select` из `@/components/ui`, кнопки через существующий `run`.
- [ ] **Step 3:** Страница: `session.companyId` может быть `null` → кандидаты `[]`. Обновить page-тест (мок `listCompanyManagers`).
- [ ] **Step 4:** Прогнать оба тест-файла + `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(parity): B2 — передача лида менеджеру и возврат в новые`.

---

### Task B3: «Отправить в 1С» — продюсер oneCSync.pushLead + UI

**Files:**
- Create: `src/server-actions/manager/leads.ts`
- Modify: `src/components/manager/manager-lead-actions.tsx` (кнопка) ИЛИ отдельный клиентский `src/components/manager/push-lead-button.tsx` (предпочтительно — отдельная ответственность)
- Modify: `src/app/manager/leads/[id]/page.tsx` (строка «1С» в `<dl>`, данные `pushedToOneCAt`/`externalIdInOneC` — проверить, что `getManagerLead` их селектит; если нет — расширить select в `src/lib/services/manager/leads.ts`)
- Test: `src/__tests__/server-actions.manager.push-lead.test.ts` (новый, unit: vi.hoisted-моки `getQueue`, `requireManager`, prisma)
- Test: `src/__tests__/components.push-lead-button.test.tsx` (новый)

Server-action:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma'; // проверить фактический экспорт (grep "from '@/lib/prisma'" в соседних экшенах)
import { requireManager } from '@/lib/auth/requireRole';
import { getQueue } from '@/lib/jobs/queues';
import { log } from '@/lib/logging';
import { writeAuditLog } from '@/lib/audit'; // проверить фактический хелпер по соседним экшенам

const Schema = z.object({ leadId: z.string().min(1).max(64) });

export type PushLeadResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'not_found' | 'already_pushed' | 'queue_error' };

export async function pushLeadToOneCAction(input: unknown): Promise<PushLeadResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireManager();
  const lead = await prisma.lead.findUnique({
    where: { id: parsed.data.leadId },
    select: { id: true, pushedToOneCAt: true },
  });
  if (!lead) return { ok: false, error: 'not_found' };
  if (lead.pushedToOneCAt) return { ok: false, error: 'already_pushed' };
  try {
    await getQueue('oneCSync.pushLead').add(
      'push',
      { leadId: lead.id },
      { jobId: `push-lead:${lead.id}` }
    );
  } catch (err) {
    log.error({ err, leadId: lead.id }, 'push_lead_enqueue_failed');
    return { ok: false, error: 'queue_error' };
  }
  // audit по образцу соседних (action:'lead_push_enqueued', entity:'lead', userId: session.sub)
  revalidatePath(`/manager/leads/${lead.id}`);
  return { ok: true };
}
```
(Импорты/хелперы сверить с реальными соседями: `src/server-actions/manager/orderAssignment.ts`.)

Кнопка `push-lead-button.tsx` (`'use client'`): `useFormAction`-или-`useTransition`-паттерн как в соседних кнопках; `errorMap: { already_pushed: 'Лид уже отправлен в 1С', queue_error: 'Очередь недоступна, попробуйте позже' }`; успех → toast «Лид поставлен в очередь отправки в 1С». Рендерится только при `pushedToOneCAt == null`. Строка в `<dl>` карточки: «1С» → `pushedToOneCAt ? \`отправлено {fmtDate}, №{externalIdInOneC ?? '—'}\` : 'не отправлялся'`.

- [ ] **Step 1:** Unit-тест экшена: validation; not_found; already_pushed; успех (проверить `add` вызван с jobId `push-lead:<id>`); queue_error при reject `add`.
- [ ] **Step 2:** Реализовать экшен; `npm run typecheck`.
- [ ] **Step 3:** Component-тест кнопки (jsdom): рендер/скрытие, сабмит зовёт экшен (mock), тосты.
- [ ] **Step 4:** Кнопка + строка «1С» на странице; расширить select `getManagerLead` при необходимости (+integration-тест сервиса обновить, если select менялся — найти существующий).
- [ ] **Step 5:** Прогнать целевые тесты + typecheck.
- [ ] **Step 6:** Commit `feat(parity): B3 — ручная отправка лида в 1С (продюсер oneCSync.pushLead + кнопка)`.

---

### Task A1: Фильтр «Без менеджера» в списках заказов

**Files:**
- Modify: `src/lib/services/manager/orders.ts` (`listOrders` — фильтры ~:59-75)
- Modify: компонент фильтров списка (`src/components/manager/manager-orders-filter.tsx` — точное имя проверить по `src/app/manager/orders/page.tsx`)
- Modify: `src/app/manager/orders/page.tsx`, `src/app/leader/orders/page.tsx` (searchParam `unassigned`)
- Test: существующий integration-тест `listOrders` (найти `grep -l "listOrders" src/__tests__ | grep integration`) — добавить кейс; component/page-тесты фильтра обновить.

Контракт: `listOrders` принимает опцию `unassigned?: boolean` → `where.managerId = null`. UI: чекбокс/линк «Без менеджера» в фильтр-баре, сериализуется в `?unassigned=1`.

- [ ] **Step 1:** Integration-кейс: два заказа (с менеджером и без) → `unassigned:true` возвращает только второй.
- [ ] **Step 2:** Реализация сервиса + страницы + фильтра.
- [ ] **Step 3:** Обновить component/page-тесты; typecheck.
- [ ] **Step 4:** Commit `feat(parity): A1 — фильтр заказов «Без менеджера»`.

---

### Task A2: Кнопка «Взять в работу» (claim) на деталке заказа

**Files:**
- Create: `src/components/manager/claim-order-button.tsx`
- Modify: `src/components/manager/manager-order-detail-view.tsx` (монтаж в шапке/правой колонке)
- Modify: `src/lib/services/manager/orderDetail.ts` — убедиться, что `loadManagerOrderDetail` отдаёт `managerId` (или `manager`) заказа; расширить select при необходимости
- Test: `src/__tests__/components.claim-order-button.test.tsx` (новый), обновить тест `manager-order-detail-view`

Компонент (`'use client'`): props `{ orderId: string; managerId: string | null; sessionUserId: string }`; рендерится только при `managerId === null`; кнопка → `claimOrderAction({orderId})` (`@/server-actions/manager/orderAssignment`) через `useTransition`; `errorMap: { already_assigned: 'Заказ уже взят другим менеджером' }`, остальное `errorMessageRu`; успех → toast «Заказ закреплён за вами» (revalidate внутри экшена обновит страницу).

- [ ] **Step 1:** Component-тест: скрыт при managerId≠null; клик зовёт экшен; тост при already_assigned (mock action).
- [ ] **Step 2:** Реализация + монтаж + прокид props из detail-данных (sessionUserId уже есть в данных страницы — проверить; иначе не нужен, достаточно managerId===null).
- [ ] **Step 3:** Обновить тест detail-view (новая секция в снапшоте/квери).
- [ ] **Step 4:** Целевые тесты + typecheck; Commit `feat(parity): A2 — кнопка «Взять в работу» на деталке заказа`.

---

### Task A3: Leader — форма «Назначить менеджера» на деталке заказа

**Files:**
- Create: `src/components/leader/leader-assign-order-manager-form.tsx` (sibling admin-версии — НЕ реюзать admin-компонент)
- Modify: `src/app/leader/orders/[id]/page.tsx` (кандидаты + монтаж рядом с `ManagerOrderDetailView`)
- Test: `src/__tests__/components.leader-assign-order-manager-form.test.tsx` (новый), page-тест leader-деталки обновить

Форма — калька [admin/assign-order-manager-form.tsx](../../src/components/admin/assign-order-manager-form.tsx) (props `{orderId, currentManagerId, candidates}`; select c опцией «— Без менеджера —» = `''`→`null`; disabled пока не dirty; success/error inline aria-live), но экшен — `assignOrderManagerLeaderAction` из `@/server-actions/manager/orderAssignment`, errorMap `{ order_not_found, invalid_manager, forbidden }` через `errorMessageRu`-фоллбек. Кандидаты на странице: `listCompanyManagers(prisma, session.companyId)` → фильтр `isActive`.

- [ ] **Step 1:** Component-тест: рендер кандидатов (текущий первым), сабмит зовёт экшен c `{orderId, managerUserId}` и `null` для пустого значения, success-нотис.
- [ ] **Step 2:** Реализация формы; монтаж на leader-странице (передать `currentManagerId` из detail-данных).
- [ ] **Step 3:** Обновить page-тест; целевые тесты + typecheck.
- [ ] **Step 4:** Commit `feat(parity): A3 — назначение менеджера руководителем на деталке заказа`.

---

### Task A4: Секция «Жизненный цикл» на деталке заказа

**Files:**
- Create: `src/components/manager/order-lifecycle-panel.tsx`
- Modify: `src/components/manager/manager-order-detail-view.tsx` (монтаж в правой колонке под `ManagerStatusChangeForm`)
- Modify: `src/lib/services/manager/orderDetail.ts` (select: `status`, `accountingSignedAt`, `returnReason`, `serviceType` — если отсутствуют)
- Test: `src/__tests__/components.order-lifecycle-panel.test.tsx` (новый; jsdom, mock `HTMLDialogElement`), тесты detail-view/orderDetail обновить

Компонент (`'use client'`), props `{ orderId; status: 'new'|'in_progress'|'waiting_client'|'completed'; accountingSigned: boolean; returnReason: string | null }`:
- Заголовок «Жизненный цикл» + бейдж текущего статуса (словарь RU: new=Новый, in_progress=В работе, waiting_client=Ждём клиента, completed=Завершён). Подпись-различение: «Операционный статус — в блоке выше».
- Кнопки переходов из локальной копии графа (дублировать константой в компоненте, источник — `ALLOWED_TRANSITIONS` сервиса): из `new`→[В работу]; `in_progress`→[Ждём клиента][Завершить]; `waiting_client`→[Вернуть в работу]; `completed`→[Переоткрыть].
- «Ждём клиента» открывает `Dialog` (примитив) с `Textarea` причины → `transitionOrderLifecycleAction({orderId, to:'waiting_client', reason})`; пустая причина — disable submit.
- Ответ `completion_conditions_unmet` → в aria-live `error`-регион списком RU-лейблов: documents_uploaded=«Нет чистого документа», accounting_signed=«Бухгалтерия не подписана», certificates_issued=«Не выданы удостоверения».
- Чекбокс «Бухгалтерия подписана» → `setOrderAccountingSignedAction({orderId, signed})` (optimistic не нужен — revalidate).
- При `waiting_client` и `returnReason` — показать причину.

- [ ] **Step 1:** Component-тест: кнопки соответствуют статусу; диалог причины (mock showModal); unmet-список рендерится; чекбокс зовёт экшен; ошибки в aria-live.
- [ ] **Step 2:** Реализация; расширить `loadManagerOrderDetail` (+обновить его integration/unit тест).
- [ ] **Step 3:** Монтаж; обновить тест detail-view.
- [ ] **Step 4:** Целевые тесты + typecheck; Commit `feat(parity): A4 — панель жизненного цикла заказа (переходы, причина, условия завершения, бухгалтерия)`.

---

### Task D1: «Забыли пароль»

**Files:**
- Create: `src/components/auth/forgot-password-form.tsx`
- Modify: `src/app/(auth)/reset-password/page.tsx` (ветка без `?token` → форма вместо тупика)
- Modify: `src/components/auth/login-form.tsx` (ссылка «Забыли пароль?» на credentials-шаге)
- Test: `src/__tests__/components.forgot-password-form.test.tsx` (новый), обновить существующие тесты reset-password-page и login-form (`grep -l "reset-password" src/__tests__`)

`ForgotPasswordForm` (`'use client'`, по образцу `reset-password-form.tsx`: `useTransition` + `fetch`): поле email (required, type=email) → `POST /api/auth/reset-password/request` `{email}`. Любой 2xx → замена формы на success-текст «Если такой email зарегистрирован, мы отправили письмо со ссылкой для сброса пароля.» (`role="status"`); 429 → «Слишком много запросов, попробуйте позже»; сетевые/прочие ошибки → generic error. В `login-form.tsx`: `<a href="/reset-password">Забыли пароль?</a>` рядом с полем пароля (стили соседних ссылок).

- [ ] **Step 1:** Component-тест формы: сабмит шлёт fetch c email; success-состояние; 429-ветка; error-ветка.
- [ ] **Step 2:** Реализация формы + ветка страницы (без token — рендер формы; невалидный/пустой token НЕ трогаем — текущее поведение с token сохраняется).
- [ ] **Step 3:** Ссылка в login-form + обновить его тест (квери по тексту «Забыли пароль?»).
- [ ] **Step 4:** Целевые тесты + typecheck; Commit `feat(parity): D1 — самостоятельный запрос сброса пароля`.

---

### Task F1: Цвета стадий воронки и колонок задач

**Files:**
- Modify: `src/components/funnel/stage-config.tsx` (StageDialog), `src/components/tasks/column-config.tsx` (ColumnDialog)
- Modify: `src/components/funnel/funnel-board.tsx`, `src/components/tasks/task-board.tsx` (рендер цвета)
- Modify: `src/lib/services/access/funnelStages.ts:21`, `src/lib/services/tasks/columns.ts:22` (zod: `z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish()`)
- Create: `src/components/ui/color-swatch-picker.tsx` — маленький презентационный radio-group (8 пресетов + «без цвета»), domain-agnostic → допустимо общим
- Test: `src/__tests__/components.color-swatch-picker.test.tsx` (новый); обновить тесты 4 изменённых компонентов и 2 сервисов

Пресеты: `['#EF4444','#F97316','#EAB308','#22C55E','#06B6D4','#3B82F6','#8B5CF6','#EC4899']`. Пикер: `props {name: string; value: string | null}`; radio-инпуты `name={name}`, value пресета или `''`; визуально — кружки, выбранный с кольцом; лейбл «Цвет». Диалоги вставляют `<ColorSwatchPicker name="color" value={stage?.color ?? null}/>` (экшены уже читают `fd.color`; пустая строка → `null` — проверить существующую нормализацию `str(fd,'color') || null`). Доски: полоска `<div style={{background: color}} className="h-1 rounded-t" />` сверху колонки при наличии color (data-driven, не brand-hex).

- [ ] **Step 1:** Тест пикера (радио-выбор, дефолт «без цвета»); zod-тесты сервисов: `#ZZZZZZ` → validation-ошибка, `#22C55E` → ok, undefined/null → ok.
- [ ] **Step 2:** Ужесточить zod; реализовать пикер; вставить в оба диалога; полоска на обеих досках.
- [ ] **Step 3:** Обновить тесты диалогов/досок; целевые тесты + typecheck.
- [ ] **Step 4:** Commit `feat(parity): F1 — цвета стадий воронки и колонок задач`.

---

### Task C1: Notifications — вынос scope + unread-роут

**Files:**
- Create: `src/lib/services/notifications/scope.ts` (перенос `buildScopeWhere` из роута, экспорт + типы)
- Create: `src/app/api/notifications/unread/route.ts`
- Modify: `src/app/api/notifications/route.ts` (импорт scope из сервиса)
- Test: `src/__tests__/api.notifications.unread.test.ts` (новый; по образцу существующих `api.notifications*.test.ts` — найти и скопировать сид-паттерн)

Unread-роут:
```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession, requireRole } from '@/lib/auth/requireRole'; // сверить фактические импорты с src/app/api/notifications/route.ts
import { buildNotificationScopeWhere } from '@/lib/services/notifications/scope';

export async function GET(req: NextRequest) {
  // 1:1 гейты существующего GET /api/notifications
  const scope = await buildNotificationScopeWhere(prisma, session);
  const count = await prisma.notification.count({ where: { AND: [scope, { isRead: false }] } });
  return Response.json({ count });
}
```
(Точную обвязку auth/try-catch взять из текущего `route.ts` — она переносится вместе со scope.)

- [ ] **Step 1:** Тест unread-роута: per-role скоуп (manager видит свои+orgId, partner — partnerId, organization — organizationId, admin — все), считаются только `isRead:false`.
- [ ] **Step 2:** Вынести scope в сервис (существующие тесты `api.notifications*` должны остаться зелёными — прогнать), реализовать unread-роут.
- [ ] **Step 3:** Целевые тесты + typecheck; Commit `feat(parity): C1 — сервис scope уведомлений + GET /api/notifications/unread`.

---

### Task C2: NotificationBell + панель + href-резолвер

**Files:**
- Create: `src/lib/notifications/href.ts` — чистая функция `notificationHref(role, type, meta): string | null`
- Create: `src/components/notifications/notification-bell.tsx` (`'use client'`)
- Test: `src/__tests__/notifications.href.test.ts`, `src/__tests__/components.notification-bell.test.tsx`

`notificationHref`: `meta?.url` (string) → вернуть его; иначе по `type`: manager-роль и `meta?.orderId` → `/manager/orders/${orderId}` (типы `comment_from_org|document_uploaded_by_org|document_uploaded_by_partner|order_marked_paid_by_1c|order_status_changed_by_manager|chat_message`); `ops_alert` и role='admin' → `/admin/health`; иначе `null`.

`NotificationBell` props `{ role: 'admin'|'manager'|'partner'|'organization' }` (leader передаёт `'manager'`):
- Бейдж: `useClientResource<number>('/api/notifications/unread', { intervalMs: 30_000, select: d => d.count ?? 0 })`; пилл-стили скопировать с [unread-badge.tsx](../../src/components/chat/unread-badge.tsx) (палитра — как там; это существующий паттерн, не новый инлайн).
- Кнопка (`aria-label="Уведомления"`, `aria-expanded`, `aria-haspopup="true"`) → попап `<div>` (absolute, right-0): список из `useClientResource<Row[]>('/api/notifications', { enabled: open })`; Escape + клик-вне закрывают (обработчики в `useEffect` при open).
- Строка: `title` (bold при `!isRead`), `body` (line-clamp), дата (`fmtDate` из `@/lib/format`); клик → `fetch('/api/notifications', {method:'PATCH', body: JSON.stringify({id})})` → `refetch` обоих → если href — `router.push(href)`, закрыть.
- Шапка панели: «Уведомления» + кнопка «Прочитать все» (disabled при 0 непрочитанных) → PATCH `{ids: unreadIds}` → refetch.
- Пустой список → «Нет уведомлений». Ошибка загрузки → «Не удалось загрузить».

- [ ] **Step 1:** Unit-тест `notificationHref` (все ветки: meta.url, manager+orderId, admin ops_alert, null-фоллбек).
- [ ] **Step 2:** Component-тест bell (jsdom, mock fetch + useClientResource через vi.mock хука ИЛИ mock global fetch — по образцу существующего теста unread-badge, найти `grep -l "unread-badge" src/__tests__`): открытие/закрытие, рендер строк, mark-read по клику, «прочитать все», пустое/ошибочное состояние.
- [ ] **Step 3:** Реализация; целевые тесты + typecheck.
- [ ] **Step 4:** Commit `feat(parity): C2 — колокольчик уведомлений (бейдж, панель, mark-read)`.

---

### Task C3: Монтаж bell в 5 шеллов

**Files:**
- Modify: `src/components/dashboard/app-shell.tsx` (partner; хедер ~:29), `src/components/manager/manager-app-shell.tsx`, `src/components/leader/leader-app-shell.tsx`, `src/components/organization/org-app-shell.tsx`, `src/components/admin/admin-app-shell.tsx`
- Test: обновить существующие тесты 5 шеллов (`grep -l "app-shell" src/__tests__`)

В каждом хедере рядом с `LogoutButton`: `<NotificationBell role="…" />` (partner→`'partner'`, manager/leader→`'manager'`, org→`'organization'`, admin→`'admin'`). На тёмном хедере partner проверить контраст иконки (белая иконка — цвет текста хедера уже белый, наследуется).

- [ ] **Step 1:** Обновить тесты шеллов (bell присутствует).
- [ ] **Step 2:** Монтаж во все 5; целевые тесты + typecheck.
- [ ] **Step 3:** Commit `feat(parity): C3 — колокольчик во всех кабинетах`.

---

### Task E1: Download вложений инбокса

**Files:**
- Create: `src/app/api/manager/inbox/[id]/attachment/route.ts`
- Modify: `src/lib/services/inbound/listInbox.ts` (select добавить `attachmentPath` не нужен — ссылка строится по id; НЕ менять) — только если тест покажет нехватку данных
- Modify: `src/components/manager/inbox-list.tsx` (имя вложения → ссылка при `scanStatus==='clean'`)
- Test: `src/__tests__/api.manager.inbox.attachment.test.ts` (новый; эталон — тест recording-роута, найти `grep -l "recording" src/__tests__`)

Роут — скелет [recording/route.ts](../../src/app/api/manager/calls/[id]/recording/route.ts) с заменами: флаг `inbound_messaging`; `prisma.inboundMessage.findUnique({ select: { companyId, status, attachmentPath, attachmentName, scanStatus } })`; scope: `(msg.companyId != null && msg.companyId === session.companyId) || msg.status === 'unresolved'` → иначе 404; `!attachmentPath` → 404; `scanStatus==='infected'` → 410; `!=='clean'` → 404; `createSignedUrl(attachmentPath, 600, { download: attachmentName ?? 'attachment' })` → 302. Если recording-роут пишет `recordPiiAccess` — повторить с новым контекстом `inbox_attachment_download` (зарегистрировать в `src/lib/pii/contexts.ts`); если нет — не добавлять (guardrail `pii.capture-coverage` подскажет — прогнать его тест).

- [ ] **Step 1:** Unit-тест роута: 404 флаг off; 404 чужая компания bound; 200/302 своя компания clean; 302 unresolved clean; 410 infected; 404 pending; 404 без attachmentPath.
- [ ] **Step 2:** Реализация роута; ссылка в `inbox-list.tsx` (`<a href={`/api/manager/inbox/${m.id}/attachment`}>` вокруг имени при clean).
- [ ] **Step 3:** Обновить тест inbox-list; guardrail pii прогнать (`npx vitest run --mode=unit src/__tests__/pii.capture-coverage*`).
- [ ] **Step 4:** Целевые тесты + typecheck; Commit `feat(parity): E1 — скачивание вложений входящих обращений`.

---

### Task E2: Архивация обращений

**Files:**
- Modify: `src/server-actions/inbound.ts` (+2 экшена)
- Modify: `src/components/manager/inbox-list.tsx` (кнопки) — клиентские кнопки вынести в `src/components/manager/inbox-archive-button.tsx` (`'use client'`, список — серверный)
- Test: `src/__tests__/server-actions.inbound.archive.test.ts` (новый; эталон — существующий тест inbound-экшенов), `src/__tests__/components.inbox-archive-button.test.tsx`

Экшены (по образцу `bindInboundMessageAction` — те же гейты `requireManager`, zod, scope):
```ts
export type ArchiveInboundResult = { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

export async function archiveInboundMessageAction(input: unknown): Promise<ArchiveInboundResult>
// scope: (msg.companyId === session.companyId) || msg.status === 'unresolved' → иначе forbidden
// update: { status: 'archived' }; audit inbound_message_archived; revalidatePath('/manager/inbox')

export async function restoreInboundMessageAction(input: unknown): Promise<ArchiveInboundResult>
// только для status==='archived' (иначе not_found-семантика не нужна — вернуть ok идемпотентно НЕЛЬЗЯ; вернуть forbidden тоже нет:
// решение: если статус не 'archived' → { ok:false, error:'not_found' } — «нечего восстанавливать»)
// update: { status: msg.boundAt ? 'bound' : 'unresolved' }; audit inbound_message_restored
```
- [ ] **Step 1:** Unit-тесты экшенов: scope-deny чужой компании; archive unresolved ok; archive bound ok; restore выводит статус из boundAt; restore не-archived → not_found.
- [ ] **Step 2:** Реализация экшенов.
- [ ] **Step 3:** Кнопка-компонент (`useTransition`, confirm не нужен — обратимо) + монтаж: «В архив» на unresolved/bound, «Вернуть» на archived (вместо «—»).
- [ ] **Step 4:** Тесты кнопки + обновить inbox-list тест; typecheck; Commit `feat(parity): E2 — архивация и восстановление обращений`.

---

### Task E3: Email-ответ — честный UX

**Files:**
- Modify: `src/components/manager/inbox-list.tsx` (bound + email → подсказка вместо формы)
- Modify: `src/components/manager/inbox-reply-form.tsx` (ERROR_LABEL: `email_unsupported`, `reply_failed`, `invalid`)
- Test: обновить тесты обоих компонентов

- [ ] **Step 1:** Обновить тесты: email-строка не содержит reply-форму, содержит текст «Ответ по email пока недоступен — ответьте из почтового клиента»; ERROR_LABEL покрывает новые коды.
- [ ] **Step 2:** Реализация; целевые тесты + typecheck.
- [ ] **Step 3:** Commit `fix(parity): E3 — скрыть недоступный email-ответ в инбоксе + полный ERROR_LABEL`.

---

### Task E4: Фильтр звонков по организации

**Files:**
- Create: `src/components/manager/calls-org-filter.tsx` (`'use client'`: `Select` организаций + `router.push`, сохраняет `direction`)
- Modify: `src/components/manager/calls-filters.tsx` (принять `orgId` и сохранять его в `buildHref` направлений)
- Modify: `src/app/manager/calls/page.tsx` (грузить `listOrganizations(prisma, session)`, передать)
- Test: `src/__tests__/components.calls-org-filter.test.tsx` (новый), обновить тесты calls-filters и страницы

- [ ] **Step 1:** Тесты: селект пушит `?orgId=…&direction=…`; «Все организации» убирает orgId; ссылки направлений сохраняют orgId.
- [ ] **Step 2:** Реализация; целевые тесты + typecheck.
- [ ] **Step 3:** Commit `feat(parity): E4 — фильтр звонков по организации`.

---

### Task E5: Композер M1 — три режима + мелочи ленты

**Files:**
- Modify: `src/components/manager/deal-activity/deal-activity-thread.tsx` (режимы; удалить комментарий-отсрочку :14-16; поле «Внутренний номер» в call-форме)
- Modify: `src/components/manager/deal-activity/activity-item.tsx` (case 'call': рендер `item.initiator`)
- Test: обновить существующие тесты обоих компонентов (найти `grep -rl "deal-activity" src/__tests__`)

Режим-переключатель (radio-pills над textarea): `note` (default) — текущий `addDealNoteAction`; `comment` — «Комментарий клиенту (видит клиент)» → `useFetchSubmit`/fetch `POST /api/comments {orderId, body}` (эталон [partner/add-comment-form.tsx](../../src/components/partner/add-comment-form.tsx)), `refresh` после успеха; `channel` — «Ответ в канал ({channelLabel})» — рендерится только при `inboundEnabled && lastInbound`, где `lastInbound = [...items].filter(i => i.kind === 'message_in').at(-1)` (items уже отсортированы возрастанием — сверить с реальным порядком; иначе взять max по dates) → `replyInboundAction({ inboundMessageId: lastInbound.id, text })`, errorMap `{ email_unsupported: 'Ответ по email недоступен', reply_failed: 'Не удалось отправить', invalid: 'Пустое сообщение' }`. Общая textarea; подпись под ней меняется по режиму. Call-форма: `Input name="fromInternal"` (опционально, placeholder «Внутренний номер (необяз.)») → в `initiateCallAction({orderId, toNumber, fromInternal})`.

- [ ] **Step 1:** Обновить/дописать тесты thread: три режима, channel-режим скрыт без message_in/при `!inboundEnabled`, каждый режим зовёт свой экшен/endpoint (mocks), fromInternal прокидывается.
- [ ] **Step 2:** Тест activity-item: call-строка с initiator рендерит имя, без — нет.
- [ ] **Step 3:** Реализация; целевые тесты + typecheck.
- [ ] **Step 4:** Commit `feat(parity): E5 — композер ленты сделки (заметка/комментарий/ответ в канал), initiator и внутренний номер`.

---

### Task G1: 1С pending-записи — сервис + вьюер + requeue

**Files:**
- Create: `src/lib/services/admin/pendingRecords.ts`
- Create: `src/server-actions/admin/pendingRecords.ts` (requeue-экшен)
- Create: `src/components/admin/pending-records-section.tsx` (таблица, server) + `src/components/admin/requeue-pending-button.tsx` (`'use client'`)
- Modify: `src/app/admin/sync/page.tsx` (секция «Отложенные записи 1С»)
- Test: `src/__tests__/admin.pendingRecords.integration.test.ts`, `src/__tests__/server-actions.admin.pendingRecords.test.ts`, component/page-тесты

Сервис:
```ts
export type PendingRecordRow = {
  id: string; entity: string; externalId: string; reason: string;
  attempts: number; status: string; firstSeenAt: Date; lastTriedAt: Date;
};

export async function listPendingRecords(prisma: PrismaClient, session: SessionPayload):
  Promise<{ ok: true; records: PendingRecordRow[] } | { ok: false; error: 'forbidden' }> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  const records = await prisma.oneCPendingRecord.findMany({
    select: { id, entity, externalId, reason, attempts, status, firstSeenAt, lastTriedAt }, // dto НЕ селектить (ПДн)
    orderBy: [{ status: 'asc' }, { lastTriedAt: 'desc' }], // 'dead' < 'pending' лексикографически → dead первыми
    take: 100,
  });
  return { ok: true, records };
}

export async function requeueDeadRecord(prisma, session, id):
  Promise<{ ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'not_dead' }>
// admin-only; запись существует и status==='dead' → update { status:'pending', attempts: 0 }; audit one_c_pending_requeued
```
UI: секция на `/admin/sync` — таблица (Сущность/externalId/Причина/Попытки/Статус-бейдж (dead — красный)/Впервые/Последняя), для dead — `RequeuePendingButton` (по образцу [sync-trigger-button.tsx](../../src/components/admin/sync-trigger-button.tsx)); пустое состояние «Отложенных записей нет».

- [ ] **Step 1:** Integration-тесты сервиса (forbidden не-админу; сортировка dead-first; dto не возвращается; requeue: dead→pending+attempts 0; not_dead).
- [ ] **Step 2:** Реализация сервиса + экшена (zod + requireAdmin + revalidatePath('/admin/sync')).
- [ ] **Step 3:** Компоненты + секция; component/page-тесты.
- [ ] **Step 4:** Целевые тесты + typecheck; Commit `feat(parity): G1 — вьюер отложенных 1С-записей и возврат dead в очередь`.

---

### Task G2: Алерты + ошибки синхронизации на /admin/health

**Files:**
- Create: `src/lib/services/admin/alerts.ts` (`listAlertStates`)
- Modify: `src/lib/services/syncSummary.ts` (+`listSyncErrors`) — или рядом отдельной функцией в том же файле
- Create: `src/components/admin/alerts-section.tsx`, `src/components/admin/sync-errors-section.tsx` (server-компоненты)
- Modify: `src/app/admin/health/page.tsx` (2 новые секции, graceful `.catch` как соседние)
- Test: `src/__tests__/admin.alerts.integration.test.ts`, integration-кейс listSyncErrors, component/page-тесты

`listAlertStates(prisma, session)`: admin-only Result; `findMany({ orderBy: [{status:'asc'} /* firing < resolved */, {updatedAt:'desc'}], take: 100 })` — все поля модели. `listSyncErrors(prisma)`: `syncLog.findMany({ where: { status:'error' }, select: { id, entity, externalId, direction, operation, errorMessage, durationMs, createdAt }, orderBy: { createdAt:'desc' }, take: 50 })` — `payload` НЕ селектить. UI: «Алерты» — таблица (Ключ/Severity-бейдж (critical красный, warning жёлтый)/Статус (firing выделен)/Сообщение/Значение/Первое срабатывание/Resolved); «Ошибки синхронизации (последние 50)» — таблица; пустые состояния.

- [ ] **Step 1:** Integration-тесты: forbidden; firing-first сортировка; payload отсутствует в ответе listSyncErrors.
- [ ] **Step 2:** Сервисы; компоненты; секции на странице.
- [ ] **Step 3:** Обновить page-тест health; целевые тесты + typecheck.
- [ ] **Step 4:** Commit `feat(parity): G2 — алерты и построчные ошибки синхронизации в админке`.

---

### Task G3: Run-now для 4 cron-джобов

**Files:**
- Modify: `src/lib/services/admin/syncControl.ts` (реестр `SYNC_ENTITIES` +4 записи: `certificateExpiry`→`notifications.certificateExpiry`, `emailPoll`→`inbound.email.poll`, `mangoBackfill`→`telephony.mango.backfill`, `monthlyCommissions`→`docs.calculateMonthlyCommissions`; `hasCursor:false`; `schedulerId` взять из `src/lib/jobs/scheduling.ts` соответствующих schedule-реестров)
- Modify: `src/app/admin/sync/page.tsx` (секция «Прочие фоновые задачи»: задача/cron/`SyncTriggerButton entity=…`)
- Test: обновить unit/integration тесты syncControl (`grep -l "triggerSync" src/__tests__`) + page-тест

Перед реализацией **проверить процессоры** 4 очередей (`src/worker/processors/{certificate-expiry,inbound-email-poll,mango-backfill? ,calculate-monthly-commissions?}.ts` — имена уточнить по `src/worker/index.ts`): payload manual-джобы `{triggeredAt, reason:'manual'}` не должен ломать обработку (обычно payload игнорируется). Если процессор требует поля — адаптировать enqueue в `triggerSync` per-entity (минимально).

**Внимание:** `setSchedulePaused` валидирует entity по `SYNC_SCHEDULES` — новые записи паузе не подлежат по спеке; убедиться, что расширение `SYNC_ENTITIES` не открыло паузу случайно (если открыло — огородить: паузу разрешать только 1С-сущностям, тест на `unknown_entity`/`forbidden`-поведение для новых).

- [ ] **Step 1:** Тесты: `triggerSync('certificateExpiry')` ставит джобу в верную очередь с jobId `manual:…`; `already_running` guard работает; пауза для новых сущностей недоступна.
- [ ] **Step 2:** Реализация реестра; секция UI (в таблице показывать cron-строку статически из реестра — добавить поле `cronLabel` в новые записи).
- [ ] **Step 3:** Целевые тесты + typecheck; Commit `feat(parity): G3 — ручной запуск фоновых задач (сертификаты, email-poll, mango-backfill, комиссии)`.

---

### Task G4: История орг-ставки комиссии

**Files:**
- Modify: `src/lib/services/commission/rateHistory.ts` (+`listOrgRateHistory`)
- Modify: `src/app/admin/organizations/[id]/page.tsx` (секция под `AdminRateOverrideForm`)
- Test: integration-кейсы в существующий тест rateHistory (`grep -l "listRateHistory" src/__tests__`), page-тест обновить

`listOrgRateHistory(prisma, session, organizationId)` — калька `listRateHistory` (admin-only, batch-резолв имён `changedById`), источник `organizationCommissionRateChange`, `RateHistoryRow` с `newRate: number | null`. UI: инлайн-таблица по образцу [admin/partners/[id]/page.tsx:36-62](../../src/app/admin/partners/[id]/page.tsx) (Дата/Было/Стало/Кто); `newRate === null` → «сброс (ставка партнёра)»; `oldRate === null` → «—».

- [ ] **Step 1:** Integration-тест: forbidden; сортировка `effectiveFrom desc`; null-ставки; имена changedBy.
- [ ] **Step 2:** Сервис + секция; page-тест.
- [ ] **Step 3:** Целевые тесты + typecheck; Commit `feat(parity): G4 — история ставок комиссии организации в админке`.

---

### Task FINAL: Полная верификация + PR

- [ ] **Step 1:** `npm run typecheck && npm run lint` — чисто (max-warnings=0).
- [ ] **Step 2:** `npm run test:unit` — зелёный (НЕ параллельно с gate).
- [ ] **Step 3:** `npm run gate` (Docker-Postgres; при WinNAT-блоке 5432 — override на 15432 + `GATE_DATABASE_URL`, см. память local-test-environment) — зелёный.
- [ ] **Step 4:** `npm run test:coverage` — 100% на denominator; добить непокрытые ветки, если гейт покажет.
- [ ] **Step 5:** CHANGELOG.md — записи по трекам в `[Unreleased]` (стиль см. существующий CHANGELOG).
- [ ] **Step 6:** Close-out `docs/superpowers/plans/2026-07-15-backend-frontend-parity-DONE.md` (эталон — [partner-cabinet-phase4-DONE.md](2026-05-22-partner-cabinet-phase4-DONE.md)).
- [ ] **Step 7:** Push (`git push -u origin claude/backend-frontend-parity-c44a4e`; TLS-флейк лечится retry; multi-minute hang = pre-push gate — допустим `--no-verify` после ручного полного прогона шагов 1-4).
- [ ] **Step 8:** PR в `main` через `gh pr create` — заголовок `feat: backend-frontend parity (tracks A–H)`, тело: сводка треков + ссылка на спеку, футер `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
