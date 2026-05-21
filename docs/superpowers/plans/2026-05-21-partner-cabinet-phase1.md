# Партнёрский кабинет — Фаза 1 (Каркас партнёра) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать партнёру-администратору рабочий каркас личного кабинета: дашборд с реальными KPI и «требует внимания», портфель организаций со сводными показателями и фильтрами, карточка организации без сделок/документов (они в Phase 2) с overрайдом ставки комиссии, страница команды партнёра с инвайтом менеджеров и scope-привязкой к организациям. Все защищено сабролью `PartnerUser.roleInPartner` и scope-фильтром по `assignedOrgIds`.

**Architecture:**
- Саброльная RBAC поверх существующего middleware: в JWT-сессию добавляются `partnerRole` (admin|manager) и `assignedOrgIds` при логине; middleware проверяет path-префиксы (`/partner/team`, `/partner/portfolio/[orgId]/settings` → только admin), а тонкая проверка scope-видимости делается в policy-хелперах для server components и API routes.
- Service Layer (`src/lib/services/partner/*`) — чистые функции `(prisma, args) → result`, без HTTP. Это позволяет вызывать их и из server components (без лишнего round-trip), и из API routes, и в тестах подменять prisma.
- UI — Server Components для чтений (списки, карточки), Client Components только там где нужен state (фильтры, формы инвайта, переключение табов). Используем существующий `AppShell` + расширяем `navByRole.partner`, добавляем `BottomTabBar` для мобильного.
- Phase 1 НЕ затрагивает реальный 1С — `Order.totalAmount` и `paidAmount` берутся из БД (наполнение из 1С — Phase 3); пока для KPI данные могут быть пустыми/демо-фикстурами через seed.

**Tech Stack:** Next.js 15 (App Router, Server Components), TypeScript, Prisma 5, Vitest, Zod, Tailwind, jose JWT, существующий `AppShell` и брендинг (#F97316 / #111111).

**Spec:** [`docs/superpowers/specs/2026-05-21-partner-cabinet-design.md`](../specs/2026-05-21-partner-cabinet-design.md), особенно §2.3, §3.1-3.2, §5, §7.

**Phase 0:** [`docs/superpowers/plans/2026-05-21-partner-cabinet-phase0-DONE.md`](2026-05-21-partner-cabinet-phase0-DONE.md) — все модели данных, миграции, BullMQ-инфраструктура и 1С fake-adapter уже готовы.

**Estimated duration:** ~2 недели (1 разработчик full-time) или ~1 неделя (2 разработчика: API/service ↔ UI).

**Out of scope (Phase 2+):**
- UI сделок (`/partner/deals`), лидов (`/partner/leads`), документов (`/partner/documents`), финансов (`/partner/finance`).
- Тулинг типа Comments по карточке org за пределами уже существующих `Comment` на Order — простой read-only список.
- Реальный 1С sync (`/api/integrations/1c/*`) — Phase 3.
- PDF/XLSX генерация комиссии — Phase 4.
- Воронка сделок на дашборде (§5.2 desktop-only) — нужен полный deals UI, переезжает в Phase 2.
- Storage RLS (§7.4) — нужен только когда появятся загрузки документов (Phase 2).

**Сознательные упрощения Phase 1 (не баги, а отложенный scope):**
- Фильтры портфеля (§5.3) — реализуем только name search и pagination. Остальные (hasDebt / hasActiveDeals / productMix / assignedManagerId) откладываются до Phase 2, где их можно унифицировать с фильтрами по сделкам.
- `SavedView` модель уже в БД (§3.2), но UI «сохранить фильтр / поделиться» не делаем — пока хватает state в URL. Sharable URL уже даёт 80% ценности.
- Bulk actions с чекбоксами (§5.10 п.4) — НЕ делаем, нет mutation-операций над списками в Phase 1.
- Расширенные audit-log entries (§7.5 — invite/deactivate PartnerUser) — пока пишем audit только для rate override; остальные — Phase 2.

---

## Pre-flight: окружение и подготовка

Перед началом работ убедитесь:

- [ ] **Pre-1: Git identity настроена локально**

```bash
git config user.email
git config user.name
```

Если пусто — настроить:

```bash
git config user.email "your-email@example.com"
git config user.name "Your Name"
```

- [ ] **Pre-2: На ветке `claude/partner-cabinet-phase0`, всё чисто**

```bash
git status
git branch --show-current
```

Ожидаемо: `claude/partner-cabinet-phase0`, working tree clean. Phase 1 продолжается в той же ветке (см. handoff в `.remember/remember.md`).

- [ ] **Pre-3: Postgres и Redis подняты, Prisma сгенерирован**

```bash
docker compose up -d db redis
docker compose ps
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
```

Ожидаемо: оба контейнера `healthy`, миграции применены (последняя — `20260521150000_partner_cabinet_phase0`).

- [ ] **Pre-4: Baseline зелёный**

```bash
npm test
npm run typecheck
npm run build
```

Ожидаемо: 74 теста PASS, 0 type errors, build successful (как в Phase 0 DONE).

- [ ] **Pre-5: Запомните baseline-хэш**

```bash
git log -1 --oneline
```

Зафиксируйте — на него будете откатываться, если что-то пойдёт не так. На момент старта Phase 1 baseline = `ea9671a` (chore(gitignore): exclude local assistant/session state).

---

## Часть 1 — Фундамент: статусные хелперы и обогащение сессии

### Task 1: Чистый хелпер `humanStage` для двухмерного статуса

Спека §5.5 требует комбинированный лейбл из `executionStatus + financialStatus` для отображения «стадии» сделки. Делаем чистую функцию заранее — она будет использована во многих UI (org card → orders tab Phase 2, dashboard attention list).

**Files:**
- Create: `src/lib/orders/humanStage.ts`
- Create: `src/__tests__/orders.humanStage.test.ts`

- [ ] **Step 1.1: Написать тест**

Создать `src/__tests__/orders.humanStage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { humanStage, type StageInput } from '@/lib/orders/humanStage';

describe('humanStage', () => {
  it('returns "Новая, не выставлен счёт" for pending + not_billed', () => {
    const stage = humanStage({ executionStatus: 'pending', financialStatus: 'not_billed' });
    expect(stage.label).toBe('Новая, счёт не выставлен');
    expect(stage.tone).toBe('neutral');
  });

  it('returns "В работе, частично оплачена" for in_progress + partially_paid', () => {
    const stage = humanStage({ executionStatus: 'in_progress', financialStatus: 'partially_paid' });
    expect(stage.label).toBe('В работе, частично оплачена');
    expect(stage.tone).toBe('warning');
  });

  it('returns "Завершена, оплачена" for completed + paid', () => {
    const stage = humanStage({ executionStatus: 'completed', financialStatus: 'paid' });
    expect(stage.label).toBe('Завершена, оплачена');
    expect(stage.tone).toBe('success');
  });

  it('marks cancelled regardless of finance as "Отменена"', () => {
    const stage = humanStage({ executionStatus: 'cancelled', financialStatus: 'billed' });
    expect(stage.label).toBe('Отменена');
    expect(stage.tone).toBe('danger');
  });

  it('marks refunded as "Возврат"', () => {
    const stage = humanStage({ executionStatus: 'completed', financialStatus: 'refunded' });
    expect(stage.label).toBe('Возврат');
    expect(stage.tone).toBe('danger');
  });

  it('marks on_hold as "На паузе"', () => {
    const stage = humanStage({ executionStatus: 'on_hold', financialStatus: 'billed' });
    expect(stage.label).toBe('На паузе');
    expect(stage.tone).toBe('warning');
  });

  it('falls back to dash on unknown combo', () => {
    const stage = humanStage({ executionStatus: 'pending', financialStatus: 'refunded' });
    expect(stage.label).toBe('—');
    expect(stage.tone).toBe('neutral');
  });

  it('accepts inputs typed as StageInput', () => {
    const input: StageInput = { executionStatus: 'pending', financialStatus: 'not_billed' };
    expect(humanStage(input).label).toBeTypeOf('string');
  });
});
```

- [ ] **Step 1.2: Запустить — FAIL (модуля нет)**

```bash
npx vitest run src/__tests__/orders.humanStage.test.ts
```

Ожидаемо: FAIL «Cannot find module '@/lib/orders/humanStage'».

- [ ] **Step 1.3: Реализовать хелпер**

Создать `src/lib/orders/humanStage.ts`:

```typescript
import type { ExecutionStatus, FinancialStatus } from '@prisma/client';

export type StageTone = 'neutral' | 'success' | 'warning' | 'danger';

export type StageInput = {
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
};

export type Stage = {
  label: string;
  tone: StageTone;
};

export function humanStage(input: StageInput): Stage {
  const { executionStatus, financialStatus } = input;

  if (executionStatus === 'cancelled') return { label: 'Отменена', tone: 'danger' };
  if (financialStatus === 'refunded') return { label: 'Возврат', tone: 'danger' };
  if (executionStatus === 'on_hold') return { label: 'На паузе', tone: 'warning' };

  if (executionStatus === 'pending' && financialStatus === 'not_billed')
    return { label: 'Новая, счёт не выставлен', tone: 'neutral' };
  if (executionStatus === 'pending' && financialStatus === 'billed')
    return { label: 'Ожидает старта, выставлен счёт', tone: 'neutral' };
  if (executionStatus === 'in_progress' && financialStatus === 'not_billed')
    return { label: 'В работе, счёт не выставлен', tone: 'warning' };
  if (executionStatus === 'in_progress' && financialStatus === 'billed')
    return { label: 'В работе, выставлен счёт', tone: 'neutral' };
  if (executionStatus === 'in_progress' && financialStatus === 'partially_paid')
    return { label: 'В работе, частично оплачена', tone: 'warning' };
  if (executionStatus === 'in_progress' && financialStatus === 'paid')
    return { label: 'В работе, оплачена', tone: 'success' };
  if (executionStatus === 'completed' && financialStatus === 'paid')
    return { label: 'Завершена, оплачена', tone: 'success' };
  if (executionStatus === 'completed' && financialStatus === 'partially_paid')
    return { label: 'Завершена, частично оплачена', tone: 'warning' };
  if (executionStatus === 'completed' && financialStatus === 'billed')
    return { label: 'Завершена, ожидаем оплату', tone: 'warning' };
  if (executionStatus === 'completed' && financialStatus === 'not_billed')
    return { label: 'Завершена, счёт не выставлен', tone: 'warning' };

  return { label: '—', tone: 'neutral' };
}
```

- [ ] **Step 1.4: Тест PASS**

```bash
npx vitest run src/__tests__/orders.humanStage.test.ts
```

Ожидаемо: 8 passed.

- [ ] **Step 1.5: Коммит**

```bash
git add src/lib/orders/humanStage.ts src/__tests__/orders.humanStage.test.ts
git commit -m "feat(orders): humanStage helper for two-dimensional order status"
```

---

### Task 2: Расширить `SessionPayload` сабролью партнёра

Спека §7.1 определяет sub-роли через `PartnerUser.roleInPartner`. Чтобы middleware и server components могли быстро их проверять без лишнего DB-запроса при каждом запросе, кладём `partnerRole` и `assignedOrgIds` в JWT.

**Files:**
- Modify: `src/lib/auth/jwt.ts`
- Create: `src/__tests__/auth.jwt.partner-payload.test.ts`

- [ ] **Step 2.1: Тест**

Создать `src/__tests__/auth.jwt.partner-payload.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { SessionPayload, PartnerRoleInPartner } from '@/lib/auth/jwt';

describe('SessionPayload partner sub-role', () => {
  it('exposes optional partnerRole and assignedOrgIds', () => {
    expectTypeOf<SessionPayload>().toHaveProperty('partnerRole');
    expectTypeOf<SessionPayload>().toHaveProperty('assignedOrgIds');
  });

  it('PartnerRoleInPartner is union of admin | manager', () => {
    const admin: PartnerRoleInPartner = 'admin';
    const manager: PartnerRoleInPartner = 'manager';
    expect([admin, manager]).toEqual(['admin', 'manager']);
  });
});
```

- [ ] **Step 2.2: FAIL — тип не существует**

```bash
npx vitest run src/__tests__/auth.jwt.partner-payload.test.ts
```

Ожидаемо: FAIL «Module '"@/lib/auth/jwt"' has no exported member 'PartnerRoleInPartner'».

- [ ] **Step 2.3: Расширить тип**

В `src/lib/auth/jwt.ts` добавить экспорт перед `SessionPayload`:

```typescript
export type PartnerRoleInPartner = 'admin' | 'manager';
```

И в `SessionPayload` добавить два поля:

```typescript
export type SessionPayload = {
  sub: string;
  role: Role;
  companyId?: string | null;
  partnerId?: string | null;
  partnerRole?: PartnerRoleInPartner | null;
  assignedOrgIds?: string[];
  organizationId?: string | null;
  email?: string;
  name?: string;
  externalStudentId?: string | null;
};
```

- [ ] **Step 2.4: Тест PASS**

```bash
npx vitest run src/__tests__/auth.jwt.partner-payload.test.ts
```

Ожидаемо: 2 passed.

- [ ] **Step 2.5: Прогнать весь typecheck — ничего не сломалось**

```bash
npm run typecheck
```

Ожидаемо: 0 errors. Поля optional → существующий код не ломается.

- [ ] **Step 2.6: Коммит**

```bash
git add src/lib/auth/jwt.ts src/__tests__/auth.jwt.partner-payload.test.ts
git commit -m "feat(auth): extend SessionPayload with partnerRole and assignedOrgIds"
```

---

### Task 3: Login-роут обогащает сессию данными `PartnerUser`

При успешной аутентификации пользователя с ролью `partner` нужно подтянуть его запись `PartnerUser` (если есть) и положить `roleInPartner` + `assignedOrgIds` в JWT.

**Files:**
- Modify: `src/app/api/auth/login/route.ts`
- Create: `src/__tests__/api.auth.login.partner-enrichment.test.ts`

- [ ] **Step 3.1: Прочитать существующий login-роут**

```bash
cat src/app/api/auth/login/route.ts
```

Запомнить структуру: bcrypt-сверка, `signToken({ sub, role, partnerId, ... })`. Нужно добавить ОДИН prisma-запрос если `user.role === 'partner'`.

- [ ] **Step 3.2: Тест**

Создать `src/__tests__/api.auth.login.partner-enrichment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    partnerUser: { findUnique: vi.fn() }
  }
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(true) },
  compare: vi.fn().mockResolvedValue(true)
}));

vi.mock('@/lib/auth/jwt', () => ({
  signToken: vi.fn().mockResolvedValue('signed.jwt.token')
}));

import { prisma } from '@/lib/db/prisma';
import { signToken } from '@/lib/auth/jwt';
import { POST } from '@/app/api/auth/login/route';

const fakePartnerUser = {
  partnerId: 'partner-1',
  userId: 'user-1',
  email: 'p@test.local',
  passwordHash: 'hash',
  name: 'Партнёр',
  role: 'partner' as const,
  companyId: null,
  organizationId: null,
  externalStudentId: null
};

function makeRequest(body: object) {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('POST /api/auth/login partner enrichment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET = 'login-test-secret-with-at-least-32-chars';
  });

  it('signs JWT with partnerRole=admin and assignedOrgIds=[] for partner admin', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakePartnerUser as any);
    vi.mocked(prisma.partnerUser.findUnique).mockResolvedValue({
      id: 'pu-1', partnerId: 'partner-1', userId: 'user-1',
      roleInPartner: 'admin', assignedOrgIds: [], isActive: true
    } as any);
    vi.mocked(signToken).mockResolvedValue('jwt-with-admin');

    const res = await POST(makeRequest({ email: 'p@test.local', password: 'x' }));
    expect(res.status).toBe(200);

    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({
      sub: 'user-1',
      role: 'partner',
      partnerId: 'partner-1',
      partnerRole: 'admin',
      assignedOrgIds: []
    }));
  });

  it('signs JWT with partnerRole=manager and assignedOrgIds=[orgA,orgB] for scoped manager', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakePartnerUser as any);
    vi.mocked(prisma.partnerUser.findUnique).mockResolvedValue({
      id: 'pu-2', partnerId: 'partner-1', userId: 'user-1',
      roleInPartner: 'manager', assignedOrgIds: ['orgA', 'orgB'], isActive: true
    } as any);

    await POST(makeRequest({ email: 'p@test.local', password: 'x' }));

    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({
      partnerRole: 'manager',
      assignedOrgIds: ['orgA', 'orgB']
    }));
  });

  it('omits partner fields if user has no PartnerUser record (legacy partner)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakePartnerUser as any);
    vi.mocked(prisma.partnerUser.findUnique).mockResolvedValue(null);

    await POST(makeRequest({ email: 'p@test.local', password: 'x' }));

    const arg = vi.mocked(signToken).mock.calls[0][0];
    expect(arg.partnerRole).toBeUndefined();
    expect(arg.assignedOrgIds).toBeUndefined();
  });

  it('refuses login if PartnerUser exists but isActive=false', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakePartnerUser as any);
    vi.mocked(prisma.partnerUser.findUnique).mockResolvedValue({
      id: 'pu-3', partnerId: 'partner-1', userId: 'user-1',
      roleInPartner: 'manager', assignedOrgIds: [], isActive: false
    } as any);

    const res = await POST(makeRequest({ email: 'p@test.local', password: 'x' }));
    expect(res.status).toBe(403);
    expect(signToken).not.toHaveBeenCalled();
  });

  it('does not query partnerUser if role != partner', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...fakePartnerUser, role: 'admin' } as any);

    await POST(makeRequest({ email: 'a@test.local', password: 'x' }));

    expect(prisma.partnerUser.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.3: FAIL — текущий роут не делает enrichment**

```bash
npx vitest run src/__tests__/api.auth.login.partner-enrichment.test.ts
```

Ожидаемо: FAIL.

- [ ] **Step 3.4: Открыть и модифицировать login-роут**

Файл `src/app/api/auth/login/route.ts` сейчас выглядит примерно так (свериться через `cat`):

```typescript
// EXISTING (schematic)
const user = await prisma.user.findUnique({ where: { email } });
if (!user || !(await compare(password, user.passwordHash))) {
  return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
}
const token = await signToken({
  sub: user.id, role: user.role, partnerId: user.partnerId,
  companyId: user.companyId, organizationId: user.organizationId,
  email: user.email, name: user.name, externalStudentId: user.externalStudentId
});
```

Заменить блок формирования payload на следующий (сохраняя остальную логику cookies, etc.):

```typescript
let partnerRole: 'admin' | 'manager' | undefined;
let assignedOrgIds: string[] | undefined;

if (user.role === 'partner' && user.partnerId) {
  const membership = await prisma.partnerUser.findUnique({
    where: { partnerId_userId: { partnerId: user.partnerId, userId: user.id } }
  });

  if (membership) {
    if (!membership.isActive) {
      return NextResponse.json({ error: 'Account deactivated' }, { status: 403 });
    }
    partnerRole = membership.roleInPartner === 'admin' ? 'admin' : 'manager';
    assignedOrgIds = membership.assignedOrgIds;
  }
}

const token = await signToken({
  sub: user.id,
  role: user.role,
  partnerId: user.partnerId,
  companyId: user.companyId,
  organizationId: user.organizationId,
  email: user.email,
  name: user.name,
  externalStudentId: user.externalStudentId,
  ...(partnerRole !== undefined ? { partnerRole } : {}),
  ...(assignedOrgIds !== undefined ? { assignedOrgIds } : {})
});
```

**Важно:** `partnerUser.findUnique({ where: { partnerId_userId: ... } })` использует составной unique-ключ из схемы (`@@unique([partnerId, userId])` в `PartnerUser`).

- [ ] **Step 3.5: Тест PASS**

```bash
npx vitest run src/__tests__/api.auth.login.partner-enrichment.test.ts
```

Ожидаемо: 5 passed.

- [ ] **Step 3.6: Прогон всех тестов login — старые тесты не сломались**

```bash
npx vitest run src/__tests__/auth.login.route.test.ts
```

Ожидаемо: PASS как раньше. Если упало — добавьте `vi.mocked(prisma.partnerUser.findUnique).mockResolvedValue(null)` в setUp существующих тестов.

- [ ] **Step 3.7: Коммит**

```bash
git add src/app/api/auth/login/route.ts src/__tests__/api.auth.login.partner-enrichment.test.ts
git commit -m "feat(auth): enrich partner session with roleInPartner and assignedOrgIds at login"
```

---

## Часть 2 — RBAC: middleware и policy-хелперы

### Task 4: Middleware блокирует не-admin'ов на `/partner/team` и settings

Спека §7.2: `/partner/team/*` и `/partner/portfolio/[orgId]/settings` — только для admin (`partnerRole === 'admin'`). Делаем проверку в middleware (грубая, на path-уровне), точная проверка orgId scope — в server components / API.

**Files:**
- Modify: `src/middleware.ts`
- Create: `src/__tests__/auth.middleware.partner-subrole.test.ts`

- [ ] **Step 4.1: Тест**

Создать `src/__tests__/auth.middleware.partner-subrole.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jose', () => ({ jwtVerify: vi.fn() }));

import { jwtVerify } from 'jose';
import { middleware } from '@/middleware';

function req(pathname: string, token = 'tkn') {
  return {
    url: `https://app.local${pathname}`,
    nextUrl: { pathname },
    cookies: { get: vi.fn().mockReturnValue({ value: token }) }
  } as any;
}

describe('middleware partner sub-role', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET = 'middleware-sub-test-secret-with-at-least-32-chars';
  });

  it('redirects partner manager away from /partner/team to /forbidden', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: [] }
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('allows partner admin on /partner/team', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'admin', assignedOrgIds: [] }
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects manager from /partner/portfolio/abc/settings to /forbidden', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: ['abc'] }
    } as any);

    const res = await middleware(req('/partner/portfolio/abc/settings'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('allows manager on /partner/portfolio/abc (without /settings suffix)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: ['abc'] }
    } as any);

    const res = await middleware(req('/partner/portfolio/abc'));

    expect(res.status).toBe(200);
  });

  it('does not apply sub-role check to non-partner roles', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'admin' }
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(200);
  });

  it('treats partner without partnerRole (legacy) as non-admin (cannot access /partner/team)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerId: 'p1' }
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });
});
```

- [ ] **Step 4.2: FAIL — middleware пока не делает sub-role check**

```bash
npx vitest run src/__tests__/auth.middleware.partner-subrole.test.ts
```

- [ ] **Step 4.3: Расширить `src/middleware.ts`**

После существующей проверки `protectedPrefixes` (около строки 47, ПЕРЕД `if (pathname === '/' || pathname === '/dashboard')`) добавить блок:

```typescript
    if (role === 'partner') {
      const partnerRole = (payload as { partnerRole?: 'admin' | 'manager' }).partnerRole;
      const isAdminOnly =
        pathname.startsWith('/partner/team') ||
        /^\/partner\/portfolio\/[^/]+\/settings(?:\/|$)/.test(pathname);

      if (isAdminOnly && partnerRole !== 'admin') {
        return NextResponse.redirect(new URL('/forbidden', req.url));
      }
    }
```

- [ ] **Step 4.4: Тесты PASS**

```bash
npx vitest run src/__tests__/auth.middleware.partner-subrole.test.ts
npx vitest run src/__tests__/auth.middleware.test.ts
```

Ожидаемо: оба файла зелёные.

- [ ] **Step 4.5: Коммит**

```bash
git add src/middleware.ts src/__tests__/auth.middleware.partner-subrole.test.ts
git commit -m "feat(auth): middleware gates /partner/team and /portfolio/*/settings to admin sub-role"
```

---

### Task 5: Policy-хелперы для scope-видимости организаций

Спека §7.2: «либо `partnerId` совпадает, либо (если `assignedOrgIds` непустой) — `orgId` в этом списке». Реализуем чистый predicate и фильтр-фабрику, которые будут использованы во всех partner API/Server Components.

**Files:**
- Modify: `src/lib/auth/policy.ts` (добавить функции)
- Create: `src/__tests__/auth.policy.partner-scope.test.ts`

- [ ] **Step 5.1: Тест**

Создать `src/__tests__/auth.policy.partner-scope.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() }
  }
}));

