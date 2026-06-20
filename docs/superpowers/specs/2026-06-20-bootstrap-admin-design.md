# Spec — bootstrap первого администратора (`scripts/create-admin.ts`)

**Дата:** 2026-06-20
**Статус:** design approved (brainstorming)
**Автор/драйвер:** оператор Промтехносфера + агент

## 1. Проблема

В чистой (не-демо) БД невозможно войти: создание пользователей — замкнутый цикл.

- [`createUser`](../../../src/lib/services/admin/users/mutations.ts) требует `actorUserId` (существующего админа) и **явно отказывается создавать роль `admin`** (`admin_role_via_ui`).
- 1С-синхронизация (`oneCSync/**`) приносит организации/заказы/платежи, но **не** логинабельных пользователей с `passwordHash`.
- Единственное, что «чеканит» админа сегодня — `prisma/seed.ts`, т.е. **демо** (аккаунты `*@demo.local`).

Поэтому свежий боевой запуск (см. [runbook-launch-deploy.md](../../runbook-launch-deploy.md)) упирается в отсутствие первого админа. Этот скрипт закрывает пробел.

**Не-цель:** это не замена админки. Скрипт создаёт ровно одного bootstrap-админа; дальше всё через кабинет администратора (инвайты, создание пользователей).

## 2. Контракт

Разовый идемпотентный CLI-скрипт, запускается оператором руками:

```bash
ADMIN_EMAIL=… ADMIN_PASSWORD=… npx tsx scripts/create-admin.ts
# npm-алиас:
ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run db:create-admin
```

### Вход — только env (никаких CLI-аргументов: пароль не должен попадать в историю shell и в `ps`)

| Env | Обяз. | Дефолт | Валидация |
|---|---|---|---|
| `ADMIN_EMAIL` | да | — | непустой; базовый формат `x@y.z` |
| `ADMIN_PASSWORD` | да | — | длина **≥ 8** |
| `ADMIN_NAME` | нет | `Администратор` | — |
| `ADMIN_COMPANY` | нет | `Промтехносфера` | непустой после trim |

При отсутствии обязательных или провале валидации — понятное сообщение в stderr и `exit 1`, **никаких записей в БД**.

### Выходные коды

| Код | Случай |
|---|---|
| `0` | админ создан **или** уже существовал с ролью `admin` (идемпотентно) |
| `1` | ошибка валидации env; email занят НЕ-admin учёткой; сбой БД |

## 3. Логика

Чистая функция (ядро) + тонкий runner (env/печать/exit):

```ts
// ядро — тестируемое, по §3 Result-контракту
export async function bootstrapAdmin(
  prisma: PrismaClient,
  args: { email: string; password: string; name: string; company: string }
): Promise<
  | { ok: true; created: boolean; userId: string }
  | { ok: false; error: 'invalid_email' | 'weak_password' | 'email_taken_non_admin' }
>;
```

Шаги ядра:

1. **Валидация** `email` (формат) и `password` (длина ≥ 8) → при провале `{ ok:false, error }` (БД не трогаем).
2. **Компания**: `findFirst({ where: { name: company } })` → если нет, `create({ data: { name: company } })`. `Company.name` **не** `@unique`, поэтому find-or-create, а не `upsert`.
3. **Пользователь** по `email` (`findUnique`):
   - нет → `create { email, name, role:'admin', passwordHash, companyId, isActive:true }` → `{ ok:true, created:true, userId }`.
   - есть и `role === 'admin'` → не трогаем → `{ ok:true, created:false, userId }`.
   - есть и `role !== 'admin'` → `{ ok:false, error:'email_taken_non_admin' }` (чужую учётку молча не повышаем).
4. **Audit** (только при `created:true`): `recordAudit(prisma, { userId: <new id>, action:'admin_bootstrapped', entity:'user', entityId: <new id>, after: { email, role:'admin', companyId } })`. `entity:'user'` уже в `AuditEntity`.

Хеш пароля — `bcrypt.hash(password, 10)` (cost как в seed). Шаги 2–4 — в `prisma.$transaction`, чтобы при сбое не осталось компании без админа.

Runner:

1. Читает env, подставляет дефолты (`name`, `company`), trim.
2. Зовёт `bootstrapAdmin`.
3. Печатает результат:
   - `created:true` → `✓ admin создан: <email>`
   - `created:false` → `• admin уже существует: <email> (ничего не изменено)`
   - `ok:false` → понятная ошибка в stderr + `exit 1`.
4. Явно закрывает `prisma.$disconnect()` и `process.exit(code)` (надёжнее, чем полагаться на естественный выход; BullMQ здесь не импортируется, так что висящих хэндлов быть не должно — но явный exit дешевле отладки).

## 4. Безопасность (§12)

- Пароль приходит **только** из env (не из args/логов).
- Сам пароль **никогда** не печатается и не пишется в audit (в `after` только `email`/`role`/`companyId`).
- Хеш — bcrypt cost 10.
- Скрипт не открывает сетевых портов и не зависит от Redis/Supabase.

## 5. Тестирование (§6)

Integration-тест (TDD: тест пишется первым) на `bootstrapAdmin` против живого Postgres. Файл содержит `new PrismaClient(` → vitest сам относит его к integration-слою (self-detection, см. CLAUDE.md §6).

Покрываемые сценарии:

1. **happy path** — пустая БД → `created:true`, юзер с `role:'admin'`, `passwordHash` валиден против `bcrypt.compare`, привязан к новой компании; запись в `auditLog` (`action:'admin_bootstrapped'`).
2. **идемпотентность** — повторный вызов тем же email → `created:false`, ровно один пользователь, второй записи в audit нет.
3. **компания переиспользуется** — компания с таким `name` уже есть → новая не создаётся.
4. **email занят не-admin** — заранее создан `manager`/`partner` с этим email → `{ ok:false, error:'email_taken_non_admin' }`, роль НЕ изменилась.
5. **weak_password** — пароль < 8 → `{ ok:false, error:'weak_password' }`, в БД ничего не создано.
6. **invalid_email** — кривой email → `{ ok:false, error:'invalid_email' }`, в БД ничего не создано.

Скрипты в `scripts/` под per-glob coverage-гейт §6 не попадают (гейт — на `src/**`), поэтому отдельного порога нет; тест ценен как защита security-sensitive логики.

## 6. Файлы

- `scripts/create-admin.ts` — новый (ядро `bootstrapAdmin` + runner). Шапка-комментарий в стиле [dedupe-commission-statements.ts](../../../scripts/dedupe-commission-statements.ts).
- `package.json` — новый скрипт `"db:create-admin": "tsx scripts/create-admin.ts"`.
- `src/__tests__/scripts.create-admin.test.ts` — новый integration-тест.
- `.env.example` — добавить закомментированный блок `ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME/ADMIN_COMPANY` с пометкой «для bootstrap первого админа; никогда не коммитить реальные значения».

## 7. Открытые вопросы

Нет — все развилки (вход=env, идемпотентность=safe/refuse-non-admin, компания=find-or-create, мин. длина=8, тест=нужен) решены на этапе brainstorming.
