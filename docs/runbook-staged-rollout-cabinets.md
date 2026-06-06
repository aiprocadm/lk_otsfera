# Runbook — staged rollout кабинетов Organization + Manager (C7)

**Owner**: тех.лид Промтехносфера (флип флагов) + QA (smoke) + ops (наблюдение)
**Scope**: feature-флаги `organization_cabinet` и `manager_cabinet` — оба **opt-in**, в prod **OFF**.
**Roadmap**: пункт **C7** «Staged rollout кабинетов org+manager» в [completion-roadmap §C7](superpowers/specs/2026-06-02-completion-roadmap.md). Последний гейт перед «проект готов».
**Не-цель**: этот runbook **не меняет семантику флагов** — они остаются глобальным boolean-env. Гранулярная per-org / cohort-раскатка — отдельный код-трек (см. §8 «Известные ограничения»), если бизнес потребует.

> Это **операционный** документ: «как безопасно и пошагово включить кабинеты в проде и как откатиться». Код кабинетов уже в `main` и работает под флагом. Реальные действия (флип env, redeploy, наблюдение) выполняет оператор — агент подготавливает процедуру, чеклисты и критерии go/no-go.

---

## 0. Механика флага (прочитать один раз)

Источник — [src/lib/featureFlags.ts](../src/lib/featureFlags.ts).

| Кабинет | Env-переменная | Включить | Выключить (или не ставить) |
|---|---|---|---|
| Organization | `FEATURE_ORGANIZATION_CABINET` | `1` / `true` / `on` / `yes` / `enabled` | `0` / `false` / `off` / `no` / `disabled` / **unset** |
| Manager | `FEATURE_MANAGER_CABINET` | `1` / `true` / `on` / `yes` / `enabled` | `0` / `false` / `off` / `no` / `disabled` / **unset** |

Значения trim'ятся и сравниваются case-insensitive. Оба флага **opt-in**: пустое/непоставленное значение = **OFF** (см. `OPT_IN_FLAGS` в `featureFlags.ts`).

**Где флаг читается (defense-in-depth, 3 точки):**

1. **Middleware** ([src/middleware.ts](../src/middleware.ts), `FEATURE_PREFIXES`): `/organization/*` → `organization_cabinet`, `/manager/*` → `manager_cabinet`. При OFF — **404** (после auth, чтобы не утекало существование префикса).
2. **Навигация** ([src/lib/navigation/cabinet.ts](../src/lib/navigation/cabinet.ts), `navItemsFor`): пункты меню с `flag` скрываются при OFF.
3. **Route handlers** (`requireFeature` / `notFoundIfDisabled`) — жёсткий блок API там, где он есть.

**Критичные нюансы — обязательно учесть оператору:**

- **Флип требует redeploy/restart.** `isFeatureEnabled()` читает `process.env` на каждый вызов (для тестов), но в проде env фиксируется при старте процесса. Менять флаг = выставить env и **перезапустить web-инстанс И worker-процесс** (флаг прокидывается в оба — worker фанит уведомления org/manager).
- **Зона действия — только `/organization/*` и `/manager/*`.** Кабинеты `partner` / `admin` / `student` флагами не затронуты.
- **`/student` НЕ под флагом** ([cabinet.ts](../src/lib/navigation/cabinet.ts), пункт `organization`): организация сохраняет доступ к кабинету слушателя даже при выключенном `organization_cabinet`.
- **Флаги независимы.** Org и manager раскатываются по отдельности и откатываются по отдельности. Рекомендуемый порядок — org → manager (org уже отрепетирован локально, см. §6), но можно параллельно.
- **`chat` — отдельный флаг.** `/organization/messages` дополнительно гейтится `chat` (middleware). У manager пункт «Сообщения» гейтится `manager_cabinet` (это лента комментариев к заказам, не чат). Не путать раскатку кабинета с раскаткой чата.

---

## 1. Stage-модель и гейты go/no-go

Раскатка идёт стадиями; переход на следующую — только после явного go.

| Stage | Что | Где | Окно | Гейт перехода |
|---|---|---|---|---|
| **1 — Dark (merged)** ✅ | Код в `main`, флаги OFF | prod | — | **Сделано.** Ничего включать не нужно. |
| **2 — Staging smoke** | Флаг=1 на staging, прогон smoke-чеклиста | staging | 1–2 недели | Все шаги smoke ✅ (или ⚠ с письменным waiver); нет regressions в логах/alerting |
| **3 — Prod pilot** | Флаг=1 в prod, реальная экспозиция ограничена пилотной когортой (см. §8) | prod | 1–2 недели | Пилот без инцидентов; внутренняя валидация UX ≥3 человека; go от тех.лида |
| **4 — GA** | Флаг остаётся =1, онбординг остальных org/менеджеров | prod | постоянно | — |