import { prisma } from '@/lib/db/prisma';
import {
  canPartnerAccessOrg,
  partnerOrgScopeFilter,
  isPartnerAdmin
} from '@/lib/auth/policy';
import type { SessionPayload } from '@/lib/auth/jwt';

const partnerAdminSession: SessionPayload = {
  sub: 'u1', role: 'partner', partnerId: 'p1',
  partnerRole: 'admin', assignedOrgIds: []
};

const partnerManagerScopedSession: SessionPayload = {
  sub: 'u2', role: 'partner', partnerId: 'p1',
  partnerRole: 'manager', assignedOrgIds: ['orgA', 'orgB']
};

const partnerManagerEmptyScopeSession: SessionPayload = {
  sub: 'u3', role: 'partner', partnerId: 'p1',
  partnerRole: 'manager', assignedOrgIds: []
};

describe('isPartnerAdmin', () => {
  it('returns true only for partner role with partnerRole=admin', () => {
    expect(isPartnerAdmin(partnerAdminSession)).toBe(true);
    expect(isPartnerAdmin(partnerManagerScopedSession)).toBe(false);
    expect(isPartnerAdmin({ ...partnerAdminSession, role: 'admin' })).toBe(false);
    expect(isPartnerAdmin({ ...partnerAdminSession, partnerRole: undefined })).toBe(false);
  });
});

describe('canPartnerAccessOrg', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns true for admin partner if org belongs to partner', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgZ', partnerId: 'p1'
    } as any);

    expect(await canPartnerAccessOrg(partnerAdminSession, 'orgZ')).toBe(true);
  });

  it('returns false for partner if org belongs to different partner', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgZ', partnerId: 'OTHER'
    } as any);

    expect(await canPartnerAccessOrg(partnerAdminSession, 'orgZ')).toBe(false);
  });

  it('returns true for scoped manager if orgId in assignedOrgIds', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgA', partnerId: 'p1'
    } as any);

    expect(await canPartnerAccessOrg(partnerManagerScopedSession, 'orgA')).toBe(true);
  });

  it('returns false for scoped manager if orgId not in assignedOrgIds (even own partner)', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgC', partnerId: 'p1'
    } as any);

    expect(await canPartnerAccessOrg(partnerManagerScopedSession, 'orgC')).toBe(false);
  });

  it('returns true for manager with empty assignedOrgIds (= all in partner)', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgX', partnerId: 'p1'
    } as any);

    expect(await canPartnerAccessOrg(partnerManagerEmptyScopeSession, 'orgX')).toBe(true);
  });

  it('returns false if org not found', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

    expect(await canPartnerAccessOrg(partnerAdminSession, 'missing')).toBe(false);
  });
});

describe('partnerOrgScopeFilter', () => {
  it('returns { partnerId } only for admin/empty scope', () => {
    expect(partnerOrgScopeFilter(partnerAdminSession)).toEqual({ partnerId: 'p1' });
    expect(partnerOrgScopeFilter(partnerManagerEmptyScopeSession)).toEqual({ partnerId: 'p1' });
  });

  it('returns { partnerId, id: { in } } for scoped manager', () => {
    expect(partnerOrgScopeFilter(partnerManagerScopedSession)).toEqual({
      partnerId: 'p1',
      id: { in: ['orgA', 'orgB'] }
    });
  });

  it('returns impossible filter if no partnerId on session', () => {
    expect(partnerOrgScopeFilter({ sub: 'x', role: 'partner' } as SessionPayload)).toEqual({
      id: { in: [] }
    });
  });
});
```

- [ ] **Step 5.2: FAIL — функции не существуют**

```bash
npx vitest run src/__tests__/auth.policy.partner-scope.test.ts
```

- [ ] **Step 5.3: Добавить функции в `src/lib/auth/policy.ts`**

В конец файла добавить:

```typescript
export function isPartnerAdmin(session: SessionPayload): boolean {
  return session.role === 'partner' && session.partnerRole === 'admin';
}

export async function canPartnerAccessOrg(
  session: SessionPayload,
  organizationId: string
): Promise<boolean> {
  if (session.role !== 'partner' || !session.partnerId) return false;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { partnerId: true }
  });
  if (!org || org.partnerId !== session.partnerId) return false;

  const scope = session.assignedOrgIds ?? [];
  if (scope.length === 0) return true;
  return scope.includes(organizationId);
}

export function partnerOrgScopeFilter(
  session: SessionPayload
): { partnerId: string } | { partnerId: string; id: { in: string[] } } | { id: { in: never[] } } {
  if (!session.partnerId) return { id: { in: [] } };

  const scope = session.assignedOrgIds ?? [];
  if (scope.length === 0) return { partnerId: session.partnerId };
  return { partnerId: session.partnerId, id: { in: scope } };
}
```

- [ ] **Step 5.4: Тесты PASS**

```bash
npx vitest run src/__tests__/auth.policy.partner-scope.test.ts
```

Ожидаемо: 9 passed.

- [ ] **Step 5.5: Коммит**

```bash
git add src/lib/auth/policy.ts src/__tests__/auth.policy.partner-scope.test.ts
git commit -m "feat(auth): partner sub-role policy helpers (isPartnerAdmin, canPartnerAccessOrg, partnerOrgScopeFilter)"
```

---

### Task 6: Guard-хелперы для API роутов

Чтобы каждый partner API route не повторял `requireSession + requireRole(['partner']) + isPartnerAdmin`, делаем тонкие хелперы.

**Files:**
- Modify: `src/lib/auth/guard.ts`
- Create: `src/__tests__/auth.guard.partner.test.ts`

- [ ] **Step 6.1: Тест**

Создать `src/__tests__/auth.guard.partner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { requirePartner, requirePartnerAdmin } from '@/lib/auth/guard';
import type { SessionPayload } from '@/lib/auth/jwt';

const adminPartner: SessionPayload = {
  sub: 'u1', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
};

const managerPartner: SessionPayload = {
  sub: 'u2', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: []
};

const platformAdmin: SessionPayload = { sub: 'u3', role: 'admin' };

const orgUser: SessionPayload = { sub: 'u4', role: 'organization', organizationId: 'o1' };

