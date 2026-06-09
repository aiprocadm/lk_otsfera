# Role Consistency — P2 (флаг messages + канонизация partner-гарда) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть две P2-оси аудита согласованности ролей: ось 5 (флаг messages — документально выровнять, без правки кода) и ось 3 (канонизировать идиому гарда — partner-страницы с ручного `getSession()+redirect` на `require*`).

**Architecture:** Ось 5 — **только документация**: вопреки буквальной формулировке спеки, флаг messages НЕ выравнивается в коде. Расследование (см. ниже) показало, что `chat` уже enforced во всех трёх точках §5 для чисто-чатовых поверхностей, а менеджерский/админский `/messages` несут ещё и order-comments (ungated) → гейтить их через `chat` нельзя (регрессия). Поэтому ось 5 = внести `chat` в CLAUDE.md §5 + задокументировать матрицу. Ось 3 — новый narrowed-гард `requirePartner()` + конвертация partner-страниц; defense-in-depth §4 сохраняется (middleware+page+service), идиома страницы выравнивается с manager/admin/organization.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Vitest (unit mode, `vi.hoisted` mock-паттерн).

**Источник:** [role-consistency-audit spec](../specs/2026-06-07-role-consistency-audit-design.md) §3 (оси 3/5), §6 (бэклог P2 — строки 4/5), §7 (тест-стратегия). Предшественник: [P1 план](2026-06-07-role-consistency-p1.md) / [-DONE](2026-06-07-role-consistency-p1-DONE.md).

---

## Расследование оси 5 (зафиксировано до написания плана)

«Сообщения» — **не один домен, а два, по-разному смонтированных по ролям:**

| Кабинет | Содержимое `/messages` | chat off → | nav-флаг | middleware |
|---|---|---|---|---|
| partner | team-chat **только** (`listThreads`) | hard `notFound()` | `chat` | `/partner/messages`→`chat` |
| organization | team-chat **только** | hard `notFound()` | `chat` | `/organization/messages`→`chat` |
| manager | **order-comments (ungated, всегда)** + team-chat (когда `chat`) | graceful (комментарии остаются) | `manager_cabinet` | `/manager`→`manager_cabinet` |
| admin | team-chat только, но graceful «Чат не включён» | graceful | нет флага | нет |

Флаг `chat` **уже** enforced во всех 3 точках §5 для чатовых поверхностей: middleware (partner/org ✓), nav (partner/org ✓), route-handler (`src/app/api/messages/route.ts` → `notFoundIfDisabled('chat')` ✓). `src/app/api/comments/route.ts` флага не имеет **намеренно** — комментарии к заказам это до-chat фича, не часть домена chat.

**Вывод:** буквальная рекомендация спеки «выровнять manager под единый флаг chat» вызвала бы **регрессию** — скрыла/обрубила бы order-comments менеджера при `chat=off`. Поэтому ось 5 в этом плане = **документация** (внести `chat` в §5 + матрица), без правок флагов. Админский graceful-режим — узаконенное internal-исключение (спека §3 ось 5).

---

## File Structure

| Файл | Роль в P2 | Задача |
|---|---|---|
| `CLAUDE.md` | §5 — добавить `chat` в opt-in список + абзац-матрица messages | Task 1 |
| `docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md` | §3 ось 5 + §6 строка 4 — исправленный вердикт (doc-only) | Task 1 |
| `src/lib/auth/requireRole.ts` | новый `PartnerSession` тип + `requirePartner()`; `requirePartnerAdmin()` → `PartnerSession` | Task 2 |
| `src/__tests__/auth.requireRole.test.ts` | новый describe `requirePartner` | Task 2 |
| `src/app/partner/**` (12 страниц) | `getSession()+redirect('/login')` → `requirePartner()` | Task 3 |
| `src/app/partner/team/page.tsx`, `src/app/partner/portfolio/[orgId]/settings/page.tsx` | → `requirePartnerAdmin()` | Task 4 |
| spec §6 | пометить P2 закрытым | Task 5 |

**Порядок задач:** 1 (docs, независим) → 2 (хелпер — блокер для 3/4) → 3 → 4 → 5 (финал). Task 2 обязателен до 3/4.

---

## Task 1: Ось 5 — документация (CLAUDE.md §5 + spec-вердикт)

**Контекст:** `chat` есть в `FEATURE_FLAGS`/`OPT_IN_FLAGS` (`src/lib/featureFlags.ts:24,37`), но **не перечислен в CLAUDE.md §5** (там 8 флагов, `chat` отсутствует) → нарушает требование §5 «не добавляй флаг без документации». Правок кода нет.