**Откат возможен на любой стадии** (см. §5) — это безопасная, обратимая операция.

---

## 2. Pre-flight (перед флипом в любом окружении)

Сверить **до** выставления флага. Это срез готовности инфраструктуры, без которого кабинет «включится», но будет работать криво.

| Чек | Команда / Действие | Ожидание |
|---|---|---|
| Deploy свежий | SHA на окружении == целевой коммит `main` | совпадает |
| Миграции применены | `npx prisma migrate status` | `Database schema is up to date` |
| C8-поля в БД (для manager) | миграция с `Company.managerTeamVisibility` + `User.managerRole` задеплоена | колонки есть (см. [schema.prisma:104,399](../prisma/schema.prisma)) |
| Worker запущен | процесс `npm run worker:start` / systemd-unit | очереди `oneCSync.*`, `notifications.dispatch`, `emails.send` слушают |
| Redis доступен | подключение из web и worker | OK — от него зависят rate-limit, alerting, health-readiness |
| Supabase bucket | загрузка тестового файла через admin | 200, файл в bucket `documents` |
| Resend | `EMAIL_ENABLED=true`, валидный `RESEND_API_KEY`, `EMAIL_FROM=…@otsfera.ru` | тестовый email доходит |
| `JWT_SECRET` | ≥ 32 символов на окружении | иначе middleware редиректит всех на `/login` ([middleware.ts](../src/middleware.ts)) |
| Liveness | `GET /api/health/live` | `200` |
| Readiness | `GET /api/health` (с health-токеном) | `200`, DB+Redis green ([api/health/route.ts](../src/app/api/health/route.ts)) |
| Alerting боевой | пороги queue/DLQ/sync-lag + каналы (in-app/email/Telegram) настроены | наблюдение в §4 «с зубами» |

---

## 3. Процедура флипа

> Делать **по одному кабинету за раз**. Сначала довести org до нужной стадии, затем manager (или согласованно, но не «оба разом вслепую»).

### 3.1 Выставить env (web **и** worker)

- Organization: `FEATURE_ORGANIZATION_CABINET=1`
- Manager: `FEATURE_MANAGER_CABINET=1`

**Vercel**: Project → Settings → Environment Variables → добавить переменную в нужное окружение (Production/Preview) → **Redeploy**. Worker (если деплоится отдельно) — выставить ту же переменную в его окружении и перезапустить.

**VPS / Docker**: добавить переменную в `.env` / `docker-compose` / systemd-unit для **обоих** сервисов (web + worker) → `docker compose up -d` (или `systemctl restart`).

### 3.2 Верифицировать включение (≤ 5 минут после redeploy)

- [ ] Под пользователем нужной роли `/{organization|manager}/dashboard` отдаёт страницу (не 404).
- [ ] В сайдбаре появились пункты кабинета (для manager-leader — также «Команда»).
- [ ] Под **чужой** ролью префикс по-прежнему даёт 404 / `/forbidden` (RBAC не сломан).
- [ ] `GET /api/health` всё ещё green; в `/admin/health` нет новых красных сигналов.
- [ ] В `/admin/sync` cursor-lag в норме (флип кабинета не должен влиять, но сверяем базлайн).

Если любой пункт ❌ — **откат (§5)**, разбор по логам, повтор.

---

## 4. Наблюдение

**Окно**: 1–2 недели на стадию (Stage-2 staging, Stage-3 prod-pilot).

**Дашборды и сигналы:**

- [`/admin/health`](../src/app/admin/health/page.tsx) — DB / Redis / worker / очереди.
- [`/admin/sync`](../src/app/admin/sync/page.tsx) — cursor-lag 1С (база; retry джоб вручную при необходимости).
- [`GET /api/health`](../src/app/api/health/route.ts) — readiness (DB+Redis, fail-closed).
- **Alerting** ([plan](superpowers/plans/2026-05-31-alerting-DONE.md)): queue depth / **DLQ** (failed-jobs хранятся, `removeOnFail:false`) / sync-lag → in-app + email + Telegram. Следить за новыми алертами после флипа.
- **Audit log** — всплеск ошибок? Новые потоки (`org_member_invited`, `document_download_signed_url`, `notification_sent`, …).
- **Логи**: `[worker] notifications.dispatch`, `[worker] emails.send`, RSC-ошибки, 5xx.

**Признаки успеха стадии:**

- Все шаги smoke-чеклиста ✅ (org: §6.1, manager: §6.2).
- Нет новых записей в DLQ, относимых к кабинету.
- Нет всплеска error-rate / 5xx.
- **Нет ни одного отчёта о cross-tenant data-leak** (см. critical-fail-шаги в smoke).
- Внутренняя валидация UX ≥ 3 человека (для manager — обязательно проверить роли regular-manager / leader / admin).