describe('requirePartner', () => {
  it('passes for partner session with partnerId', () => {
    const r = requirePartner(adminPartner);
    expect(r.ok).toBe(true);
  });

  it('forbids non-partner roles', async () => {
    const r = requirePartner(orgUser);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it('forbids partner without partnerId', async () => {
    const r = requirePartner({ ...adminPartner, partnerId: null });
    expect(r.ok).toBe(false);
  });

  it('forbids platform admin (we want partner-scoped only)', () => {
    const r = requirePartner(platformAdmin);
    expect(r.ok).toBe(false);
  });
});

describe('requirePartnerAdmin', () => {
  it('passes for partner with partnerRole=admin', () => {
    const r = requirePartnerAdmin(adminPartner);
    expect(r.ok).toBe(true);
  });

  it('forbids partner manager', async () => {
    const r = requirePartnerAdmin(managerPartner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it('forbids platform admin', () => {
    const r = requirePartnerAdmin(platformAdmin);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 6.2: FAIL**

```bash
npx vitest run src/__tests__/auth.guard.partner.test.ts
```

- [ ] **Step 6.3: Добавить хелперы в `src/lib/auth/guard.ts`**

В конец файла:

```typescript
import { isPartnerAdmin } from './policy';

export function requirePartner(session: SessionPayload): GuardResult<SessionPayload & { partnerId: string }> {
  if (session.role !== 'partner' || !session.partnerId) {
    return { ok: false, response: forbiddenResponse('Partner access only') };
  }
  return { ok: true, value: session as SessionPayload & { partnerId: string } };
}

export function requirePartnerAdmin(session: SessionPayload): GuardResult<SessionPayload & { partnerId: string }> {
  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult;
  if (!isPartnerAdmin(session)) {
    return { ok: false, response: forbiddenResponse('Partner admin only') };
  }
  return partnerResult;
}
```

- [ ] **Step 6.4: Тесты PASS**

```bash
npx vitest run src/__tests__/auth.guard.partner.test.ts
```

Ожидаемо: 7 passed.

- [ ] **Step 6.5: Коммит**

```bash
git add src/lib/auth/guard.ts src/__tests__/auth.guard.partner.test.ts
git commit -m "feat(auth): requirePartner and requirePartnerAdmin API guards"
```

---

## Часть 3 — Service Layer: portfolio, dashboard, team, rate override

Сервисы — чистые функции `(prisma, args) → Promise<result>`. Не зависят от Next.js / Request. Используются из API роутов (тонкая обёртка) и из Server Components (прямой вызов без HTTP). Это паттерн «service layer», который спека §2.1 явно одобряет.

### Task 7: `portfolio.ts` — список организаций партнёра с KPI

Спека §5.3: колонки «Организация, ИНН, Ответств., Сделок, Долг», server-side pagination, фильтры (имя, hasDebt, hasActiveDeals).

**Files:**
- Create: `src/lib/services/partner/portfolio.ts`
- Create: `src/__tests__/services.partner.portfolio.test.ts`

- [ ] **Step 7.1: Тест (integration с реальной БД)**

Создать `src/__tests__/services.partner.portfolio.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listPortfolio } from '@/lib/services/partner/portfolio';

let prisma: PrismaClient;
let partnerId: string;
let otherPartnerId: string;
let orgIds: { withDebt: string; clean: string; otherPartner: string };

beforeAll(async () => {
  prisma = new PrismaClient();

  const partner = await prisma.partner.create({ data: { name: 'TestP-' + Date.now() } });
  const other = await prisma.partner.create({ data: { name: 'OtherP-' + Date.now() } });
  partnerId = partner.id;
  otherPartnerId = other.id;

  const company = await prisma.company.create({ data: { name: 'C-' + Date.now() } });

  const withDebt = await prisma.organization.create({
    data: { name: 'OrgДолг', partnerId, companyId: company.id, inn: '7700000001' }
  });
  const clean = await prisma.organization.create({
    data: { name: 'OrgЧистый', partnerId, companyId: company.id, inn: '7700000002' }
  });
  const otherPartnerOrg = await prisma.organization.create({
    data: { name: 'OrgЧужой', partnerId: otherPartnerId, companyId: company.id }
  });

  await prisma.order.create({
    data: {
      title: 'Сделка с долгом', companyId: company.id, partnerId,
      totalAmount: 100000, paidAmount: 40000,
      executionStatus: 'in_progress', financialStatus: 'partially_paid'
    }
  });
  await prisma.order.create({
    data: {
      title: 'Завершённая', companyId: company.id, partnerId,
      totalAmount: 50000, paidAmount: 50000,
      executionStatus: 'completed', financialStatus: 'paid'
    }
  });

  orgIds = { withDebt: withDebt.id, clean: clean.id, otherPartner: otherPartnerOrg.id };
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { partnerId: { in: [partnerId, otherPartnerId] } } });
  await prisma.organization.deleteMany({ where: { partnerId: { in: [partnerId, otherPartnerId] } } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerId, otherPartnerId] } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'C-' } } });
  await prisma.$disconnect();
});

describe('listPortfolio', () => {
  it('returns only organizations of the given partner', async () => {
    const result = await listPortfolio(prisma, { partnerId, take: 50, skip: 0 });
    const names = result.items.map((o) => o.name);
    expect(names).toContain('OrgДолг');
    expect(names).toContain('OrgЧистый');
    expect(names).not.toContain('OrgЧужой');
  });

  it('returns total count and pagination metadata', async () => {
    const result = await listPortfolio(prisma, { partnerId, take: 1, skip: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('computes KPI fields per organization (ordersCount, debt)', async () => {
    const result = await listPortfolio(prisma, { partnerId, take: 50, skip: 0 });
    const debtOrg = result.items.find((o) => o.name === 'OrgДолг');
    const cleanOrg = result.items.find((o) => o.name === 'OrgЧистый');

    expect(debtOrg).toBeDefined();
    expect(debtOrg!.ordersCount).toBe(0);
    // На самом деле сделки привязаны к company, не к org. KPI основан на company.organizations
    // ordersCount = заказы компании организации, debt = sum(totalAmount - paidAmount) для активных
    // В этом тесте обе организации в одной компании → ordersCount=2 для обеих
    expect(cleanOrg).toBeDefined();
  });

  it('respects scopeOrgIds filter', async () => {
    const result = await listPortfolio(prisma, {
      partnerId,
      scopeOrgIds: [orgIds.withDebt],
      take: 50,
      skip: 0
    });
    const names = result.items.map((o) => o.name);
    expect(names).toEqual(['OrgДолг']);
  });

  it('filters by name search (case-insensitive substring)', async () => {
    const result = await listPortfolio(prisma, {
      partnerId, search: 'долг', take: 50, skip: 0
    });
    expect(result.items.map((o) => o.name)).toEqual(['OrgДолг']);
  });
});
```

- [ ] **Step 7.2: FAIL — сервис не существует**

- [ ] **Step 7.3: Реализовать сервис**

Создать `src/lib/services/partner/portfolio.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';

export type PortfolioFilters = {
  partnerId: string;
  scopeOrgIds?: string[];
  search?: string;
  take: number;
  skip: number;
};

export type PortfolioItem = {
  id: string;
  name: string;
  inn: string | null;
  assignedManagerUserId: string | null;
  ordersCount: number;
  debt: string; // Decimal как строка для безопасной сериализации
};

export type PortfolioResult = {
  items: PortfolioItem[];
  total: number;
};

export async function listPortfolio(
  prisma: PrismaClient,
  filters: PortfolioFilters
): Promise<PortfolioResult> {
  const where = {
    partnerId: filters.partnerId,
    ...(filters.scopeOrgIds && filters.scopeOrgIds.length > 0
      ? { id: { in: filters.scopeOrgIds } }
      : {}),
    ...(filters.search
      ? { name: { contains: filters.search, mode: 'insensitive' as const } }
      : {})
  };

  const [total, rows] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: { name: 'asc' },
      take: filters.take,
      skip: filters.skip,
      select: {
        id: true,
        name: true,
        inn: true,
        assignedManagerUserId: true,
        companyId: true
      }
    })
  ]);

  const items: PortfolioItem[] = await Promise.all(
    rows.map(async (org) => {
      if (!org.companyId) return baseItem(org, 0, '0');

      const orders = await prisma.order.findMany({
        where: { companyId: org.companyId, partnerId: filters.partnerId },
        select: { totalAmount: true, paidAmount: true, executionStatus: true }
      });

      const ordersCount = orders.length;
      const debt = orders
        .filter((o) => o.executionStatus !== 'cancelled')
        .reduce((sum, o) => sum + Number(o.totalAmount) - Number(o.paidAmount), 0);

      return baseItem(org, ordersCount, debt.toFixed(2));
    })
  );

  return { items, total };
}

function baseItem(
  org: { id: string; name: string; inn: string | null; assignedManagerUserId: string | null },
  ordersCount: number,
  debt: string
): PortfolioItem {
  return {
    id: org.id,
    name: org.name,
    inn: org.inn,
    assignedManagerUserId: org.assignedManagerUserId,
    ordersCount,
    debt
  };
}
```

- [ ] **Step 7.4: Тест PASS**

```bash
npx vitest run src/__tests__/services.partner.portfolio.test.ts
```

Ожидаемо: 5 passed (требует поднятого Postgres).

- [ ] **Step 7.5: Коммит**

```bash
git add src/lib/services/partner/portfolio.ts src/__tests__/services.partner.portfolio.test.ts
git commit -m "feat(partner): listPortfolio service with KPI per organization"
```

---

### Task 8: `dashboard.ts` — 4 KPI для дашборда

Спека §5.2: «открытые сделки, к оплате (сумма), комиссия за месяц, лиды в обработке».

**Files:**
- Create: `src/lib/services/partner/dashboard.ts`
- Create: `src/__tests__/services.partner.dashboard.kpis.test.ts`

- [ ] **Step 8.1: Тест**

Создать `src/__tests__/services.partner.dashboard.kpis.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { kpis } from '@/lib/services/partner/dashboard';

let prisma: PrismaClient;
let partnerId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: 'KpiP-' + Date.now(), commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: 'KpiC-' + Date.now() } });
  const orgA = await prisma.organization.create({
    data: { name: 'A', partnerId, companyId: company.id }
  });

  await prisma.order.createMany({
    data: [
      {
        title: 'Открытая 1', companyId: company.id, partnerId,
        totalAmount: 100000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed'
      },
      {
        title: 'Открытая 2', companyId: company.id, partnerId,
        totalAmount: 80000, paidAmount: 30000,
        executionStatus: 'in_progress', financialStatus: 'partially_paid'
      },
      {
        title: 'Завершённая, оплачена в этом месяце', companyId: company.id, partnerId,
        totalAmount: 200000, paidAmount: 200000,
        executionStatus: 'completed', financialStatus: 'paid',
        closedAt: new Date(),
        paidAt: new Date()
      },
      {
        title: 'Отменённая', companyId: company.id, partnerId,
        totalAmount: 500000, paidAmount: 0,
        executionStatus: 'cancelled', financialStatus: 'not_billed'
      }
    ]
  });

  const u = await prisma.user.create({
    data: { email: `kpi-${Date.now()}@t.local`, passwordHash: 'x', name: 'L', role: 'partner', partnerId }
  });
  await prisma.lead.createMany({
    data: [
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L1', clientContactName: 'X', subject: 'S1', status: 'new', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L2', clientContactName: 'X', subject: 'S2', status: 'in_review', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L3', clientContactName: 'X', subject: 'S3', status: 'qualified', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L4', clientContactName: 'X', subject: 'S4', status: 'promoted_to_order', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L5', clientContactName: 'X', subject: 'S5', status: 'rejected', productType: [] }
    ]
  });
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'KpiC-' } } });
  await prisma.$disconnect();
});

describe('partner.dashboard.kpis', () => {
  it('counts open orders (executionStatus in pending|in_progress)', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    expect(k.openOrders).toBe(2);
  });

  it('sums outstanding (totalAmount - paidAmount) for non-cancelled orders', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    // 100000 + (80000-30000) = 150000; завершённая = 0; отменённая исключена
    expect(k.outstanding).toBe('150000.00');
  });

  it('counts leads in active states (new, in_review, qualified)', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    expect(k.activeLeads).toBe(3);
  });

  it('estimates commission for current month from paid orders × partner.commissionRate', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    // 200000 * 0.1 = 20000
    expect(k.commissionThisMonth).toBe('20000.00');
  });
});
```

- [ ] **Step 8.2: FAIL**

- [ ] **Step 8.3: Реализация**

Создать `src/lib/services/partner/dashboard.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';

export type DashboardScope = {
  partnerId: string;
  scopeOrgIds: string[]; // [] = весь партнёр
};

export type Kpis = {
  openOrders: number;
  outstanding: string;
  activeLeads: number;
  commissionThisMonth: string;
};

function orderWhereForScope(scope: DashboardScope) {
  const base: {
    partnerId: string;
    company?: { organizations: { some: { id: { in: string[] } } } };
  } = { partnerId: scope.partnerId };

  if (scope.scopeOrgIds.length > 0) {
    base.company = { organizations: { some: { id: { in: scope.scopeOrgIds } } } };
  }
  return base;
}

function startOfThisMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function startOfNextMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

export async function kpis(
  prisma: PrismaClient,
  scope: DashboardScope
): Promise<Kpis> {
  const baseWhere = orderWhereForScope(scope);

  const partner = await prisma.partner.findUnique({
    where: { id: scope.partnerId },
    select: { commissionRate: true }
  });
  const rate = Number(partner?.commissionRate ?? 0);

  const [openOrders, outstandingOrders, activeLeads, paidThisMonth] = await Promise.all([
    prisma.order.count({
      where: { ...baseWhere, executionStatus: { in: ['pending', 'in_progress'] } }
    }),
    prisma.order.findMany({
      where: { ...baseWhere, executionStatus: { not: 'cancelled' } },
      select: { totalAmount: true, paidAmount: true }
    }),
    prisma.lead.count({
      where: {
        partnerId: scope.partnerId,
        status: { in: ['new', 'in_review', 'qualified'] }
      }
    }),
    prisma.order.findMany({
      where: {
        ...baseWhere,
        financialStatus: 'paid',
        paidAt: { gte: startOfThisMonth(), lt: startOfNextMonth() }
      },
      select: { totalAmount: true }
    })
  ]);

  const outstanding = outstandingOrders.reduce(
    (sum, o) => sum + Number(o.totalAmount) - Number(o.paidAmount),
    0
  );
  const commission = paidThisMonth.reduce(
    (sum, o) => sum + Number(o.totalAmount) * rate,
    0
  );

  return {
    openOrders,
    outstanding: outstanding.toFixed(2),
    activeLeads,
    commissionThisMonth: commission.toFixed(2)
  };
}
```

- [ ] **Step 8.4: PASS**

```bash
npx vitest run src/__tests__/services.partner.dashboard.kpis.test.ts
```

- [ ] **Step 8.5: Коммит**

```bash
git add src/lib/services/partner/dashboard.ts src/__tests__/services.partner.dashboard.kpis.test.ts
git commit -m "feat(partner): dashboard KPI service (open orders, outstanding, leads, commission)"
```

---

### Task 9: `dashboard.ts` — «требует внимания»

Спека §5.2: «зависшие сделки > 14 дней, просроченные счета, лиды без квалификации > 5 дней». Добавляем к существующему модулю.

**Files:**
- Modify: `src/lib/services/partner/dashboard.ts` (добавить функцию)
- Create: `src/__tests__/services.partner.dashboard.attention.test.ts`

- [ ] **Step 9.1: Тест**

Создать `src/__tests__/services.partner.dashboard.attention.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { attention } from '@/lib/services/partner/dashboard';

let prisma: PrismaClient;
let partnerId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'AttP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'AttC-' + Date.now() } });
  await prisma.organization.create({ data: { name: 'O', partnerId, companyId: c.id } });

  const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 3600 * 1000);
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);

  await prisma.order.createMany({
    data: [
      {
        title: 'Зависшая 20 дней', companyId: c.id, partnerId,
        totalAmount: 50000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed',
        updatedAt: twentyDaysAgo, createdAt: twentyDaysAgo
      },
      {
        title: 'Свежая', companyId: c.id, partnerId,
        totalAmount: 50000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed',
        updatedAt: tenDaysAgo, createdAt: tenDaysAgo
      },
      {
        title: 'Просроченный счёт', companyId: c.id, partnerId,
        totalAmount: 50000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed',
        deadline: threeDaysAgo, updatedAt: tenDaysAgo
      }
    ]
  });

  const u = await prisma.user.create({
    data: { email: `att-${Date.now()}@t.local`, passwordHash: 'x', name: 'L', role: 'partner', partnerId }
  });
  await prisma.lead.createMany({
    data: [
      {
        partnerId, createdByUserId: u.id,
        clientCompanyName: 'Старый лид', clientContactName: 'X', subject: 'S',
        status: 'new', productType: [], createdAt: sevenDaysAgo
      },
      {
        partnerId, createdByUserId: u.id,
        clientCompanyName: 'Свежий', clientContactName: 'X', subject: 'S',
        status: 'new', productType: [], createdAt: threeDaysAgo
      }
    ]
  });
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

describe('partner.dashboard.attention', () => {
  it('reports stuck orders updated more than 14 days ago', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    const titles = a.stuckOrders.map((o) => o.title);
    expect(titles).toContain('Зависшая 20 дней');
    expect(titles).not.toContain('Свежая');
  });

  it('reports orders with deadline in the past and not paid', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    const titles = a.overdueOrders.map((o) => o.title);
    expect(titles).toContain('Просроченный счёт');
  });

  it('reports leads in state "new" older than 5 days', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    const names = a.staleLeads.map((l) => l.clientCompanyName);
    expect(names).toContain('Старый лид');
    expect(names).not.toContain('Свежий');
  });

  it('returns hard cap of 10 per bucket', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    expect(a.stuckOrders.length).toBeLessThanOrEqual(10);
    expect(a.overdueOrders.length).toBeLessThanOrEqual(10);
    expect(a.staleLeads.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 9.2: FAIL**

- [ ] **Step 9.3: Расширить `src/lib/services/partner/dashboard.ts`**

Добавить в конец файла:

```typescript
const FOURTEEN_DAYS_MS = 14 * 24 * 3600 * 1000;
const FIVE_DAYS_MS = 5 * 24 * 3600 * 1000;
const ATTENTION_CAP = 10;

export type AttentionOrder = {
  id: string;
  title: string;
  updatedAt: Date;
  deadline: Date | null;
  totalAmount: string;
  paidAmount: string;
};

export type AttentionLead = {
  id: string;
  clientCompanyName: string;
  subject: string;
  createdAt: Date;
};

export type Attention = {
  stuckOrders: AttentionOrder[];
  overdueOrders: AttentionOrder[];
  staleLeads: AttentionLead[];
};

export async function attention(
  prisma: PrismaClient,
  scope: DashboardScope
): Promise<Attention> {
  const baseWhere = orderWhereForScope(scope);
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - FOURTEEN_DAYS_MS);
  const fiveDaysAgo = new Date(now.getTime() - FIVE_DAYS_MS);

  const [stuck, overdue, stale] = await Promise.all([
    prisma.order.findMany({
      where: {
        ...baseWhere,
        executionStatus: { in: ['pending', 'in_progress'] },
        updatedAt: { lt: fourteenDaysAgo }
      },
      orderBy: { updatedAt: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, title: true, updatedAt: true, deadline: true, totalAmount: true, paidAmount: true }
    }),
    prisma.order.findMany({
      where: {
        ...baseWhere,
        executionStatus: { not: 'cancelled' },
        financialStatus: { in: ['billed', 'partially_paid'] },
        deadline: { lt: now }
      },
      orderBy: { deadline: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, title: true, updatedAt: true, deadline: true, totalAmount: true, paidAmount: true }
    }),
    prisma.lead.findMany({
      where: {
        partnerId: scope.partnerId,
        status: 'new',
        createdAt: { lt: fiveDaysAgo }
      },
      orderBy: { createdAt: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, clientCompanyName: true, subject: true, createdAt: true }
    })
  ]);

  return {
    stuckOrders: stuck.map((o) => ({
      ...o,
      totalAmount: o.totalAmount.toFixed(2),
      paidAmount: o.paidAmount.toFixed(2)
    })),
    overdueOrders: overdue.map((o) => ({
      ...o,
      totalAmount: o.totalAmount.toFixed(2),
      paidAmount: o.paidAmount.toFixed(2)
    })),
    staleLeads: stale
  };
}
```

- [ ] **Step 9.4: PASS**

- [ ] **Step 9.5: Коммит**

```bash
git add src/lib/services/partner/dashboard.ts src/__tests__/services.partner.dashboard.attention.test.ts
git commit -m "feat(partner): attention service for stuck orders, overdue invoices, stale leads"
```

---

### Task 10: `dashboard.ts` — лента событий (последние 10)

Спека §5.2: лента событий. Делаем простую агрегацию из `Order.updatedAt`, `Lead.createdAt`, `Payment.createdAt`, `Document.createdAt`.

**Files:**
- Modify: `src/lib/services/partner/dashboard.ts`
- Create: `src/__tests__/services.partner.dashboard.events.test.ts`

- [ ] **Step 10.1: Тест**

Создать `src/__tests__/services.partner.dashboard.events.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { recentEvents } from '@/lib/services/partner/dashboard';

let prisma: PrismaClient;
let partnerId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'EvP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'EvC-' + Date.now() } });
  await prisma.organization.create({ data: { name: 'O', partnerId, companyId: c.id } });

  const order = await prisma.order.create({
    data: {
      title: 'Сделка', companyId: c.id, partnerId,
      totalAmount: 1000, paidAmount: 0,
      executionStatus: 'in_progress', financialStatus: 'billed'
    }
  });

  await prisma.payment.create({
    data: { orderId: order.id, amount: 500, paidAt: new Date() }
  });

  const u = await prisma.user.create({
    data: { email: `ev-${Date.now()}@t.local`, passwordHash: 'x', name: 'L', role: 'partner', partnerId }
  });
  await prisma.lead.create({
    data: {
      partnerId, createdByUserId: u.id,
      clientCompanyName: 'Лид', clientContactName: 'X', subject: 'S',
      status: 'new', productType: []
    }
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { order: { partnerId } } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

describe('partner.dashboard.recentEvents', () => {
  it('returns mixed events across orders, leads, payments sorted by time desc', async () => {
    const events = await recentEvents(prisma, { partnerId, scopeOrgIds: [] }, 10);
    expect(events.length).toBeGreaterThan(0);
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].at.getTime()).toBeGreaterThanOrEqual(events[i].at.getTime());
    }
  });

  it('respects limit', async () => {
    const events = await recentEvents(prisma, { partnerId, scopeOrgIds: [] }, 1);
    expect(events).toHaveLength(1);
  });

  it('returns nothing for foreign partner', async () => {
    const events = await recentEvents(prisma, { partnerId: 'no-such', scopeOrgIds: [] }, 10);
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 10.2: FAIL**

- [ ] **Step 10.3: Реализация**

В `src/lib/services/partner/dashboard.ts` добавить:

```typescript
export type EventKind = 'order_updated' | 'lead_created' | 'payment_received';

export type DashboardEvent = {
  kind: EventKind;
  at: Date;
  title: string;
  ref: { kind: 'order' | 'lead'; id: string };
};

export async function recentEvents(
  prisma: PrismaClient,
  scope: DashboardScope,
  limit: number
): Promise<DashboardEvent[]> {
  const baseWhere = orderWhereForScope(scope);

  const [orders, leads, payments] = await Promise.all([
    prisma.order.findMany({
      where: baseWhere,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, title: true, updatedAt: true }
    }),
    prisma.lead.findMany({
      where: { partnerId: scope.partnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, clientCompanyName: true, subject: true, createdAt: true }
    }),
    prisma.payment.findMany({
      where: { order: baseWhere },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, amount: true, createdAt: true,
        order: { select: { id: true, title: true } }
      }
    })
  ]);

  const events: DashboardEvent[] = [
    ...orders.map((o): DashboardEvent => ({
      kind: 'order_updated',
      at: o.updatedAt,
      title: `Заказ «${o.title}» обновлён`,
      ref: { kind: 'order', id: o.id }
    })),
    ...leads.map((l): DashboardEvent => ({
      kind: 'lead_created',
      at: l.createdAt,
      title: `Новый лид: ${l.clientCompanyName} — ${l.subject}`,
      ref: { kind: 'lead', id: l.id }
    })),
    ...payments.map((p): DashboardEvent => ({
      kind: 'payment_received',
      at: p.createdAt,
      title: `Оплата ${Number(p.amount).toFixed(2)} ₽ по заказу «${p.order.title}»`,
      ref: { kind: 'order', id: p.order.id }
    }))
  ];

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, limit);
}
```

- [ ] **Step 10.4: PASS**

- [ ] **Step 10.5: Коммит**

```bash
git add src/lib/services/partner/dashboard.ts src/__tests__/services.partner.dashboard.events.test.ts
git commit -m "feat(partner): recentEvents service merging orders/leads/payments by time"
```

---

### Task 11: `team.ts` — listTeam, inviteMember

Спека §5.9: «Список `PartnerUser`, инвайт нового менеджера». Invite создаёт User + PartnerUser в transaction'е.

**Files:**
- Create: `src/lib/services/partner/team.ts`
- Create: `src/__tests__/services.partner.team.test.ts`

- [ ] **Step 11.1: Тест**

Создать `src/__tests__/services.partner.team.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listTeam, inviteMember, assignOrgs, deactivateMember } from '@/lib/services/partner/team';

let prisma: PrismaClient;
let partnerId: string;
let orgIds: string[];

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'TeamP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'TeamC-' + Date.now() } });
  const orgA = await prisma.organization.create({ data: { name: 'TA', partnerId, companyId: c.id } });
  const orgB = await prisma.organization.create({ data: { name: 'TB', partnerId, companyId: c.id } });
  orgIds = [orgA.id, orgB.id];
});

afterAll(async () => {
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
});

describe('team.listTeam', () => {
  it('returns empty array for empty partner', async () => {
    const team = await listTeam(prisma, partnerId);
    expect(team).toEqual([]);
  });

  it('returns active and inactive members', async () => {
    const u1 = await prisma.user.create({
      data: { email: 't1@x.local', passwordHash: 'h', name: 'U1', role: 'partner', partnerId }
    });
    const u2 = await prisma.user.create({
      data: { email: 't2@x.local', passwordHash: 'h', name: 'U2', role: 'partner', partnerId }
    });
    await prisma.partnerUser.create({
      data: { partnerId, userId: u1.id, roleInPartner: 'admin', assignedOrgIds: [], isActive: true }
    });
    await prisma.partnerUser.create({
      data: { partnerId, userId: u2.id, roleInPartner: 'manager', assignedOrgIds: orgIds, isActive: false }
    });

    const team = await listTeam(prisma, partnerId);
    expect(team).toHaveLength(2);
    const adminRow = team.find((t) => t.email === 't1@x.local');
    expect(adminRow?.roleInPartner).toBe('admin');
    expect(adminRow?.isActive).toBe(true);
  });
});

describe('team.inviteMember', () => {
  it('creates User and PartnerUser within a transaction', async () => {
    const result = await inviteMember(prisma, {
      partnerId,
      email: 'new@x.local',
      name: 'Новый менеджер',
      roleInPartner: 'manager',
      assignedOrgIds: [orgIds[0]]
    });

    expect(result.user.email).toBe('new@x.local');
    expect(result.user.role).toBe('partner');
    expect(result.partnerUser.roleInPartner).toBe('manager');
    expect(result.partnerUser.assignedOrgIds).toEqual([orgIds[0]]);
  });

  it('rejects duplicate email', async () => {
    await prisma.user.create({
      data: { email: 'dup@x.local', passwordHash: 'h', name: 'D', role: 'partner', partnerId }
    });

    await expect(
      inviteMember(prisma, {
        partnerId, email: 'dup@x.local', name: 'X',
        roleInPartner: 'manager', assignedOrgIds: []
      })
    ).rejects.toThrow(/already exists|EMAIL_TAKEN/);
  });

  it('rejects assignedOrgIds outside partner', async () => {
    const otherPartner = await prisma.partner.create({ data: { name: 'OthP-' + Date.now() } });
    const c = await prisma.company.create({ data: { name: 'OthC-' + Date.now() } });
    const foreignOrg = await prisma.organization.create({
      data: { name: 'Foreign', partnerId: otherPartner.id, companyId: c.id }
    });

    await expect(
      inviteMember(prisma, {
        partnerId, email: 'x@x.local', name: 'X',
        roleInPartner: 'manager', assignedOrgIds: [foreignOrg.id]
      })
    ).rejects.toThrow(/ORG_OUT_OF_SCOPE|outside partner/);

    await prisma.organization.delete({ where: { id: foreignOrg.id } });
    await prisma.company.deleteMany({ where: { name: { startsWith: 'OthC-' } } });
    await prisma.partner.delete({ where: { id: otherPartner.id } });
  });
});

describe('team.assignOrgs', () => {
  it('replaces assignedOrgIds for an existing member', async () => {
    const u = await prisma.user.create({
      data: { email: 'as@x.local', passwordHash: 'h', name: 'A', role: 'partner', partnerId }
    });
    await prisma.partnerUser.create({
      data: { partnerId, userId: u.id, roleInPartner: 'manager', assignedOrgIds: [orgIds[0]], isActive: true }
    });

    const updated = await assignOrgs(prisma, { partnerId, userId: u.id, assignedOrgIds: orgIds });
    expect(updated.assignedOrgIds).toEqual(orgIds);
  });

  it('rejects orgs outside partner', async () => {
    const u = await prisma.user.create({
      data: { email: 'as2@x.local', passwordHash: 'h', name: 'A', role: 'partner', partnerId }
    });
    await prisma.partnerUser.create({
      data: { partnerId, userId: u.id, roleInPartner: 'manager', assignedOrgIds: [], isActive: true }
    });

    await expect(
      assignOrgs(prisma, { partnerId, userId: u.id, assignedOrgIds: ['no-such-org'] })
    ).rejects.toThrow(/ORG_OUT_OF_SCOPE/);
  });
});

describe('team.deactivateMember', () => {
  it('flips isActive=false', async () => {
    const u = await prisma.user.create({
      data: { email: 'd@x.local', passwordHash: 'h', name: 'D', role: 'partner', partnerId }
    });
    await prisma.partnerUser.create({
      data: { partnerId, userId: u.id, roleInPartner: 'manager', assignedOrgIds: [], isActive: true }
    });

    const r = await deactivateMember(prisma, { partnerId, userId: u.id });
    expect(r.isActive).toBe(false);
  });

  it('refuses to deactivate the last admin', async () => {
    const u = await prisma.user.create({
      data: { email: 'last@x.local', passwordHash: 'h', name: 'L', role: 'partner', partnerId }
    });
    await prisma.partnerUser.create({
      data: { partnerId, userId: u.id, roleInPartner: 'admin', assignedOrgIds: [], isActive: true }
    });

    await expect(
      deactivateMember(prisma, { partnerId, userId: u.id })
    ).rejects.toThrow(/LAST_ADMIN/);
  });
});
```

- [ ] **Step 11.2: FAIL**

- [ ] **Step 11.3: Реализация**

Создать `src/lib/services/partner/team.ts`:

```typescript
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient, PartnerUser, User } from '@prisma/client';

export type TeamRow = {
  userId: string;
  partnerUserId: string;
  email: string;
  name: string;
  roleInPartner: 'admin' | 'manager';
  assignedOrgIds: string[];
  isActive: boolean;
  createdAt: Date;
};

export async function listTeam(
  prisma: PrismaClient,
  partnerId: string
): Promise<TeamRow[]> {
  const rows = await prisma.partnerUser.findMany({
    where: { partnerId },
    include: { user: { select: { email: true, name: true } } },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }]
  });

  return rows.map((r) => ({
    userId: r.userId,
    partnerUserId: r.id,
    email: r.user.email,
    name: r.user.name,
    roleInPartner: r.roleInPartner === 'admin' ? 'admin' : 'manager',
    assignedOrgIds: r.assignedOrgIds,
    isActive: r.isActive,
    createdAt: r.createdAt
  }));
}

export type InviteInput = {
  partnerId: string;
  email: string;
  name: string;
  roleInPartner: 'admin' | 'manager';
  assignedOrgIds: string[];
};

export async function inviteMember(
  prisma: PrismaClient,
  input: InviteInput
): Promise<{ user: User; partnerUser: PartnerUser }> {
  if (input.assignedOrgIds.length > 0) {
    const inScope = await prisma.organization.count({
      where: { partnerId: input.partnerId, id: { in: input.assignedOrgIds } }
    });
    if (inScope !== input.assignedOrgIds.length) {
      throw new Error('ORG_OUT_OF_SCOPE');
    }
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new Error('EMAIL_TAKEN: user with this email already exists');

  const tempPasswordPlain = randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPasswordPlain, 10);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: 'partner',
        partnerId: input.partnerId,
        passwordHash
      }
    });

    const partnerUser = await tx.partnerUser.create({
      data: {
        partnerId: input.partnerId,
        userId: user.id,
        roleInPartner: input.roleInPartner,
        assignedOrgIds: input.assignedOrgIds,
        isActive: true
      }
    });

    return { user, partnerUser };
  });
}

export async function assignOrgs(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string; assignedOrgIds: string[] }
): Promise<PartnerUser> {
  if (args.assignedOrgIds.length > 0) {
    const inScope = await prisma.organization.count({
      where: { partnerId: args.partnerId, id: { in: args.assignedOrgIds } }
    });
    if (inScope !== args.assignedOrgIds.length) {
      throw new Error('ORG_OUT_OF_SCOPE');
    }
  }

  return prisma.partnerUser.update({
    where: { partnerId_userId: { partnerId: args.partnerId, userId: args.userId } },
    data: { assignedOrgIds: args.assignedOrgIds }
  });
}

export async function deactivateMember(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string }
): Promise<PartnerUser> {
  const target = await prisma.partnerUser.findUnique({
    where: { partnerId_userId: { partnerId: args.partnerId, userId: args.userId } }
  });
  if (!target) throw new Error('NOT_FOUND');

  if (target.roleInPartner === 'admin' && target.isActive) {
    const activeAdmins = await prisma.partnerUser.count({
      where: { partnerId: args.partnerId, roleInPartner: 'admin', isActive: true }
    });
    if (activeAdmins <= 1) throw new Error('LAST_ADMIN: cannot deactivate the last active admin');
  }

  return prisma.partnerUser.update({
    where: { id: target.id },
    data: { isActive: false }
  });
}
```

- [ ] **Step 11.4: PASS**

```bash
npx vitest run src/__tests__/services.partner.team.test.ts
```

- [ ] **Step 11.5: Коммит**

```bash
git add src/lib/services/partner/team.ts src/__tests__/services.partner.team.test.ts
git commit -m "feat(partner): team service (list, invite, assignOrgs, deactivate)"
```

---

### Task 12: `rateOverride.ts` — per-org commission rate с audit log

Спека §6.7: per-org override ставки. Только admin партнёра. Audit log в `AuditLog` с before/after и `reason`.

**Files:**
- Create: `src/lib/services/partner/rateOverride.ts`
- Create: `src/__tests__/services.partner.rateOverride.test.ts`

- [ ] **Step 12.1: Тест**

Создать `src/__tests__/services.partner.rateOverride.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';

let prisma: PrismaClient;
let partnerId: string;
let userId: string;
let orgId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'RP-' + Date.now(), commissionRate: 0.05 } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'RC-' + Date.now() } });
  const org = await prisma.organization.create({ data: { name: 'OR', partnerId, companyId: c.id } });
  orgId = org.id;
  const u = await prisma.user.create({
    data: { email: `ro-${Date.now()}@x.local`, passwordHash: 'h', name: 'A', role: 'partner', partnerId }
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      partnerCommissionRate: null,
      partnerCommissionRateNote: null,
      partnerCommissionRateChangedAt: null,
      partnerCommissionRateChangedBy: null
    }
  });
});

describe('setOrgCommissionRate', () => {
  it('updates partnerCommissionRate and metadata fields', async () => {
    await setOrgCommissionRate(prisma, {
      organizationId: orgId, partnerId,
      newRate: 0.08, reason: 'VIP клиент', changedByUserId: userId
    });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.partnerCommissionRate?.toString()).toBe('0.08');
    expect(org.partnerCommissionRateNote).toBe('VIP клиент');
    expect(org.partnerCommissionRateChangedBy).toBe(userId);
    expect(org.partnerCommissionRateChangedAt).toBeInstanceOf(Date);
  });

  it('writes AuditLog with before/after rate', async () => {
    await setOrgCommissionRate(prisma, {
      organizationId: orgId, partnerId,
      newRate: 0.08, reason: 'VIP', changedByUserId: userId
    });

    const audit = await prisma.auditLog.findFirst({
      where: { userId, entity: 'Organization', entityId: orgId },
      orderBy: { createdAt: 'desc' }
    });
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe('partner_commission_rate_changed');
    const meta = audit!.meta as { oldRate: string | null; newRate: string; reason: string };
    expect(meta.oldRate).toBeNull();
    expect(meta.newRate).toBe('0.08');
    expect(meta.reason).toBe('VIP');
  });

  it('rejects rates out of (0, 1) range', async () => {
    await expect(
      setOrgCommissionRate(prisma, {
        organizationId: orgId, partnerId,
        newRate: -0.1, reason: 'X', changedByUserId: userId
      })
    ).rejects.toThrow(/RATE_OUT_OF_RANGE/);

    await expect(
      setOrgCommissionRate(prisma, {
        organizationId: orgId, partnerId,
        newRate: 1.5, reason: 'X', changedByUserId: userId
      })
    ).rejects.toThrow(/RATE_OUT_OF_RANGE/);
  });

  it('refuses to change org outside partner', async () => {
    await expect(
      setOrgCommissionRate(prisma, {
        organizationId: orgId, partnerId: 'no-such',
        newRate: 0.08, reason: 'X', changedByUserId: userId
      })
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('clearOrgCommissionRate', () => {
  it('nullifies rate and writes audit log', async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        partnerCommissionRate: 0.08,
        partnerCommissionRateNote: 'old',
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: userId
      }
    });

    await clearOrgCommissionRate(prisma, {
      organizationId: orgId, partnerId, reason: 'вернуть базу', changedByUserId: userId
    });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.partnerCommissionRate).toBeNull();
    expect(org.partnerCommissionRateNote).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'partner_commission_rate_changed' },
      orderBy: { createdAt: 'desc' }
    });
    expect(audit).not.toBeNull();
    const meta = audit!.meta as { oldRate: string; newRate: string | null };
    expect(meta.oldRate).toBe('0.08');
    expect(meta.newRate).toBeNull();
  });
});
```

- [ ] **Step 12.2: Сверить структуру AuditLog (sanity check)**

```bash
grep -A 12 'model AuditLog' prisma/schema.prisma
```

Ожидаемые поля (зафиксированы в текущей схеме): `id`, `createdAt`, `updatedAt`, `action` (String), `entity` (String), `entityId` (String), `userId` (String, FK на User), `user`, `meta` (Json?). Используем именно эти имена в реализации.

- [ ] **Step 12.3: FAIL**

- [ ] **Step 12.4: Реализация**

Создать `src/lib/services/partner/rateOverride.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';

export type SetRateInput = {
  organizationId: string;
  partnerId: string;
  newRate: number;
  reason: string;
  changedByUserId: string;
};

export async function setOrgCommissionRate(
  prisma: PrismaClient,
  input: SetRateInput
): Promise<void> {
  if (!(input.newRate > 0 && input.newRate < 1)) {
    throw new Error('RATE_OUT_OF_RANGE: rate must be in (0, 1)');
  }

  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, partnerId: input.partnerId },
    select: { id: true, partnerCommissionRate: true }
  });
  if (!org) throw new Error('NOT_FOUND: organization not under given partner');

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: input.organizationId },
      data: {
        partnerCommissionRate: input.newRate,
        partnerCommissionRateNote: input.reason,
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: input.changedByUserId
      }
    }),
    prisma.auditLog.create({
      data: {
        userId: input.changedByUserId,
        action: 'partner_commission_rate_changed',
        entity: 'Organization',
        entityId: input.organizationId,
        meta: {
          oldRate: org.partnerCommissionRate?.toString() ?? null,
          newRate: input.newRate.toString(),
          reason: input.reason
        }
      }
    })
  ]);
}

export async function clearOrgCommissionRate(
  prisma: PrismaClient,
  input: { organizationId: string; partnerId: string; reason: string; changedByUserId: string }
): Promise<void> {
  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, partnerId: input.partnerId },
    select: { id: true, partnerCommissionRate: true }
  });
  if (!org) throw new Error('NOT_FOUND');

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: input.organizationId },
      data: {
        partnerCommissionRate: null,
        partnerCommissionRateNote: null,
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: input.changedByUserId
      }
    }),
    prisma.auditLog.create({
      data: {
        userId: input.changedByUserId,
        action: 'partner_commission_rate_changed',
        entity: 'Organization',
        entityId: input.organizationId,
        meta: {
          oldRate: org.partnerCommissionRate?.toString() ?? null,
          newRate: null,
          reason: input.reason
        }
      }
    })
  ]);
}
```

- [ ] **Step 12.5: PASS**

- [ ] **Step 12.6: Коммит**

```bash
git add src/lib/services/partner/rateOverride.ts src/__tests__/services.partner.rateOverride.test.ts
git commit -m "feat(partner): per-org commission rate override with audit log"
```

---

## Часть 4 — API routes

API роуты — тонкие обёртки: `requirePartner` → парсинг query/body через Zod → вызов сервиса → JSON ответ. Server Components могут вызывать сервисы напрямую, но API нужен для (а) client-side обновлений после mutations (форма rate override, форма инвайта), (б) будущей мобильной/PWA-функциональности.

### Task 13: GET `/api/partner/dashboard`

**Files:**
- Create: `src/app/api/partner/dashboard/route.ts`
- Create: `src/__tests__/api.partner.dashboard.test.ts`

- [ ] **Step 13.1: Тест**

Создать `src/__tests__/api.partner.dashboard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/dashboard', () => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { kpis, attention, recentEvents } from '@/lib/services/partner/dashboard';
import { GET } from '@/app/api/partner/dashboard/route';

describe('GET /api/partner/dashboard', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 for non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'organization', organizationId: 'o' } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns kpis + attention + events for partner', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(kpis).mockResolvedValue({ openOrders: 5, outstanding: '10000.00', activeLeads: 2, commissionThisMonth: '500.00' });
    vi.mocked(attention).mockResolvedValue({ stuckOrders: [], overdueOrders: [], staleLeads: [] });
    vi.mocked(recentEvents).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.kpis.openOrders).toBe(5);
    expect(body.kpis.outstanding).toBe('10000.00');
    expect(body.attention).toBeDefined();
    expect(body.events).toEqual([]);

    expect(kpis).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1', scopeOrgIds: [] });
  });

  it('passes assignedOrgIds to scope when partner is scoped manager', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: ['oA', 'oB']
    } as any);
    vi.mocked(kpis).mockResolvedValue({ openOrders: 0, outstanding: '0.00', activeLeads: 0, commissionThisMonth: '0.00' });
    vi.mocked(attention).mockResolvedValue({ stuckOrders: [], overdueOrders: [], staleLeads: [] });
    vi.mocked(recentEvents).mockResolvedValue([]);

    await GET();
    expect(kpis).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1', scopeOrgIds: ['oA', 'oB'] });
  });
});
```

- [ ] **Step 13.2: FAIL**

- [ ] **Step 13.3: Создать роут**

Создать `src/app/api/partner/dashboard/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { kpis, attention, recentEvents } from '@/lib/services/partner/dashboard';

const EVENT_LIMIT = 10;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partner = requirePartner(session);
  if (!partner.ok) return partner.response;

  const scope = {
    partnerId: partner.value.partnerId,
    scopeOrgIds: session.assignedOrgIds ?? []
  };

  const [k, a, events] = await Promise.all([
    kpis(prisma, scope),
    attention(prisma, scope),
    recentEvents(prisma, scope, EVENT_LIMIT)
  ]);

  return NextResponse.json({ kpis: k, attention: a, events });
}
```

- [ ] **Step 13.4: PASS**

```bash
npx vitest run src/__tests__/api.partner.dashboard.test.ts
```

- [ ] **Step 13.5: Коммит**

```bash
git add src/app/api/partner/dashboard/route.ts src/__tests__/api.partner.dashboard.test.ts
git commit -m "feat(api): GET /api/partner/dashboard with kpis, attention, events"
```

---

### Task 14: GET `/api/partner/portfolio`

**Files:**
- Create: `src/app/api/partner/portfolio/route.ts`
- Create: `src/__tests__/api.partner.portfolio.test.ts`

- [ ] **Step 14.1: Тест**

Создать `src/__tests__/api.partner.portfolio.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/portfolio', () => ({ listPortfolio: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { listPortfolio } from '@/lib/services/partner/portfolio';
import { GET } from '@/app/api/partner/portfolio/route';

function req(qs: string = '') {
  return new Request(`http://localhost/api/partner/portfolio${qs}`);
}

describe('GET /api/partner/portfolio', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it('403 non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'admin' } as any);
    expect((await GET(req())).status).toBe(403);
  });

  it('returns paginated items with default take=20, skip=0', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(listPortfolio).mockResolvedValue({
      items: [{ id: 'o1', name: 'Org1', inn: null, assignedManagerUserId: null, ordersCount: 0, debt: '0.00' }],
      total: 1
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].name).toBe('Org1');

    expect(listPortfolio).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1', scopeOrgIds: undefined, search: undefined, take: 20, skip: 0
    });
  });

  it('parses take/skip/search query params and caps take at 100', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(listPortfolio).mockResolvedValue({ items: [], total: 0 });

    await GET(req('?take=500&skip=10&search=ООО'));

    expect(listPortfolio).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1', scopeOrgIds: undefined, search: 'ООО', take: 100, skip: 10
    });
  });

  it('passes assignedOrgIds as scope for scoped manager', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: ['oA', 'oB']
    } as any);
    vi.mocked(listPortfolio).mockResolvedValue({ items: [], total: 0 });

    await GET(req());

    expect(listPortfolio).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scopeOrgIds: ['oA', 'oB']
    }));
  });
});
```

- [ ] **Step 14.2: FAIL**

- [ ] **Step 14.3: Создать роут**

Создать `src/app/api/partner/portfolio/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { listPortfolio } from '@/lib/services/partner/portfolio';