**Files:**
- Modify: `CLAUDE.md` (§5)
- Modify: `docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md` (§3 ось 5, §6 строка 4)

- [ ] **Step 1: Добавить `chat` в opt-in список §5**

В `CLAUDE.md` §5, в строке про opt-in флаги, добавить `chat`. Найти строку:

```markdown
- **Opt-in по умолчанию** (выключено, пока env не `1/true/on`): `organization_cabinet`, `manager_cabinet`. Сделано для staged rollout.
```

Заменить на:

```markdown
- **Opt-in по умолчанию** (выключено, пока env не `1/true/on`): `organization_cabinet`, `manager_cabinet`, `chat`. Сделано для staged rollout.
```

- [ ] **Step 2: Добавить абзац-матрицу messages в §5**

В `CLAUDE.md` §5, после абзаца «Не добавляй новый флаг без всех трёх точек.», добавить:

```markdown
**Матрица гейтинга «Сообщения» (флаг `chat`) — не выравнивай в один флаг.** Страница `/messages` несёт два разных домена, смонтированных по-разному:
- **partner / organization** — team-chat **только** → гейт `chat` во всех 3 точках (middleware-префикс, nav-`flag: 'chat'`, page `if (!isFeatureEnabled('chat')) notFound()`). Route-handler `api/messages` тоже `notFoundIfDisabled('chat')`.
- **manager** — order-comments (**ungated, всегда видны**) + team-chat (только при `chat`). Nav-флаг пункта — `manager_cabinet`, НЕ `chat` (иначе при `chat=off` исчезнут комментарии). Чат-секция рендерится условно (`chatEnabled`).
- **admin** — chat-only, но **graceful** «Чат не включён» без флага в nav. Узаконенное internal-исключение (admin видит чат-оболочку всегда).
- `api/comments` намеренно БЕЗ флага — комментарии к заказам это до-`chat` фича, не часть домена chat.
Вывод: домен «комментарии к заказам» и домен «чат» не совпадают; гейтить страницу одним флагом нельзя.
```

- [ ] **Step 3: Исправить вердикт оси 5 в spec**

В `docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md` найти строку 189 (блок «Статус»):

```markdown
**Статус:** P1 (строки 1–3) ✅ отгружен 2026-06-07 — Task 1 `5e67bb2`, Task 2 `db6f2ed`, Task 3 `c07996a` (план [role-consistency-p1](../plans/2026-06-07-role-consistency-p1.md), close-out [-DONE](../plans/2026-06-07-role-consistency-p1-DONE.md)). P2/P3 остаются открытыми.
```

Заменить на:

```markdown
**Статус:** P1 (строки 1–3) ✅ отгружен 2026-06-07 — Task 1 `5e67bb2`, Task 2 `db6f2ed`, Task 3 `c07996a` (план [role-consistency-p1](../plans/2026-06-07-role-consistency-p1.md), close-out [-DONE](../plans/2026-06-07-role-consistency-p1-DONE.md)). P2 (строки 4–5) — план [role-consistency-p2](../plans/2026-06-08-role-consistency-p2.md).

> **Поправка к оси 5 (2026-06-08):** при подготовке P2-плана выяснилось, что рекомендация «выровнять manager/partner/org messages под единый флаг `chat`» опирается на неполную модель. `/messages` несёт ДВА домена: order-comments (ungated, есть у manager/admin) и team-chat (флаг `chat`). У partner/org `/messages` — чат-only (корректно hard-gated по `chat` во всех 3 точках §5). Менеджерский нельзя гейтить через `chat` (скроет комментарии). Поэтому ось 5 в P2 сведена к **документации** (внести `chat` в CLAUDE.md §5 + матрица), без правок флагов. Админский graceful-режим — узаконенное internal-исключение.
```

- [ ] **Step 4: Проверка — `chat` теперь в §5, build doc-only не требует тестов**

Run: `rg -n "chat" CLAUDE.md`
Expected: `chat` присутствует в opt-in списке §5 и в новом абзаце-матрице.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md
git commit -m "docs(flags): document chat flag in CLAUDE.md §5 + messages gating matrix

