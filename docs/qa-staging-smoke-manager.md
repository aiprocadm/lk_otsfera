# Stage-2 staging smoke — Manager cabinet (Phase 8 + C8)

**Owner**: QA + Промтехносфера team
**Trigger**: после merge Phase 8 + C8 в `main` со скрытым флагом (Stage-1 done).
**Goal**: подтвердить, что кабинет `/manager/*` под `FEATURE_MANAGER_CABINET=1` корректно работает на staging: визуально, по данным, по **RBAC-скоупу (включая C8 company-wide и cross-company изоляцию)**, по интеграциям (Supabase Storage, Resend, ClamAV, BullMQ-worker).
**Duration**: 1–2 недели наблюдения; обязательные 12 шагов ниже — за 1–2 часа.
**Reference**: [manager spec](superpowers/specs/2026-05-26-manager-cabinet-design.md) · [phase8-DONE](superpowers/plans/2026-05-26-manager-cabinet-phase8-DONE.md) · [C8 spec](superpowers/specs/2026-06-05-c8-manager-company-wide-design.md) · [C8-DONE](superpowers/plans/2026-06-05-c8-manager-company-wide-DONE.md). Общая процедура — [runbook §6.2](runbook-staged-rollout-cabinets.md).

> Sibling-документ для [qa-staging-smoke-organization.md](qa-staging-smoke-organization.md). Manager отличается двумя вещами: (1) **API-роут** загрузки документов (у org — server-action), (2) **C8** — рантайм-переключатель company-wide видимости + роль `leader`. Эти отличия вынесены в отдельные шаги.

---

## 0. Pre-flight (выполнить до прогона)

| Чек | Команда / Действие | Ожидание |
|---|---|---|
| Staging-deploy свежий | сверить commit SHA на staging vs `main` | совпадает |
| Флаг включён | `FEATURE_MANAGER_CABINET=1` в env staging | env прокинут в **Next + worker** |
| Миграции применены | `npx prisma migrate status` | `Database schema is up to date` |
| C8-поля в БД | `Company.managerTeamVisibility`, `User.managerRole` присутствуют | см. [schema.prisma:104,399](../prisma/schema.prisma) |
| Worker запущен | процесс `npm run worker:start` / systemd | очереди `oneCSync.*`, `notifications.dispatch`, `emails.send` слушают |
| Supabase bucket | загрузка тестового файла через admin | 200, файл в bucket `documents` |
| Resend | `EMAIL_ENABLED=true`, валидный `RESEND_API_KEY`, `EMAIL_FROM=…@otsfera.ru` | тестовый email доходит |

**Test-seed на staging** (ключевое отличие — нужны ДВЕ компании для cross-company теста):

```
Company A:
  - manager-A1 (User role=manager, companyId=A, managerRole=null)      ← обычный менеджер
  - manager-A2 (User role=manager, companyId=A, managerRole='leader')  ← руководитель
  - 2+ Order, привязанных к Company A (через managerId/companyId)
Company B:
  - manager-B1 (User role=manager, companyId=B, managerRole=null)
  - 1+ Order, привязанный к Company B
```

- Менеджеры обычно уже есть в seed ([prisma/seed.ts](../prisma/seed.ts)); вторую компанию + её менеджера/заказы досидить тем же скриптом или вручную.
- `managerRole='leader'` выставляется **только admin** через user-management (server-action `setManagerRole`, audited). Через UI/БД руками — для seed допустимо.

---

## 1. Smoke walkthrough (12 шагов)

Один тестировщик последовательно. На каждом шаге: ✅ / ❌ / ⚠. На ❌ — записать correlationId из тостов + лог сервера + **НЕ продолжать**.

### Step 1 — Login → /manager/dashboard
- **Действие**: залогиниться как `manager-A1`.
- **Ожидание**: 302 на `/manager/dashboard`. KPI-плитки рендерятся, подзаголовок с именем менеджера. Сайдбар: Главная / Заказы / Организации / Документы / Сотрудники / Сообщения. **«Команда» скрыта** (не leader).
- **Fallback**: редирект на `/login` → `JWT_SECRET` < 32 на staging; 404 → флаг не прокинут в web-инстанс.

### Step 2 — Orders list + scope + фильтры
- **Действие**: `/manager/orders`. Применить фильтр по статусу + сбросить. Если > 20 — «Дальше».
- **Ожидание**: в режиме company-visibility **OFF** (по умолчанию) видны заказы по 3-way per-manager scope ([managerPolicy](../src/lib/auth/managerPolicy.ts) `canSeeOrder`).
- **Critical fail**: виден заказ **другой компании** (Company B) → немедленно стоп, data-leak.

### Step 3 — Organizations list
- **Действие**: `/manager/organizations`.
- **Ожидание**: только организации в scope менеджера; колонки/данные консистентны; чужой компании нет.

### Step 4 — Documents + **API upload** + signed URL + infected
- **Действие**: `/manager/documents`. Загрузить документ к заказу через UI (бьёт в **API-роут** [api/manager/documents/[id]/upload](../src/app/api/manager/documents/[id]/upload/route.ts) — отличие от org). Затем «Скачать».
- **Ожидание**: upload — MIME allow-list + size ≤ 20 МБ, запись `Document`, enqueue `docs.scanDocument`, audit, fan-out уведомления. Download — signed URL (302/JSON, TTL 600 сек). `infected` → **410 Gone** (не 404). Чужой документ → 404.

### Step 5 — Order detail + comment (Messages = лента комментариев)
- **Действие**: открыть заказ → написать комментарий → «Отправить». Открыть `/manager/messages`.
- **Ожидание**: комментарий в треде после refresh. «Сообщения» = входящие комментарии к заказам (`listIncomingComments`), гейтится `manager_cabinet` (**не** `chat`).

