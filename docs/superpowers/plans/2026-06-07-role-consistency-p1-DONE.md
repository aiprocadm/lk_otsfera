# Role Consistency P1 — DONE

**Дата завершения:** 2026-06-07
**Branch:** `claude/role-consistency-audit`
**Base commit (план):** `b105b19` (docs(plan): role consistency P1)
**Последний код-коммит P1:** `c07996a` (fix(rbac): remove admin dead-doors). Docs/close-out — `4c282ff`; пост-ревью фикс инвертированного словаря — отдельным коммитом (см. Task 2 ниже).
**Источник:** [план role-consistency-p1](2026-06-07-role-consistency-p1.md) · [spec §6](../specs/2026-06-07-role-consistency-audit-design.md)

P1 — «контракт-хармонизация»: три дешёвых кросс-ролевых дрейфа из аудита согласованности ролей. Defense-in-depth (§4) ни в одной правке не ослаблен — только выровнен контракт и видимость.

## Что отгружено

### Task 1 — ось 6: гейтинг пункта «Команда» у partner (`5e67bb2`)
- `src/lib/navigation/cabinet.ts`: тип `NavItem` расширен `partnerAdminOnly?`; пункт `/partner/team` помечен `partnerAdminOnly: true`; `navItemsFor` получил opt `isPartnerAdmin` + фильтр (копия механизма `leaderOnly`/`isManagerLeader`).
- `src/components/dashboard/app-shell.tsx`: прокинут `isPartnerAdmin: session.partnerRole === 'admin'`.
- Меню теперь синхронно с доступом: не-admin партнёр больше не видит «Команда» и не получает `/forbidden` по клику. Контроль доступа (middleware + page-гард) был корректен и до правки — чинилась только **видимость**.

### Task 2 — ось 1: единый redirect-контракт под-ролей + словарь (`db6f2ed`)
- `src/lib/auth/requireRole.ts`: `requireManagerLeader` при нехватке elevation теперь редиректит на `/forbidden` (было `/manager/dashboard`) — как `requirePartnerAdmin` и `requireOrganizationAdminOrLeader`. QA-смоук уже ожидал `/forbidden` → код приведён к задокументированному намерению.
- `src/lib/auth/jwt.ts`: комментарий-словарь под-ролей над тремя type-алиасами (значения СТАБИЛЬНЫ — миграция дорогая; зафиксировано, что партнёрский админ = `partnerRole='admin'`, а `partnerRole='manager'` — обычный scoped-партнёр, не связанный со строкой top-level `Role 'manager'`). Изначальная инверсия в этом словаре поймана финальным holistic-ревью и исправлена (`fix(auth): correct inverted partner sub-role glossary`).
- `requireManagerForOrg`/`ForOrder` намеренно НЕ тронуты: их `/manager/dashboard`-redirect — это scope-deny, а не elevation-deny.

### Task 3 — ось 4: Model A — убрать «мёртвые двери» admin (`c07996a`)
- `src/lib/auth/access.ts`: из `protectedPrefixes` убран `admin` у `/partner` и `/organization`. Правило стало единым: кабинетный префикс пускает только свою роль. Admin-омнипотентность нетронута — живёт в `/admin/*` зеркале + `policy.ts` (`return true`) + `/api/*`, а не во входе в чужие кабинеты. `/student` оставлен shared-entry (намеренно, с серверным гейтом на выпуск bridge-токена).
- `CLAUDE.md` §4: задокументировано правило Model A.

## Verification

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 warnings / 0 errors
npm run test:unit   # 140 файлов, 1151 passed, 0 failed
```

- Mode-разделение L2 (unit): integration-слой (L3/gate) для P1 **не требуется** — правки не трогают `prisma/`/`worker/`/`services/`.
- RED→GREEN наблюдался по каждому новому тесту перед реализацией (TDD).

## Deviation от плана

**Plan-miss (поймано holistic-проверкой перед правкой):** план Task 3 перечислил для обновления только `auth.middleware.test.ts`, но существующий тест `auth.middleware.partner-subrole.test.ts` («does not apply sub-role check to non-partner roles») ожидал `admin → /partner/team → 200`, опираясь именно на admin в `protectedPrefixes`. После Model A этот тест получал бы 307 и падал. Тест выровнен на новый контракт (admin отбивается на префиксе раньше sub-role проверки) и переименован. Без этой правки Task 4 Step 1 (полный unit) был бы красным.

## Что НЕ входит в P1 (открыто)

- **P2** — ось 5: выровнять флаг messages + внести `chat` в CLAUDE.md §5 (3 точки чтения флага); ось 3: канонизация `require*`-идиомы (partner `getSession`→`requirePartnerAdmin`).
- **P3** — ось 2: унификация навигации org к единому источнику `navByRole` (самое крупное, отдельным планом).
- **Open C-a** — продуктовое решение по manager finance-вью (не код).