Ось 5 аудита согласованности ролей. Флаг chat уже enforced во всех 3
точках §5 для чат-only поверхностей (partner/org), но не был перечислен
в §5. Добавлена матрица: manager/admin /messages несут order-comments
(ungated) + chat, поэтому единый флаг невозможен (регрессия комментариев).
Вердикт оси 5 в spec поправлен на doc-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Ось 3 — narrowed-гард `requirePartner()` (TDD)

**Контекст:** `src/lib/auth/requireRole.ts` имеет `requirePartnerAdmin()`, но нет гарда «любой активный partner». 12 partner-страниц повторяют ручной `const session = await getSession(); if (!session?.partnerId) redirect('/login');`. Нужен канон-хелпер. Чтобы конвертация была чистой (без `session.partnerId!`), хелпер возвращает narrowed-тип `PartnerSession = SessionPayload & { partnerId: string }`. `requirePartnerAdmin()` обновляется на тот же возвращаемый тип (partner-admin всегда имеет `partnerId`).

**Контракт-изменение (осознанное, ось 1):** старый код редиректил на `/login` при `!partnerId`. `requirePartner()` редиректит на `/login` только при отсутствии сессии (через `requireSession`), а аутентифицированную НЕ-partner сессию (или partner без partnerId) шлёт на `/forbidden` — единый под-ролевой контракт, как `requirePartnerAdmin`. На практике middleware и так пускает в `/partner/*` только partner, так что краевой случай недостижим из UI; смена таргета — выравнивание контракта, не ослабление.

**Files:**
- Modify: `src/lib/auth/requireRole.ts:19-25` (тип + новый хелпер + сигнатура `requirePartnerAdmin`)
- Test: `src/__tests__/auth.requireRole.test.ts`

- [ ] **Step 1: Написать падающие тесты `requirePartner`**

В `src/__tests__/auth.requireRole.test.ts` расширить импорт (строка 12):

```ts
import { requireSession, requireAdmin, requirePartnerAdmin, requirePartner } from '@/lib/auth/requireRole';
```

Добавить после фикстур (после строки 19) новую фикстуру:

```ts
const PARTNER_NO_ID_SESSION: SessionPayload = { sub: 'user-p2', role: 'partner', partnerId: null };
```

И новый describe-блок в конец файла:

```ts
describe('requirePartner', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns session for role=partner + partnerRole=admin', async () => {
    getSession.mockResolvedValue(PARTNER_ADMIN_SESSION);

    const result = await requirePartner();

    expect(result).toEqual(PARTNER_ADMIN_SESSION);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('returns session for role=partner + partnerRole=manager (любой активный partner)', async () => {
    getSession.mockResolvedValue(PARTNER_MANAGER_SESSION);

    const result = await requirePartner();

    expect(result).toEqual(PARTNER_MANAGER_SESSION);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden for partner without partnerId', async () => {
    getSession.mockResolvedValue(PARTNER_NO_ID_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requirePartner()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden for non-partner role (manager)', async () => {
    getSession.mockResolvedValue(MANAGER_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requirePartner()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden for non-partner role (organization)', async () => {
    getSession.mockResolvedValue(ORG_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requirePartner()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('calls redirect(\'/login\') when session is null', async () => {
    getSession.mockResolvedValue(null);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requirePartner()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
```

> **Примечание про фикстуру PARTNER_NO_ID_SESSION:** PARTNER_MANAGER_SESSION (строка 17) НЕ имеет `partnerId` в объекте, но тест ожидает PASS (не редирект). Это значит фикстура должна иметь partnerId — иначе тест №2 упадёт на проверке `!session.partnerId`. Поэтому в Step 1 также обнови строку 16-17 фикстур, добавив partnerId:
>
> ```ts
> const PARTNER_ADMIN_SESSION: SessionPayload = { sub: 'user-partner', role: 'partner', partnerId: 'p-1', partnerRole: 'admin' };
> const PARTNER_MANAGER_SESSION: SessionPayload = { sub: 'user-pm', role: 'partner', partnerId: 'p-1', partnerRole: 'manager' };
> ```
>
> (Существующие тесты `requirePartnerAdmin` сравнивают через `toEqual` с этими же объектами — добавление `partnerId` к обоим консистентно: они оба остаются равны своим возвращаемым значениям.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/__tests__/auth.requireRole.test.ts -t requirePartner`
Expected: FAIL — `requirePartner` ещё не экспортирован (`requirePartner is not a function`).

- [ ] **Step 3: Реализовать `PartnerSession` + `requirePartner()` + обновить `requirePartnerAdmin()`**

В `src/lib/auth/requireRole.ts` заменить блок строк 19-25 (`requirePartnerAdmin`):

```ts
export async function requirePartnerAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  const isPartnerAdmin =
    session.role === 'partner' && session.partnerRole === 'admin';
  if (!isPartnerAdmin) redirect('/forbidden');
  return session;
}
```

на:

```ts
/**
 * Узкий тип сессии партнёра: `partnerId` гарантированно `string` (не null/undefined).
 * Гарды `requirePartner`/`requirePartnerAdmin` отдают именно его, чтобы страницы
 * использовали `session.partnerId` как `string` без `!` (defense-in-depth §4).
 */
