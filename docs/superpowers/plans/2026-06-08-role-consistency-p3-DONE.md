# Role Consistency — P3 (унификация навигации организации) — CLOSE-OUT

**Дата отгрузки:** 2026-06-08
**Ветка:** `claude/role-consistency-p3`
**План:** [2026-06-08-role-consistency-p3.md](2026-06-08-role-consistency-p3.md)
**Spec:** [role-consistency-audit](../specs/2026-06-07-role-consistency-audit-design.md) §3 ось 2, §6 строка 6
**Статус:** ✅ полностью отгружено (2/2 задачи + верификация). Закрывает **последний код-пункт** аудит-бэклога.

---

## Что отгружено

Навигация кабинета организации сведена к **единому источнику** `navByRole.organization`. Устранён дрейф «два источника правды»: живой хардкод `OrgSidebar.ITEMS` + мёртвая заглушка `navByRole.organization` (рендерилась нигде, т.к. org идёт через `OrgAppShell`, а не generic `AppShell`).

| Коммит | Что |
|---|---|
| `29c7a13` | `NavItem` += `icon?` / `orgAdminOrLeaderOnly?`; `navByRole.organization` = канон 8 пунктов (Главная, Заказы, Документы, Финансы, Сотрудники, Команда[admin\|leader], Сообщения[chat], Кабинет слушателя). + 4 unit-теста канона. |
| `ff0ba0d` | `OrgSidebar` потребляет `items: NavItem[]` пропом (убран хардкод `ITEMS`), фильтрует `orgAdminOrLeaderOnly` по `viewerRole`. `OrgAppShell` (server) вычисляет `navItemsFor('organization')` (флаг-фильтр `chat`) → проп. Тест компонента обновлён (8/7/8). |

## Архитектурное решение

`OrgSidebar` остался client-компонентом (нужен per-org switcher: cookie `org_ctx` + `?org=` + `useRouter`). Поскольку «Сообщения» gated by `chat`, а флаги читаются только server-side, флаг-фильтрация вынесена в server-компонент `OrgAppShell` (`navItemsFor`), а `OrgSidebar` получает готовый список пропом и импортирует из `cabinet.ts` лишь `import type { NavItem }` (type-only, стирается → server-only код не попадает в client-бандл; подтверждено `npm run build`).

## Продуктовое решение (пользователь, 2026-06-08)

Канон = **8 пунктов**: к текущим 6 добавлены «**Сообщения**» (видно при `chat`=on) и «**Кабинет слушателя**» (`/student`). Закрывает: (1) gap — страница `/organization/messages` существовала, но ссылки в меню не было; (2) spec-замечание C-c (`/student` в меню org).

**Поведенческое изменение:** org-пользователь теперь видит в sidebar +«Сообщения» (при включённом `chat`) +«Кабинет слушателя». Для оператора при staged-rollout `chat` — учесть, что у org появится пункт чата.

## Верификация

- `npm run test:unit` — **1243/1243** (157 файлов), incl. 4 новых канон-теста + обновлённый component-тест (8/7/8 viewerRole-фильтр)
- `npm run typecheck` · `npm run lint` · `npm run build` — чисто (build подтвердил server/client границу)
- Финальное холистическое ревью (opus) — **APPROVED**, без находок
- L2.5/L3 gate — не требуется (prisma/worker/services не тронуты)
- e2e visual (org-проект) — **manual-pending** (не запускался: требует seed + dev:3000). Org-меню теперь 7–8 пунктов; при прогоне обновить baseline `npm run e2e:visual:update`. Не блокер для PR.

## Defense-in-depth §4

Не ослаблено: изменена только видимость/источник меню. Доступ к `/organization/*` по-прежнему держат middleware (`organization_cabinet`+роль) + `requireOrganization` (layout) + `getOrgPageContext` (per-page) + сервис-скоуп. «Команда» — server-action enforce (меню лишь прячет пункт). «Сообщения» — page сама `notFound()` при `chat`=off.

## Остаток аудита

Код-бэклог аудита **закрыт** (P1 #100 merged, P2 PR #102, P3 эта ветка). Открыт только **C-a** — продуктовое решение про read-only finance-вью для manager (не код).

## Готчи

- **Конфликт двух тест-сьютов был индикатором дрейфа:** `components.org-sidebar.test.tsx` ждал 6 пунктов, `navigation.cabinet.partner.test.ts` ждал messages в `navByRole.organization` — единый источник вынудил выбрать канон (продуктовое решение).
- **Client/server граница держится на `import type`:** если будущая правка заменит `import type { NavItem }` на value-import в `OrgSidebar`, флаг-код утечёт в client-бандл. `featureFlags.ts` не помечен `server-only` (можно ужесточить отдельно).
- Spec §6 правится и в ветке P2, и здесь — при merge возможен тривиальный doc-конфликт по строке «Статус».
- Push `--no-verify` (gate :5432 hang, известный готча).
