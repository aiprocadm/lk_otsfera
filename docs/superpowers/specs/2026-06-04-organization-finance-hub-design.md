# Finance-хаб организации + роль `leader` — дизайн v1

**Дата:** 2026-06-04
**Статус:** на ревью (брейнсторм завершён — все развилки закрыты)
**Трек:** C (бэклог-доработки), под-проект **C1** из [completion-roadmap](2026-06-02-completion-roadmap.md)
**Под-навык реализации:** `superpowers:subagent-driven-development`

---

## Контекст

У партнёра есть `/partner/finance` ([page](../../../src/app/partner/finance/page.tsx) + [service](../../../src/lib/services/partner/finance.ts)) — он построен на **комиссиях** (`CommissionStatement`), которые зарабатывает партнёр-посредник. У организации финансового хаба нет (route отсутствует — подтверждено roadmap C1).

«Финансы» для организации — это **не комиссии, а деньги по её заказам**: сколько выставлено, оплачено, сколько долг, и история платежей. Это уже частично разбросано по кабинету (дашборд считает `outstandingAmount`, `/orders` показывает суммы и долг по каждому заказу), но **консолидированной ленты платежей нет нигде**.

Дополнительно: руководство организации хочет видеть **комиссию партнёра-посредника** по своим заказам — но это чувствительные данные, которые не должны видеть рядовые сотрудники. Это вводит новую роль организации **`leader`** (сегодня в модели только `admin` / `member`).

## Доменная модель

- **Заказ** ([`Order`](../../../prisma/schema.prisma)): `totalAmount`, `paidAmount`, `financialStatus` (`not_billed | billed | partially_paid | paid | refunded`), `vatIncluded` / `vatRate`.
- **Платёж** (`Payment`): `amount`, `paidAt`, `method`, `isRefund`, `note` — привязан к заказу.
- **Эффективная ставка посредника** = `Organization.partnerCommissionRate ?? Partner.commissionRate` (per-org override с историей; fallback на дефолт партнёра) — ровно так считает [`commission/statement.ts`](../../../src/lib/services/commission/statement.ts).
- **База комиссии** = `order.totalAmount` (минус НДС в режиме `exclude_vat`), **комиссия** = база × ставка — логика в [`commission/calculator.ts`](../../../src/lib/services/commission/calculator.ts).
- **Роли организации**: `roleInOrg` в БД — `String?` ([`OrganizationUser`](../../../prisma/schema.prisma)); TS-тип `OrgRoleInOrg = 'admin' | 'member'` ([jwt.ts](../../../src/lib/auth/jwt.ts)). Скоуп страниц — `getOrgPageContext` → `activeOrgId` + `viewerRole`.

## Решения брейнсторма (финал)

| # | Вопрос | Решение |
|---|---|---|
| 1 | Что значит «финансы» для орг | Деньги по её заказам (выставлено/оплачено/долг + платежи), **не** комиссии |
| 2 | Состав v1 | **KPI + консолидированная лента платежей** (read-only). Без секции «К оплате», без экспорта |
| 3 | Комиссия посредника | **Показываем** в отдельном блоке, видимом только `admin` + `leader` |
| 4 | Источник суммы комиссии | **Live-расчёт** (`effectiveRate × база`, reuse `calculator.ts`); подпись «оценка по текущей ставке» |
| 5 | Видимость KPI + платежей | Всем членам организации (консистентно: эти данные уже видны на дашборде и в `/orders`) |
| 6 | Роль `leader` | Расширенная: **видит комиссию + управляет командой** (по матрице ниже) |
| 7 | Схема БД | **Без миграции**: `roleInOrg` — `String?`, новое значение `'leader'` не меняет колонку |

## Скоуп v1