const DEFAULT_TAKE = 20;
const MAX_TAKE = 100;

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partner = requirePartner(session);
  if (!partner.ok) return partner.response;

  const sp = new URL(req.url).searchParams;
  const take = Math.min(parsePositiveInt(sp.get('take'), DEFAULT_TAKE), MAX_TAKE);
  const skip = parsePositiveInt(sp.get('skip'), 0);
  const search = sp.get('search') ?? undefined;

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const result = await listPortfolio(prisma, {
    partnerId: partner.value.partnerId,
    scopeOrgIds: scope,
    search,
    take,
    skip
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 14.4: PASS**

- [ ] **Step 14.5: Коммит**

```bash
git add src/app/api/partner/portfolio/route.ts src/__tests__/api.partner.portfolio.test.ts
git commit -m "feat(api): GET /api/partner/portfolio with filters and pagination"
```

---

### Task 15: GET `/api/partner/portfolio/[orgId]` — карточка организации

Возвращает данные карточки: name, INN, KPI (orders, debt), плюс employees, recent comments, audit-log по этой организации.

**Files:**
- Create: `src/app/api/partner/portfolio/[orgId]/route.ts`
- Create: `src/lib/services/partner/orgCard.ts`
- Create: `src/__tests__/api.partner.portfolio.org.test.ts`
- Create: `src/__tests__/services.partner.orgCard.test.ts`

- [ ] **Step 15.1: Сервис — тест**

Создать `src/__tests__/services.partner.orgCard.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getOrgCard } from '@/lib/services/partner/orgCard';

let prisma: PrismaClient;
let partnerId: string;
let orgId: string;
let companyId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'OcP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'OcC-' + Date.now() } });
  companyId = c.id;
  const org = await prisma.organization.create({
    data: { name: 'OrgЦентр', partnerId, companyId: c.id, inn: '7700000099' }
  });
  orgId = org.id;

  await prisma.order.create({
    data: {
      title: 'Один', companyId, partnerId,
      totalAmount: 1000, paidAmount: 200,
      executionStatus: 'in_progress', financialStatus: 'partially_paid'
    }
  });
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('getOrgCard', () => {
  it('returns header data: name, inn, assignedManagerUserId, partnerCommissionRate', async () => {
    const card = await getOrgCard(prisma, { orgId, partnerId });
    expect(card).not.toBeNull();
    expect(card!.name).toBe('OrgЦентр');
    expect(card!.inn).toBe('7700000099');
    expect(card!.partnerCommissionRate).toBeNull();
  });

  it('computes KPI: ordersCount and debt', async () => {
    const card = await getOrgCard(prisma, { orgId, partnerId });
    expect(card!.kpi.ordersCount).toBe(1);
    expect(card!.kpi.debt).toBe('800.00');
  });

  it('returns null if org belongs to another partner', async () => {
    const card = await getOrgCard(prisma, { orgId, partnerId: 'other' });
    expect(card).toBeNull();
  });
});
```

- [ ] **Step 15.2: Сервис — FAIL**

- [ ] **Step 15.3: Сервис — реализация**

Создать `src/lib/services/partner/orgCard.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';

export type OrgCard = {
  id: string;
  name: string;
  inn: string | null;
  kpp: string | null;
  legalName: string | null;
  assignedManagerUserId: string | null;
  partnerCommissionRate: string | null;
  partnerCommissionRateNote: string | null;
  kpi: {
    ordersCount: number;
    debt: string;
  };
};

export async function getOrgCard(
  prisma: PrismaClient,
  args: { orgId: string; partnerId: string }
): Promise<OrgCard | null> {
  const org = await prisma.organization.findFirst({
    where: { id: args.orgId, partnerId: args.partnerId },
    select: {
      id: true, name: true, inn: true, kpp: true,
      assignedManagerUserId: true,
      partnerCommissionRate: true,
      partnerCommissionRateNote: true,
      companyId: true,
      company: { select: { name: true } }
    }
  });
  if (!org) return null;

  let ordersCount = 0;
  let debt = 0;
  if (org.companyId) {
    const orders = await prisma.order.findMany({
      where: { companyId: org.companyId, partnerId: args.partnerId },
      select: { totalAmount: true, paidAmount: true, executionStatus: true }
    });
    ordersCount = orders.length;
    debt = orders
      .filter((o) => o.executionStatus !== 'cancelled')
      .reduce((s, o) => s + Number(o.totalAmount) - Number(o.paidAmount), 0);
  }

  return {
    id: org.id,
    name: org.name,
    inn: org.inn,
    kpp: org.kpp,
    legalName: org.company?.name ?? null,
    assignedManagerUserId: org.assignedManagerUserId,
    partnerCommissionRate: org.partnerCommissionRate?.toString() ?? null,
    partnerCommissionRateNote: org.partnerCommissionRateNote,
    kpi: { ordersCount, debt: debt.toFixed(2) }
  };
}
```

- [ ] **Step 15.4: Сервис — PASS**

- [ ] **Step 15.5: Роут — тест**

Создать `src/__tests__/api.partner.portfolio.org.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/policy', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/policy');
  return { ...actual, canPartnerAccessOrg: vi.fn() };
});
vi.mock('@/lib/services/partner/orgCard', () => ({ getOrgCard: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { GET } from '@/app/api/partner/portfolio/[orgId]/route';

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });

describe('GET /api/partner/portfolio/[orgId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(401);
  });

  it('403 if partner has no scope for this org', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(false);

    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(403);
    expect(getOrgCard).not.toHaveBeenCalled();
  });

  it('404 if org does not exist', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);
    vi.mocked(getOrgCard).mockResolvedValue(null);

    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(404);
  });

  it('200 with card data on success', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);
    vi.mocked(getOrgCard).mockResolvedValue({
      id: 'o1', name: 'X', inn: '1', kpp: null, legalName: 'X LLC',
      assignedManagerUserId: null, partnerCommissionRate: null, partnerCommissionRateNote: null,
      kpi: { ordersCount: 0, debt: '0.00' }
    });

    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('X');
  });
});
```

- [ ] **Step 15.6: Роут — FAIL**

- [ ] **Step 15.7: Роут — реализация**

Создать `src/app/api/partner/portfolio/[orgId]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ orgId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partner = requirePartner(session);
  if (!partner.ok) return partner.response;

  const { orgId } = await ctx.params;

  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const card = await getOrgCard(prisma, { orgId, partnerId: partner.value.partnerId });
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(card);
}
```

- [ ] **Step 15.8: Роут — PASS**

- [ ] **Step 15.9: Коммит**

```bash
git add src/lib/services/partner/orgCard.ts src/app/api/partner/portfolio/[orgId]/route.ts src/__tests__/services.partner.orgCard.test.ts src/__tests__/api.partner.portfolio.org.test.ts
git commit -m "feat(api): GET /api/partner/portfolio/[orgId] with scope check"
```

---

### Task 16: PUT `/api/partner/portfolio/[orgId]/rate` — override ставки

**Files:**
- Create: `src/app/api/partner/portfolio/[orgId]/rate/route.ts`
- Create: `src/__tests__/api.partner.portfolio.rate.test.ts`

- [ ] **Step 16.1: Тест**

Создать `src/__tests__/api.partner.portfolio.rate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/policy', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/policy');
  return { ...actual, canPartnerAccessOrg: vi.fn() };
});
vi.mock('@/lib/services/partner/rateOverride', () => ({
  setOrgCommissionRate: vi.fn(),
  clearOrgCommissionRate: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';
import { PUT } from '@/app/api/partner/portfolio/[orgId]/rate/route';

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const body = (b: unknown) => new Request('http://x/', { method: 'PUT', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });

describe('PUT /api/partner/portfolio/[orgId]/rate', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PUT(body({ rate: 0.1, reason: 'x' }), ctx('o1'))).status).toBe(401);
  });

  it('403 if not partner admin', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'manager'
    } as any);
    expect((await PUT(body({ rate: 0.1, reason: 'x' }), ctx('o1'))).status).toBe(403);
  });

  it('403 if admin but org outside partner scope', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(false);

    expect((await PUT(body({ rate: 0.1, reason: 'x' }), ctx('o1'))).status).toBe(403);
  });

  it('400 on invalid payload (no rate, no reason)', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);

    expect((await PUT(body({}), ctx('o1'))).status).toBe(400);
    expect((await PUT(body({ rate: 0.1 }), ctx('o1'))).status).toBe(400);
  });

  it('204 on successful set with rate', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'admin-user', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);

    const res = await PUT(body({ rate: 0.08, reason: 'VIP' }), ctx('o1'));
    expect(res.status).toBe(204);
    expect(setOrgCommissionRate).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1', partnerId: 'p1', newRate: 0.08, reason: 'VIP', changedByUserId: 'admin-user'
    });
  });

  it('204 on clear (rate=null)', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'admin-user', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);

    const res = await PUT(body({ rate: null, reason: 'возврат к базе' }), ctx('o1'));
    expect(res.status).toBe(204);
    expect(clearOrgCommissionRate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 16.2: FAIL**

- [ ] **Step 16.3: Реализация**

Создать `src/app/api/partner/portfolio/[orgId]/rate/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';

const payloadSchema = z.object({
  rate: z.union([z.number().gt(0).lt(1), z.null()]),
  reason: z.string().min(1).max(500)
});

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ orgId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const { orgId } = await ctx.params;
  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parseResult = payloadSchema.safeParse(await req.json().catch(() => null));
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { rate, reason } = parseResult.data;
  const partnerId = admin.value.partnerId;

  if (rate === null) {
    await clearOrgCommissionRate(prisma, {
      organizationId: orgId, partnerId, reason, changedByUserId: session.sub
    });
  } else {
    await setOrgCommissionRate(prisma, {
      organizationId: orgId, partnerId, newRate: rate, reason, changedByUserId: session.sub
    });
  }

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 16.4: PASS**

- [ ] **Step 16.5: Коммит**

```bash
git add src/app/api/partner/portfolio/[orgId]/rate/route.ts src/__tests__/api.partner.portfolio.rate.test.ts
git commit -m "feat(api): PUT /api/partner/portfolio/[orgId]/rate (admin only)"
```

---

### Task 17: Team API — GET/POST/PUT/DELETE

Объединяем в один task, поскольку все ручки тонкие.

**Files:**
- Create: `src/app/api/partner/team/route.ts` (GET, POST)
- Create: `src/app/api/partner/team/[userId]/route.ts` (PUT, DELETE)
- Create: `src/__tests__/api.partner.team.test.ts`

- [ ] **Step 17.1: Тест**

Создать `src/__tests__/api.partner.team.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/team', () => ({
  listTeam: vi.fn(), inviteMember: vi.fn(), assignOrgs: vi.fn(), deactivateMember: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { listTeam, inviteMember, assignOrgs, deactivateMember } from '@/lib/services/partner/team';
import { GET, POST } from '@/app/api/partner/team/route';
import { PUT, DELETE } from '@/app/api/partner/team/[userId]/route';

const adminSession = {
  sub: 'u-admin', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
} as any;

const managerSession = {
  sub: 'u-mgr', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: []
} as any;

const userCtx = (userId: string) => ({ params: Promise.resolve({ userId }) });
const jsonReq = (b: unknown) => new Request('http://x/', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });

describe('GET /api/partner/team', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 for non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await GET()).status).toBe(403);
  });

  it('returns team rows for admin', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(listTeam).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(listTeam).toHaveBeenCalledWith(expect.anything(), 'p1');
  });
});

describe('POST /api/partner/team', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 for non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await POST(jsonReq({ email: 'x@x.local', name: 'X', roleInPartner: 'manager', assignedOrgIds: [] }))).status).toBe(403);
  });

  it('400 on invalid payload', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    expect((await POST(jsonReq({ email: 'bad-email', name: '', roleInPartner: 'wrong' }))).status).toBe(400);
  });

  it('201 on success', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockResolvedValue({ user: { id: 'u1' }, partnerUser: { id: 'pu1' } } as any);

    const res = await POST(jsonReq({ email: 'x@x.local', name: 'Имя', roleInPartner: 'manager', assignedOrgIds: ['oA'] }));
    expect(res.status).toBe(201);
    expect(inviteMember).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1', email: 'x@x.local', name: 'Имя', roleInPartner: 'manager', assignedOrgIds: ['oA']
    });
  });

  it('409 on EMAIL_TAKEN', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockRejectedValue(new Error('EMAIL_TAKEN: ...'));
    expect((await POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: [] }))).status).toBe(409);
  });

  it('422 on ORG_OUT_OF_SCOPE', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockRejectedValue(new Error('ORG_OUT_OF_SCOPE'));
    expect((await POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: ['bad'] }))).status).toBe(422);
  });
});

describe('PUT /api/partner/team/[userId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await PUT(jsonReq({ assignedOrgIds: [] }), userCtx('u'))).status).toBe(403);
  });

  it('200 on successful assignOrgs', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(assignOrgs).mockResolvedValue({} as any);

    const res = await PUT(jsonReq({ assignedOrgIds: ['oA', 'oB'] }), userCtx('user-1'));
    expect(res.status).toBe(200);
    expect(assignOrgs).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1', userId: 'user-1', assignedOrgIds: ['oA', 'oB']
    });
  });
});

describe('DELETE /api/partner/team/[userId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await DELETE(new Request('http://x/'), userCtx('u'))).status).toBe(403);
  });

  it('204 on deactivate', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(deactivateMember).mockResolvedValue({} as any);

    expect((await DELETE(new Request('http://x/'), userCtx('user-1'))).status).toBe(204);
  });

  it('409 on LAST_ADMIN', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(deactivateMember).mockRejectedValue(new Error('LAST_ADMIN'));
    expect((await DELETE(new Request('http://x/'), userCtx('user-1'))).status).toBe(409);
  });
});
```

- [ ] **Step 17.2: FAIL**

- [ ] **Step 17.3: Создать `src/app/api/partner/team/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { listTeam, inviteMember } from '@/lib/services/partner/team';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  roleInPartner: z.enum(['admin', 'manager']),
  assignedOrgIds: z.array(z.string()).default([])
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const team = await listTeam(prisma, admin.value.partnerId);
  return NextResponse.json(team);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const parsed = inviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await inviteMember(prisma, {
      partnerId: admin.value.partnerId,
      ...parsed.data
    });
    return NextResponse.json(
      { userId: result.user.id, partnerUserId: result.partnerUser.id },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.startsWith('EMAIL_TAKEN')) return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });
    if (msg.startsWith('ORG_OUT_OF_SCOPE')) return NextResponse.json({ error: 'ORG_OUT_OF_SCOPE' }, { status: 422 });
    throw err;
  }
}
```

- [ ] **Step 17.4: Создать `src/app/api/partner/team/[userId]/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartnerAdmin } from '@/lib/auth/guard';
import { assignOrgs, deactivateMember } from '@/lib/services/partner/team';

const assignSchema = z.object({
  assignedOrgIds: z.array(z.string())
});

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const { userId } = await ctx.params;
  const parsed = assignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await assignOrgs(prisma, {
      partnerId: admin.value.partnerId,
      userId,
      assignedOrgIds: parsed.data.assignedOrgIds
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.startsWith('ORG_OUT_OF_SCOPE')) return NextResponse.json({ error: 'ORG_OUT_OF_SCOPE' }, { status: 422 });
    if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requirePartnerAdmin(session);
  if (!admin.ok) return admin.response;

  const { userId } = await ctx.params;

  try {
    await deactivateMember(prisma, { partnerId: admin.value.partnerId, userId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.startsWith('LAST_ADMIN')) return NextResponse.json({ error: 'LAST_ADMIN' }, { status: 409 });
    if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    throw err;
  }
}
```

- [ ] **Step 17.5: PASS**

```bash
npx vitest run src/__tests__/api.partner.team.test.ts
```

- [ ] **Step 17.6: Коммит**

```bash
git add src/app/api/partner/team src/__tests__/api.partner.team.test.ts
git commit -m "feat(api): partner team CRUD (list, invite, assignOrgs, deactivate)"
```

---

## Часть 5 — Навигация и layout

### Task 18: Расширить `navByRole.partner` реальными разделами

Спека §5.1: разделы Дашборд / Портфель / Сделки / Заявки / Документы / Финансы / Команда / Настройки. В Phase 1 рендерим только активные (Dashboard, Portfolio, Team). Остальные — disabled placeholders (визуально присутствуют как «скоро»), это даёт пользователю сигнал что фичи будут.

**Files:**
- Modify: `src/lib/navigation/cabinet.ts`
- Modify: `src/components/dashboard/app-shell.tsx` (поддержать disabled item)
- Create: `src/__tests__/navigation.cabinet.partner.test.ts`

- [ ] **Step 18.1: Тест**

Создать `src/__tests__/navigation.cabinet.partner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { navByRole } from '@/lib/navigation/cabinet';

describe('navByRole.partner', () => {
  it('contains Phase 1 active items', () => {
    const labels = navByRole.partner.filter((i) => !i.disabled).map((i) => i.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Дашборд', 'Портфель', 'Команда'])
    );
  });

  it('contains Phase 2+ items as disabled', () => {
    const disabled = navByRole.partner.filter((i) => i.disabled).map((i) => i.label);
    expect(disabled).toEqual(
      expect.arrayContaining(['Сделки', 'Заявки', 'Документы', 'Финансы'])
    );
  });

  it('all items have href and label', () => {
    for (const item of navByRole.partner) {
      expect(item.href).toBeTypeOf('string');
      expect(item.label).toBeTypeOf('string');
    }
  });

  it('admin/manager/organization/student nav unchanged shape', () => {
    expect(Array.isArray(navByRole.admin)).toBe(true);
    expect(Array.isArray(navByRole.manager)).toBe(true);
    expect(navByRole.admin.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 18.2: FAIL — `disabled` поля нет**

- [ ] **Step 18.3: Расширить тип и `navByRole.partner`**

Изменить `src/lib/navigation/cabinet.ts`:

```typescript
import type { Role } from '@/lib/auth/jwt';

export type NavItem = { href: string; label: string; disabled?: boolean };

export const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { href: '/admin/dashboard', label: 'Dashboard' },
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/documents', label: 'Documents' },
    { href: '/admin/messages', label: 'Messages' }
  ],
  manager: [
    { href: '/manager/dashboard', label: 'Dashboard' },
    { href: '/manager/orders', label: 'Orders' },
    { href: '/manager/documents', label: 'Documents' },
    { href: '/manager/messages', label: 'Messages' }
  ],
  partner: [
    { href: '/partner/dashboard', label: 'Дашборд' },
    { href: '/partner/portfolio', label: 'Портфель' },
    { href: '/partner/deals', label: 'Сделки', disabled: true },
    { href: '/partner/leads', label: 'Заявки', disabled: true },
    { href: '/partner/documents', label: 'Документы', disabled: true },
    { href: '/partner/finance', label: 'Финансы', disabled: true },
    { href: '/partner/team', label: 'Команда' }
  ],
  organization: [
    { href: '/organization/dashboard', label: 'Dashboard организации' },
    { href: '/student', label: 'Кабинет слушателя' }
  ],
  student: [{ href: '/student', label: 'Обучение' }]
};
```

- [ ] **Step 18.4: Обновить `AppShell` чтобы пропускать disabled**

В `src/components/dashboard/app-shell.tsx` заменить `.map(...)` в sidebar:

```tsx
{navByRole[session.role].map((item) =>
  item.disabled ? (
    <div
      key={item.href}
      className='flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 cursor-not-allowed'
      title='Доступно в следующей фазе'
    >
      <span className='w-1.5 h-1.5 rounded-full bg-gray-200 flex-shrink-0' />
      {item.label}
      <span className='ml-auto text-[10px] uppercase tracking-wide text-gray-300 bg-gray-50 px-1.5 py-0.5 rounded'>скоро</span>
    </div>
  ) : (
    <Link
      key={item.href}
      href={item.href}
      className='flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-[#FFF7ED] hover:text-[#F97316] transition-all group'
    >
      <span className='w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-[#F97316] transition-colors flex-shrink-0' />
      {item.label}
    </Link>
  )
)}
```

- [ ] **Step 18.5: PASS**

```bash
npx vitest run src/__tests__/navigation.cabinet.partner.test.ts
```

- [ ] **Step 18.6: Коммит**

```bash
git add src/lib/navigation/cabinet.ts src/components/dashboard/app-shell.tsx src/__tests__/navigation.cabinet.partner.test.ts
git commit -m "feat(nav): real partner sidebar items with Phase 2 placeholders"
```

---

### Task 19: `BottomTabBar` для мобильного + `/partner/layout.tsx`

Спека §5.10 п.9-10: mobile bottom tab-bar (4 основные: Дашборд / Сделки / Документы / Финансы) и touch targets ≥ 44×44px. В Phase 1 показываем все 4 кнопки, но Сделки/Документы/Финансы — disabled.

**Files:**
- Create: `src/components/partner/bottom-tab-bar.tsx`
- Create: `src/app/partner/layout.tsx`

(Component тестов нет в проекте — RTL не настроен. Проверка — smoke на dev server в Task 28.)

- [ ] **Step 19.1: Создать компонент**

Создать `src/components/partner/bottom-tab-bar.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = { href: string; label: string; icon: string; disabled?: boolean };

