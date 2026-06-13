# Кабинет руководителя — Close-out

> Companion-файл к плану [2026-06-12-leader-cabinet.md](2026-06-12-leader-cabinet.md) (конвенция §8: что отгрузили, а не что планировали). План = «что планировали».

**Дата:** 2026-06-13
**Ветка:** `claude/leader-cabinet` (от `main` после мержа [PR #118](https://github.com/aiprocadm/lk_otsfera/pull/118))
**Метод:** subagent-driven-development (10 задач, на каждую: implementer → spec-review → code-quality-review), + финальное холистическое ревью всей фичи.

## Что отгружено

Шестой полноценный кабинет `/leader/*` для руководителя менеджеров (role=`manager` + суб-роль `managerRole='leader'`), за opt-in флагом `leader_cabinet`.

| Задача | Коммит | Суть |
|---|---|---|
| 1. Флаг | `fa50aee` | `leader_cabinet` в `FEATURE_FLAGS` + `OPT_IN_FLAGS` (выкл. по умолчанию) |
| 2. Доступ | `0cb6747` | `/leader` префикс (`protectedPrefixes`), middleware flag-404-gate (`FEATURE_PREFIXES`), home-редирект лидера на `/leader/dashboard` |
| 3. Навигация | `a28a31c` | `navByRole.leader` (7 пунктов), `NavItem.hiddenWhenFlag` (обратный гейт «Команды»), пункт-вход «Кабинет руководителя» в меню менеджера |
| 4. Шелл | `4a86a36` | `LeaderSidebar` / `LeaderAppShell` (siblings), `app/leader/layout.tsx` (3-я точка гейтинга `notFound()` + `requireManagerLeader`) |
| 5. Данные | `fa07ddb`, `1811608` | `teamModeOverride?` в 5 manager-сервисах (`listOrders`/`listOrganizations`/dashboard `kpis`/`attention`/`events`); `isLeaderSameCompany` хелпер → лидер открывает любой заказ своей компании (деталь, не списки) |
| 6. Команда | `616e1dd` | `/leader/team` (контент `/manager/team`); старый адрес → redirect при флаге ON, прежний рендер сохранён при OFF |
| 7. Сводка | `2640286`, `<decimal-fix>` | `services/leader/dashboard.ts` — company-wide KPI (менеджеры/активные/долг/комиссия) + per-manager агрегаты; Decimal-safe сумма комиссии |
| 8. Страницы | `43c6569` | `/leader/{dashboard,orders,organizations,finance}` + `leader-managers-table.tsx`; все тонкие, re-guard (принцип #6), переиспользуют manager-компоненты с `teamModeOverride:true` |
| 9. Demo | `0a8caa7` | `leader@demo.local` + кнопка «Руководитель» на `/login`; привязка к `firstOrg.companyId` (не `company.id` — заказы живут в per-org компании) |
| 10. Верификация | (этот коммит) | typecheck/lint/unit(1457)/build зелёные; force-dynamic + flag-dependency комментарий |

## Инварианты (Definition of Done)

- **3 точки гейтинга** `leader_cabinet`: middleware (404), nav (`hiddenWhenFlag` + пункт-вход), layout (`notFound()`). ✅
- `rg "teamModeOverride" src/lib/services` → **ровно 5 сервисов**. ✅
- `rg "leader_cabinet" src` → флаг, middleware, cabinet.ts, layout, manager/team-redirect, тесты. ✅
- **C8 cross-company изоляция держится** на всех read-путях лидера (холистическое ревью: «cross-company leak risk: NONE»). `companyId=null` → empty/deny везде, никогда не утечка. Order-detail расширение ограничено `order.companyId === session.companyId`.
- Комиссия видна в `/leader/finance`, НЕ видна в `/manager/finance` рядового менеджера (инвариант не сломан).
- «Играющий тренер»: личный `/manager/*` кабинет лидера остаётся scoped (override — opt-in per call).
- typecheck / lint / test:unit (1457) / build (62 страницы, 5 leader-роутов) — зелёные.

## Решения по ходу (отклонения/находки)

- **«Сообщения» лидера → `/manager/messages`** (не дубль `/leader/messages`): сообщения персональны, дубль не добавил бы функции (зафиксировано в плане).
- **Demo companyId**: заказы сида привязаны к per-org компании (`firstOrg.companyId`), создаваемой sync-процессором, а НЕ к `company.id` (`demo-company`). Лидер/менеджер/демо-комиссия перепривязаны к `firstOrg.companyId` + guard, иначе кабинет пуст. (Находка имплементера Task 9.)
- **Decimal-safe комиссия** (Task 7): сумма по секциям через `Prisma.Decimal.plus`, не JS-float (соответствие `commission/calculator.ts`).
- **`isLeaderSameCompany` хелпер** (Task 5): дедуп security-предиката между `getOrder` и `requireManagerForOrder` — устранён риск дрейфа на критичном пути.

## Зависимость флагов / runbook-нота

**`leader_cabinet` включать ТОЛЬКО вместе с `manager_cabinet`.** Пункты-мосты leader-меню (`/manager/messages`, `/manager/dashboard`) живут под `manager_cabinet`; при `manager_cabinet=OFF` они 404-ят. На практике лидер всегда и менеджер. Задокументировано комментарием в `cabinet.ts` и здесь. Global-boolean флаг = redeploy web+worker (см. C7 staged-rollout runbook).

## Оставшийся ручной шаг (operator)

**Browser-smoke (Task 10 шаги 2–3) не выполнен в этой сессии** — требует живого Postgres + seed + флаги ON в `.env`. Cross-company инвариант покрыт unit-тестами (Task 5), но визуальная проверка KPI/ростера/комиссии/переезда «Команды» — за оператором по чеклисту плана Task 10. Инфра-нюансы: seed.ts не завершается сам (BullMQ), `:3000` может быть занят, Postgres в WSL засыпает.

## Тесты

Новые/затронутые unit-файлы: `featureFlags.leader`, `auth.middleware.leader`, `navigation.cabinet.leader`, `components.leader-sidebar`, `services.manager.orders.override`, `auth.requireManager` (+leader-кейсы), `auth.managerPolicy` (+`isLeaderSameCompany`), `services.leader.dashboard`, `components.leader-managers-table`. Полный unit: **1457 зелёных**.
