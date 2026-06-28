# Finance-хаб организации + роль `leader` — close-out (DONE)

**Дата:** 2026-06-04 · **Ветка:** `claude/org-finance-hub` · **Спека:** [organization-finance-hub-design](../specs/2026-06-04-organization-finance-hub-design.md) · **План:** [organization-finance-hub](2026-06-04-organization-finance-hub.md)

Компаньон к плану (не замена). План — «что собирались», этот файл — «что отгрузили». Трек **C / C1** из [completion-roadmap](../specs/2026-06-02-completion-roadmap.md).

## Статус

**Отгружено в ветку `claude/org-finance-hub` (16 коммитов).** Гейтится существующим opt-in флагом `organization_cabinet` (новый флаг не вводили). Реализовано через subagent-driven-development: implementer → spec-review → code-quality-review на каждую задачу + финальный сквозной ревью.

## Что отгрузили

| Слой | Содержимое |
|---|---|
| Роль `leader` | `OrgRoleInOrg` → `admin\|leader\|member` (без миграции — `roleInOrg` это `String?`); `isOrgLeader` / `canSeeIntermediaryCommission`; `requireOrganizationAdminOrLeader`; `viewerRole` расширен в `getOrgPageContext`/shell/sidebar |
| Team (RBAC) | `team.ts` принимает `actorRole` (default `admin`) + privesc-guard'ы (`requires_admin`): leader не создаёт/не трогает admin — включая ветку реактивации в `inviteMember`; server-action деривит `actorRole` из сессии; zod-энумы расширены |
| Team UI | страница «Команда» открыта admin+leader; `TeamTable` — 3-way выбор роли, гейтится по вьюеру (admin-опция и admin-строки недоступны лидеру); invite-форма: опция «Руководитель» + скрытие admin от лидера; сайдбар показывает «Команда» лидеру |
| Finance-сервис | `organization/finance.ts`: `getOrgFinanceKpis` (выставлено/оплачено/долг по billed-заказам), `listOrgPayments` (консолидированная лента, refund-aware), `getOrgIntermediaryCommission` (live-расчёт `effectiveRate × база`, reuse `commission/calculator`) |
| Finance UI | `/organization/finance` (server component); презентационные `org-finance-{kpis,payments,commission}`; пункт «Финансы» в сайдбаре (всем) |
| Гейтинг комиссии | field-level: `getOrgIntermediaryCommission` вызывается и рендерится **только** для admin/leader → member не получает данные даже в HTML |

## Верификация

- **lint** чисто · **typecheck** чисто · **unit: 1082** (135 файлов) · **integration L3: полный прогон** зелёный · **`next build`** собрался (`/organization/finance` в роутах).
- Новые тесты: политики (incl. неактивный leader), guard, privesc-guard'ы команды (incl. реактивация admin), server-action leader-actor, finance-сервис (KPI/ledger/commission + fallback ставки), сайдбар (leader=6), login-loader (сохранение `leader`).

## Финальный сквозной ревью поймал (исправлено до merge)

- 🔴 **CRITICAL (producer/consumer рассинхрон):** `src/app/api/auth/login/route.ts` собирал `organizationMemberships`, схлопывая любой не-`admin` в `member` → `leader` **никогда не попадал в JWT**, и вся фича была мертва для целевой роли (leader не видел комиссию, на `/organization/team` получал `/forbidden`) на все 7 дней токена. Файл **вне ветки** и без leader-покрытия — поэтому по-задачные ревью пропустили. Безопасность не страдала (login только сужает роли). **Фикс:** 3-way маппинг + login-loader регрессионный тест.
- 🟠 **Реактивация-privesc:** `inviteMember` при реактивации перезаписывал `roleInOrg`, так что leader мог пере-пригласить деактивированного admin'а как member (разжаловать). **Фикс:** in-transaction guard на роль существующей записи + тест.
- Минор: invite-форма скрыла admin-опцию от лидера (симметрия с таблицей); конфликт `overflow-hidden`/`overflow-x-auto`.

## Отложено в v2 (задокументировано, не тихие пробелы)

- Экспорт акта сверки / истории платежей (PDF/XLSX) — потребует новых job-типов генерации.
- Секция «К оплате» (неоплаченные заказы) — частично дублирует `/orders?financialStatus`.
- Полная иерархия `member → manager → leader`; синхронизация роли `leader` из 1С.
- *(минор)* `fmtMoney` дублируется по компонентам (house-паттерн §4); `isNaN` vs `Number.isFinite` косметика.

## Гочи для будущего

- **Новая роль организации = править ДВА конца.** `roleInOrg` — `String?`, но при добавлении роли надо обновить и **producer** (`login/route.ts`, сборка JWT-memberships), и всех consumer'ов (`OrgRoleInOrg`, политики, guard, `normaliseRole`, UI). Producer вне «доменной» ветки и легко забывается — закрыто регрессионным тестом на login-loader'е.
- **L1-гейт не ловит integration:** pre-commit гоняет `test:changed` в unit-режиме; файлы с `new PrismaClient(` исключаются → integration-тесты надо гонять вручную (`npm run test:integration`) до пуша.
- Длинный субагент-диспатч может упасть на одном connection-timeout'е, потеряв прогресс; короткие inline-правки устойчивее при флакающем соединении. Реализацию вёл inline, ревью — короткоживущими субагентами.