const TABS: Tab[] = [
  { href: '/partner/dashboard', label: 'Кабинет', icon: '⌂' },
  { href: '/partner/portfolio', label: 'Портфель', icon: '🏢' },
  { href: '/partner/team', label: 'Команда', icon: '👥' },
  { href: '/partner/deals', label: 'Сделки', icon: '📋', disabled: true }
];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label='Mobile navigation'
      className='fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 grid grid-cols-4 md:hidden'
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const className = `flex flex-col items-center justify-center gap-0.5 h-14 text-xs font-medium ${
          tab.disabled
            ? 'text-gray-300 cursor-not-allowed'
            : active
            ? 'text-[#F97316]'
            : 'text-gray-600 active:bg-[#FFF7ED]'
        }`;

        if (tab.disabled) {
          return (
            <div key={tab.href} className={className} aria-disabled='true'>
              <span className='text-lg leading-none'>{tab.icon}</span>
              {tab.label}
            </div>
          );
        }
        return (
          <Link key={tab.href} href={tab.href} className={className}>
            <span className='text-lg leading-none'>{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 19.2: Создать `/partner/layout.tsx`**

```tsx
import { AppShell } from '@/components/dashboard/app-shell';
import { BottomTabBar } from '@/components/partner/bottom-tab-bar';

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>
        <div className='pb-16 md:pb-0'>{children}</div>
      </AppShell>
      <BottomTabBar />
    </>
  );
}
```

`pb-16` нужен чтобы контент не уходил под bottom-bar на мобильном (h-14 = 56px, +отступ).

- [ ] **Step 19.3: Sanity — typecheck + build**

```bash
npm run typecheck
npm run build
```

Ожидаемо: 0 errors, build success.

- [ ] **Step 19.4: Коммит**

```bash
git add src/components/partner/bottom-tab-bar.tsx src/app/partner/layout.tsx
git commit -m "feat(partner): mobile bottom tab bar and /partner/layout.tsx"
```

---

## Часть 6 — UI страницы

Все страницы — Server Components, читают через сервисы (без HTTP-fetch к собственному API). Это даёт скорость и убирает water-fall. Mutation-формы — Client Components, вызывающие API роуты через `fetch`.

### Task 20: Dashboard `/partner/dashboard` — реальные данные

**Files:**
- Modify: `src/app/partner/dashboard/page.tsx`
- Create: `src/components/partner/kpi-grid.tsx`
- Create: `src/components/partner/attention-list.tsx`
- Create: `src/components/partner/events-feed.tsx`

(Tests-free pure presentational components — корректность валидируется smoke E2E.)

- [ ] **Step 20.1: Создать `kpi-grid.tsx`**

```tsx
import { StatCard } from '@/components/dashboard/stat-card';

export type DashboardKpis = {
  openOrders: number;
  outstanding: string;
  activeLeads: number;
  commissionThisMonth: string;
};

function fmtMoney(rubles: string): string {
  const n = Number(rubles);
  if (!Number.isFinite(n)) return rubles;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
}

export function KpiGrid({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-4'>
      <StatCard title='Открытые сделки' value={kpis.openOrders} />
      <StatCard title='К оплате' value={fmtMoney(kpis.outstanding) as unknown as number} />
      <StatCard title='Заявки в работе' value={kpis.activeLeads} />
      <StatCard title='Комиссия за месяц' value={fmtMoney(kpis.commissionThisMonth) as unknown as number} accent />
    </div>
  );
}
```

**Примечание:** `StatCard` принимает `value: number`, а у нас валюта-строка. Чтобы не модифицировать `StatCard`, передаём отформатированную строку через `as unknown as number` (он рендерит `{value}` без проверки типа). В будущем (Phase 5 polish) можно расширить `StatCard` чтобы принимать `value: string | number`.

Альтернативно — можно расширить `StatCard` сразу. Делаем правильно: расширяем тип.

Изменить `src/components/dashboard/stat-card.tsx`:

```tsx
export function StatCard({ title, value, accent }: { title: string; value: number | string; accent?: boolean }) {
```

И тогда в `kpi-grid.tsx` убираем cast:

```tsx
<StatCard title='К оплате' value={fmtMoney(kpis.outstanding)} />
<StatCard title='Комиссия за месяц' value={fmtMoney(kpis.commissionThisMonth)} accent />
```

- [ ] **Step 20.2: Создать `attention-list.tsx`**

```tsx
import Link from 'next/link';
import type { Attention } from '@/lib/services/partner/dashboard';

export function AttentionList({ data }: { data: Attention }) {
  const empty =
    data.stuckOrders.length === 0 &&
    data.overdueOrders.length === 0 &&
    data.staleLeads.length === 0;

  if (empty) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        Всё под контролем — ничего не зависло.
      </div>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Требует внимания</h2>
      <ul className='space-y-2 text-sm'>
        {data.stuckOrders.map((o) => (
          <li key={`stuck-${o.id}`} className='flex items-center justify-between gap-3'>
            <span className='text-gray-700'>🕒 Сделка «{o.title}» зависла</span>
            <span className='text-gray-400 text-xs'>обн. {o.updatedAt.toLocaleDateString('ru-RU')}</span>
          </li>
        ))}
        {data.overdueOrders.map((o) => (
          <li key={`overdue-${o.id}`} className='flex items-center justify-between gap-3'>
            <span className='text-red-700'>⚠ Просрочка: «{o.title}»</span>
            <span className='text-gray-400 text-xs'>до {o.deadline?.toLocaleDateString('ru-RU') ?? '—'}</span>
          </li>
        ))}
        {data.staleLeads.map((l) => (
          <li key={`lead-${l.id}`} className='flex items-center justify-between gap-3'>
            <span className='text-gray-700'>👤 Лид «{l.clientCompanyName}» без квалификации</span>
            <span className='text-gray-400 text-xs'>с {l.createdAt.toLocaleDateString('ru-RU')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 20.3: Создать `events-feed.tsx`**

```tsx
import type { DashboardEvent } from '@/lib/services/partner/dashboard';

const kindIcon: Record<DashboardEvent['kind'], string> = {
  order_updated: '📋',
  lead_created: '👤',
  payment_received: '💰'
};

export function EventsFeed({ events }: { events: DashboardEvent[] }) {
  if (events.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        Пока тут пусто — события появятся когда начнётся работа.
      </div>
    );
  }
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Последние события</h2>
      <ul className='space-y-2 text-sm'>
        {events.map((e, i) => (
          <li key={i} className='flex items-center justify-between gap-3'>
            <span className='text-gray-700'>
              <span className='mr-1'>{kindIcon[e.kind]}</span>
              {e.title}
            </span>
            <span className='text-gray-400 text-xs whitespace-nowrap'>{e.at.toLocaleString('ru-RU')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 20.4: Обновить `src/app/partner/dashboard/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { kpis, attention, recentEvents } from '@/lib/services/partner/dashboard';
import { KpiGrid } from '@/components/partner/kpi-grid';
import { AttentionList } from '@/components/partner/attention-list';
import { EventsFeed } from '@/components/partner/events-feed';

export default async function PartnerDashboard() {
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');

  const scope = {
    partnerId: session.partnerId,
    scopeOrgIds: session.assignedOrgIds ?? []
  };

  const [k, a, events] = await Promise.all([
    kpis(prisma, scope),
    attention(prisma, scope),
    recentEvents(prisma, scope, 10)
  ]);

  return (
    <div className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Кабинет партнёра</h1>
        <p className='text-sm text-gray-500 mt-0.5'>Обзор ключевых показателей и активности</p>
      </div>

      <KpiGrid kpis={k} />

      <div className='grid gap-4 md:grid-cols-2'>
        <AttentionList data={a} />
        <EventsFeed events={events} />
      </div>
    </div>
  );
}
```

- [ ] **Step 20.5: Smoke — typecheck + build**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 20.6: Коммит**

```bash
git add src/app/partner/dashboard/page.tsx src/components/partner/kpi-grid.tsx src/components/partner/attention-list.tsx src/components/partner/events-feed.tsx src/components/dashboard/stat-card.tsx
git commit -m "feat(partner): dashboard with real KPI, attention list and events feed"
```

---

### Task 21: Portfolio list `/partner/portfolio`

Спека §5.3: density-таблица, поиск, server-side pagination, mobile card-list.

**Files:**
- Create: `src/app/partner/portfolio/page.tsx`
- Create: `src/components/partner/portfolio-table.tsx`
- Create: `src/components/partner/portfolio-card-list.tsx`
- Create: `src/components/partner/portfolio-search.tsx`

- [ ] **Step 21.1: Создать `portfolio-search.tsx` (client)**

```tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function PortfolioSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get('search') ?? '');
  const [isPending, startTransition] = useTransition();

  function apply(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set('search', next);
    else params.delete('search');
    params.delete('skip');
    startTransition(() => router.replace(`/partner/portfolio?${params.toString()}`));
  }

  return (
    <div className='flex gap-2 items-center'>
      <input
        type='search'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') apply(value); }}
        placeholder='Поиск по названию…'
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-72 focus:outline-none focus:border-[#F97316]'
      />
      <button
        onClick={() => apply(value)}
        className='px-3 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
        disabled={isPending}
      >
        Найти
      </button>
    </div>
  );
}
```

- [ ] **Step 21.2: Создать `portfolio-table.tsx` (desktop server component)**

```tsx
import Link from 'next/link';
import type { PortfolioItem } from '@/lib/services/partner/portfolio';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

export function PortfolioTable({ items }: { items: PortfolioItem[] }) {
  if (items.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>🏢</span>
        </div>
        <p className='text-gray-500 text-sm'>Нет организаций по выбранным фильтрам</p>
      </div>
    );
  }

  return (
    <div className='hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Организация</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>ИНН</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сделок</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Долг</th>
          </tr>
        </thead>
        <tbody>
          {items.map((org, i) => (
            <tr key={org.id} className={`border-b border-gray-50 hover:bg-[#FFF7ED] ${i === items.length - 1 ? 'border-b-0' : ''}`}>
              <td className='px-4 py-2.5'>
                <Link href={`/partner/portfolio/${org.id}`} className='font-medium text-[#111111] hover:text-[#F97316]'>
                  {org.name}
                </Link>
              </td>
              <td className='px-4 py-2.5 text-gray-500'>{org.inn ?? '—'}</td>
              <td className='px-4 py-2.5 text-right'>{org.ordersCount}</td>
              <td className={`px-4 py-2.5 text-right ${Number(org.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
                {fmtMoney(org.debt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 21.3: Создать `portfolio-card-list.tsx` (mobile server component)**

```tsx
import Link from 'next/link';
import type { PortfolioItem } from '@/lib/services/partner/portfolio';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

export function PortfolioCardList({ items }: { items: PortfolioItem[] }) {
  if (items.length === 0) return null;

  return (
    <ul className='md:hidden space-y-2'>
      {items.map((org) => (
        <li key={org.id}>
          <Link
            href={`/partner/portfolio/${org.id}`}
            className='block bg-white border border-gray-200 rounded-xl p-4 active:bg-[#FFF7ED]'
          >
            <div className='font-medium text-[#111111]'>{org.name}</div>
            <div className='text-xs text-gray-500 mt-1'>{org.inn ?? 'ИНН не указан'}</div>
            <div className='flex justify-between items-center mt-2 text-sm'>
              <span className='text-gray-500'>{org.ordersCount} сделок</span>
              <span className={Number(org.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'}>
                Долг: {fmtMoney(org.debt)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 21.4: Создать `src/app/partner/portfolio/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { listPortfolio } from '@/lib/services/partner/portfolio';
import { PortfolioSearch } from '@/components/partner/portfolio-search';
import { PortfolioTable } from '@/components/partner/portfolio-table';
import { PortfolioCardList } from '@/components/partner/portfolio-card-list';

type SearchParams = { search?: string; take?: string; skip?: string };

const DEFAULT_TAKE = 20;
const MAX_TAKE = 100;

export default async function PortfolioPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');

  const sp = await searchParams;
  const take = Math.min(
    Number.isFinite(Number(sp.take)) ? Number(sp.take) : DEFAULT_TAKE,
    MAX_TAKE
  );
  const skip = Number.isFinite(Number(sp.skip)) ? Number(sp.skip) : 0;
  const search = sp.search ?? undefined;

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const { items, total } = await listPortfolio(prisma, {
    partnerId: session.partnerId,
    scopeOrgIds: scope,
    search,
    take,
    skip
  });

  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <div className='space-y-4'>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Портфель</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {total} {total === 1 ? 'организация' : total < 5 ? 'организации' : 'организаций'}
          </p>
        </div>
        <PortfolioSearch />
      </div>

      <PortfolioTable items={items} />
      <PortfolioCardList items={items} />

      {pages > 1 && (
        <Paginator total={total} take={take} skip={skip} page={page} pages={pages} search={search} />
      )}
    </div>
  );
}

function Paginator({
  total, take, skip, page, pages, search
}: { total: number; take: number; skip: number; page: number; pages: number; search?: string }) {
  function link(targetSkip: number): string {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    return `/partner/portfolio${params.toString() ? '?' + params.toString() : ''}`;
  }

  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);

  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>Страница {page} из {pages} · {total} всего</span>
      <div className='flex gap-2'>
        {skip > 0 && <a href={link(prev)} className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'>Назад</a>}
        {skip + take < total && <a href={link(next)} className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'>Вперёд</a>}
      </div>
    </div>
  );
}
```

- [ ] **Step 21.5: Smoke — typecheck + build**

- [ ] **Step 21.6: Коммит**

```bash
git add src/app/partner/portfolio src/components/partner/portfolio-search.tsx src/components/partner/portfolio-table.tsx src/components/partner/portfolio-card-list.tsx
git commit -m "feat(partner): portfolio list page with search and pagination"
```

---

### Task 22: Org card `/partner/portfolio/[orgId]` — header + tabs

Спека §5.4: header (KPI), табы Сотрудники / Комментарии / История / Настройки.
Сделки/Документы — в Phase 2; в Phase 1 их табы НЕ отрисовываем.

**Files:**
- Create: `src/app/partner/portfolio/[orgId]/page.tsx`
- Create: `src/components/partner/org-card-header.tsx`
- Create: `src/components/partner/org-tabs.tsx`

- [ ] **Step 22.1: Создать `org-card-header.tsx`**

```tsx
import type { OrgCard } from '@/lib/services/partner/orgCard';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

export function OrgCardHeader({ card }: { card: OrgCard }) {
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <div className='flex flex-col md:flex-row md:items-start md:justify-between gap-4'>
        <div className='flex-1'>
          <h1 className='text-2xl font-bold text-[#111111]'>{card.name}</h1>
          <div className='text-sm text-gray-500 mt-1'>
            ИНН {card.inn ?? '—'}{card.kpp ? ` · КПП ${card.kpp}` : ''}
          </div>
          {card.legalName && (
            <div className='text-xs text-gray-400 mt-0.5'>{card.legalName}</div>
          )}
        </div>
        <div className='grid grid-cols-2 gap-3 md:gap-4 md:min-w-[280px]'>
          <Tile label='Сделок' value={String(card.kpi.ordersCount)} />
          <Tile label='Долг' value={fmtMoney(card.kpi.debt)} accent={Number(card.kpi.debt) > 0} />
        </div>
      </div>
      {card.partnerCommissionRate !== null && (
        <div className='mt-3 px-3 py-2 bg-[#FFF7ED] border border-orange-100 rounded-lg text-xs text-orange-800'>
          Индивидуальная ставка комиссии: <strong>{(Number(card.partnerCommissionRate) * 100).toFixed(2)}%</strong>
          {card.partnerCommissionRateNote && <span className='ml-1 text-orange-600'>· {card.partnerCommissionRateNote}</span>}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
      <div className='text-[10px] uppercase tracking-wider text-gray-500'>{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-red-700' : 'text-[#111111]'}`}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 22.2: Создать `org-tabs.tsx` (server, ссылки на табы через query string)**

```tsx
import Link from 'next/link';

export type TabKey = 'employees' | 'comments' | 'history' | 'settings';

const ALL_TABS: { key: TabKey; label: string; adminOnly?: boolean }[] = [
  { key: 'employees', label: 'Сотрудники' },
  { key: 'comments', label: 'Комментарии' },
  { key: 'history', label: 'История' },
  { key: 'settings', label: 'Настройки', adminOnly: true }
];

export function OrgTabs({
  orgId, active, isAdmin
}: { orgId: string; active: TabKey; isAdmin: boolean }) {
  const tabs = ALL_TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <nav className='border-b border-gray-200 flex gap-4 overflow-x-auto'>
      {tabs.map((t) => {
        const isActive = t.key === active;
        const href = t.key === 'settings'
          ? `/partner/portfolio/${orgId}/settings`
          : `/partner/portfolio/${orgId}?tab=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              isActive
                ? 'text-[#F97316] border-[#F97316]'
                : 'text-gray-600 border-transparent hover:text-[#111111]'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 22.3: Создать `src/app/partner/portfolio/[orgId]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canPartnerAccessOrg, isPartnerAdmin } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import { OrgTabs, type TabKey } from '@/components/partner/org-tabs';
import { EmployeesTab } from '@/components/partner/org-employees-tab';
import { CommentsTab } from '@/components/partner/org-comments-tab';
import { HistoryTab } from '@/components/partner/org-history-tab';

const VALID_TABS: TabKey[] = ['employees', 'comments', 'history'];

export default async function OrgCardPage({
  params, searchParams
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');

  const { orgId } = await params;

  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) redirect('/forbidden');

  const card = await getOrgCard(prisma, { orgId, partnerId: session.partnerId });
  if (!card) notFound();

  const sp = await searchParams;
  const tab: TabKey = VALID_TABS.includes(sp.tab as TabKey) ? (sp.tab as TabKey) : 'employees';

  return (
    <div className='space-y-4'>
      <OrgCardHeader card={card} />
      <OrgTabs orgId={orgId} active={tab} isAdmin={isPartnerAdmin(session)} />
      {tab === 'employees' && <EmployeesTab orgId={orgId} />}
      {tab === 'comments' && <CommentsTab orgId={orgId} />}
      {tab === 'history' && <HistoryTab orgId={orgId} />}
    </div>
  );
}
```

- [ ] **Step 22.4: Sanity check — нужны stub-компоненты табов**

Эти компоненты создаются в Task 23, иначе build упадёт. Поэтому пока — заглушки в этом файле:

Изменить импорты на inline-функции (временно):

```tsx
function EmployeesTab() { return <div className='text-sm text-gray-500'>Будет в Task 23</div>; }
function CommentsTab() { return <div className='text-sm text-gray-500'>Будет в Task 23</div>; }
function HistoryTab() { return <div className='text-sm text-gray-500'>Будет в Task 23</div>; }
```

И убрать импорты из `@/components/partner/org-*-tab`. **Не коммитим пока — следующая задача всё доделает.**

Альтернативный вариант: совместить Task 22 и Task 23 в один коммит. Делаем именно так — переходим к Step 22.5 (=Task 23 ниже) до коммита.

- [ ] **Step 22.5: Откладываем коммит — продолжаем в Task 23**

---

### Task 23: Табы Employees / Comments / History для org card

**Files:**
- Create: `src/components/partner/org-employees-tab.tsx`
- Create: `src/components/partner/org-comments-tab.tsx`
- Create: `src/components/partner/org-history-tab.tsx`

- [ ] **Step 23.1: `org-employees-tab.tsx`**

Список `OrganizationUser` для этой организации.

```tsx
import { prisma } from '@/lib/db/prisma';

export async function EmployeesTab({ orgId }: { orgId: string }) {
  const rows = await prisma.organizationUser.findMany({
    where: { organizationId: orgId, isActive: true },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' }
  });

  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        В этой организации пока нет сотрудников.
      </div>
    );
  }

  return (
    <ul className='divide-y divide-gray-100 bg-white border border-gray-200 rounded-xl'>
      {rows.map((r) => (
        <li key={r.id} className='px-4 py-3 flex items-center justify-between'>
          <div>
            <div className='text-sm font-medium text-[#111111]'>{r.user.name}</div>
            <div className='text-xs text-gray-500'>{r.user.email}</div>
          </div>
          {r.roleInOrg && (
            <span className='text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded'>{r.roleInOrg}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 23.2: `org-comments-tab.tsx`**

Комментарии по заказам этой организации (через `Order.companyId → Order.organizations`).

```tsx
import { prisma } from '@/lib/db/prisma';

export async function CommentsTab({ orgId }: { orgId: string }) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { companyId: true }
  });
  if (!org?.companyId) {
    return <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>Нет данных.</div>;
  }

  const comments = await prisma.comment.findMany({
    where: { order: { companyId: org.companyId } },
    include: {
      author: { select: { name: true } },
      order: { select: { id: true, title: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  if (comments.length === 0) {
    return <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>Комментариев нет.</div>;
  }

  return (
    <ul className='space-y-2'>
      {comments.map((c) => (
        <li key={c.id} className='bg-white border border-gray-200 rounded-xl p-4'>
          <div className='flex justify-between text-xs text-gray-500 mb-1'>
            <span>{c.author.name} · «{c.order.title}»</span>
            <span>{c.createdAt.toLocaleString('ru-RU')}</span>
          </div>
          <div className='text-sm text-[#111111] whitespace-pre-wrap'>{c.body}</div>
        </li>
      ))}
    </ul>
  );
}
```

**Примечание:** связь в схеме — `author` (поле `authorId` + relation `author User`), а текст — `body`. Использовать именно `author.name`.

- [ ] **Step 23.3: `org-history-tab.tsx`**

```tsx
import { prisma } from '@/lib/db/prisma';

const labels: Record<string, string> = {
  partner_commission_rate_changed: 'Изменена ставка комиссии'
};

export async function HistoryTab({ orgId }: { orgId: string }) {
  const rows = await prisma.auditLog.findMany({
    where: { entity: 'Organization', entityId: orgId },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  if (rows.length === 0) {
    return <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>История пуста.</div>;
  }

  return (
    <ul className='divide-y divide-gray-100 bg-white border border-gray-200 rounded-xl'>
      {rows.map((r) => (
        <li key={r.id} className='px-4 py-3'>
          <div className='flex justify-between text-xs text-gray-500'>
            <span>{r.user?.name ?? 'Система'}</span>
            <span>{r.createdAt.toLocaleString('ru-RU')}</span>
          </div>
          <div className='text-sm text-[#111111] mt-0.5'>
            {labels[r.action] ?? r.action}
            {r.action === 'partner_commission_rate_changed' && r.meta && (
              <span className='text-gray-500 text-xs ml-2'>
                {String((r.meta as { oldRate?: string | null }).oldRate ?? '—')} → {String((r.meta as { newRate?: string | null }).newRate ?? '—')}
                {(r.meta as { reason?: string }).reason && ` · ${(r.meta as { reason: string }).reason}`}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 23.4: Вернуть импорты в `page.tsx` (Task 22)**

В `src/app/partner/portfolio/[orgId]/page.tsx` убрать inline-заглушки и вернуть импорты:

```tsx
import { EmployeesTab } from '@/components/partner/org-employees-tab';
import { CommentsTab } from '@/components/partner/org-comments-tab';
import { HistoryTab } from '@/components/partner/org-history-tab';
```

- [ ] **Step 23.5: Smoke — typecheck + build**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 23.6: Коммит (объединённый с Task 22)**

```bash
git add src/app/partner/portfolio/[orgId]/page.tsx src/components/partner/org-card-header.tsx src/components/partner/org-tabs.tsx src/components/partner/org-employees-tab.tsx src/components/partner/org-comments-tab.tsx src/components/partner/org-history-tab.tsx
git commit -m "feat(partner): org card with header, tabs (employees, comments, history)"
```

---

### Task 24: Org Settings `/partner/portfolio/[orgId]/settings` — rate override (admin only)

Спека §5.4 / §6.7: переопределение ставки. Middleware уже защищает path (Task 4), но дополнительно делаем `isPartnerAdmin` guard в page (defense-in-depth).

**Files:**
- Create: `src/app/partner/portfolio/[orgId]/settings/page.tsx`
- Create: `src/components/partner/rate-override-form.tsx` (client)

- [ ] **Step 24.1: Создать форму (client component)**

`src/components/partner/rate-override-form.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function RateOverrideForm({
  orgId,
  initialRate,
  initialNote
}: { orgId: string; initialRate: string | null; initialNote: string | null }) {
  const router = useRouter();
  const [rate, setRate] = useState<string>(initialRate ? (Number(initialRate) * 100).toFixed(2) : '');
  const [reason, setReason] = useState<string>(initialNote ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: 'set' | 'clear') {
    setError(null);
    setSubmitting(true);
    try {
      const payload =
        action === 'clear'
          ? { rate: null, reason: reason || 'Возврат к базовой ставке' }
          : { rate: Number(rate) / 100, reason };

      const res = await fetch(`/api/partner/portfolio/${orgId}/rate`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === 'string' ? body.error : 'Ошибка сохранения');
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
      <h2 className='text-sm font-semibold text-[#111111]'>Ставка комиссии партнёра для этой организации</h2>

      <label className='block'>
        <span className='text-sm text-gray-700'>Ставка, %</span>
        <input
          type='number'
          step='0.01'
          min='0.01'
          max='99.99'
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-48 focus:outline-none focus:border-[#F97316]'
          placeholder='напр. 8.00'
        />
      </label>

      <label className='block'>
        <span className='text-sm text-gray-700'>Обоснование (audit log)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
          placeholder='Например: VIP-клиент, индивидуальные условия'
        />
      </label>

      {error && <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>{error}</div>}

      <div className='flex gap-2'>
        <button
          type='button'
          onClick={() => submit('set')}
          disabled={submitting || !rate || !reason.trim()}
          className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
        >
          Сохранить
        </button>
        {initialRate !== null && (
          <button
            type='button'
            onClick={() => submit('clear')}
            disabled={submitting}
            className='px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50'
          >
            Вернуть базовую ставку
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 24.2: Создать страницу**

`src/app/partner/portfolio/[orgId]/settings/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canPartnerAccessOrg, isPartnerAdmin } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import { OrgTabs } from '@/components/partner/org-tabs';
import { RateOverrideForm } from '@/components/partner/rate-override-form';

export default async function OrgSettingsPage({
  params
}: { params: Promise<{ orgId: string }> }) {
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');
  if (!isPartnerAdmin(session)) redirect('/forbidden');

  const { orgId } = await params;
  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) redirect('/forbidden');

  const card = await getOrgCard(prisma, { orgId, partnerId: session.partnerId });
  if (!card) notFound();

  return (
    <div className='space-y-4'>
      <OrgCardHeader card={card} />
      <OrgTabs orgId={orgId} active='settings' isAdmin={true} />
      <RateOverrideForm
        orgId={orgId}
        initialRate={card.partnerCommissionRate}
        initialNote={card.partnerCommissionRateNote}
      />
    </div>
  );
}
```

- [ ] **Step 24.3: Smoke — typecheck + build**

- [ ] **Step 24.4: Коммит**

```bash
git add src/app/partner/portfolio/[orgId]/settings src/components/partner/rate-override-form.tsx
git commit -m "feat(partner): org settings page with commission rate override (admin only)"
```

---

### Task 25: Team `/partner/team` — список + инвайт + assign orgs

**Files:**
- Create: `src/app/partner/team/page.tsx`
- Create: `src/components/partner/team-list.tsx`
- Create: `src/components/partner/team-invite-form.tsx` (client)
- Create: `src/components/partner/team-assign-orgs-row.tsx` (client)

- [ ] **Step 25.1: `team-invite-form.tsx`**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type OrgChoice = { id: string; name: string };

export function TeamInviteForm({ orgs }: { orgs: OrgChoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'manager'>('manager');
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/partner/team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, roleInPartner: role, assignedOrgIds: selectedOrgs })
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(typeof b.error === 'string' ? b.error : 'Ошибка');
        return;
      }
      setEmail(''); setName(''); setSelectedOrgs([]); setRole('manager'); setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
      >
        + Пригласить участника
      </button>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
      <div className='grid gap-3 md:grid-cols-2'>
        <label>
          <span className='text-sm text-gray-700'>Email</span>
          <input type='email' value={email} onChange={(e) => setEmail(e.target.value)}
            className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'/>
        </label>
        <label>
          <span className='text-sm text-gray-700'>Имя</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'/>
        </label>
      </div>

      <label>
        <span className='text-sm text-gray-700'>Роль внутри партнёра</span>
        <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'manager')}
          className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-48'>
          <option value='manager'>Менеджер (scoped)</option>
          <option value='admin'>Администратор партнёра</option>
        </select>
      </label>

      {role === 'manager' && (
        <fieldset className='border border-gray-200 rounded-lg p-3'>
          <legend className='text-xs text-gray-500 px-1'>Доступ к организациям (пусто = все)</legend>
          <div className='flex flex-wrap gap-2 max-h-40 overflow-y-auto'>
            {orgs.map((o) => {
              const checked = selectedOrgs.includes(o.id);
              return (
                <label key={o.id} className={`text-xs px-2 py-1 rounded border cursor-pointer ${checked ? 'border-[#F97316] bg-[#FFF7ED] text-[#F97316]' : 'border-gray-200 text-gray-700'}`}>
                  <input
                    type='checkbox'
                    className='hidden'
                    checked={checked}
                    onChange={() => setSelectedOrgs((prev) => checked ? prev.filter((x) => x !== o.id) : [...prev, o.id])}
                  />
                  {o.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {error && <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>
        {error === 'EMAIL_TAKEN' ? 'Пользователь с таким email уже существует' :
         error === 'ORG_OUT_OF_SCOPE' ? 'Одна или несколько организаций вне партнёра' :
         error}
      </div>}

      <div className='flex gap-2'>
        <button onClick={invite} disabled={submitting || !email || !name}
          className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'>
          Пригласить
        </button>
        <button onClick={() => setOpen(false)} className='px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50'>
          Отмена
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 25.2: `team-assign-orgs-row.tsx`**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Org = { id: string; name: string };

export function TeamAssignOrgsRow({
  userId, orgs, initialSelected
}: { userId: string; orgs: Org[]; initialSelected: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/partner/team/${userId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignedOrgIds: selected })
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!confirm('Деактивировать участника?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/partner/team/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b.error === 'LAST_ADMIN' ? 'Нельзя деактивировать последнего администратора' : 'Ошибка');
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap gap-1.5 max-h-24 overflow-y-auto'>
        {orgs.map((o) => {
          const checked = selected.includes(o.id);
          return (
            <label key={o.id} className={`text-xs px-2 py-1 rounded border cursor-pointer ${checked ? 'border-[#F97316] bg-[#FFF7ED] text-[#F97316]' : 'border-gray-200 text-gray-700'}`}>
              <input
                type='checkbox'
                className='hidden'
                checked={checked}
                onChange={() => setSelected((prev) => checked ? prev.filter((x) => x !== o.id) : [...prev, o.id])}
              />
              {o.name}
            </label>
          );
        })}
      </div>
      <div className='flex gap-2'>
        <button onClick={save} disabled={saving} className='px-3 py-1.5 bg-[#F97316] text-white text-xs rounded hover:bg-[#EA580C] disabled:opacity-50'>
          Сохранить scope
        </button>
        <button onClick={deactivate} disabled={saving} className='px-3 py-1.5 border border-gray-200 text-xs text-red-700 rounded hover:bg-red-50 disabled:opacity-50'>
          Деактивировать
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 25.3: `team-list.tsx` (server)**

```tsx
import type { TeamRow } from '@/lib/services/partner/team';
import { TeamAssignOrgsRow } from './team-assign-orgs-row';

type Org = { id: string; name: string };

export function TeamList({ rows, orgs }: { rows: TeamRow[]; orgs: Org[] }) {
  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        В команде пока никого. Пригласите первого менеджера.
      </div>
    );
  }
  return (
    <ul className='space-y-2'>
      {rows.map((r) => (
        <li key={r.partnerUserId} className={`bg-white border rounded-xl p-4 ${!r.isActive ? 'opacity-60 border-gray-100' : 'border-gray-200'}`}>
          <div className='flex flex-col md:flex-row md:items-start md:justify-between gap-3'>
            <div>
              <div className='font-medium text-[#111111]'>
                {r.name}
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${r.roleInPartner === 'admin' ? 'bg-[#FFF7ED] text-[#F97316]' : 'bg-gray-50 text-gray-600'}`}>
                  {r.roleInPartner === 'admin' ? 'Администратор' : 'Менеджер'}
                </span>
                {!r.isActive && <span className='ml-2 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500'>Деактивирован</span>}
              </div>
              <div className='text-xs text-gray-500 mt-0.5'>{r.email}</div>
            </div>
            {r.isActive && r.roleInPartner === 'manager' && (
              <div className='md:w-1/2'>
                <TeamAssignOrgsRow userId={r.userId} orgs={orgs} initialSelected={r.assignedOrgIds} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 25.4: Создать `src/app/partner/team/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { isPartnerAdmin } from '@/lib/auth/policy';
import { listTeam } from '@/lib/services/partner/team';
import { TeamList } from '@/components/partner/team-list';
import { TeamInviteForm } from '@/components/partner/team-invite-form';

export default async function PartnerTeamPage() {
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');
  if (!isPartnerAdmin(session)) redirect('/forbidden');

  const [rows, orgs] = await Promise.all([
    listTeam(prisma, session.partnerId),
    prisma.organization.findMany({
      where: { partnerId: session.partnerId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    })
  ]);

  return (
    <div className='space-y-4'>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Команда</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {rows.filter((r) => r.isActive).length} активных участников
          </p>
        </div>
      </div>

      <TeamInviteForm orgs={orgs} />
      <TeamList rows={rows} orgs={orgs} />
    </div>
  );
}
```

- [ ] **Step 25.5: Smoke — typecheck + build**

- [ ] **Step 25.6: Коммит**

```bash
git add src/app/partner/team src/components/partner/team-list.tsx src/components/partner/team-invite-form.tsx src/components/partner/team-assign-orgs-row.tsx
git commit -m "feat(partner): team page with invite, role management, scope assignment"
```

---

## Часть 7 — PWA polish

### Task 26: PWA manifest и meta-tags

Спека §5.10 п.9: «PWA manifest + install on home screen».

**Files:**
- Create: `public/manifest.webmanifest`
- Modify: `src/app/layout.tsx` (добавить link/meta)

- [ ] **Step 26.1: Создать `public/manifest.webmanifest`**

```json
{
  "name": "Промтехносфера — личный кабинет",
  "short_name": "ОТСФЕРА",
  "description": "Личный кабинет партнёра Промтехносферы",
  "start_url": "/partner/dashboard",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F9FAFB",
  "theme_color": "#F97316",
  "lang": "ru",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

**Замечание про иконки:** Phase 1 не включает финальные брендовые ассеты. Положить placeholder-PNG (можно сгенерировать через ImageMagick из логотипа: `convert logo.png -resize 192x192 public/icon-192.png` или временно скопировать `public/favicon.ico` под этими именами). Если иконок нет — браузер purchase install prompt не покажет, но manifest не сломается.

- [ ] **Step 26.2: Расширить `src/app/layout.tsx`**

Найти текущий `<head>` или `metadata` export. В Next.js 15 предпочитаемо через `export const metadata`:

```typescript
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Промтехносфера — личный кабинет',
  description: 'Личный кабинет партнёра Промтехносферы',
  manifest: '/manifest.webmanifest',
  themeColor: '#F97316',
  viewport: { width: 'device-width', initialScale: 1, viewportFit: 'cover' },
  appleWebApp: {
    capable: true,
    title: 'ОТСФЕРА',
    statusBarStyle: 'default'
  }
};
```

(Если уже есть `metadata` — добавьте недостающие поля; не дублируйте.)

- [ ] **Step 26.3: Smoke — build + проверка manifest**

```bash
npm run build
npm run dev &
sleep 5
curl http://localhost:3000/manifest.webmanifest
kill %1
```

Ожидаемо: 200 OK + JSON.

- [ ] **Step 26.4: Коммит**

```bash
git add public/manifest.webmanifest src/app/layout.tsx
git commit -m "feat(pwa): web app manifest and meta tags for install-on-home-screen"
```

---

## Часть 8 — Финал

### Task 27: Smoke E2E walkthrough (manual)

Поскольку Playwright не настроен в Phase 1 (spec §8.1 — в Phase 2+), ручной прогон по golden path.

- [ ] **Step 27.1: Поднять окружение**

```bash
docker compose up -d db redis
npm run dev
# В другом терминале:
npm run worker:dev
```

- [ ] **Step 27.2: Sеed-данные**

Если `prisma/seed.ts` не создаёт партнёра с PartnerUser — добавить (НЕ в Phase 1 plan-scope, но полезно). Минимально нужно через `prisma studio` или `psql`:

```sql
-- Подготовить тестового partner-admin
INSERT INTO "Partner" (id, name, "commissionRate", "createdAt", "updatedAt")
VALUES ('test-partner', 'TestPartner', 0.05, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Создать User (password = "password123" → hash через bcrypt)
-- Используйте seed.ts или ручной script
```

Для удобства можно расширить `prisma/seed.ts` (но это вне scope Phase 1 — отметить как follow-up).

- [ ] **Step 27.3: Пройти основной путь**

1. Зайти на `http://localhost:3000/login` → авторизоваться как partner-admin.
2. Должен открыться `/partner/dashboard` — отобразить 4 KPI (даже если все нули), 2 панели (attention, events) пустые.
3. Сайдбар: видны Дашборд, Портфель, Команда (активные); Сделки/Заявки/Документы/Финансы — disabled.
4. Кликнуть «Портфель» → загружается список (может быть пустой), форма поиска работает.
5. Если есть организация — кликнуть → открывается карточка с табами Сотрудники / Комментарии / История / Настройки.
6. Кликнуть «Настройки» → форма ставки. Установить 8% с обоснованием «Тест» → Сохранить → видно подсветку в header («Индивидуальная ставка: 8.00%»).
7. Открыть «История» → видна запись об изменении ставки с before/after.
8. Кликнуть «Команда» → видим себя в списке, форма «Пригласить участника» доступна.
9. Пригласить test-manager (email/name/role=manager). Видно в списке. Изменить scope, сохранить.
10. Logout → залогиниться как test-manager → middleware должен НЕ пускать на `/partner/team` (redirect /forbidden).

- [ ] **Step 27.4: Мобильный smoke (DevTools mobile mode)**

1. F12 → Toggle device toolbar → выбрать iPhone 12 (375px).
2. На `/partner/dashboard` — KPI в 2×2, события стопками, sidebar скрыт.
3. Внизу видна BottomTabBar (4 кнопки, touch target ≥44px).
4. Tap на «Портфель» → переход. На карточке организации — header сжатый.

- [ ] **Step 27.5: Lighthouse mobile score**

В DevTools → Lighthouse → Mobile → Performance + Accessibility.

```
Цель из спеки §5.10 п.11: mobile performance ≥ 85.
```

Если Performance < 85 — частые причины: размер JS bundle (проверить `npm run build` stats), Tailwind purge (в next.js обычно ок), большие изображения. Accessibility ≥ 90 ожидаем по умолчанию. Зафиксировать скриншот / число в Phase 1 DONE.

- [ ] **Step 27.6: Зафиксировать найденные баги**

Любой найденный недочёт — починить тем же task (или создать follow-up issue если из scope Phase 2). НЕ оставлять «починим потом».

- [ ] **Step 27.7: Коммит (если были фиксы)**

```bash
git add -A
git commit -m "fix(partner): smoke walkthrough fixes (<краткое описание>)"
```

Если правок не потребовалось — пропустить.

---

### Task 28: Финальный полный прогон тестов + build

- [ ] **Step 28.1: Проверки**

```bash
npm test
npm run typecheck
npm run build
```

Ожидаемо:
- `npm test`: исходные 74 теста + ~Phase 1 тесты (~20-25 новых) → суммарно ~95-100 passed.
- `npm run typecheck`: 0 errors.
- `npm run build`: успешно, без warnings про size.

- [ ] **Step 28.2: Запустить вручную worker и тесты с реальной БД**

```bash
docker compose up -d db redis
npm run worker:dev &
npm test
kill %1
```

Все integration-тесты (`services.partner.*`, `schema.integration`) должны проходить.

- [ ] **Step 28.3: Создать handoff-документ Phase 1 DONE**

Создать `docs/superpowers/plans/2026-05-21-partner-cabinet-phase1-DONE.md` (структуру брать из `phase0-DONE.md`):

- Что сделано (по частям 1-7)
- Что НЕ готово (Phase 2+: deals UI, leads UI, documents UI, finance UI, real 1С)
- Команды проверки состояния
- Deviations from плана (если были)
- Известные ограничения (например, нет компонент-тестов — UI верифицируется smoke'ом)

- [ ] **Step 28.4: Обновить `.remember/remember.md`**

Заменить блок «## Next» на:

```
1. Phase 1 завершена. Открыть PR против main: gh pr create --title "feat: partner cabinet phase 1 — каркас, портфель, команда" --body "..."
2. После merge — стартовать Phase 2 (Deals + Documents). Спека §5.5-5.7.
3. Заодно решить: переименовать ветку `claude/partner-cabinet-phase0` → `claude/partner-cabinet` для будущих фаз, чтобы имя не вводило в заблуждение.
```

- [ ] **Step 28.5: Финальный коммит и tagging**

```bash
git add docs/superpowers/plans/2026-05-21-partner-cabinet-phase1-DONE.md .remember/remember.md
git commit -m "chore(phase1): mark partner cabinet phase 1 complete"
git log --oneline -30  # увидеть полную ленту Phase 1
```

---

## Завершение

После Task 28 ветка `claude/partner-cabinet-phase0` содержит и Phase 0, и Phase 1. Подготовить PR:

```bash
gh pr create --title "feat: partner cabinet phases 0 + 1" --body-file <(cat <<'EOF'
## Summary
- Phase 0: Prisma schema (8 enums, 8 new models, миграция), BullMQ infra, 1С fake-adapter, контракт IT 1С (draft).
- Phase 1: RBAC sub-roles (PartnerUser-based), middleware sub-role guard, scope-aware policy helpers, services (portfolio, dashboard, team, rateOverride), API роуты (dashboard, portfolio, team), UI (Dashboard, Portfolio list, Org card с табами, Org settings, Team page), мобильный BottomTabBar, PWA manifest.

## Out of scope (Phase 2+)
- Deals / Leads / Documents / Finance UI
- Real 1С sync
- Commission PDF/XLSX generation

## Test plan
- [x] `npm test` — ~95-100 passed
- [x] `npm run typecheck` — 0 errors
- [x] `npm run build` — successful
- [x] Manual smoke walkthrough на desktop + mobile (DevTools 375px)
- [x] Login как admin / manager — sub-role guards работают
EOF
)
```

После merge — переименовать ветку или просто закрыть и сделать новую для Phase 2.

---
