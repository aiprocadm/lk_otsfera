# Runbook — боевой запуск (launch-readiness, все 6 ролей)

**Owner**: тех.лид Промтехносфера (деплой + флип env) + DBA/ops (миграция + dedupe) + QA (smoke) + поддержка партнёров (F2-коммуникация)
**Scope**: разворот в prod кода треков **T1–T5 + F6 + T4**, смерженного в `main` через [PR #124](https://github.com/aiprocadm/lk_otsfera/pull/124) (2026-06-15).
**Roadmap**: [launch-readiness-roadmap](superpowers/specs/2026-06-13-launch-readiness-roadmap.md).
**Не-цель**: этот runbook не раскатывает кабинеты постадийно (это [runbook-staged-rollout-cabinets.md](runbook-staged-rollout-cabinets.md), C7) — он про **порядок и безопасность одного боевого деплоя**: миграции, схлопывание дублей, включение флагов, перевод 1С в live, коммуникация партнёрам.

> Операционный документ. Код уже в `main` и верифицирован (unit 1558, integration 59 файлов / 399 тестов, build зелёный; операторский прогон закрыл 3 реальных бага). Реальные действия выполняет оператор; агент даёт процедуру, чеклисты и go/no-go.

---

## 0. Что именно разворачиваем (один раз прочитать)

| Трек | Поведение в prod после запуска | Гейтинг |
|---|---|---|
| T1 | Excel + API 1С-ингестии сведены к одному writer'у (`oneCSync/writers.ts`); финансы/комиссия считаются и на импортированных данных | всегда вкл |
| T2 | REST-адаптер 1С (Q5/Q6/Q10 + DOC-03) — **код есть, выключен** | `ONE_C_ADAPTER` / `ONE_C_MODE` |
| T3 | Менеджер видит лиды (`/manager/leads`); партнёр видит заказы **только через свои лиды** (F2) | `manager_cabinet` (+ см. §6 — F2 поведенческий) |
| T4 | 4 блокера закрыты: DOC-01 (изоляция доков), C-01/C-05 (дубли ведомостей), C-02 (уведомление о ведомости) | всегда вкл; **C-01 требует pre-deploy gate — см. §2** |
| T5 | Заявки на обучение для 5 ролей (`/…/enrollments`) | `enrollment_requests` |
| F6 | Семантика leader-дашборда «стоимость в работе» (executionStatus-ось), явно подписана | всегда вкл |

**Две вещи, которые реально могут уронить прод, если сделать не глядя:**
1. **Порядок C-01:** `dedupe:commission` **строго до** `migrate deploy` (§2). Иначе partial-unique индекс не построится на существующих дублях и миграция упадёт.
2. **Дефолт 1С:** `ONE_C_MODE` дефолтит в **`live`** (`oneCSync/config.ts:4`). Когда выставишь `ONE_C_ADAPTER=rest`, ингестия пойдёт **сразу в боевую запись**, если явно не задать `ONE_C_MODE=shadow` (§4). До репетиции `ONE_C_ADAPTER` держать `fake` (по умолчанию = живых записей нет).

---

## 0.1 Свежая БД (запуск с нуля) vs существующий прод — выбери ветку

Этот runbook по умолчанию написан под **существующий** прод: §2 `dedupe:commission` схлопывает уже накопленные дубли ведомостей, §6 оповещает уже работающих партнёров. Для **свежей/пустой** БД (первый боевой запуск) появляются шаги, которых иначе нет — и наоборот, часть существующих становится no-op.

**Свежая БД — Step 0 (выполнить ДО §3.2 миграций):**

1. **Bootstrap первого администратора.** В чистой БД войти невозможно — замкнутый цикл: `createUser` ([admin/users/mutations.ts](../src/lib/services/admin/users/mutations.ts)) отказывает в роли `admin`, 1С-синхронизация юзеров не создаёт, единственный источник admin раньше был demo-`seed.ts`. Завести боевого админа:
   ```bash
   ADMIN_EMAIL=<email> ADMIN_PASSWORD=<≥8 символов> npm run db:create-admin
   # опц.: ADMIN_NAME (деф. «Администратор»), ADMIN_COMPANY (деф. «Промтехносфера»)
   ```
   Вход **только через env** (пароль не в shell-history / `ps`). Идемпотентно (повтор = no-op, пароль не перезаписывается). Дальше все остальные учётки — через кабинет админа (инвайты). Детали — [scripts/create-admin.ts](../scripts/create-admin.ts).
2. **Демо-офф.** `SHOW_DEMO_LOGINS` **не выставлять** (или `off`) — иначе на `/login` отрисуется блок с готовыми демо-логинами/паролями (раскрытие учёток). Это server-only env, **не** `FEATURE_`-флаг.
3. **Demo-seed НЕ запускать.** `npm run prisma:seed` создаёт `*@demo.local` / «Demo LLC» — это демоданные, в проде не нужны.
4. **§2 `dedupe:commission`** на свежей БД безвреден, но избыточен: dry-run сразу даст `OK` (дублей ведомостей ещё нет). Прогнать ради проверки можно, `--apply` не понадобится.

**Существующий прод:** Step 0 пропустить целиком, идти с §2; bootstrap не нужен (админ уже есть).

---

## 1. Класс флагов (важно не перепутать)

Источник — [src/lib/featureFlags.ts](../src/lib/featureFlags.ts). Env-имя = `FEATURE_<UPPER_SNAKE>`.

| Флаг | Env | Класс | Дефолт (unset) | Действие на launch |
|---|---|---|---|---|
| `organization_cabinet` | `FEATURE_ORGANIZATION_CABINET` | opt-in | **OFF** | включить → `1` |
| `manager_cabinet` | `FEATURE_MANAGER_CABINET` | opt-in | **OFF** | включить → `1` |
| `leader_cabinet` | `FEATURE_LEADER_CABINET` | opt-in | **OFF** | включить → `1` |
| `chat` | `FEATURE_CHAT` | opt-in | **OFF** | включить, если чат в первой волне |
| `enrollment_requests` | `FEATURE_ENROLLMENT_REQUESTS` | opt-in | **OFF** | включить → `1` (T5) |
| `partner_leads` | `FEATURE_PARTNER_LEADS` | opt-out | **ON** | ничего не делать (уже вкл) |
| `commission_pdf` / `commission_xlsx` / `pwa_installer` | соотв. | opt-out | **ON** | ничего не делать |

**Ловушка дефолтов:** «забыл выставить env» ведёт себя противоположно для двух классов — opt-in остаётся **OFF** (кабинет → 404), opt-out остаётся **ON**. Поэтому проверка «все opt-in флаги первой волны явно =1» обязательна (§3.3). Флип любого флага требует **redeploy web И worker** (env фиксируется при старте процесса) — механика и 3 точки чтения описаны в [runbook-staged-rollout-cabinets.md §0](runbook-staged-rollout-cabinets.md).

---

## 2. Pre-deploy gate (C-01) — выполнить ПЕРВЫМ, до миграций

Миграция `20260614000000_commission_statement_partial_unique` добавляет **partial-unique** индекс на `(partnerId, periodFrom, periodTo) WHERE supersededBy IS NULL`. Если в prod уже есть >1 «живой» (non-superseded) ведомости в группе — `CREATE UNIQUE INDEX` упадёт во время `migrate deploy`.

```bash
# 1. DRY-RUN (read-only): показывает дубли, ничего не меняет. Exit 0 = чисто, exit 1 = есть дубли.
DATABASE_URL=<PROD> npm run dedupe:commission

# 2. Если dry-run нашёл дубли — применить (оставляет свежую по calculatedAt, остальные supersede):
DATABASE_URL=<PROD> npm run dedupe:commission -- --apply

# 3. Повторить dry-run → должно быть "OK — no duplicate live statements".
DATABASE_URL=<PROD> npm run dedupe:commission
```

**Гейт перехода к §3:** dry-run завершается с `OK`. Скрипт идемпотентен и безопасен (дубли не удаляются, а помечаются `supersededBy` — тем же дискриминатором, что использует индекс и приложение). Подробности — шапка [scripts/dedupe-commission-statements.ts](../scripts/dedupe-commission-statements.ts).

---

## 3. Процедура деплоя

### 3.1 Pre-flight
Сверить инфраструктурный срез из [runbook-staged-rollout-cabinets.md §2](runbook-staged-rollout-cabinets.md) (deploy свежий, worker запущен, Redis/Supabase/Resend живы, `JWT_SECRET` ≥32, `/api/health` green). **Плюс launch-специфика:**

| Чек | Команда / действие | Ожидание |
|---|---|---|
| C-01 gate пройден | §2 dry-run | `OK` |
| Деплой = целевой `main` | SHA окружения == `main` (PR #124 merged) | совпадает |
| 1С безопасен по умолчанию | `ONE_C_ADAPTER` не выставлен или `=fake` | живых 1С-записей нет до §4 |

### 3.2 Применить миграции
```bash
npx prisma migrate status          # ожидание: pending миграции из PR #124
npx prisma migrate deploy          # применяет partial-unique (C-01) + enrollment_requests (T5)
npx prisma migrate status          # ожидание: "Database schema is up to date"
```
Ключевые миграции волны: `20260614000000_commission_statement_partial_unique` (C-01, raw SQL — Prisma не выражает partial-unique), `20260615030202_enrollment_requests` (T5, аддитивная). Откатывать миграции для отключения фич **не нужно** — всё гейтится флагами.

### 3.3 Включить opt-in флаги первой волны (web + worker)
```
FEATURE_ORGANIZATION_CABINET=1
FEATURE_MANAGER_CABINET=1
FEATURE_LEADER_CABINET=1
FEATURE_ENROLLMENT_REQUESTS=1
FEATURE_CHAT=1            # только если чат идёт в первую волну; иначе оставить unset
```
Выставить в env **обоих** процессов (web + worker) → redeploy/restart обоих. Затем верифицировать (≤5 мин):
- [ ] под нужной ролью `/{organization|manager|leader}/dashboard` и `/…/enrollments` отдают страницу (не 404);
- [ ] под **чужой** ролью префиксы по-прежнему 404 / `/forbidden` (RBAC цел);
- [ ] `/api/enrollments` под валидной ролью → не 404 (флаг виден route-handler'у);
- [ ] `GET /api/health` green; в `/admin/health` нет новых красных сигналов.

Любой ❌ → откат (§5), разбор по логам.

---

## 4. Включение живой 1С (T2) — отдельным шагом, после стабилизации кабинетов

> Не совмещать с §3. Сначала убедиться, что кабинеты и финансы работают на текущих (Excel-импортированных) данных, потом подключать live-поток.

1. **Shadow-репетиция** против реальной 1С (записи НЕ идут в БД):
   ```
   ONE_C_ADAPTER=rest
   ONE_C_API_URL=<реальный>
   ONE_C_API_TOKEN=<реальный>
   ONE_C_MODE=shadow        # ОБЯЗАТЕЛЬНО явно — дефолт=live пишет в боевую БД
   ```
   Наблюдать в `/admin/sync`: cursor продвигается, RU-статусы переводятся (`translate.ts`, иначе live=0 строк), пагинация Q6 обходит все страницы (нет undercount первой страницы), DOC-03 качает файлы в Supabase. Сверить расхождения shadow vs ожидание.
2. **Go/no-go:** shadow без аномалий, cursor-lag в норме, перевод справочников полный.
3. **Перевод в live:** `ONE_C_MODE=live` (или снять override) → redeploy worker. Наблюдать первый цикл записи в `/admin/sync` + alerting (sync-lag / DLQ).

**Откат 1С:** `ONE_C_ADAPTER=fake` (или `ONE_C_MODE=shadow`) → restart worker. Уже записанные данные идемпотентны, не повреждаются.

---

## 5. Откат (rollback)

**Триггеры** (любой → откат немедленно): cross-tenant data-leak; всплеск 5xx / новые DLQ-джобы; сломан core-flow (login→dashboard, скачивание документа, инвайт, расчёт комиссии); `/api/health` красный.

**Шаги** (по слоям, независимо):
- **Фичи волны** — выставить соответствующий `FEATURE_*=0` (или `unset` для opt-in) → redeploy web+worker. Кабинеты partner/admin/student не затронуты.
- **1С** — `ONE_C_ADAPTER=fake` → restart worker.
- **Миграции откатывать НЕ нужно.** Partial-unique (C-01) и `EnrollmentRequest` (T5) безвредны при выключенных фичах; данные read-only.

---

## 6. F2 — поведенческое изменение, нужна коммуникация партнёрам

T3/F2 — это **чистый флип видимости**: партнёр теперь видит заказы **только** через свои лиды (`promotedFromLead.partnerId`); импортированные из 1С заказы для него **невидимы**. Это не баг, а решение владельца — но для партнёра выглядит как «пропали заказы».

**Действие до/в момент запуска:** оповестить партнёров (письмо/уведомление), что список заказов теперь формируется из их лидов, и как заводить лид. Без этого — поток обращений в поддержку. (Текст коммуникации — на стороне поддержки/владельца; код-уведомления S5 шлёт только о смене статуса лида, не об изменении модели видимости.)

---

## 7. После запуска

1. Включить opt-in флаги зафиксировать в [README §Cabinet rollout status](../README.md) как раскатанные (дата).
2. Прогнать WSL/host integration новых тестов, если ещё не на этом окружении ([project-wsl-live-pg-verification], host-БД `cabinet` доступна напрямую).
3. Закрыть треки T1–T5 в [launch-readiness-roadmap](superpowers/specs/2026-06-13-launch-readiness-roadmap.md) как DONE; обновить close-out'ы (`-PARTIAL.md` → отметить операторскую часть выполненной).
4. Наблюдение 1–2 недели по [§4 staged-rollout runbook](runbook-staged-rollout-cabinets.md) (DLQ, sync-lag, error-rate, audit log).

---

## 8. Чек-лист одной страницей (порядок строгий)

- [ ] **(свежая БД)** §0.1 Step 0: `db:create-admin` создан · `SHOW_DEMO_LOGINS` снят/`off` · demo-seed НЕ запускался
- [ ] §2 `dedupe:commission` dry-run → `--apply` (если нужно) → dry-run `OK` *(свежая БД → сразу `OK`, `--apply` не нужен)*
- [ ] §3.2 `prisma migrate deploy` → `up to date`
- [ ] §3.3 `FEATURE_*=1` (org/manager/leader/enrollment [+chat]) на web **и** worker → redeploy обоих → верификация
- [ ] §6 коммуникация партнёрам про F2 отправлена
- [ ] §4 1С: shadow-репетиция → go/no-go → `ONE_C_MODE=live` (отдельным окном)
- [ ] §7 README + roadmap + наблюдение
