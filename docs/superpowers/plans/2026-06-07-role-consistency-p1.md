# Role Consistency — P1 (контракт-хармонизация) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить три дешёвых кросс-ролевых дрейфа (P1 из аудита): UX-баг видимости «Команда» у partner, неоднородный redirect под-ролей, и «мёртвые двери» admin в `protectedPrefixes`.

**Architecture:** Точечные правки в навигации (`cabinet.ts` + `app-shell.tsx`), в гарде (`requireRole.ts` + словарь в `jwt.ts`) и в RBAC-таблице (`access.ts`). Defense-in-depth §4 (middleware + page + service) сохраняется во всех трёх; ни одна правка не ослабляет доступ — только выравнивает контракт и видимость. Admin-омнипотентность остаётся нетронутой (живёт в `/admin/*` + `policy.ts`).

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Vitest (unit mode, `vi.hoisted` mock-паттерн).

**Источник:** [role-consistency-audit spec](../specs/2026-06-07-role-consistency-audit-design.md) §6 (бэклог P1), §3 (оси 1/4/6), §7 (тест-стратегия). Решение по admin — **Model A** (§5.1).

---

## File Structure

| Файл | Роль в P1 | Задача |
|---|---|---|
| `src/lib/navigation/cabinet.ts` | `NavItem.partnerAdminOnly` + `/partner/team` гейтинг + фильтр в `navItemsFor` | Task 1 |
| `src/components/dashboard/app-shell.tsx` | прокинуть `isPartnerAdmin` в `navItemsFor` | Task 1 |
| `src/__tests__/navigation.cabinet.partner.test.ts` | новые тесты гейтинга + обновить 2 существующих | Task 1 |
| `src/lib/auth/requireRole.ts` | `requireManagerLeader` redirect `/manager/dashboard` → `/forbidden` | Task 2 |
| `src/lib/auth/jwt.ts` | словарь под-ролей (комментарий-контракт над типами) | Task 2 |
| `src/__tests__/auth.requireManager.test.ts` | новый describe для `requireManagerLeader` | Task 2 |
| `src/lib/auth/access.ts` | убрать `admin` из `protectedPrefixes['/partner']` и `['/organization']` | Task 3 |
| `src/__tests__/auth.middleware.test.ts` | admin → /partner,/organization → /forbidden; admin → /admin/* → pass | Task 3 |
| `CLAUDE.md` | §4 — задокументировать правило «кабинет = его роль; admin через /admin/* + policy» | Task 3 |

**Порядок задач независим** (три разные подсистемы), но рекомендуется 1 → 2 → 3 (от самого видимого UX-фикса к RBAC-правке). Каждая задача — самостоятельный коммит, проходящий typecheck + lint.

---

## Task 1: Ось 6 — гейтинг пункта «Команда» у partner

**Контекст:** `navByRole.partner` пункт `/partner/team` сейчас без гейтинга (`src/lib/navigation/cabinet.ts:32`) → виден всем партнёрам. Но middleware (`src/middleware.ts:58-67`) и page-гард (`isPartnerAdmin`) пускают только partner-admin → не-admin кликает «Команда» и получает `/forbidden`. Чиним **видимость меню** (контроль доступа уже корректен и многослоен). Механизм — копия существующего `leaderOnly`/`isManagerLeader`.

**Files:**
- Modify: `src/lib/navigation/cabinet.ts` (тип `NavItem`, пункт `/partner/team`, функция `navItemsFor`)
- Modify: `src/components/dashboard/app-shell.tsx:47`
- Test: `src/__tests__/navigation.cabinet.partner.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `src/__tests__/navigation.cabinet.partner.test.ts` новый describe-блок:

```ts
describe('navItemsFor — partnerAdminOnly гейтинг (/partner/team)', () => {
  it('скрывает «Команда» для partner без opts (не-admin по умолчанию)', () => {
    const labels = navItemsFor('partner').map((i) => i.label);
    expect(labels).not.toContain('Команда');
  });

  it('скрывает «Команда» для partner с isPartnerAdmin=false', () => {
    const labels = navItemsFor('partner', { isPartnerAdmin: false }).map((i) => i.label);
    expect(labels).not.toContain('Команда');
  });

  it('показывает «Команда» для partner с isPartnerAdmin=true', () => {
    const labels = navItemsFor('partner', { isPartnerAdmin: true }).map((i) => i.label);
    expect(labels).toContain('Команда');
  });

  it('пункт /partner/team помечен partnerAdminOnly в navByRole', () => {
    const item = navByRole.partner.find((i) => i.href === '/partner/team');
    expect(item).toBeDefined();
    expect(item!.partnerAdminOnly).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/__tests__/navigation.cabinet.partner.test.ts`
Expected: FAIL — `partnerAdminOnly` ещё нет в типе/пункте, «Команда» видна без opts.

- [ ] **Step 3: Реализовать гейтинг в `cabinet.ts`**

В `src/lib/navigation/cabinet.ts` расширить тип `NavItem` (строка 4):

```ts
export type NavItem = { href: string; label: string; disabled?: boolean; flag?: FeatureFlag; leaderOnly?: boolean; partnerAdminOnly?: boolean };
```

Пометить пункт partner `/team` (строка 32) — `partnerAdminOnly: true`:

```ts
    { href: '/partner/team', label: 'Команда', partnerAdminOnly: true },
```

Расширить `navItemsFor` (строки 52-58) — новый opt + фильтр:

```ts
export function navItemsFor(
  role: Role,
  opts?: { isManagerLeader?: boolean; isPartnerAdmin?: boolean }
): NavItem[] {
  return navByRole[role].filter((item) => {
    if (item.flag && !isFeatureEnabled(item.flag)) return false;
    if (item.leaderOnly && !opts?.isManagerLeader) return false;
    if (item.partnerAdminOnly && !opts?.isPartnerAdmin) return false;
    return true;
  });
}
```

- [ ] **Step 4: Прокинуть `isPartnerAdmin` в `app-shell.tsx`**

В `src/components/dashboard/app-shell.tsx` строка 47 — добавить opt (значение из сессии, без нового импорта):

```tsx
            {navItemsFor(session.role, { isManagerLeader: isManagerLeader(session), isPartnerAdmin: session.partnerRole === 'admin' }).map((item) =>
```

- [ ] **Step 5: Запустить новые тесты — убедиться, что проходят**

Run: `npx vitest run src/__tests__/navigation.cabinet.partner.test.ts -t partnerAdminOnly`
Expected: PASS (4 теста нового блока).

- [ ] **Step 6: Обновить 2 существующих теста, ожидавших «Команда» без opts**

В том же файле два теста зовут `navItemsFor('partner')` без opts и ждут «Команда» в `arrayContaining` (строки ~54-56 и ~84-86). Теперь без `isPartnerAdmin` «Команда» скрыта — передать opt, чтобы ассерты остались валидны.

Тест `hides "Заявки" when FEATURE_PARTNER_LEADS=0` — заменить вызов:

```ts
    const labels = navItemsFor('partner', { isPartnerAdmin: true }).map((i) => i.label);
```

Тест `shows "Сообщения" (/partner/messages) when FEATURE_CHAT=1` — заменить вызов:

```ts
    const labels = navItemsFor('partner', { isPartnerAdmin: true }).map((i) => i.label);
```

(Оба `arrayContaining([... 'Команда'])` остаются без изменений — теперь они снова верны.)

- [ ] **Step 7: Прогнать весь файл + typecheck**

Run: `npx vitest run src/__tests__/navigation.cabinet.partner.test.ts && npm run typecheck`
Expected: PASS — все тесты файла зелёные, typecheck без ошибок.

- [ ] **Step 8: Commit**

```bash
git add src/lib/navigation/cabinet.ts src/components/dashboard/app-shell.tsx src/__tests__/navigation.cabinet.partner.test.ts
git commit -m "fix(nav): gate partner «Команда» behind partnerAdminOnly

Меню показывало пункт всем партнёрам, но middleware+page-гард пускали
только partner-admin → не-admin получал /forbidden по клику. Выровнено
видимость меню с доступом (механизм — копия leaderOnly/isManagerLeader).
Ось 6 аудита согласованности ролей.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Ось 1 — единый redirect-контракт под-ролей + словарь

**Контекст:** при отказе по под-роли redirect неоднороден: `requirePartnerAdmin` → `/forbidden`, `requireOrganizationAdminOrLeader` → `/forbidden`, но `requireManagerLeader` → `/manager/dashboard` (мягко, `src/lib/auth/requireRole.ts:78`). QA-смоук [qa-staging-smoke-manager.md:74](../../qa-staging-smoke-manager.md) **уже** документирует ожидание `/forbidden` — то есть код расходится с задокументированным намерением. Выравниваем на `/forbidden`. Плюс снимаем двусмысленность именования под-ролей комментарием-контрактом в `jwt.ts` (значения НЕ мигрируем — дорого).

**Files:**
- Modify: `src/lib/auth/requireRole.ts:76-80`
- Modify: `src/lib/auth/jwt.ts:17-21`
- Test: `src/__tests__/auth.requireManager.test.ts`

- [ ] **Step 1: Написать падающий тест для `requireManagerLeader`**

В `src/__tests__/auth.requireManager.test.ts` добавить импорт `requireManagerLeader` в существующий импорт-блок (строки 20-24):

```ts
import {
  requireManager,
  requireManagerForOrg,
  requireManagerForOrder,
  requireManagerLeader
} from '@/lib/auth/requireRole';
```

И новый describe-блок в конец файла:

```ts
describe('requireManagerLeader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redirect.mockImplementation((to: string) => {
      throw new Error(`NEXT_REDIRECT:${to}`);
    });
  });

  const MANAGER_LEADER: SessionPayload = {
    sub: 'mgr-leader',
    role: 'manager',
    managedOrgIds: [],
    managerRole: 'leader'
  };

  it('возвращает сессию для manager-leader', async () => {
    getSession.mockResolvedValue(MANAGER_LEADER);
    const result = await requireManagerLeader();
    expect(result).toEqual(MANAGER_LEADER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('редиректит manager-не-leader на /forbidden (единый контракт под-ролей)', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    await expect(requireManagerLeader()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });

  it('редиректит не-manager на /forbidden (делегирует requireManager)', async () => {
    getSession.mockResolvedValue(PARTNER_SESSION);
    await expect(requireManagerLeader()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/__tests__/auth.requireManager.test.ts -t requireManagerLeader`
Expected: FAIL — тест `редиректит manager-не-leader на /forbidden` получает `NEXT_REDIRECT:/manager/dashboard`.

- [ ] **Step 3: Изменить redirect в `requireRole.ts`**

В `src/lib/auth/requireRole.ts` функция `requireManagerLeader` (строки 76-80) — заменить мягкий redirect на `/forbidden`:

```ts
export async function requireManagerLeader(): Promise<SessionPayload> {
  const session = await requireManager();
  // Единый redirect-контракт под-ролей (ось 1 аудита): нехватка elevation →
  // /forbidden, как requirePartnerAdmin и requireOrganizationAdminOrLeader.
  if (session.managerRole !== 'leader') redirect('/forbidden');
  return session;
}
```

- [ ] **Step 4: Добавить словарь под-ролей в `jwt.ts`**

В `src/lib/auth/jwt.ts` над тремя type-алиасами под-ролей (строки 17-21) добавить комментарий-контракт:

```ts
// Словарь под-ролей («руководитель» проекта реализован тремя под-ролями, by
// design §4 — три домена, три гарда). Значения СТАБИЛЬНЫ (миграция дорогая):
//  - partnerRole='manager'  = «партнёрский администратор» (исторически назван
//    manager; НЕ путать с top-level Role 'manager'). Гард requirePartnerAdmin.
//  - roleInOrg='leader'      = старший в организации. Гард requireOrganizationAdminOrLeader.
//  - managerRole='leader'    = старший менеджер (company-wide, C8). Гард requireManagerLeader.
// Контракт отказа по под-роли единый: redirect → /forbidden (см. requireRole.ts).
export type PartnerRoleInPartner = 'admin' | 'manager';

export type OrgRoleInOrg = 'admin' | 'leader' | 'member';

export type ManagerRole = 'leader';
```

- [ ] **Step 5: Запустить тесты + typecheck**

Run: `npx vitest run src/__tests__/auth.requireManager.test.ts && npm run typecheck`
Expected: PASS — новый describe зелёный; существующие requireManager/ForOrg/ForOrder не затронуты (ForOrg по-прежнему `/manager/dashboard` для out-of-scope — это scope-deny, не elevation-deny).

- [ ] **Step 6: Прогнать manager server-action тесты (регрессия)**

Run: `npx vitest run src/__tests__/server-actions.manager.team.test.ts src/__tests__/server-actions.manager.teamVisibility.test.ts`
Expected: PASS — они **мокают** `requireManagerLeader`, так что смена redirect-таргета их не трогает (sanity-check, что мок-граница цела).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/requireRole.ts src/lib/auth/jwt.ts src/__tests__/auth.requireManager.test.ts
git commit -m "fix(auth): unify sub-role denial redirect to /forbidden + sub-role glossary

requireManagerLeader редиректил на /manager/dashboard, тогда как
requirePartnerAdmin/requireOrganizationAdminOrLeader — на /forbidden
(и QA-смоук уже ожидал /forbidden). Выровнен контракт + добавлен
словарь под-ролей в jwt.ts. Ось 1 аудита согласованности ролей.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Ось 4 — Model A: убрать «мёртвые двери» admin + задокументировать

**Контекст:** `protectedPrefixes` пускает admin в `/partner` и `/organization` на уровне middleware, но page-гарды (`requireOrganization`/`requirePartnerAdmin`) всё равно бьют admin → это «мёртвые двери» (итог тот же `/forbidden`, просто позже). `/manager` не пускает admin даже в middleware. **Model A (решение §5.1):** admin-омнипотентность живёт в `/admin/*` + `policy.ts` (`return true`); кабинеты — ролевые. Убираем мёртвые двери → правило становится единым: ни один кабинет не пускает admin в middleware. Власть admin **не уменьшается** (она в `/api/*` + `/admin/*`, не под этими page-префиксами).

**Files:**
- Modify: `src/lib/auth/access.ts:11-17`
- Modify: `CLAUDE.md` (§4)
- Test: `src/__tests__/auth.middleware.test.ts`

- [ ] **Step 1: Предусловие — grep, что под префиксами нет admin-используемых негейтнутых роутов**

Run: `rg -l "requireAdmin|requireOrganization|requirePartner|isPartnerAdmin|getSession" src/app/partner src/app/organization`
Expected: каждая страница под `/partner/*` и `/organization/*` имеет ролевой гард (admin там не работает). Если найдётся страница БЕЗ гарда, которую admin реально использует — остановиться и эскалировать (тогда правка небезопасна). По аудиту таких нет: все `/partner/*` и `/organization/*` — кабинетные страницы с гардами, а admin-данные идут через `/admin/*` и `/api/*`.

- [ ] **Step 2: Написать падающие middleware-тесты**

В `src/__tests__/auth.middleware.test.ts` добавить в `describe('auth middleware', …)` три теста:

```ts
  it('redirects admin away from /partner (no dead door; admin works via /admin/*)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'admin' } } as any);
    const res = await middleware(req('/partner/dashboard', 'tkn'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('redirects admin away from /organization (no dead door)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'admin' } } as any);
    const res = await middleware(req('/organization/dashboard', 'tkn'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('still lets admin into its own /admin/* cabinet', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'admin' } } as any);
    const res = await middleware(req('/admin/orders', 'tkn'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `npx vitest run src/__tests__/auth.middleware.test.ts`
Expected: FAIL — первые два теста: admin сейчас проходит middleware в /partner и /organization (status 200, не 307→/forbidden). Третий проходит уже сейчас.

- [ ] **Step 4: Убрать admin из двух префиксов в `access.ts`**

В `src/lib/auth/access.ts` `protectedPrefixes` (строки 11-17) — убрать `'admin'` из `/partner` и `/organization`:

```ts
export const protectedPrefixes: Record<string, Role[]> = {
  '/admin': ['admin'],
  '/manager': ['manager'],
  '/partner': ['partner'],
  '/organization': ['organization'],
  '/student': ['student', 'organization', 'admin', 'manager']
};
```

(`/student` оставляем общим — это намеренный shared-entry с жёстким серверным гейтом на выпуск токена, эталон §3; admin может посмотреть лендинг слушателя, но не получит student-токен.)

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `npx vitest run src/__tests__/auth.middleware.test.ts`
Expected: PASS — все тесты файла зелёные.

- [ ] **Step 6: Регрессия — admin-омнипотентность в policy.ts цела**

Run: `npx vitest run src/__tests__/auth.policy.partner-scope.test.ts src/__tests__/auth.organizationPolicy.test.ts`
Expected: PASS — `policy.ts` (`canReadOrder`/`canAccessOrganization` `return true` для admin) не тронут; data-омнипотентность admin сохраняется через `/api/*`.

- [ ] **Step 7: Задокументировать правило в `CLAUDE.md` §4**

В `CLAUDE.md` §4 (после списка трёх точек защиты, перед абзацем про новую страницу) добавить абзац:

```markdown
**Admin-доступ (Model A):** admin управляет всем через **`/admin/*` зеркало + `policy.ts` (`return true`)**, а НЕ входом в чужие кабинеты. Единое правило: `protectedPrefixes` пускает в кабинет только его роль (`/manager`→manager, `/partner`→partner, `/organization`→organization); admin там не работает (page-гарды его бьют). Не добавляй admin в кабинетные префиксы «чтобы посмотреть» — это мёртвая дверь. Исключение — `/student` (намеренный shared-entry с жёстким серверным гейтом на выпуск токена).
```

- [ ] **Step 8: Финальная проверка задачи**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth/access.ts src/__tests__/auth.middleware.test.ts CLAUDE.md
git commit -m "fix(rbac): remove admin dead-doors from cabinet prefixes (Model A)

protectedPrefixes пускал admin в /partner и /organization на middleware,
но page-гарды всё равно бьют admin → мёртвые двери. Убраны: правило стало
единым (кабинет = его роль). Admin-омнипотентность нетронута (живёт в
/admin/* + policy.ts). Документировано в CLAUDE.md §4. Ось 4, Model A.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Финальная верификация P1

- [ ] **Step 1: Полный unit-слой**

Run: `npm run test:unit`
Expected: PASS — весь unit-слой зелёный (новые + существующие). Особое внимание: `auth.middleware*`, `navigation.cabinet.partner`, `auth.requireManager`, `server-actions.manager.*`.

- [ ] **Step 2: Typecheck + lint (финал)**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Обновить spec — отметить P1 закрытым**

В [spec](../specs/2026-06-07-role-consistency-audit-design.md) §6 пометить строки 1-3 бэклога как ✅ (DONE, 2026-06-07), оставив P2/P3 открытыми. Commit:

```bash
git add docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md
git commit -m "docs(spec): mark P1 backlog done in role-consistency audit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Note (L2.5 gate):** правки не трогают `prisma/`/`worker/`/`services/`, так что `npm run gate` (integration) для P1 не требуется. Если gate-хук на push зависнет на host :5432 — `git push --no-verify` (известный готча, см. memory). PR — против `main`.

---

## Self-Review (выполнено при написании)

**1. Покрытие spec'а (§6 P1):** ось 6 → Task 1 ✓; ось 1 → Task 2 ✓; ось 4 (Model A) → Task 3 ✓. P2/P3 намеренно вне объёма (отдельные планы). Открытый продуктовый вопрос (manager finance, C-a) — не код, вне P1. ✓

**2. Скан плейсхолдеров:** нет TBD/«обработать edge-cases» — весь код и команды конкретны. ✓

**3. Консистентность типов/имён:** `partnerAdminOnly` (поле NavItem) + `isPartnerAdmin` (opt navItemsFor) согласованы между Task 1 Step 3/4/1. `requireManagerLeader` сигнатура не меняется (только тело). `protectedPrefixes` форма сохранена. ✓

**4. Защита §4 не ослаблена:** Task 1 — только видимость меню (доступ цел). Task 2 — redirect жёстче (`/forbidden`), не мягче. Task 3 — убирает мёртвую дверь (admin и так бился page-гардом); omnipotence в `policy.ts` подтверждена регресс-тестом (Task 3 Step 6). ✓