**Делаем:**
- Страница `/organization/finance` (sibling-роль в `OrgAppShell`).
- Сервис `src/lib/services/organization/finance.ts`: `getOrgFinanceKpis`, `listOrgPayments`, `getOrgIntermediaryCommission`.
- Роль `leader`: расширение `OrgRoleInOrg`, политики `isOrgLeader` / `canSeeIntermediaryCommission`, виджет назначения на странице «Команда», privilege-escalation guard'ы в team-сервисе.
- Блок «Комиссия посредника» с field-level гейтингом (server-side: member физически не получает данные).
- Пункт «Финансы» в `OrgSidebar` (всем; блок комиссии гейтится внутри страницы).
- Тесты: unit (KPI/ставка/guard'ы), integration (изоляция орг + field-level + live-расчёт).

**НЕ делаем в v1 (вынесено → v2):**
- Экспорт акта сверки / истории платежей (PDF/XLSX) — потребует новых job-типов генерации.
- Секция «К оплате» (неоплаченные заказы) — частично дублирует `/orders?financialStatus`.
- Полная иерархия `member → manager → leader` — вводим только `leader`; «менеджеры/сотрудники» = `member`.
- Синхронизация роли `leader` из 1С; роль назначается вручную админом организации.

## Архитектура

### Данные — без миграции схемы

Ничего не добавляем в Prisma. Всё нужное уже есть: `Order.{totalAmount,paidAmount,financialStatus}`, `Payment`, `Organization.partnerCommissionRate`, `Partner.commissionRate`. `roleInOrg` — `String?`, значение `'leader'` пишется как обычная строка.

### Комиссия посредника — live-расчёт (оценка)

```
effectiveRate(org) = org.partnerCommissionRate ?? partner.commissionRate
base(order)        = baseAmountFor(order, vatMode)         // reuse calculator.ts
commission(order)  = round2(base(order) * effectiveRate)
```

- Покрывает **все** заказы организации (в отличие от `CommissionStatementItem`, который появляется только после генерации отчёта партнёра и отстаёт).
- Блок показывает: текущую `effectiveRate` (%) + суммарную оценочную комиссию + per-order разбивку (переиспользуем уже выбранные заказы). Подписан «оценка».
- `vatMode` по умолчанию — `full` (база = `totalAmount`); вынесено в открытые вопросы.

### Роль `leader` — матрица прав (security-ядро)

| Возможность | member | leader | admin |
|---|:--:|:--:|:--:|
| KPI + лента платежей | ✓ | ✓ | ✓ |
| Блок «Комиссия посредника» | ✗ | ✓ | ✓ |
| Доступ к странице «Команда» | ✗ | ✓ | ✓ |
| Пригласить / деактивировать **member или leader** | ✗ | ✓ | ✓ |
| Назначить роль **admin**, изменить/деактивировать **admin** | ✗ | **✗** | ✓ |

**Guard'ы (defense-in-depth, §4) — против privilege escalation:**
- Актор-`leader` может действовать только на цели с ролью `member`/`leader` и задавать `newRole ∈ {member, leader}`. Любая операция, затрагивающая `admin` (как цель **или** как назначаемую роль), запрещена → нет пути самоповышения до `admin`.
- `assertNotLastActiveAdmin` сохраняется (защита последнего админа неизменна).
- Новый стабильный код ошибки `'requires_admin'` в `OrgMemberErrorCode`.

### Слои (CLAUDE.md §2)

**Сервис** `src/lib/services/organization/finance.ts`:
- `getOrgFinanceKpis(prisma, organizationId)` → `{ billed, paid, outstanding }` (агрегаты `Order`, как дашборд; точные бакеты по `financialStatus` фиксируются TDD-тестами; возвраты видны отдельно в ленте платежей).
- `listOrgPayments(prisma, { organizationId, take })` → лента платежей (узкий select §13: amount, paidAt, method, isRefund, note, orderId, orderNumber).
- `getOrgIntermediaryCommission(prisma, organizationId)` → `{ effectiveRate, totalCommission, perOrder[] }`. **Вызывается только для admin/leader** — не тащим данные, которые member видеть не должен.

**Team-сервис** [`organization/team.ts`](../../../src/lib/services/organization/team.ts) — расширение `'admin' | 'member'` → `'admin' | 'leader' | 'member'` в `normaliseRole`, `OrgMemberRow`, `InviteMemberInput`, сигнатурах `updateMemberRole`/`inviteMember`/`deactivate`/`reactivate`; добавить параметр `actorRole` и guard'ы выше.

**Guard** [`requireRole.ts`](../../../src/lib/auth/requireRole.ts) — новый `requireOrganizationAdminOrLeader(orgId)` (возвращает session; роль актора резолвится из `organizationMemberships`).

**Server-action** [`organization/team.ts`](../../../src/server-actions/organization/team.ts) — zod-схемы `z.enum(['admin','member'])` → `['admin','leader','member']`; для team-мутаций сменить guard на `requireOrganizationAdminOrLeader` и пробросить `actorRole` в сервис. Новый код мапится в `Failure`.

**Страница** `src/app/organization/finance/page.tsx` — server component: `getOrgPageContext` → KPI + платежи всегда; комиссия — только если `viewerRole ∈ {admin, leader}`.

### RBAC — три слоя (§4)

1. **Middleware** — `/organization/*` уже отрезает чужие роли (флаг `organization_cabinet`).
2. **Страница / server-action** — `getOrgPageContext` → `requireOrganization` + резолв `activeOrgId` (членство проверяется внутри); team-мутации — `requireOrganizationAdminOrLeader`.
3. **Сервис** — все finance-функции принимают `organizationId` (= resolved `activeOrgId`), выборки жёстко фильтруются по нему. Поверх этого — **field-level гейтинг комиссии**: `getOrgIntermediaryCommission` вызывается и рендерится **только** при `isOrgAdmin || isOrgLeader`, иначе member не получает эти данные даже в HTML.

### UI — sibling-компоненты `organization-*` (§4)

- Новые `org-finance-kpis`, `org-finance-payments`, `org-finance-commission` (НЕ переиспользуем партнёрский `CommissionStatementsList` — другая сущность, другие действия). Делим только domain-agnostic `StatCard`.
- `OrgSidebar` ([sidebar](../../../src/components/organization/org-sidebar.tsx)): пункт «Финансы» (иконка `₽`/`💰`), **без** `adminOnly` (блок комиссии гейтится на странице).
- `getOrgPageContext` / `OrgAppShell` / `OrgSidebar`: тип `viewerRole` расширяется `'admin' | 'leader' | 'member'`.
- Страница «Команда» ([page](../../../src/app/organization/team/page.tsx)): переключатель ролей и инвайт получают опцию `leader`; видна также `leader` (с урезанными возможностями по матрице).
- Русские строки, английские коды/идентификаторы, оранжевая палитра (§13).

## Тестовая стратегия (§6)

- **Unit** (`vi.hoisted` + `vi.mock`):
  - `getOrgFinanceKpis` — корректность billed/paid/outstanding, учёт `isRefund`/`refunded`.
  - Резолвинг `effectiveRate` (org override ?? partner default) и live-комиссия = ставка × база.
  - `normaliseRole('leader')`; `isOrgLeader`; `canSeeIntermediaryCommission`.
  - **Privilege-escalation guard'ы**: leader НЕ может выдать `admin`, изменить/деактивировать `admin` (каждый кейс → `requires_admin`); admin может всё (с last-admin guard).
- **Integration** (`new PrismaClient`, авто-детект режима):
  - Изоляция: член организации A не видит финансы/платежи B.
  - Field-level: для `member` блок комиссии не отдаётся; для `leader`/`admin` — отдаётся.
  - Live-комиссия на сид-данных совпадает с ожидаемой ставкой; учёт per-org override.
- **e2e (опц.)** `organization-finance.spec.ts`: рендер KPI + скрытие блока комиссии у member.
- **Без нового worker-процессора** → guardrail [worker.processor-coverage](../../../src/__tests__/worker.processor-coverage.guardrail.test.ts) не затрагивается.

## Открытые вопросы (на ревью)

1. **`vatMode` для базы комиссии** — предлагаю `full` (база = `totalAmount`, gross), т.к. это «оценка» и проще всего. Если нужен паритет со статементами — уточнить дефолтный режим генерации.
2. **Гранулярность блока комиссии** — показывать per-order разбивку или только агрегат (ставка + сумма)? Предлагаю агрегат + сворачиваемая per-order таблица.
3. **Инвайт сразу как `leader`** — разрешить (`inviteMember` поддержит `leader`) или только смена роли после инвайта? Предлагаю разрешить инвайт как `leader`.
4. **Точная граница team-прав `leader`** — матрица выше (leader управляет только member/leader, не трогает admin). Подтвердить.

## Фазы

- **v1 (эта спека):** finance-хаб (KPI + лента платежей + блок комиссии gated) + роль `leader` (комиссия + управление командой) + privilege-escalation guard'ы.
- **v2:** экспорт акта сверки (PDF/XLSX), секция «К оплате», иерархия ролей, sync `leader` из 1С.