### Step 6 — Students list
- **Действие**: `/manager/students`, поиск по фамилии.
- **Ожидание**: сотрудники в scope; поиск по `name` (case-insensitive contains).

### Step 7 — Leader-gate
- **Действие (как manager-A1, не-leader)**: прямой переход `/manager/team`.
- **Ожидание**: пункт «Команда» скрыт в сайдбаре; прямой переход → `/forbidden` ([requireManagerLeader](../src/lib/auth/requireRole.ts)).
- **Действие (как manager-A2, leader)**: `/manager/team` открывается — виден `TeamVisibilityToggle` + ростер команды.

### Step 8 — C8 company-wide toggle (как leader)
- **Действие**: на `/manager/team` переключить [TeamVisibilityToggle](../src/components/manager/team-visibility-toggle.tsx) в **ON**. Перелогиниться/обновить под `manager-A1`.
- **Ожидание (ON)**: `manager-A1` теперь видит **ВСЕ** заказы/документы/организации/студентов **Company A** (дашборд тоже агрегирует по компании). Audit: `manager_team_visibility_changed` ([service](../src/lib/services/manager/teamVisibility.ts)).
- **Действие**: вернуть toggle в **OFF** → `manager-A1` снова видит только свой 3-way scope. Идемпотентный no-op флип audit-строку не пишет.

### Step 9 — Cross-company изоляция (CRITICAL, проверить в ОБОИХ режимах)
- **Действие**: будучи `manager-A1` (и при ON, и при OFF), взять ID заказа/документа **Company B** (из `/admin/orders` под admin) и открыть `/manager/orders/{companyB_orderId}`.
- **Ожидание**: **404 в обоих режимах.** Company-wide раздвигает границу до **своей** компании, но никогда — за её пределы. Это ключевой инвариант C8.
- **Critical fail**: виден хоть один объект Company B → стоп, разбор, откат.

### Step 10 — Worker sync → notification (scoped, не company-blast)
- **Действие**: добавить тестовый платёж/документ по заказу Company A (через 1С-имитацию или admin-route) → подождать ≤ 5 мин (или retry через `/admin/sync`).
- **Ожидание**: уведомление приходит **по scoped-правилу таргетинга** ([notifications/manager.ts](../src/lib/notifications/manager.ts)) — даже при company-wide **ON** уведомления остаются scoped (видимость ≠ таргетинг). Email-шаблон + in-app bell. Audit `notification_sent`.
- **Fallback**: нет email → `[worker] notifications.dispatch` + Resend dashboard.

### Step 11 — Privesc-guard (leader не выдаёт leader)
- **Действие**: попытаться через UI/доступные действия leader'у назначить `managerRole='leader'` другому менеджеру.
- **Ожидание**: невозможно — `setManagerRole` **admin-only**, audited; leader не имеет такого действия в своём кабинете (privesc-инвариант C8).

### Step 12 — Rollback rehearsal
- **Действие**: на staging выставить `FEATURE_MANAGER_CABINET=0` → redeploy/restart → открыть `/manager/dashboard`.
- **Ожидание**: `/manager/*` → 404. Кабинеты `partner` / `admin` / `organization` / `student` не задеты. `Company.managerTeamVisibility` и `User.managerRole` остаются в данных (безвредны при OFF). Вернуть флаг в `1` для продолжения наблюдения.

---

## 2. Признаки успеха Stage-2

- [ ] Все 12 шагов — ✅ (или ⚠ с письменным waiver).
- [ ] **Cross-company изоляция (Step 9) — ✅ в обоих режимах.** Без этого Stage-2 не закрывается.
- [ ] 1–2 недели наблюдения — нет regressions в логах worker'а / alerting (queue/DLQ/sync-lag).
- [ ] Внутренняя валидация UX: ≥3 человека, включая роли **regular-manager / leader / admin**.
- [ ] Финальная встреча go/no-go: «выпускаем Stage-3 (prod pilot)».

## 3. Откат (если Stage-2 ❌)

```bash
# 1. Env staging (web + worker): FEATURE_MANAGER_CABINET=0
# 2. Deploy / перезапуск
# 3. /manager/* → 404 — partner/admin/organization/student не задеты
# 4. C8-поля (managerTeamVisibility, managerRole) остаются read-only, безвредны
# 5. Order-данные не трогаются; 1С-sync продолжает писать идемпотентно
```

Откатывать миграции не нужно — feature-флаг единственная точка отказа.

## 4. После Stage-2

1. Сообщить тех.лиду: «Manager Stage-2 passed, можно в prod pilot».
2. Агент:
   - обновит memory ([reference-manager-plan.md](../../../C:/Users/karka/.claude/projects/D-------------------------------------------------/memory/reference-manager-plan.md)) — `Stage-2 staging smoke COMPLETED YYYY-MM-DD`,
   - перейдёт по [runbook](runbook-staged-rollout-cabinets.md) к Stage-3 (prod pilot).

---

## Приложение A — Local rehearsal результаты

_(Заполняется при локальном прогоне с `FEATURE_MANAGER_CABINET=1`; ниже — шаблон, как в org-варианте.)_

| Step | Status | Notes |
|---|---|---|
| 1 | — | |
| … | — | |

Локальный прогон **не заменяет staging** — только confidence-build, что code-path корректен. Cross-company инвариант (Step 9) дополнительно покрыт integration-тестом ([services.manager.teamVisibility / auth.policy.manager-refactor](../src/__tests__/auth.policy.manager-refactor.test.ts)).