export type PartnerSession = SessionPayload & { partnerId: string };

/**
 * Любой активный партнёр (role=partner + есть partnerId). Канон-замена ручному
 * `getSession() + if(!session?.partnerId) redirect('/login')` на partner-страницах.
 * Отказ по роли/под-роли → `/forbidden` (единый контракт под-ролей, ось 1 аудита).
 */
export async function requirePartner(): Promise<PartnerSession> {
  const session = await requireSession();
  if (session.role !== 'partner' || !session.partnerId) redirect('/forbidden');
  return session as PartnerSession;
}

export async function requirePartnerAdmin(): Promise<PartnerSession> {
  const session = await requireSession();
  const isPartnerAdmin =
    session.role === 'partner' && session.partnerRole === 'admin' && !!session.partnerId;
  if (!isPartnerAdmin) redirect('/forbidden');
  return session as PartnerSession;
}
```

- [ ] **Step 4: Запустить новые тесты — PASS**

Run: `npx vitest run src/__tests__/auth.requireRole.test.ts`
Expected: PASS — весь файл (новый describe `requirePartner` + существующие `requireSession`/`requireAdmin`/`requirePartnerAdmin`).

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS — `requirePartnerAdmin` теперь возвращает `PartnerSession`; убедиться, что вызовы в `src/server-actions/**` не сломались (PartnerSession ⊂ SessionPayload по чтению — потребители получают более узкий тип, что безопасно).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/requireRole.ts src/__tests__/auth.requireRole.test.ts
git commit -m "feat(auth): add requirePartner() guard + PartnerSession narrowed type

Канон-гард «любой активный partner» (ось 3 аудита). Возвращает
PartnerSession (partnerId: string) → страницы используют session.partnerId
без !. requirePartnerAdmin тоже отдаёт PartnerSession. Отказ по роли →
/forbidden (единый под-ролевой контракт, ось 1).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Ось 3 — конвертация 12 partner-страниц на `requirePartner()`

**Контекст:** каждая из 12 страниц повторяет один guard-блок. Каноническая замена ниже; далее — таблица с per-страничными нюансами (судьба импорта `redirect`, доп. проверки сохраняются).

**Канонический diff (применяется к каждой странице):**

```diff
- import { getSession } from '@/lib/auth/session';
+ import { requirePartner } from '@/lib/auth/requireRole';
  ...
-  const session = await getSession();
-  if (!session?.partnerId) redirect('/login');
+  const session = await requirePartner();
```

После замены `session.partnerId` имеет тип `string` (из `PartnerSession`) — остальной код страницы не меняется. Все прочие проверки (`canPartnerAccessOrg`, `redirect('/forbidden')`, `notFound()`, scope по `assignedOrgIds`, `isPartnerAdmin(session)` для field-level) **остаются как есть**.

**Таблица: судьба импорта `redirect` после замены** (убираем из `next/navigation`-импорта, если `redirect` больше нигде в файле не используется; иначе оставляем):

| Страница | `redirect` ещё нужен? | Доп. нюанс |
|---|---|---|
| `partner/dashboard/page.tsx` | **убрать** (был только в guard) | — |
| `partner/deals/page.tsx` | **убрать** | — |
| `partner/deals/[id]/page.tsx` | **оставить** (есть `redirect('/forbidden')` при `!accessible`) | сохранить `notFound()` |
| `partner/documents/page.tsx` | **убрать** | — |
| `partner/finance/page.tsx` | **убрать** | сохранить `isPartnerAdmin(session)` → `canManage` |
| `partner/leads/new/page.tsx` | **убрать** | сохранить scope по `assignedOrgIds` |
| `partner/leads/page.tsx` | **убрать** | — |
| `partner/leads/[id]/page.tsx` | **убрать** (redirect только в guard; ниже только `notFound()`) | сохранить `isPartnerAdmin(session)`, scope |
| `partner/messages/page.tsx` | **убрать** (guard заменён; остаётся `notFound()`) | flag-check `if(!isFeatureEnabled('chat')) notFound()` остаётся ПЕРВЫМ; убрать строку `if (session.role !== 'partner' || !session.partnerId) redirect('/forbidden')` — её роль берёт на себя `requirePartner()` |
| `partner/portfolio/page.tsx` | **убрать** | — |
| `partner/portfolio/[orgId]/page.tsx` | **оставить** (есть `redirect('/forbidden')` при `!access`) | сохранить `canPartnerAccessOrg`, `notFound()`, `isPartnerAdmin` |
| `partner/portfolio/[orgId]/documents/page.tsx` | **оставить** (есть `redirect('/forbidden')` при `!access`) | сохранить `canPartnerAccessOrg`, `notFound()`, `isPartnerAdmin` |

> **Особый случай `partner/messages/page.tsx`** (текущий guard другой формы). Заменить блок:
> ```ts
>   const session = await getSession();
>   if (!session) redirect('/login');
>   if (session.role !== 'partner' || !session.partnerId) redirect('/forbidden');
> ```
> на одну строку:
> ```ts
>   const session = await requirePartner();
> ```
> Импорт первой строки `import { notFound, redirect } from 'next/navigation';` → `import { notFound } from 'next/navigation';`. Строка `if (!isFeatureEnabled('chat')) notFound();` остаётся ПЕРВОЙ (до `requirePartner()`) — defense-in-depth §4.

- [ ] **Step 1: Конвертировать страницы БЕЗ остаточного `redirect`** (8 шт.)

Применить канонический diff + убрать `redirect` из `next/navigation`-импорта в:
`dashboard`, `deals`, `documents`, `finance`, `leads/new`, `leads`, `leads/[id]`, `portfolio`.

Для `partner/finance/page.tsx` импорт `isPartnerAdmin` из `@/lib/auth/policy` **оставить** (используется для `canManage`). Аналогично `leads/[id]` — `isPartnerAdmin` остаётся.

- [ ] **Step 2: Конвертировать страницы С остаточным `redirect`** (3 шт.)

Применить канонический diff, `redirect` в импорте **оставить** (используется ниже для `/forbidden`):
`deals/[id]`, `portfolio/[orgId]`, `portfolio/[orgId]/documents`.

- [ ] **Step 3: Конвертировать `partner/messages/page.tsx`** (особый случай)

Применить замену из блока «Особый случай» выше (3-строчный guard → `requirePartner()`, импорт `notFound` only, flag-check остаётся первым).

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS — нет неиспользуемого `redirect`/`getSession`, `session.partnerId` всюду `string`. Если lint ругается на неиспользуемый `getSession`/`redirect` — убрать соответствующий импорт на указанной странице.

- [ ] **Step 5: Прогнать связанные тесты (регрессия)**

Run: `npm run test:unit`
Expected: PASS — страницы обычно не покрыты unit'ом напрямую, но гард-тесты (`auth.requireRole`, `auth.guard.partner`) и любые partner-сервис-тесты должны остаться зелёными.

- [ ] **Step 6: Commit**

```bash
git add src/app/partner
git commit -m "refactor(partner): canonicalize page guards to requirePartner()

12 partner-страниц переведены с ручного getSession()+redirect('/login')
на requirePartner() (ось 3 аудита — единая идиома гарда, как
manager/admin/organization). PartnerSession даёт partnerId: string без !.
Defense-in-depth §4 цел (middleware+page+service).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Ось 3 — 2 admin-страницы partner на `requirePartnerAdmin()`

**Контекст:** `partner/team` и `partner/portfolio/[orgId]/settings` — partner-admin-only. Сейчас ручной `getSession() + !partnerId→/login + !isPartnerAdmin→/forbidden`. Заменяем на существующий `requirePartnerAdmin()` (теперь отдаёт `PartnerSession`).

**Files:**
- Modify: `src/app/partner/team/page.tsx:1-13`
- Modify: `src/app/partner/portfolio/[orgId]/settings/page.tsx:1-15`

- [ ] **Step 1: Конвертировать `partner/team/page.tsx`**

Заменить импорты (строки 1-4) и guard (строки 10-13). Было:

```ts
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { isPartnerAdmin } from '@/lib/auth/policy';
```
...
```ts
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');
  if (!isPartnerAdmin(session)) redirect('/forbidden');
```

Стало (убираем `redirect`, `getSession`, `isPartnerAdmin` — все три больше не нужны):

```ts
import { prisma } from '@/lib/db/prisma';
import { requirePartnerAdmin } from '@/lib/auth/requireRole';
```
...
```ts
  const session = await requirePartnerAdmin();
```

(`session.partnerId` ниже остаётся валиден — `PartnerSession`.)

- [ ] **Step 2: Конвертировать `partner/portfolio/[orgId]/settings/page.tsx`**

Заменить импорты (строки 3-4) и guard (строки 13-15). Было:

```ts
import { getSession } from '@/lib/auth/session';
import { canPartnerAccessOrg, isPartnerAdmin } from '@/lib/auth/policy';
```
...
```ts
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');
  if (!isPartnerAdmin(session)) redirect('/forbidden');
```

Стало (`isPartnerAdmin` убираем, `canPartnerAccessOrg` оставляем; `requirePartnerAdmin` добавляем; `redirect` **оставить** — ниже строка 19 `if (!access) redirect('/forbidden')`):

```ts
import { requirePartnerAdmin } from '@/lib/auth/requireRole';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
```
...
```ts
  const session = await requirePartnerAdmin();
```

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS — нет неиспользуемых `getSession`/`isPartnerAdmin`; `redirect` оставлен только в settings (где ещё нужен).

- [ ] **Step 4: Commit**

```bash
git add src/app/partner/team/page.tsx src/app/partner/portfolio/[orgId]/settings/page.tsx
git commit -m "refactor(partner): team + portfolio-settings use requirePartnerAdmin()

Две partner-admin-only страницы переведены с ручного
getSession()+isPartnerAdmin на requirePartnerAdmin() (ось 3 аудита).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Финальная верификация P2

- [ ] **Step 1: Полный unit-слой**

Run: `npm run test:unit`
Expected: PASS — весь unit-слой. Особое внимание: `auth.requireRole`, `auth.guard.partner`, `auth.middleware`, `navigation.cabinet.partner`.

- [ ] **Step 2: typecheck + lint (финал)**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Грэп-проверка — ни одной partner-страницы на ручном `getSession`**

Run: `rg -l "getSession" src/app/partner`
Expected: пусто (0 файлов) — все 14 страниц переведены на `require*`.

- [ ] **Step 4: Пометить P2 закрытым в spec**

В `docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md` §6 пометить строки 4-5 бэклога как ✅ (DONE, 2026-06-08); в строке «Статус» дописать close-out. Commit:

```bash
git add docs/superpowers/specs/2026-06-07-role-consistency-audit-design.md
git commit -m "docs(spec): mark P2 backlog done in role-consistency audit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Note (L2.5 gate):** правки не трогают `prisma/`/`worker/`/`services/`, integration-gate для P2 не требуется. Если gate-хук на push зависнет на host :5432 — `git push --no-verify` (известный готча, memory). PR — против `main`.

---

## Self-Review (выполнено при написании)

**1. Покрытие spec'а (§6 P2):** строка 4 (ось 5) → Task 1 (doc-only, с обоснованием почему не код) ✓; строка 5 (ось 3) → Task 2 (хелпер) + Task 3 (12 стр.) + Task 4 (2 стр.) ✓. P3 (ось 2 nav org) намеренно вне объёма (отдельный план, M·medium). C-a (manager finance) — продуктовое, не код. ✓

**2. Скан плейсхолдеров:** нет TBD/«обработать edge-cases». Канонический diff показан кодом; per-страничные нюансы — явной таблицей (убрать/оставить `redirect`). ✓

**3. Консистентность типов/имён:** `PartnerSession` (Task 2) используется в `requirePartner`/`requirePartnerAdmin` и неявно на страницах Task 3/4. `requirePartner()` сигнатура согласована между Task 2 (опр.) и Task 3 (вызов). Фикстуры теста (`partnerId` добавлен к обоим PARTNER_*) согласованы с ассертами `toEqual`. ✓

**4. Защита §4 не ослаблена:** Task 1 — только документация. Task 2/3/4 — идиома гарда меняется, но три слоя (middleware+page+service) целы; redirect-таргет для не-partner стал жёстче (`/forbidden` вместо `/login`), не мягче. middleware `/partner/*` по-прежнему отрезает чужие роли. ✓

**5. Регрессия-риск оси 5:** матрица в §5 явно фиксирует, почему manager-флаг ≠ `chat` — защищает от будущего «выравнивания». ✓