**Manager-специфика (C8)** — отдельно валидировать:

- Решить значение `Company.managerTeamVisibility` ([spec C8](superpowers/specs/2026-06-05-c8-manager-company-wide-design.md)): **OFF** (по умолчанию) = 3-way per-manager scope; **ON** = company-wide (любой менеджер компании видит всё по компании). Флип — рантайм-решением leader/admin.
- **Инвариант изоляции company↔company держится в ОБОИХ режимах** — это гарантия C8, проверяется smoke-шагом manager §6.2 (cross-company → 404).
- Роль `managerRole='leader'` назначается **только admin** (privesc-guard: leader не может выдать leader).
- **Уведомления остаются scoped** (видимость ≠ таргетинг) даже при company-wide ON.

---

## 5. Откат (rollback)

**Триггеры** (любой → откат немедленно):

- Cross-tenant data-leak (чужая org/компания видна в списках или по прямому ID).
- Всплеск error-rate / 5xx / новые DLQ-джобы, относимые к кабинету.
- Сломан core-flow (login → dashboard, документ-скачивание, инвайт).
- `/api/health` красный после флипа.

**Шаги** (на затронутый кабинет, независимо от второго):

```bash
# 1. Env (web + worker): FEATURE_ORGANIZATION_CABINET=0   # или FEATURE_MANAGER_CABINET=0
# 2. Redeploy / restart обоих процессов
# 3. /organization/*  (или /manager/*) снова отдаёт 404
# 4. Кабинеты partner / admin / student НЕ затронуты
# 5. Данные остаются: Order.organizationId и т.п. — read-only; 1С-sync продолжает писать идемпотентно
```

**Откатывать миграции не нужно** — feature-флаг это единственная точка отказа. C8-поля (`managerTeamVisibility`, `managerRole`) безвредны при выключенном кабинете.

---

## 6. Per-cabinet исполнение

### 6.1 Organization

- Stage-1 (merged, OFF) — ✅.
- Stage-2 smoke — чеклист: **[qa-staging-smoke-organization.md](qa-staging-smoke-organization.md)** (12 шагов, локальная репетиция пройдена 2026-05-29, см. Приложение A там).
- Спека/план: [organization-cabinet-design](superpowers/specs/2026-05-25-organization-cabinet-design.md) · [phase7-DONE](superpowers/plans/2026-05-25-organization-cabinet-phase7-DONE.md).

### 6.2 Manager

- Stage-1 (merged, OFF) — ✅.
- Stage-2 smoke — чеклист: **[qa-staging-smoke-manager.md](qa-staging-smoke-manager.md)** (с акцентом на C8 cross-company изоляцию, leader-роль и company-wide toggle).
- Спека/план: [manager-cabinet-design](superpowers/specs/2026-05-26-manager-cabinet-design.md) · [phase8-DONE](superpowers/plans/2026-05-26-manager-cabinet-phase8-DONE.md) · [C8-DONE](superpowers/plans/2026-06-05-c8-manager-company-wide-DONE.md).

---

## 7. После выхода в GA (Stage-4)

Когда кабинет стабильно работает в prod:

1. Обновить **[README §Cabinet rollout status](../README.md)** — «Состояние» соответствующей строки → `Production / GA (раскатан YYYY-MM-DD)`.
2. Обновить memory-референс ([organization](../../../C:/Users/karka/.claude/projects/D-------------------------------------------------/memory/reference-organization-plan.md) / [manager](../../../C:/Users/karka/.claude/projects/D-------------------------------------------------/memory/reference-manager-plan.md)) — `staged rollout COMPLETED YYYY-MM-DD`.
3. Отметить C7 в [roadmap](superpowers/specs/2026-06-02-completion-roadmap.md) как DONE (это закрывает C-track и весь проект по C-линии).

---

## 8. Известные ограничения

- **Глобальный boolean ≠ когортная раскатка.** Флаг включает кабинет для **всего окружения** сразу. «Пилот» в Stage-3 достигается не флагом, а контролем того, *у кого есть аккаунты/инвайты* (приглашаем одну пилотную организацию / небольшой набор менеджеров; у остальных просто нет учёток). Если потребуется настоящая per-org/per-company постепенная раскатка с одним общим prod-окружением — это **код-изменение** семантики `featureFlags` (per-tenant gate / allow-list + kill-switch), вынесено за рамки C7 (см. опцию «Runbook + код-страховка» в обсуждении C7).
- **Нет авто-метрики adoption.** Отдельного дашборда «сколько org/менеджеров реально зашли» нет; пролистывать audit log / login-события вручную или добавить метрику отдельной задачей.
