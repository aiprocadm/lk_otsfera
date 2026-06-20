# Bootstrap Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать оператору разовый идемпотентный CLI (`npm run db:create-admin`), создающий первого реального `admin` в не-демо БД, чтобы закрыть «замкнутый цикл» (через приложение admin создать нельзя).

**Architecture:** Один файл `scripts/create-admin.ts` = чистое тестируемое ядро `bootstrapAdmin(prisma, args)` (Result-тип по §3) + тонкий runner (читает env, печатает, выставляет exit-код, защищён guard'ом от запуска при импорте из теста). Integration-тест бьёт по ядру против живого Postgres.

**Tech Stack:** TypeScript, Prisma 5, bcryptjs, Vitest (integration mode), tsx.

**Spec:** [docs/superpowers/specs/2026-06-20-bootstrap-admin-design.md](../specs/2026-06-20-bootstrap-admin-design.md)

---

## File Structure

- **Create** `scripts/create-admin.ts` — ядро `bootstrapAdmin` (экспорт) + runner `main()` под guard. Шапка-комментарий в стиле [scripts/dedupe-commission-statements.ts](../../../scripts/dedupe-commission-statements.ts).
- **Create** `src/__tests__/scripts.bootstrap-admin.test.ts` — integration-тест (содержит `new PrismaClient(` → vitest сам относит к integration-слою).
- **Modify** `package.json` — добавить скрипт `db:create-admin`.
- **Modify** `.env.example` — закомментированный блок `ADMIN_*`.

**Зависимости от существующего кода:**
- `recordAudit` из [src/lib/auth/audit.ts](../../../src/lib/auth/audit.ts): `recordAudit(prisma, { userId, action, entity:'user', entityId, after? })` (`entity:'user'` уже в `AuditEntity`).
- Паттерн скрипта-на-tsx и `bcrypt.hash(pw, 10)` — как в [prisma/seed.ts](../../../prisma/seed.ts).

---

## Task 1: Ядро `bootstrapAdmin` (TDD)

**Files:**
- Create: `src/__tests__/scripts.bootstrap-admin.test.ts`
- Create: `scripts/create-admin.ts`

**Требование:** перед запуском должен быть поднят локальный Postgres с БД `cabinet` (`pwsh -File scripts/dev-stack.ps1 -NoDev`) — тест integration-слоя.

- [ ] **Step 1: Написать падающий integration-тест**

Создать `src/__tests__/scripts.bootstrap-admin.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { bootstrapAdmin } from '../../scripts/create-admin';

const prisma = new PrismaClient();

const EMAIL = 'bootstrap-admin@test.local';
const EMAIL_TAKEN = 'bootstrap-taken@test.local';
const COMPANY = 'Bootstrap Test Co (fixture)';
const PASSWORD = 'BootstrapPw123';

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { in: [EMAIL, EMAIL_TAKEN] } },
    select: { id: true }
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.company.deleteMany({ where: { name: COMPANY } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('bootstrapAdmin', () => {
  it('создаёт admin в пустой БД (happy path)', async () => {
    const res = await bootstrapAdmin(prisma, {
      email: EMAIL,
      password: PASSWORD,
      name: 'Администратор',
      company: COMPANY
    });
    expect(res).toEqual({ ok: true, created: true, userId: expect.any(String) });

    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(user?.role).toBe('admin');
    expect(user?.isActive).toBe(true);
    expect(user?.companyId).toBeTruthy();
    expect(await bcrypt.compare(PASSWORD, user!.passwordHash!)).toBe(true);

    const company = await prisma.company.findFirst({ where: { name: COMPANY } });
    expect(user?.companyId).toBe(company?.id);

    const audit = await prisma.auditLog.findMany({ where: { userId: user!.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('admin_bootstrapped');
  });

  it('идемпотентен: повтор не создаёт второго и не пишет второй audit', async () => {
    const first = await bootstrapAdmin(prisma, { email: EMAIL, password: PASSWORD, name: 'A', company: COMPANY });
    expect(first.ok && first.created).toBe(true);

    const second = await bootstrapAdmin(prisma, { email: EMAIL, password: PASSWORD, name: 'A', company: COMPANY });
    expect(second).toEqual({ ok: true, created: false, userId: expect.any(String) });

    const users = await prisma.user.findMany({ where: { email: EMAIL } });
    expect(users).toHaveLength(1);
    const audit = await prisma.auditLog.findMany({ where: { userId: users[0].id } });
    expect(audit).toHaveLength(1);
  });

  it('переиспользует существующую компанию по имени', async () => {
    await prisma.company.create({ data: { name: COMPANY } });
    await bootstrapAdmin(prisma, { email: EMAIL, password: PASSWORD, name: 'A', company: COMPANY });
    const companies = await prisma.company.findMany({ where: { name: COMPANY } });
    expect(companies).toHaveLength(1);
  });

  it('отказывает, если email занят НЕ-admin учёткой', async () => {
    await prisma.user.create({
      data: { email: EMAIL_TAKEN, name: 'Менеджер', role: 'manager', isActive: true }
    });
    const res = await bootstrapAdmin(prisma, { email: EMAIL_TAKEN, password: PASSWORD, name: 'A', company: COMPANY });
    expect(res).toEqual({ ok: false, error: 'email_taken_non_admin' });

    const user = await prisma.user.findUnique({ where: { email: EMAIL_TAKEN } });
    expect(user?.role).toBe('manager');
  });

  it('отклоняет слабый пароль и ничего не создаёт', async () => {
    const res = await bootstrapAdmin(prisma, { email: EMAIL, password: 'short', name: 'A', company: COMPANY });
    expect(res).toEqual({ ok: false, error: 'weak_password' });
    expect(await prisma.user.findUnique({ where: { email: EMAIL } })).toBeNull();
  });

  it('отклоняет некорректный email и ничего не создаёт', async () => {
    const res = await bootstrapAdmin(prisma, { email: 'not-an-email', password: PASSWORD, name: 'A', company: COMPANY });
    expect(res).toEqual({ ok: false, error: 'invalid_email' });
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run --mode=integration src/__tests__/scripts.bootstrap-admin.test.ts`
Expected: FAIL — `bootstrapAdmin` не экспортируется (нет файла `scripts/create-admin.ts`).

- [ ] **Step 3: Реализовать ядро (минимально для green)**

Создать `scripts/create-admin.ts`:

```ts
// scripts/create-admin.ts
//
// Bootstrap первого реального администратора в не-демо БД.
//
// В чистой БД войти невозможно: createUser (admin/users) требует existing admin
// и отказывается создавать роль admin; 1С-синхронизация юзеров не создаёт;
// единственный сегодняшний источник admin — seed.ts (демо). Этот скрипт даёт
// оператору разовый идемпотентный способ завести первого боевого админа.
//
// Запуск (вход только через env — пароль не должен попадать в историю shell / ps):
//   ADMIN_EMAIL=admin@example.ru ADMIN_PASSWORD=secret12 npm run db:create-admin
// Необязательные: ADMIN_NAME (деф. «Администратор»), ADMIN_COMPANY (деф. «Промтехносфера»).
//
// Коды выхода: 0 — создан или уже был admin; 1 — ошибка валидации / email занят
// не-admin / сбой БД.

import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { recordAudit } from '../src/lib/auth/audit';

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BootstrapAdminArgs = {
  email: string;
  password: string;
  name: string;
  company: string;
};

export type BootstrapAdminResult =
  | { ok: true; created: boolean; userId: string }
  | { ok: false; error: 'invalid_email' | 'weak_password' | 'email_taken_non_admin' };

export async function bootstrapAdmin(
  prisma: PrismaClient,
  args: BootstrapAdminArgs
): Promise<BootstrapAdminResult> {
  const email = args.email.trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' };
  if (args.password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'weak_password' };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role === ('admin' as Role)) {
      return { ok: true, created: false, userId: existing.id };
    }
    return { ok: false, error: 'email_taken_non_admin' };
  }

  const passwordHash = await bcrypt.hash(args.password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const existingCompany = await tx.company.findFirst({ where: { name: args.company } });
    const company = existingCompany ?? (await tx.company.create({ data: { name: args.company } }));

    const created = await tx.user.create({
      data: {
        email,
        name: args.name,
        role: 'admin' as Role,
        passwordHash,
        companyId: company.id,
        isActive: true
      }
    });

    await recordAudit(tx, {
      userId: created.id,
      action: 'admin_bootstrapped',
      entity: 'user',
      entityId: created.id,
      after: { email, role: 'admin', companyId: company.id }
    });

    return created;
  });

  return { ok: true, created: true, userId: user.id };
}
```

- [ ] **Step 4: Запустить тест — убедиться, что зелёный**

Run: `npx vitest run --mode=integration src/__tests__/scripts.bootstrap-admin.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add scripts/create-admin.ts src/__tests__/scripts.bootstrap-admin.test.ts
git commit -m "feat(scripts): bootstrapAdmin core + integration tests"
```

---

## Task 2: Runner (env → ядро → exit) + guard

**Files:**
- Modify: `scripts/create-admin.ts` (дописать runner в конец файла)

Runner НЕ покрывается автотестом (process.exit/env) — проверяется вручную (Step 3). Guard не даёт runner'у выполниться при импорте из теста.

- [ ] **Step 1: Дописать runner в конец `scripts/create-admin.ts`**

```ts

// --- Runner: выполняется только при прямом запуске (tsx scripts/create-admin.ts),
// --- но НЕ при импорте ядра из тестов. ---

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Администратор';
  const company = process.env.ADMIN_COMPANY?.trim() || 'Промтехносфера';

  if (!email || !password) {
    console.error('✗ Заданы не все обязательные env: ADMIN_EMAIL и ADMIN_PASSWORD.');
    console.error('  Пример: ADMIN_EMAIL=admin@example.ru ADMIN_PASSWORD=secret12 npm run db:create-admin');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let code = 0;
  try {
    const result = await bootstrapAdmin(prisma, { email, password, name, company });
    if (!result.ok) {
      const msg: Record<'invalid_email' | 'weak_password' | 'email_taken_non_admin', string> = {
        invalid_email: 'некорректный ADMIN_EMAIL',
        weak_password: `ADMIN_PASSWORD короче ${MIN_PASSWORD_LENGTH} символов`,
        email_taken_non_admin: 'email уже занят пользователем с другой ролью — повышение до admin запрещено'
      };
      console.error(`✗ ${msg[result.error]}`);
      code = 1;
    } else if (result.created) {
      console.log(`✓ admin создан: ${email}`);
    } else {
      console.log(`• admin уже существует: ${email} (ничего не изменено)`);
    }
  } catch (err) {
    console.error('✗ Ошибка БД при создании админа:', err);
    code = 1;
  } finally {
    await prisma.$disconnect();
  }
  process.exit(code);
}

const invoked = (process.argv[1] ?? '').replace(/\\/g, '/');
if (invoked.endsWith('scripts/create-admin.ts')) {
  void main();
}
```

- [ ] **Step 2: typecheck + убедиться, что тесты ядра всё ещё зелёные (guard не сломал импорт)**

Run: `npm run typecheck && npx vitest run --mode=integration src/__tests__/scripts.bootstrap-admin.test.ts`
Expected: typecheck без ошибок; 6 passed (импорт ядра из теста НЕ запускает runner).

- [ ] **Step 3: Ручная проверка runner'а (нужен живой Postgres)**

```bash
# happy path:
ADMIN_EMAIL=manual-bootstrap@test.local ADMIN_PASSWORD=secret12 npx tsx scripts/create-admin.ts
# Expected: "✓ admin создан: manual-bootstrap@test.local", exit 0

# идемпотентность (повтор):
ADMIN_EMAIL=manual-bootstrap@test.local ADMIN_PASSWORD=secret12 npx tsx scripts/create-admin.ts
# Expected: "• admin уже существует: …", exit 0

# слабый пароль:
ADMIN_EMAIL=x@y.ru ADMIN_PASSWORD=short npx tsx scripts/create-admin.ts
# Expected: "✗ ADMIN_PASSWORD короче 8 символов", exit 1

# нет env:
npx tsx scripts/create-admin.ts
# Expected: "✗ Заданы не все обязательные env…", exit 1
```

Подчистить тестового юзера после ручной проверки:
```bash
ADMIN_EMAIL=manual-bootstrap@test.local npx tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); const u=await p.user.findUnique({where:{email:process.env.ADMIN_EMAIL}}); if(u){await p.auditLog.deleteMany({where:{userId:u.id}}); await p.user.delete({where:{id:u.id}});} await p.\$disconnect();"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/create-admin.ts
git commit -m "feat(scripts): create-admin runner (env-driven, guarded)"
```

---

## Task 3: Wiring — npm-скрипт + `.env.example`

**Files:**
- Modify: `package.json` (раздел `scripts`)
- Modify: `.env.example`

- [ ] **Step 1: Добавить npm-скрипт**

В `package.json`, в объект `scripts`, рядом с `db:recreate-local`:

```json
"db:create-admin": "tsx scripts/create-admin.ts",
```

- [ ] **Step 2: Добавить блок в `.env.example`**

Дописать в конец `.env.example`:

```bash
# --- Bootstrap первого администратора (scripts/create-admin.ts, `npm run db:create-admin`) ---
# Разовый идемпотентный скрипт для не-демо БД (чистый локальный стенд / свежий прод).
# Вход ТОЛЬКО через env (не CLI-аргументы) — пароль не попадает в историю shell / ps.
# НИКОГДА не коммитить реальные значения.
# ADMIN_EMAIL=admin@example.ru       # обязателен
# ADMIN_PASSWORD=replace_me_min8     # обязателен, ≥ 8 символов
# ADMIN_NAME=Администратор           # необязателен (дефолт)
# ADMIN_COMPANY=Промтехносфера       # необязателен (дефолт)
```

- [ ] **Step 3: Проверить, что npm-скрипт виден и валиден**

Run: `npm run db:create-admin`
Expected: `✗ Заданы не все обязательные env…` + exit 1 (env не выставлен — это корректное поведение, подтверждает, что алиас резолвится и запускает скрипт).

- [ ] **Step 4: Commit**

```bash
git add package.json .env.example
git commit -m "chore(scripts): db:create-admin npm alias + .env.example block"
```

---

## Финальная проверка (после всех задач)

- [ ] `npm run typecheck` — без ошибок.
- [ ] `npm run lint` — без ошибок.
- [ ] `npx vitest run --mode=integration src/__tests__/scripts.bootstrap-admin.test.ts` — 6 passed.
- [ ] Обновить `docs/superpowers/specs/2026-06-20-bootstrap-admin-design.md` → создать рядом close-out `2026-06-20-bootstrap-admin-DONE.md` (что отгружено) по конвенции CLAUDE.md §8.

> Примечание: `npm run gate` (L2.5) на этой машине висит, если хост держит :5432 (известный нюанс) — для PR прогонять integration вручную (живой Postgres уже поднят), либо push `--no-verify`.
